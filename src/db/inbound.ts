import crypto from 'node:crypto';
import { and, asc, desc, eq, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  buildingDoors,
  coils,
  inboundReceiptItems,
  inboundReceipts,
  inventory,
  locationReservations,
  stockTransactions,
  storageLocations,
  users,
  warehouseLevels,
  warehouseRows,
  zones,
} from './schema.ts';
import {
  allocateLocationsForCoils,
  analyzeCoilMissingData,
  buildSlotSupportKey,
  checkPyramidStackingSupport,
  computeBatchSummaryStatus,
  evaluateRowSlotsForCoil,
  normalizeScannedIdentifier,
  normalizeScannedLocationCode,
  resolveEffectiveCoilWeightKg,
  validatePhysicalPlacementScan,
  type CoilReferenceForAllocation,
  type LocationCandidateForAllocation,
  type OccupiedSlotSupportInfo,
} from '../utils/inboundAllocationEngine.ts';
import { validateCoilCapacityFit, type LocationStatus, type StackingRule } from '../utils/warehouseMath.ts';
import type {
  AllocationRecommendationItem,
  BatchReferenceCoilItem,
  InboundBatchScanResponse,
  InboundConfirmPlacementResponse,
  InboundDirectPlaceRequest,
  InboundDirectPlaceResponse,
  InboundHistoryReceipt,
  InboundHistoryResponse,
  InboundRecommendResponse,
  InboundReleaseResponse,
  InboundReserveResponse,
  InboundRowSlotsResponse,
  PendingSapBatchSummary,
  RowLevelSlotsGroup,
  RowSlotEvaluationItem,
} from '../types/inbound.ts';

export interface InboundActor {
  userId: number;
  email: string;
  roleCode: string;
  ip: string | null;
}

export type InboundRealtimeEventType =
  | 'location:reserved'
  | 'location:released'
  | 'inbound:confirmed'
  | 'location:updated';

export type InboundEventEmitter = (
  eventType: InboundRealtimeEventType,
  payload: Record<string, unknown>
) => void;

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

function generateReceiptNo(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `RCP-${ymd}-${suffix}`;
}

function generateTransactionNo(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `TX-IN-${ymd}-${suffix}`;
}

function isPgUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const anyErr = err as { code?: string; cause?: { code?: string } };
  return anyErr.code === '23505' || anyErr.cause?.code === '23505';
}

/**
 * Atomically expires all stale ACTIVE reservations where expires_at <= now
 * and safely reverts affected RESERVED storage_locations back to EMPTY
 * (provided no active inventory or other active reservation exists on them).
 */
export async function expireStaleReservations(
  executor: DbExecutor = db,
  now: Date = new Date()
): Promise<{ expiredCount: number; freedLocationIds: number[] }> {
  const expiredRows = await executor
    .update(locationReservations)
    .set({
      status: 'EXPIRED',
      releasedAt: now,
      releaseReason: 'TTL_EXPIRED',
    })
    .where(and(eq(locationReservations.status, 'ACTIVE'), lte(locationReservations.expiresAt, now)))
    .returning({
      id: locationReservations.id,
      locationId: locationReservations.locationId,
      coilId: locationReservations.coilId,
    });

  if (expiredRows.length === 0) {
    return { expiredCount: 0, freedLocationIds: [] };
  }

  const expiredIds = expiredRows.map((r) => r.id);
  const candidateLocIds = Array.from(new Set(expiredRows.map((r) => r.locationId)));

  // Revert pending receipt items that pointed to expired reservations
  await executor
    .update(inboundReceiptItems)
    .set({
      status: 'PENDING',
      reservationId: null,
      updatedAt: now,
    })
    .where(
      and(
        inArray(inboundReceiptItems.reservationId, expiredIds),
        eq(inboundReceiptItems.status, 'RESERVED')
      )
    );

  // Check which locations have no active inventory and no other active reservation
  const activeInvLocs = await executor
    .select({ locId: inventory.currentLocationId })
    .from(inventory)
    .where(
      and(
        inArray(inventory.currentLocationId, candidateLocIds),
        inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
      )
    );
  const occupiedSet = new Set(activeInvLocs.map((r) => r.locId).filter((v): v is number => v !== null));

  const otherActiveResv = await executor
    .select({ locId: locationReservations.locationId })
    .from(locationReservations)
    .where(
      and(
        inArray(locationReservations.locationId, candidateLocIds),
        eq(locationReservations.status, 'ACTIVE')
      )
    );
  const stillReservedSet = new Set(otherActiveResv.map((r) => r.locId));

  const toFreeLocIds = candidateLocIds.filter((id) => !occupiedSet.has(id) && !stillReservedSet.has(id));
  if (toFreeLocIds.length > 0) {
    await executor
      .update(storageLocations)
      .set({ status: 'EMPTY', updatedAt: now })
      .where(and(inArray(storageLocations.id, toFreeLocIds), eq(storageLocations.status, 'RESERVED')));
  }

  return { expiredCount: expiredRows.length, freedLocationIds: toFreeLocIds };
}

/**
 * Loads occupied slot weights for pyramid stacking safety verification.
 */
async function loadOccupiedSlotSupport(executor: DbExecutor): Promise<OccupiedSlotSupportInfo[]> {
  const rows = await executor
    .select({
      rowId: storageLocations.rowId,
      levelNumber: warehouseLevels.levelNumber,
      slotNumber: storageLocations.slotNumber,
      locationCode: storageLocations.locationCode,
      weightKg: coils.weightKg,
      grossWeightKg: coils.grossWeightKg,
      netWeightKg: coils.netWeightKg,
    })
    .from(inventory)
    .innerJoin(coils, eq(inventory.coilId, coils.id))
    .innerJoin(storageLocations, eq(inventory.currentLocationId, storageLocations.id))
    .innerJoin(warehouseLevels, eq(storageLocations.levelId, warehouseLevels.id))
    .where(inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD']));

  return rows.map((r) => ({
    rowId: r.rowId,
    levelNumber: r.levelNumber,
    slotNumber: r.slotNumber,
    locationCode: r.locationCode,
    coilWeightKg: resolveEffectiveCoilWeightKg(r) ?? 0,
  }));
}

/**
 * Helper to fetch coils belonging to a Batch Number while strictly preserving Leading Zeros.
 */
async function findCoilsByBatchNo(executor: DbExecutor, batchNoRaw: string) {
  const normalized = normalizeScannedIdentifier(batchNoRaw);
  if (!normalized) return { matchedBatchNo: '', rows: [] as Array<typeof coils.$inferSelect> };

  const exactRows = await executor
    .select()
    .from(coils)
    .where(eq(coils.batchNo, normalized))
    .orderBy(asc(coils.coilId));

  if (exactRows.length > 0) {
    return { matchedBatchNo: exactRows[0].batchNo, rows: exactRows };
  }

  // Case-insensitive exact fallback (still strictly preserving leading zeros!)
  const ciRows = await executor
    .select()
    .from(coils)
    .where(sql`UPPER(${coils.batchNo}) = UPPER(${normalized})`)
    .orderBy(asc(coils.coilId));

  if (ciRows.length > 0) {
    return { matchedBatchNo: ciRows[0].batchNo, rows: ciRows };
  }

  return { matchedBatchNo: normalized, rows: [] as Array<typeof coils.$inferSelect> };
}

/**
 * Lists SAP Reference Batches available for Batch-First Inbound Receiving.
 * Read-only on inventory & locations.
 */
export async function listPendingSapBatches(
  search?: string,
  limit = 30
): Promise<PendingSapBatchSummary[]> {
  await expireStaleReservations(db);
  const now = new Date();
  const cleanSearch = search?.trim();

  const allCoilRows = await db
    .select({
      id: coils.id,
      batchNo: coils.batchNo,
      materialCode: coils.materialCode,
      materialDescription: coils.materialDescription,
      grade: coils.grade,
      weightKg: coils.weightKg,
      grossWeightKg: coils.grossWeightKg,
      netWeightKg: coils.netWeightKg,
      sourceType: coils.sourceType,
      lifecycleStatus: coils.lifecycleStatus,
      importedAt: coils.importedAt,
      createdAt: coils.createdAt,
    })
    .from(coils)
    .where(
      cleanSearch
        ? or(
            ilike(coils.batchNo, `%${cleanSearch}%`),
            ilike(coils.materialCode, `%${cleanSearch}%`),
            ilike(coils.grade, `%${cleanSearch}%`)
          )
        : undefined
    )
    .orderBy(desc(coils.createdAt));

  if (allCoilRows.length === 0) return [];

  const coilIds = allCoilRows.map((c) => c.id);

  const [activeInvRows, activeResvRows] = await Promise.all([
    db
      .select({ coilId: inventory.coilId })
      .from(inventory)
      .where(
        and(
          inArray(inventory.coilId, coilIds),
          inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
        )
      ),
    db
      .select({ coilId: locationReservations.coilId })
      .from(locationReservations)
      .where(
        and(
          inArray(locationReservations.coilId, coilIds),
          eq(locationReservations.status, 'ACTIVE'),
          sql`${locationReservations.expiresAt} > ${now}`
        )
      ),
  ]);

  const receivedCoilSet = new Set(activeInvRows.map((r) => r.coilId));
  const reservedCoilSet = new Set(activeResvRows.map((r) => r.coilId));

  const byBatch = new Map<string, typeof allCoilRows>();
  for (const row of allCoilRows) {
    const list = byBatch.get(row.batchNo) ?? [];
    list.push(row);
    byBatch.set(row.batchNo, list);
  }

  const summaries: PendingSapBatchSummary[] = [];
  for (const [batchNo, batchRows] of byBatch.entries()) {
    const metrics = computeBatchSummaryStatus(
      batchRows.map((c) => {
        const analysis = analyzeCoilMissingData(c);
        const isReceived = receivedCoilSet.has(c.id) || c.lifecycleStatus === 'IN_STOCK';
        return {
          isReceived,
          hasActiveReservation: !isReceived && reservedCoilSet.has(c.id),
          hasMissingData: analysis.hasMissingData,
          effectiveWeightKg: analysis.effectiveWeightKg,
        };
      })
    );

    const first = batchRows[0];
    const latestDate = batchRows.reduce<Date | null>((acc, r) => {
      const candidate = r.importedAt ?? r.createdAt;
      if (!acc || candidate > acc) return candidate;
      return acc;
    }, null);

    const pendingSapCoils = batchRows.filter((r) => r.sourceType === 'PRE_SAP_INBOUND').length;

    summaries.push({
      batchNo,
      materialCode: first.materialCode || null,
      materialDescription: first.materialDescription ?? null,
      grade: first.grade ?? null,
      totalCoils: metrics.totalCoils,
      receivedCoils: metrics.receivedCoils,
      reservedCoils: metrics.reservedCoils,
      pendingCoils: metrics.pendingCoils,
      pendingSapCoils,
      totalWeightKg: metrics.totalWeightKg,
      batchStatus: metrics.batchStatus,
      latestImportedAt: latestDate ? latestDate.toISOString() : null,
    });
  }

  // Sort: active/pending batches first, then completed, then newest imported
  const statusRank: Record<string, number> = {
    PARTIALLY_RECEIVED: 0,
    RESERVED_IN_PROGRESS: 1,
    READY_TO_RECEIVE: 2,
    COMPLETED: 3,
    EMPTY: 4,
  };

  summaries.sort((a, b) => {
    const ra = statusRank[a.batchStatus] ?? 9;
    const rb = statusRank[b.batchStatus] ?? 9;
    if (ra !== rb) return ra - rb;
    return (b.latestImportedAt ?? '').localeCompare(a.latestImportedAt ?? '');
  });

  return summaries.slice(0, Math.max(1, Math.min(limit, 100)));
}

/**
 * Step 1–3 of Batch-First Inbound Workflow:
 * Scans a Batch Number and retrieves read-only SAP Reference Data for all coils in that Batch.
 * CRITICAL: NEVER creates Inventory, NEVER reserves locations, NEVER marks coils IN_STOCK.
 */
export async function scanBatchReference(
  batchNoRaw: string,
  actor: InboundActor
): Promise<InboundBatchScanResponse> {
  const normalized = normalizeScannedIdentifier(batchNoRaw);
  if (!normalized) {
    throw new Error('VALIDATION: กรุณาสแกนหรือระบุหมายเลข Batch Number');
  }

  await expireStaleReservations(db);
  const now = new Date();
  const { matchedBatchNo, rows: batchCoils } = await findCoilsByBatchNo(db, normalized);

  if (batchCoils.length === 0) {
    return {
      found: false,
      preSapMode: true,
      batchNo: normalized,
      materialCode: null,
      materialDescription: null,
      grade: null,
      importBatchId: null,
      receiptId: null,
      receiptNo: null,
      summary: {
        totalCoils: 0,
        receivedCoils: 0,
        reservedCoils: 0,
        pendingCoils: 0,
        missingDataCoils: 0,
        totalWeightKg: 0,
        batchStatus: 'EMPTY',
      },
      coils: [],
      serverTimestamp: now.toISOString(),
    };
  }

  const coilIds = batchCoils.map((c) => c.id);

  const [invRows, activeResvRows, expiredResvRows, latestReceiptRows] = await Promise.all([
    db
      .select({
        coilId: inventory.coilId,
        currentLocationId: inventory.currentLocationId,
        locationCode: storageLocations.locationCode,
        inboundDate: inventory.inboundDate,
        status: inventory.status,
      })
      .from(inventory)
      .leftJoin(storageLocations, eq(inventory.currentLocationId, storageLocations.id))
      .where(
        and(
          inArray(inventory.coilId, coilIds),
          inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
        )
      ),
    db
      .select({
        reservationId: locationReservations.id,
        coilId: locationReservations.coilId,
        locationId: locationReservations.locationId,
        locationCode: storageLocations.locationCode,
        doorCode: buildingDoors.doorCode,
        rowNumber: warehouseRows.rowNumber,
        levelNumber: warehouseLevels.levelNumber,
        slotNumber: storageLocations.slotNumber,
        reservedByUserId: locationReservations.reservedByUserId,
        reservedByEmail: users.email,
        expiresAt: locationReservations.expiresAt,
      })
      .from(locationReservations)
      .innerJoin(storageLocations, eq(locationReservations.locationId, storageLocations.id))
      .innerJoin(buildingDoors, eq(storageLocations.doorId, buildingDoors.id))
      .innerJoin(warehouseRows, eq(storageLocations.rowId, warehouseRows.id))
      .innerJoin(warehouseLevels, eq(storageLocations.levelId, warehouseLevels.id))
      .leftJoin(users, eq(locationReservations.reservedByUserId, users.id))
      .where(
        and(
          inArray(locationReservations.coilId, coilIds),
          eq(locationReservations.status, 'ACTIVE'),
          sql`${locationReservations.expiresAt} > ${now}`
        )
      ),
    db
      .select({ coilId: locationReservations.coilId })
      .from(locationReservations)
      .where(
        and(
          inArray(locationReservations.coilId, coilIds),
          eq(locationReservations.status, 'EXPIRED')
        )
      ),
    db
      .select({
        id: inboundReceipts.id,
        receiptNo: inboundReceipts.receiptNo,
      })
      .from(inboundReceipts)
      .where(eq(inboundReceipts.batchNo, matchedBatchNo))
      .orderBy(desc(inboundReceipts.createdAt))
      .limit(1),
  ]);

  const invByCoil = new Map(invRows.map((r) => [r.coilId, r]));
  const resvByCoil = new Map(activeResvRows.map((r) => [r.coilId, r]));
  const expiredCoilSet = new Set(expiredResvRows.map((r) => r.coilId));

  const coilItems: BatchReferenceCoilItem[] = batchCoils.map((c) => {
    const analysis = analyzeCoilMissingData(c);
    const inv = invByCoil.get(c.id) ?? null;
    const resv = resvByCoil.get(c.id) ?? null;
    const isReceived = Boolean(inv) || c.lifecycleStatus === 'IN_STOCK';

    let inboundStatus: BatchReferenceCoilItem['inboundStatus'] = 'PENDING';
    if (isReceived) {
      inboundStatus = 'RECEIVED';
    } else if (resv) {
      inboundStatus = 'RESERVED';
    } else if (expiredCoilSet.has(c.id)) {
      inboundStatus = 'EXPIRED_RESERVATION';
    }

    return {
      coilDbId: c.id,
      coilId: c.coilId,
      batchNo: c.batchNo,
      materialCode: c.materialCode,
      materialDescription: c.materialDescription ?? null,
      thicknessMm: c.thicknessMm ?? null,
      targetThicknessMm: c.targetThicknessMm ?? null,
      widthMm: c.widthMm ?? null,
      outerDiameterMm: c.outerDiameterMm ?? null,
      innerDiameterMm: c.innerDiameterMm ?? null,
      grade: c.grade ?? null,
      skinpass: c.skinpass ?? null,
      heatNo: c.heatNo ?? null,
      weightKg: c.weightKg ?? null,
      grossWeightKg: c.grossWeightKg ?? null,
      netWeightKg: c.netWeightKg ?? null,
      effectiveWeightKg: analysis.effectiveWeightKg,
      unitOfMeasure: c.unitOfMeasure ?? null,
      sapStorageLocation: c.sapStorageLocation ?? null,
      scannedLocationRef: c.scannedLocationRef ?? null,
      sourceType: c.sourceType,
      isPendingSapSync: c.sourceType === 'PRE_SAP_INBOUND',
      lifecycleStatus: c.lifecycleStatus,
      inboundStatus,
      missingFields: analysis.missingFields,
      criticalMissingFields: analysis.criticalMissingFields,
      hasMissingData: analysis.hasMissingData,
      canAutoAllocate: analysis.canAutoAllocate,
      activeReservation: resv
        ? {
            reservationId: resv.reservationId,
            locationId: resv.locationId,
            locationCode: resv.locationCode,
            doorCode: resv.doorCode,
            rowNumber: resv.rowNumber,
            levelNumber: resv.levelNumber,
            slotNumber: resv.slotNumber,
            reservedByUserId: resv.reservedByUserId,
            reservedByEmail: resv.reservedByEmail ?? null,
            expiresAt: resv.expiresAt.toISOString(),
            isOwnedByActor: resv.reservedByUserId === actor.userId,
          }
        : null,
      confirmedLocationId: inv?.currentLocationId ?? null,
      confirmedLocationCode: inv?.locationCode ?? null,
      confirmedAt: inv?.inboundDate ? inv.inboundDate.toISOString() : null,
    };
  });

  const summary = computeBatchSummaryStatus(
    coilItems.map((item) => ({
      isReceived: item.inboundStatus === 'RECEIVED',
      hasActiveReservation: item.activeReservation !== null,
      hasMissingData: item.hasMissingData,
      effectiveWeightKg: item.effectiveWeightKg,
    }))
  );

  // Audit batch lookup (read-only on inventory & locations)
  await db.insert(auditLogs).values({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'INBOUND_BATCH_SCANNED',
    entityType: 'batch',
    entityId: matchedBatchNo,
    beforeJson: null,
    afterJson: {
      batchNo: matchedBatchNo,
      totalCoils: summary.totalCoils,
      pendingCoils: summary.pendingCoils,
      receivedCoils: summary.receivedCoils,
      batchStatus: summary.batchStatus,
    },
    ipAddress: actor.ip,
  });

  const first = batchCoils[0];
  const latestReceipt = latestReceiptRows[0] ?? null;
  const allPreSap = batchCoils.every((c) => c.sourceType === 'PRE_SAP_INBOUND');

  return {
    found: true,
    preSapMode: allPreSap,
    batchNo: matchedBatchNo,
    materialCode: first.materialCode || null,
    materialDescription: first.materialDescription ?? null,
    grade: first.grade ?? null,
    importBatchId: first.importBatchId ?? null,
    receiptId: latestReceipt?.id ?? null,
    receiptNo: latestReceipt?.receiptNo ?? null,
    summary,
    coils: coilItems,
    serverTimestamp: now.toISOString(),
  };
}

/**
 * Step 4 of Batch-First Inbound Workflow:
 * Computes deterministic Auto Location Allocation recommendations for pending coils in a Batch.
 * CRITICAL: Read-only preview — does NOT reserve locations and does NOT create Inventory.
 */
export async function recommendLocationsForBatch(
  params: {
    batchNo: string;
    coilDbIds?: number[];
    preferredDoorId?: number;
    preferredRowId?: number;
    strictDoorFilter?: boolean;
    strictRowFilter?: boolean;
  },
  _actor: InboundActor
): Promise<InboundRecommendResponse> {
  const normalized = normalizeScannedIdentifier(params.batchNo);
  if (!normalized) {
    throw new Error('VALIDATION: กรุณาระบุ Batch Number');
  }

  await expireStaleReservations(db);
  const now = new Date();
  const { matchedBatchNo, rows: batchCoils } = await findCoilsByBatchNo(db, normalized);

  if (batchCoils.length === 0) {
    throw new Error(`NOT_FOUND: ไม่พบ Batch Number "${normalized}" ในข้อมูลอ้างอิงจาก SAP`);
  }

  const selectedIdSet = params.coilDbIds && params.coilDbIds.length > 0 ? new Set(params.coilDbIds) : null;
  const candidateCoilRows = batchCoils.filter((c) => {
    if (selectedIdSet && !selectedIdSet.has(c.id)) return false;
    return c.lifecycleStatus === 'PENDING_INBOUND';
  });

  const coilIds = candidateCoilRows.map((c) => c.id);

  const [
    activeInvForCoils,
    activeResvForCoils,
    rawLocations,
    allActiveInvLocs,
    allActiveResvLocs,
    occupiedSupport,
  ] = await Promise.all([
    coilIds.length > 0
      ? db
          .select({ coilId: inventory.coilId })
          .from(inventory)
          .where(
            and(
              inArray(inventory.coilId, coilIds),
              inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
            )
          )
      : Promise.resolve([]),
    coilIds.length > 0
      ? db
          .select({
            coilId: locationReservations.coilId,
            locationCode: storageLocations.locationCode,
          })
          .from(locationReservations)
          .innerJoin(storageLocations, eq(locationReservations.locationId, storageLocations.id))
          .where(
            and(
              inArray(locationReservations.coilId, coilIds),
              eq(locationReservations.status, 'ACTIVE'),
              sql`${locationReservations.expiresAt} > ${now}`
            )
          )
      : Promise.resolve([]),
    db
      .select({
        id: storageLocations.id,
        locationCode: storageLocations.locationCode,
        doorId: storageLocations.doorId,
        doorCode: buildingDoors.doorCode,
        doorSortOrder: buildingDoors.sortOrder,
        rowId: storageLocations.rowId,
        rowNumber: warehouseRows.rowNumber,
        rowMaxLevels: warehouseRows.maxLevels,
        rowAllocationPriority: warehouseRows.allocationPriority,
        levelId: storageLocations.levelId,
        levelNumber: warehouseLevels.levelNumber,
        levelMaxWeightKg: warehouseLevels.maxWeightKg,
        stackingRule: warehouseLevels.stackingRule,
        slotNumber: storageLocations.slotNumber,
        maxWeightKg: storageLocations.maxWeightKg,
        maxOuterDiameterMm: storageLocations.maxOuterDiameterMm,
        maxWidthMm: storageLocations.maxWidthMm,
        stackingGroup: storageLocations.stackingGroup,
        allocationPriority: storageLocations.allocationPriority,
        status: storageLocations.status,
        isActive: storageLocations.isActive,
      })
      .from(storageLocations)
      .innerJoin(buildingDoors, eq(storageLocations.doorId, buildingDoors.id))
      .innerJoin(warehouseRows, eq(storageLocations.rowId, warehouseRows.id))
      .innerJoin(warehouseLevels, eq(storageLocations.levelId, warehouseLevels.id))
      .where(
        and(
          eq(storageLocations.isActive, true),
          eq(buildingDoors.isActive, true),
          eq(warehouseRows.isActive, true),
          eq(warehouseLevels.isActive, true)
        )
      ),
    db
      .select({ locationId: inventory.currentLocationId })
      .from(inventory)
      .where(inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])),
    db
      .select({ locationId: locationReservations.locationId })
      .from(locationReservations)
      .where(
        and(
          eq(locationReservations.status, 'ACTIVE'),
          sql`${locationReservations.expiresAt} > ${now}`
        )
      ),
    loadOccupiedSlotSupport(db),
  ]);

  const receivedCoilSet = new Set(activeInvForCoils.map((r) => r.coilId));
  const activeResvByCoil = new Map(activeResvForCoils.map((r) => [r.coilId, r.locationCode]));
  const occupiedLocSet = new Set(
    allActiveInvLocs.map((r) => r.locationId).filter((v): v is number => v !== null)
  );
  const reservedLocSet = new Set(allActiveResvLocs.map((r) => r.locationId));

  const coilsForEngine: CoilReferenceForAllocation[] = candidateCoilRows
    .filter((c) => !receivedCoilSet.has(c.id))
    .map((c) => ({
      coilDbId: c.id,
      coilId: c.coilId,
      batchNo: c.batchNo,
      materialCode: c.materialCode,
      materialDescription: c.materialDescription ?? null,
      thicknessMm: c.thicknessMm ?? null,
      widthMm: c.widthMm ?? null,
      outerDiameterMm: c.outerDiameterMm ?? null,
      grade: c.grade ?? null,
      weightKg: c.weightKg ?? null,
      grossWeightKg: c.grossWeightKg ?? null,
      netWeightKg: c.netWeightKg ?? null,
      lifecycleStatus: c.lifecycleStatus,
      hasActiveInventory: false,
      activeReservationLocationCode: activeResvByCoil.get(c.id) ?? null,
    }));

  const locationCandidates: LocationCandidateForAllocation[] = rawLocations.map((loc) => ({
    ...loc,
    stackingRule: loc.stackingRule as StackingRule,
    status: loc.status as LocationStatus,
    hasActiveInventory: occupiedLocSet.has(loc.id),
    hasActiveReservation: reservedLocSet.has(loc.id),
  }));

  const decisions = allocateLocationsForCoils(coilsForEngine, locationCandidates, occupiedSupport, {
    preferredDoorId: params.preferredDoorId,
    preferredRowId: params.preferredRowId,
    strictDoorFilter: params.strictDoorFilter,
    strictRowFilter: params.strictRowFilter,
  });

  const recommendations: AllocationRecommendationItem[] = decisions.map((d) => ({
    coilDbId: d.coilDbId,
    batchNo: d.batchNo,
    coilId: d.coilId,
    thicknessMm: d.thicknessMm,
    widthMm: d.widthMm,
    grade: d.grade,
    effectiveWeightKg: d.effectiveWeightKg,
    missingFields: d.missingFields,
    recommendedLocationId: d.recommendedLocation?.id ?? null,
    recommendedLocationCode: d.recommendedLocation?.locationCode ?? null,
    doorCode: d.recommendedLocation?.doorCode ?? null,
    rowNumber: d.recommendedLocation?.rowNumber ?? null,
    levelNumber: d.recommendedLocation?.levelNumber ?? null,
    slotNumber: d.recommendedLocation?.slotNumber ?? null,
    stackingRule: d.recommendedLocation?.stackingRule ?? null,
    locationMaxWeightKg: d.recommendedLocation?.maxWeightKg ?? null,
    alreadyReservedLocationCode: d.alreadyReservedLocationCode,
    status: d.status,
    reason: d.reason,
  }));

  return {
    batchNo: matchedBatchNo,
    recommendations,
    recommendedCount: recommendations.filter((r) => r.status === 'RECOMMENDED').length,
    unallocatableCount: recommendations.filter((r) => r.status === 'UNALLOCATABLE').length,
    alreadyReservedCount: recommendations.filter((r) => r.status === 'ALREADY_RESERVED').length,
    availableLocationsChecked: locationCandidates.filter(
      (l) => l.status === 'EMPTY' && !l.hasActiveInventory && !l.hasActiveReservation
    ).length,
    serverTimestamp: now.toISOString(),
  };
}

/**
 * Step 5 of Batch-First Inbound Workflow:
 * Atomically reserves one or more EMPTY locations for pending coils in a Batch with TTL expiration.
 * CRITICAL: Sets storage_locations.status = 'RESERVED' ONLY — NEVER creates Inventory, NEVER sets OCCUPIED!
 */
export async function reserveBatchLocations(
  params: {
    batchNo: string;
    allocations: Array<{ coilDbId: number; locationId: number }>;
    ttlMinutes?: number;
  },
  actor: InboundActor,
  emitEvent?: InboundEventEmitter
): Promise<InboundReserveResponse> {
  const normalizedBatch = normalizeScannedIdentifier(params.batchNo);
  if (!normalizedBatch) {
    throw new Error('VALIDATION: กรุณาระบุ Batch Number');
  }
  if (!params.allocations || params.allocations.length === 0) {
    throw new Error('VALIDATION: กรุณาเลือกอย่างน้อย 1 คู่ (Coil + Location) เพื่อจองตำแหน่ง');
  }

  const seenCoils = new Set<number>();
  const seenLocs = new Set<number>();
  for (const pair of params.allocations) {
    if (seenCoils.has(pair.coilDbId)) {
      throw new Error('VALIDATION: พบ Coil ซ้ำกันในคำขอจองตำแหน่งเดียวกัน');
    }
    if (seenLocs.has(pair.locationId)) {
      throw new Error('VALIDATION: พบตำแหน่งจัดเก็บซ้ำกันในคำขอจองตำแหน่งเดียวกัน (1 Location = 1 Coil)');
    }
    seenCoils.add(pair.coilDbId);
    seenLocs.add(pair.locationId);
  }

  const ttlMinutes = Math.max(5, Math.min(params.ttlMinutes ?? 30, 120));
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

  // Durably expire any stale reservations before entering the write transaction
  await expireStaleReservations(db, now);

  try {
    const result = await db.transaction(async (tx) => {
      await expireStaleReservations(tx, now);

      const { matchedBatchNo, rows: allBatchCoils } = await findCoilsByBatchNo(tx, normalizedBatch);
      if (allBatchCoils.length === 0) {
        throw new Error(`NOT_FOUND: ไม่พบ Batch Number "${normalizedBatch}" ในข้อมูลอ้างอิงจาก SAP`);
      }

      // Lock requested coils & locations in deterministic ID order to prevent deadlocks
      const sortedCoilIds = [...seenCoils].sort((a, b) => a - b);
      const sortedLocIds = [...seenLocs].sort((a, b) => a - b);

      const lockedCoils = await tx
        .select()
        .from(coils)
        .where(inArray(coils.id, sortedCoilIds))
        .orderBy(asc(coils.id))
        .for('update');

      const lockedLocs = await tx
        .select()
        .from(storageLocations)
        .where(inArray(storageLocations.id, sortedLocIds))
        .orderBy(asc(storageLocations.id))
        .for('update');

      const coilById = new Map(lockedCoils.map((c) => [c.id, c]));
      const locById = new Map(lockedLocs.map((l) => [l.id, l]));

      // Load hierarchy metadata for capacity & pyramid checks
      const levelIds = Array.from(new Set(lockedLocs.map((l) => l.levelId)));
      const rowIds = Array.from(new Set(lockedLocs.map((l) => l.rowId)));

      const levelsMeta =
        levelIds.length > 0
          ? await tx.select().from(warehouseLevels).where(inArray(warehouseLevels.id, levelIds))
          : [];
      const rowsMeta =
        rowIds.length > 0
          ? await tx.select().from(warehouseRows).where(inArray(warehouseRows.id, rowIds))
          : [];
      const existingInvCoils = await tx
        .select({ coilId: inventory.coilId })
        .from(inventory)
        .where(
          and(
            inArray(inventory.coilId, sortedCoilIds),
            inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
          )
        );
      const existingInvLocs = await tx
        .select({ locationId: inventory.currentLocationId })
        .from(inventory)
        .where(
          and(
            inArray(inventory.currentLocationId, sortedLocIds),
            inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
          )
        );
      const existingResvCoils = await tx
        .select()
        .from(locationReservations)
        .where(
          and(
            inArray(locationReservations.coilId, sortedCoilIds),
            eq(locationReservations.status, 'ACTIVE')
          )
        );
      const existingResvLocs = await tx
        .select()
        .from(locationReservations)
        .where(
          and(
            inArray(locationReservations.locationId, sortedLocIds),
            eq(locationReservations.status, 'ACTIVE')
          )
        );
      const occupiedSupport = await loadOccupiedSlotSupport(tx);

      const levelById = new Map(levelsMeta.map((l) => [l.id, l]));
      const rowById = new Map(rowsMeta.map((r) => [r.id, r]));
      const invCoilSet = new Set(existingInvCoils.map((r) => r.coilId));
      const invLocSet = new Set(existingInvLocs.map((r) => r.locationId).filter((v): v is number => v !== null));
      const resvCoilSet = new Set(existingResvCoils.map((r) => r.coilId));
      const resvLocSet = new Set(existingResvLocs.map((r) => r.locationId));

      const occupiedByKey = new Map<string, OccupiedSlotSupportInfo>();
      for (const occ of occupiedSupport) {
        occupiedByKey.set(buildSlotSupportKey(occ.rowId, occ.levelNumber, occ.slotNumber), occ);
      }

      // Validate every requested pair before writing
      for (const pair of params.allocations) {
        const coil = coilById.get(pair.coilDbId);
        if (!coil) {
          throw new Error(`NOT_FOUND: ไม่พบข้อมูล Coil ID #${pair.coilDbId}`);
        }
        if (coil.batchNo !== matchedBatchNo) {
          throw new Error(
            `VALIDATION: Coil ${coil.coilId} ไม่อยู่ใน Batch ${matchedBatchNo}`
          );
        }
        if (coil.lifecycleStatus !== 'PENDING_INBOUND' || invCoilSet.has(coil.id)) {
          throw new Error(
            `CONFLICT: Coil ${coil.coilId} ถูกรับเข้าคลังแล้ว ไม่สามารถจองตำแหน่งซ้ำได้`
          );
        }
        if (resvCoilSet.has(coil.id)) {
          throw new Error(
            `CONFLICT: Coil ${coil.coilId} มีการจองตำแหน่งค้างอยู่แล้ว (Active Reservation)`
          );
        }

        const effectiveWeightKg = resolveEffectiveCoilWeightKg(coil);
        if (effectiveWeightKg === null || effectiveWeightKg <= 0) {
          throw new Error(
            `VALIDATION: Coil ${coil.coilId} ไม่มีข้อมูลน้ำหนักจาก SAP (Missing Weight) ไม่สามารถจองตำแหน่งได้`
          );
        }

        const loc = locById.get(pair.locationId);
        if (!loc) {
          throw new Error(`NOT_FOUND: ไม่พบตำแหน่งจัดเก็บ #${pair.locationId}`);
        }
        if (!loc.isActive || loc.status !== 'EMPTY' || invLocSet.has(loc.id) || resvLocSet.has(loc.id)) {
          throw new Error(
            `CONFLICT: ตำแหน่ง ${loc.locationCode} ไม่ว่าง (สถานะปัจจุบัน: ${loc.status}) กรุณาคำนวณตำแหน่งแนะนำใหม่`
          );
        }

        const level = levelById.get(loc.levelId);
        const row = rowById.get(loc.rowId);
        if (!level || !row) {
          throw new Error(`VALIDATION: โครงสร้าง Row/Level ของตำแหน่ง ${loc.locationCode} ไม่สมบูรณ์`);
        }

        const capCheck = validateCoilCapacityFit({
          coilWeightKg: effectiveWeightKg,
          coilOuterDiameterMm: coil.outerDiameterMm,
          coilWidthMm: coil.widthMm,
          locationMaxWeightKg: loc.maxWeightKg,
          locationMaxOuterDiameterMm: loc.maxOuterDiameterMm,
          locationMaxWidthMm: loc.maxWidthMm,
          levelMaxWeightKg: level.maxWeightKg,
        });
        if (!capCheck.valid) {
          throw new Error(
            `CONFLICT: ตำแหน่ง ${loc.locationCode} ไม่ผ่านเงื่อนไข Capacity สำหรับ Coil ${coil.coilId}: ${capCheck.errors.join('; ')}`
          );
        }

        const pyramidCheck = checkPyramidStackingSupport({
          rowId: loc.rowId,
          rowMaxLevels: row.maxLevels,
          levelNumber: level.levelNumber,
          slotNumber: loc.slotNumber,
          stackingRule: level.stackingRule as StackingRule,
          coilWeightKg: effectiveWeightKg,
          occupiedByKey,
        });
        if (!pyramidCheck.valid) {
          throw new Error(`CONFLICT: ${pyramidCheck.reason}`);
        }
      }

      // Find or create Inbound Receipt session for this Batch
      const existingReceipts = await tx
        .select()
        .from(inboundReceipts)
        .where(
          and(
            eq(inboundReceipts.batchNo, matchedBatchNo),
            inArray(inboundReceipts.status, ['OPEN', 'IN_PROGRESS', 'PARTIALLY_RECEIVED'])
          )
        )
        .orderBy(desc(inboundReceipts.createdAt))
        .limit(1);

      const receivedInBatchCount = allBatchCoils.filter((c) => c.lifecycleStatus === 'IN_STOCK').length;
      const firstCoil = allBatchCoils[0];

      let receipt = existingReceipts[0];
      if (!receipt) {
        const [createdReceipt] = await tx
          .insert(inboundReceipts)
          .values({
            receiptNo: generateReceiptNo(),
            batchNo: matchedBatchNo,
            importBatchId: firstCoil.importBatchId ?? null,
            materialCode: firstCoil.materialCode || null,
            materialDescription: firstCoil.materialDescription ?? null,
            status: receivedInBatchCount > 0 ? 'PARTIALLY_RECEIVED' : 'IN_PROGRESS',
            totalExpectedCoils: allBatchCoils.length,
            receivedCoilsCount: receivedInBatchCount,
            createdByUserId: actor.userId,
          })
          .returning();
        receipt = createdReceipt;
      } else {
        const [updatedReceipt] = await tx
          .update(inboundReceipts)
          .set({
            status: receivedInBatchCount > 0 ? 'PARTIALLY_RECEIVED' : 'IN_PROGRESS',
            totalExpectedCoils: allBatchCoils.length,
            receivedCoilsCount: receivedInBatchCount,
            updatedAt: now,
          })
          .where(eq(inboundReceipts.id, receipt.id))
          .returning();
        receipt = updatedReceipt;
      }

      const createdReservations: InboundReserveResponse['reservations'] = [];

      for (const pair of params.allocations) {
        const coil = coilById.get(pair.coilDbId)!;
        const loc = locById.get(pair.locationId)!;

        const [resv] = await tx
          .insert(locationReservations)
          .values({
            locationId: loc.id,
            coilId: coil.id,
            inboundReceiptId: receipt.id,
            reservationType: 'INBOUND',
            status: 'ACTIVE',
            reservedByUserId: actor.userId,
            expiresAt,
          })
          .returning();

        await tx
          .update(storageLocations)
          .set({ status: 'RESERVED', updatedAt: now })
          .where(eq(storageLocations.id, loc.id));

        const existingItem = await tx
          .select()
          .from(inboundReceiptItems)
          .where(
            and(
              eq(inboundReceiptItems.receiptId, receipt.id),
              eq(inboundReceiptItems.coilId, coil.id)
            )
          )
          .limit(1);

        if (existingItem[0]) {
          await tx
            .update(inboundReceiptItems)
            .set({
              targetLocationId: loc.id,
              reservationId: resv.id,
              status: 'RESERVED',
              errorMessage: null,
              updatedAt: now,
            })
            .where(eq(inboundReceiptItems.id, existingItem[0].id));
        } else {
          await tx.insert(inboundReceiptItems).values({
            receiptId: receipt.id,
            coilId: coil.id,
            targetLocationId: loc.id,
            reservationId: resv.id,
            status: 'RESERVED',
          });
        }

        await tx.insert(auditLogs).values({
          actorUserId: actor.userId,
          actorEmail: actor.email,
          action: 'LOCATION_RESERVED',
          entityType: 'location_reservation',
          entityId: String(resv.id),
          beforeJson: { locationCode: loc.locationCode, status: 'EMPTY' },
          afterJson: {
            reservationId: resv.id,
            receiptNo: receipt.receiptNo,
            batchNo: matchedBatchNo,
            coilId: coil.coilId,
            locationId: loc.id,
            locationCode: loc.locationCode,
            status: 'RESERVED',
            expiresAt: expiresAt.toISOString(),
          },
          ipAddress: actor.ip,
        });

        createdReservations.push({
          reservationId: resv.id,
          coilDbId: coil.id,
          coilId: coil.coilId,
          locationId: loc.id,
          locationCode: loc.locationCode,
          expiresAt: expiresAt.toISOString(),
        });
      }

      return {
        receiptId: receipt.id,
        receiptNo: receipt.receiptNo,
        batchNo: matchedBatchNo,
        ttlMinutes,
        reservations: createdReservations,
        serverTimestamp: now.toISOString(),
      };
    });

    if (emitEvent) {
      emitEvent('location:reserved', {
        batchNo: result.batchNo,
        receiptNo: result.receiptNo,
        locationIds: result.reservations.map((r) => r.locationId),
        locationCodes: result.reservations.map((r) => r.locationCode),
        count: result.reservations.length,
      });
    }

    return result;
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      throw new Error(
        'CONFLICT: ตำแหน่งจัดเก็บหรือเหล็กม้วนนี้เพิ่งถูกจองโดยผู้ใช้งานอื่นพร้อมกัน กรุณาคำนวณตำแหน่งแนะนำใหม่'
      );
    }
    throw error;
  }
}

/**
 * Cancels / releases an active reservation and immediately reverts the storage location to EMPTY.
 */
export async function releaseReservation(
  reservationId: number,
  actor: InboundActor,
  emitEvent?: InboundEventEmitter,
  reason = 'MANUAL_RELEASE'
): Promise<InboundReleaseResponse> {
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    const [resv] = await tx
      .select()
      .from(locationReservations)
      .where(eq(locationReservations.id, reservationId))
      .for('update');

    if (!resv) {
      throw new Error(`NOT_FOUND: ไม่พบรายการจองตำแหน่ง #${reservationId}`);
    }

    if (resv.status !== 'ACTIVE') {
      throw new Error(
        `CONFLICT: รายการจอง #${reservationId} ไม่ได้อยู่ในสถานะ ACTIVE (สถานะปัจจุบัน: ${resv.status})`
      );
    }

    const isElevated = actor.roleCode === 'ADMIN' || actor.roleCode === 'SUPERVISOR';
    if (resv.reservedByUserId !== actor.userId && !isElevated) {
      throw new Error('FORBIDDEN: คุณไม่สามารถยกเลิกการจองตำแหน่งของผู้ใช้งานอื่นได้');
    }

    const [loc] = await tx
      .select()
      .from(storageLocations)
      .where(eq(storageLocations.id, resv.locationId))
      .for('update');

    const [coil] = await tx.select().from(coils).where(eq(coils.id, resv.coilId));

    await tx
      .update(locationReservations)
      .set({
        status: 'RELEASED',
        releasedAt: now,
        releaseReason: reason,
      })
      .where(eq(locationReservations.id, resv.id));

    await tx
      .update(inboundReceiptItems)
      .set({
        status: 'PENDING',
        reservationId: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(inboundReceiptItems.reservationId, resv.id),
          eq(inboundReceiptItems.status, 'RESERVED')
        )
      );

    // Revert location to EMPTY only if no active inventory and no other active reservation
    const activeInv = await tx
      .select({ id: inventory.id })
      .from(inventory)
      .where(
        and(
          eq(inventory.currentLocationId, resv.locationId),
          inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
        )
      )
      .limit(1);
    const otherResv = await tx
      .select({ id: locationReservations.id })
      .from(locationReservations)
      .where(
        and(
          eq(locationReservations.locationId, resv.locationId),
          eq(locationReservations.status, 'ACTIVE')
        )
      )
      .limit(1);

    if (loc && loc.status === 'RESERVED' && activeInv.length === 0 && otherResv.length === 0) {
      await tx
        .update(storageLocations)
        .set({ status: 'EMPTY', updatedAt: now })
        .where(eq(storageLocations.id, loc.id));
    }

    await tx.insert(auditLogs).values({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'RESERVATION_RELEASED',
      entityType: 'location_reservation',
      entityId: String(resv.id),
      beforeJson: {
        status: 'ACTIVE',
        locationCode: loc?.locationCode ?? null,
        coilId: coil?.coilId ?? null,
      },
      afterJson: {
        status: 'RELEASED',
        releaseReason: reason,
        locationStatus: 'EMPTY',
      },
      ipAddress: actor.ip,
    });

    return {
      released: true,
      reservationId: resv.id,
      locationId: resv.locationId,
      locationCode: loc?.locationCode ?? '',
      coilDbId: resv.coilId,
      coilId: coil?.coilId ?? '',
      serverTimestamp: now.toISOString(),
    };
  });

  if (emitEvent) {
    emitEvent('location:released', {
      reservationId: result.reservationId,
      locationId: result.locationId,
      locationCode: result.locationCode,
      coilId: result.coilId,
    });
  }

  return result;
}

/**
 * Step 6–7 of Batch-First Inbound Workflow:
 * Physical Placement Confirmation (Scan Coil ID + Scan Actual Location) -> Atomic PostgreSQL Commit!
 * This is the ONLY gate that creates active inventory, marks coil IN_STOCK, marks location OCCUPIED,
 * records immutable stock_transactions, updates inbound_receipts status, and syncs Warehouse 3D.
 */
export async function confirmPhysicalPlacement(
  params: {
    batchNo: string;
    scannedCoilId: string;
    scannedLocationCode: string;
    idempotencyKey: string;
    overrideReason?: string;
    /** Internal-only test hook for proving PostgreSQL atomic rollback — NEVER exposed to HTTP API */
    _testForceRollback?: boolean;
  },
  actor: InboundActor,
  emitEvent?: InboundEventEmitter
): Promise<InboundConfirmPlacementResponse> {
  const normalizedBatch = normalizeScannedIdentifier(params.batchNo);
  const normalizedCoilId = normalizeScannedIdentifier(params.scannedCoilId);
  const normalizedLocationCode = normalizeScannedLocationCode(params.scannedLocationCode);
  const cleanIdempotencyKey = params.idempotencyKey.trim();

  if (!normalizedBatch || !normalizedCoilId || !normalizedLocationCode) {
    throw new Error('VALIDATION: กรุณาสแกน Batch Number, Coil ID และ Location Code ให้ครบถ้วน');
  }
  if (cleanIdempotencyKey.length < 8) {
    throw new Error('VALIDATION: Invalid idempotencyKey');
  }

  const now = new Date();

  // Durably expire stale reservations outside the commit transaction so rejection never rolls back expiry cleanup
  await expireStaleReservations(db, now);

  try {
    const commitResult = await db.transaction(async (tx) => {
      // 1. Idempotency replay check inside transaction
      const replayItems = await tx
        .select({
          itemId: inboundReceiptItems.id,
          receiptId: inboundReceiptItems.receiptId,
          coilId: inboundReceiptItems.coilId,
          confirmedLocationId: inboundReceiptItems.confirmedLocationId,
          overrideReason: inboundReceiptItems.overrideReason,
          confirmedAt: inboundReceiptItems.confirmedAt,
        })
        .from(inboundReceiptItems)
        .where(
          and(
            eq(inboundReceiptItems.idempotencyKey, cleanIdempotencyKey),
            eq(inboundReceiptItems.status, 'CONFIRMED')
          )
        )
        .limit(1);

      const item = replayItems[0];
      if (item && item.coilId !== null && item.confirmedLocationId !== null) {
        const replayCoilId: number = item.coilId;
        const replayLocId: number = item.confirmedLocationId;
        const [receipt] = await tx
          .select()
          .from(inboundReceipts)
          .where(eq(inboundReceipts.id, item.receiptId));
        const [coilRow] = await tx.select().from(coils).where(eq(coils.id, replayCoilId));
        const [locRow] = await tx
          .select()
          .from(storageLocations)
          .where(eq(storageLocations.id, replayLocId));
        const [invRow] = await tx
          .select()
          .from(inventory)
          .where(eq(inventory.coilId, replayCoilId))
          .orderBy(desc(inventory.createdAt))
          .limit(1);
        const [txRow] = await tx
          .select()
          .from(stockTransactions)
          .where(
            and(
              eq(stockTransactions.coilId, replayCoilId),
              eq(stockTransactions.transactionType, 'INBOUND')
            )
          )
          .orderBy(desc(stockTransactions.createdAt))
          .limit(1);
        const batchCoilRows = await tx
          .select()
          .from(coils)
          .where(eq(coils.batchNo, normalizedBatch));

        const replaySummary = computeBatchSummaryStatus(
          batchCoilRows.map((c) => ({
            isReceived: c.lifecycleStatus === 'IN_STOCK',
            hasActiveReservation: false,
            hasMissingData: false,
            effectiveWeightKg: resolveEffectiveCoilWeightKg(c),
          }))
        );

        return {
          response: {
            idempotentReplay: true,
            receiptId: receipt?.id ?? item.receiptId,
            receiptNo: receipt?.receiptNo ?? '',
            batchNo: receipt?.batchNo ?? normalizedBatch,
            batchStatus: replaySummary.batchStatus,
            inventoryId: invRow?.id ?? 0,
            transactionId: txRow?.id ?? 0,
            transactionNo: txRow?.transactionNo ?? '',
            coilDbId: replayCoilId,
            coilId: coilRow?.coilId ?? normalizedCoilId,
            locationId: replayLocId,
            locationCode: locRow?.locationCode ?? normalizedLocationCode,
            locationStatus: (locRow?.status ?? 'OCCUPIED') as LocationStatus,
            weightKg: txRow?.weightKg ?? resolveEffectiveCoilWeightKg(coilRow ?? {}) ?? 0,
            overrideApplied: Boolean(item.overrideReason),
            confirmedAt: (item.confirmedAt ?? now).toISOString(),
            serverTimestamp: now.toISOString(),
          },
          freedOverrideLocation: null as { id: number; locationCode: string } | null,
        };
      }

      // 2. Expire stale reservations first so expired slots/locks are truthfully enforced
      await expireStaleReservations(tx, now);

      // 3. Resolve batch canonical string (preserving leading zeros)
      const { matchedBatchNo, rows: allBatchCoils } = await findCoilsByBatchNo(tx, normalizedBatch);
      if (allBatchCoils.length === 0) {
        throw new Error(`NOT_FOUND: ไม่พบ Batch Number "${normalizedBatch}" ในข้อมูลอ้างอิงจาก SAP`);
      }

      // 4. Lock scanned Coil row (exact match first, case-insensitive fallback preserving leading zeros)
      let lockedCoilRows = await tx
        .select()
        .from(coils)
        .where(eq(coils.coilId, normalizedCoilId))
        .for('update');

      if (lockedCoilRows.length === 0) {
        lockedCoilRows = await tx
          .select()
          .from(coils)
          .where(sql`UPPER(${coils.coilId}) = UPPER(${normalizedCoilId})`)
          .for('update');
      }
      const lockedCoil = lockedCoilRows[0] ?? null;

      // 5. Find target location ID and any active reservation location ID, then lock locations in sorted ID order
      const targetLocLookup = await tx
        .select({ id: storageLocations.id })
        .from(storageLocations)
        .where(eq(storageLocations.locationCode, normalizedLocationCode))
        .limit(1);

      const coilResvLookup = lockedCoil
        ? await tx
            .select()
            .from(locationReservations)
            .where(
              and(
                eq(locationReservations.coilId, lockedCoil.id),
                eq(locationReservations.status, 'ACTIVE')
              )
            )
            .for('update')
        : [];

      const activeCoilResv = coilResvLookup[0] ?? null;
      const locIdsToLock = Array.from(
        new Set(
          [targetLocLookup[0]?.id, activeCoilResv?.locationId].filter(
            (v): v is number => typeof v === 'number'
          )
        )
      ).sort((a, b) => a - b);

      const lockedLocs =
        locIdsToLock.length > 0
          ? await tx
              .select()
              .from(storageLocations)
              .where(inArray(storageLocations.id, locIdsToLock))
              .orderBy(asc(storageLocations.id))
              .for('update')
          : [];

      const locById = new Map(lockedLocs.map((l) => [l.id, l]));
      const targetLoc = targetLocLookup[0] ? (locById.get(targetLocLookup[0].id) ?? null) : null;
      const reservedLoc = activeCoilResv ? (locById.get(activeCoilResv.locationId) ?? null) : null;

      // Load supporting metadata & state for 8-point validation (sequential on single tx client)
      const coilInvRows = lockedCoil
        ? await tx
            .select({ id: inventory.id })
            .from(inventory)
            .where(
              and(
                eq(inventory.coilId, lockedCoil.id),
                inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
              )
            )
            .limit(1)
        : [];
      const locInvRows = targetLoc
        ? await tx
            .select({ id: inventory.id })
            .from(inventory)
            .where(
              and(
                eq(inventory.currentLocationId, targetLoc.id),
                inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
              )
            )
            .limit(1)
        : [];
      const locActiveResvRows = targetLoc
        ? await tx
            .select()
            .from(locationReservations)
            .where(
              and(
                eq(locationReservations.locationId, targetLoc.id),
                eq(locationReservations.status, 'ACTIVE')
              )
            )
            .for('update')
        : [];
      const coilExpiredResvRows = lockedCoil
        ? await tx
            .select({ id: locationReservations.id })
            .from(locationReservations)
            .where(
              and(
                eq(locationReservations.coilId, lockedCoil.id),
                eq(locationReservations.status, 'EXPIRED')
              )
            )
            .limit(1)
        : [];
      const targetLevelRows = targetLoc
        ? await tx.select().from(warehouseLevels).where(eq(warehouseLevels.id, targetLoc.levelId)).limit(1)
        : [];
      const targetRowRows = targetLoc
        ? await tx.select().from(warehouseRows).where(eq(warehouseRows.id, targetLoc.rowId)).limit(1)
        : [];
      const occupiedSupport = await loadOccupiedSlotSupport(tx);

      const occupiedByKey = new Map<string, OccupiedSlotSupportInfo>();
      for (const occ of occupiedSupport) {
        occupiedByKey.set(buildSlotSupportKey(occ.rowId, occ.levelNumber, occ.slotNumber), occ);
      }

      const targetLevel = targetLevelRows[0] ?? null;
      const targetRow = targetRowRows[0] ?? null;
      const locActiveResv = locActiveResvRows[0] ?? null;

      // 6. Execute pure 8-point server-side validation
      const validation = validatePhysicalPlacementScan({
        batchNo: matchedBatchNo,
        actorUserId: actor.userId,
        actorRoleCode: actor.roleCode,
        now,
        overrideReason: params.overrideReason,
        coil: lockedCoil
          ? {
              id: lockedCoil.id,
              coilId: lockedCoil.coilId,
              batchNo: lockedCoil.batchNo,
              lifecycleStatus: lockedCoil.lifecycleStatus,
              effectiveWeightKg: resolveEffectiveCoilWeightKg(lockedCoil),
              widthMm: lockedCoil.widthMm ?? null,
              outerDiameterMm: lockedCoil.outerDiameterMm ?? null,
              hasActiveInventory: coilInvRows.length > 0,
            }
          : null,
        targetLocation:
          targetLoc && targetLevel && targetRow
            ? {
                id: targetLoc.id,
                locationCode: targetLoc.locationCode,
                rowId: targetLoc.rowId,
                rowMaxLevels: targetRow.maxLevels,
                levelNumber: targetLevel.levelNumber,
                slotNumber: targetLoc.slotNumber,
                stackingRule: targetLevel.stackingRule as StackingRule,
                maxWeightKg: targetLoc.maxWeightKg,
                levelMaxWeightKg: targetLevel.maxWeightKg,
                maxOuterDiameterMm: targetLoc.maxOuterDiameterMm,
                maxWidthMm: targetLoc.maxWidthMm,
                status: targetLoc.status as LocationStatus,
                isActive: targetLoc.isActive,
                hasActiveInventory: locInvRows.length > 0,
              }
            : null,
        coilActiveReservation: activeCoilResv
          ? {
              id: activeCoilResv.id,
              locationId: activeCoilResv.locationId,
              locationCode: reservedLoc?.locationCode ?? '',
              reservedByUserId: activeCoilResv.reservedByUserId,
              expiresAt: activeCoilResv.expiresAt,
              status: activeCoilResv.status,
            }
          : null,
        coilHadExpiredReservation: coilExpiredResvRows.length > 0,
        locationActiveReservation: locActiveResv
          ? {
              id: locActiveResv.id,
              coilId: locActiveResv.coilId,
              reservedByUserId: locActiveResv.reservedByUserId,
              expiresAt: locActiveResv.expiresAt,
              status: locActiveResv.status,
            }
          : null,
        occupiedByKey,
      });

      if (!validation.valid || !lockedCoil || !targetLoc) {
        const prefix =
          validation.httpStatus === 404
            ? 'NOT_FOUND:'
            : validation.httpStatus === 403
              ? 'FORBIDDEN:'
              : validation.httpStatus === 409
                ? 'CONFLICT:'
                : 'VALIDATION:';
        throw new Error(`${prefix} ${validation.message ?? 'การตรวจสอบการสแกนไม่ผ่าน'}`);
      }

      const effectiveWeightKg = resolveEffectiveCoilWeightKg(lockedCoil)!;

      // 7. Find or create Inbound Receipt session for this Batch
      const existingReceipts = await tx
        .select()
        .from(inboundReceipts)
        .where(
          and(
            eq(inboundReceipts.batchNo, matchedBatchNo),
            inArray(inboundReceipts.status, ['OPEN', 'IN_PROGRESS', 'PARTIALLY_RECEIVED'])
          )
        )
        .orderBy(desc(inboundReceipts.createdAt))
        .limit(1)
        .for('update');

      let receipt = existingReceipts[0];
      if (!receipt) {
        const [createdReceipt] = await tx
          .insert(inboundReceipts)
          .values({
            receiptNo: generateReceiptNo(),
            batchNo: matchedBatchNo,
            importBatchId: lockedCoil.importBatchId ?? null,
            materialCode: lockedCoil.materialCode || null,
            materialDescription: lockedCoil.materialDescription ?? null,
            status: 'IN_PROGRESS',
            totalExpectedCoils: allBatchCoils.length,
            receivedCoilsCount: 0,
            createdByUserId: actor.userId,
          })
          .returning();
        receipt = createdReceipt;
      }

      // 8. ATOMIC COMMIT WRITES:
      // 8a. Insert active Inventory record (DB partial unique indexes guarantee 1 Coil <-> 1 Location)
      const [createdInv] = await tx
        .insert(inventory)
        .values({
          coilId: lockedCoil.id,
          currentLocationId: targetLoc.id,
          status: 'IN_STOCK',
          inboundDate: now,
          receivedByUserId: actor.userId,
          updatedByUserId: actor.userId,
        })
        .returning();

      // 8b. Update Coil lifecycle status to IN_STOCK
      await tx
        .update(coils)
        .set({
          lifecycleStatus: 'IN_STOCK',
          updatedAt: now,
        })
        .where(eq(coils.id, lockedCoil.id));

      // 8c. Update Target Storage Location to OCCUPIED
      await tx
        .update(storageLocations)
        .set({
          status: 'OCCUPIED',
          updatedAt: now,
        })
        .where(eq(storageLocations.id, targetLoc.id));

      // 8d. Consume active reservation (and if overridden to another slot, release the old reserved slot!)
      let freedOverrideLocation: { id: number; locationCode: string } | null = null;
      if (activeCoilResv) {
        await tx
          .update(locationReservations)
          .set({
            status: 'CONSUMED',
            releasedAt: now,
            releaseReason: validation.overrideApplied ? 'CONSUMED_WITH_OVERRIDE' : 'CONSUMED_INBOUND',
          })
          .where(eq(locationReservations.id, activeCoilResv.id));

        if (activeCoilResv.locationId !== targetLoc.id && reservedLoc && reservedLoc.status === 'RESERVED') {
          const oldInv = await tx
            .select({ id: inventory.id })
            .from(inventory)
            .where(
              and(
                eq(inventory.currentLocationId, reservedLoc.id),
                inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
              )
            )
            .limit(1);
          const oldResv = await tx
            .select({ id: locationReservations.id })
            .from(locationReservations)
            .where(
              and(
                eq(locationReservations.locationId, reservedLoc.id),
                eq(locationReservations.status, 'ACTIVE')
              )
            )
            .limit(1);
          if (oldInv.length === 0 && oldResv.length === 0) {
            await tx
              .update(storageLocations)
              .set({ status: 'EMPTY', updatedAt: now })
              .where(eq(storageLocations.id, reservedLoc.id));
            freedOverrideLocation = { id: reservedLoc.id, locationCode: reservedLoc.locationCode };
          }
        }
      }

      // 8e. Upsert Inbound Receipt Item with scan event log & idempotency key
      const scanEventEntry = {
        timestamp: now.toISOString(),
        actorEmail: actor.email,
        scannedCoilCode: normalizedCoilId,
        scannedLocationCode: normalizedLocationCode,
        outcome: 'CONFIRMED' as const,
        message: validation.overrideApplied
          ? `Confirmed with Supervisor/Admin override (${params.overrideReason?.trim()})`
          : 'Physical placement verified and committed atomically',
      };

      const existingReceiptItems = await tx
        .select()
        .from(inboundReceiptItems)
        .where(
          and(
            eq(inboundReceiptItems.receiptId, receipt.id),
            eq(inboundReceiptItems.coilId, lockedCoil.id)
          )
        )
        .limit(1);

      if (existingReceiptItems[0]) {
        const prevEvents = Array.isArray(existingReceiptItems[0].scanEventJson)
          ? existingReceiptItems[0].scanEventJson
          : [];
        await tx
          .update(inboundReceiptItems)
          .set({
            targetLocationId: existingReceiptItems[0].targetLocationId ?? targetLoc.id,
            confirmedLocationId: targetLoc.id,
            reservationId: activeCoilResv?.id ?? existingReceiptItems[0].reservationId,
            status: 'CONFIRMED',
            scannedLocationCode: normalizedLocationCode,
            scannedCoilCode: normalizedCoilId,
            idempotencyKey: cleanIdempotencyKey,
            overrideReason: validation.overrideApplied ? (params.overrideReason?.trim() ?? null) : null,
            scanEventJson: [...prevEvents, scanEventEntry],
            errorMessage: null,
            scannedByUserId: actor.userId,
            confirmedAt: now,
            updatedAt: now,
          })
          .where(eq(inboundReceiptItems.id, existingReceiptItems[0].id));
      } else {
        await tx.insert(inboundReceiptItems).values({
          receiptId: receipt.id,
          coilId: lockedCoil.id,
          targetLocationId: activeCoilResv?.locationId ?? targetLoc.id,
          confirmedLocationId: targetLoc.id,
          reservationId: activeCoilResv?.id ?? null,
          status: 'CONFIRMED',
          scannedLocationCode: normalizedLocationCode,
          scannedCoilCode: normalizedCoilId,
          idempotencyKey: cleanIdempotencyKey,
          overrideReason: validation.overrideApplied ? (params.overrideReason?.trim() ?? null) : null,
          scanEventJson: [scanEventEntry],
          scannedByUserId: actor.userId,
          confirmedAt: now,
        });
      }

      // 8f. Insert immutable Stock Transaction Ledger row
      const [createdTx] = await tx
        .insert(stockTransactions)
        .values({
          transactionNo: generateTransactionNo(),
          transactionType: 'INBOUND',
          coilId: lockedCoil.id,
          fromLocationId: null,
          toLocationId: targetLoc.id,
          referenceType: 'INBOUND_RECEIPT',
          referenceId: receipt.id,
          weightKg: effectiveWeightKg,
          status: 'COMPLETED',
          isImmutable: true,
          notes: validation.overrideApplied
            ? `Batch ${matchedBatchNo} Inbound (Override: ${params.overrideReason?.trim()})`
            : `Batch ${matchedBatchNo} Inbound Confirmed`,
          actorUserId: actor.userId,
        })
        .returning();

      // 8g. Recompute real Batch completion status & update Inbound Receipt
      const refreshedBatchCoils = await tx
        .select({
          id: coils.id,
          lifecycleStatus: coils.lifecycleStatus,
          weightKg: coils.weightKg,
          grossWeightKg: coils.grossWeightKg,
          netWeightKg: coils.netWeightKg,
        })
        .from(coils)
        .where(eq(coils.batchNo, matchedBatchNo));

      const refreshedSummary = computeBatchSummaryStatus(
        refreshedBatchCoils.map((c) => ({
          isReceived: c.lifecycleStatus === 'IN_STOCK',
          hasActiveReservation: false,
          hasMissingData: false,
          effectiveWeightKg: resolveEffectiveCoilWeightKg(c),
        }))
      );

      const newReceiptStatus =
        refreshedSummary.batchStatus === 'COMPLETED' ? 'COMPLETED' : 'PARTIALLY_RECEIVED';

      await tx
        .update(inboundReceipts)
        .set({
          status: newReceiptStatus,
          totalExpectedCoils: refreshedSummary.totalCoils,
          receivedCoilsCount: refreshedSummary.receivedCoils,
          completedAt: newReceiptStatus === 'COMPLETED' ? now : null,
          updatedAt: now,
        })
        .where(eq(inboundReceipts.id, receipt.id));

      // 8h. Insert Audit Log
      await tx.insert(auditLogs).values({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: 'INBOUND_PHYSICAL_CONFIRMED',
        entityType: 'inventory',
        entityId: String(createdInv.id),
        beforeJson: {
          coilId: lockedCoil.coilId,
          coilLifecycleStatus: lockedCoil.lifecycleStatus,
          locationCode: targetLoc.locationCode,
          locationStatus: targetLoc.status,
          reservedLocationCode: reservedLoc?.locationCode ?? null,
        },
        afterJson: {
          inventoryId: createdInv.id,
          transactionNo: createdTx.transactionNo,
          receiptNo: receipt.receiptNo,
          batchNo: matchedBatchNo,
          batchStatus: refreshedSummary.batchStatus,
          coilId: lockedCoil.coilId,
          coilLifecycleStatus: 'IN_STOCK',
          locationId: targetLoc.id,
          locationCode: targetLoc.locationCode,
          locationStatus: 'OCCUPIED',
          weightKg: effectiveWeightKg,
          overrideApplied: validation.overrideApplied,
          overrideReason: validation.overrideApplied ? (params.overrideReason?.trim() ?? null) : null,
          freedOverrideLocationCode: freedOverrideLocation?.locationCode ?? null,
        },
        ipAddress: actor.ip,
      });

      // Internal atomic rollback test hook (never callable via HTTP routes)
      if (params._testForceRollback) {
        throw new Error('FORCED_TEST_ROLLBACK');
      }

      return {
        response: {
          idempotentReplay: false,
          receiptId: receipt.id,
          receiptNo: receipt.receiptNo,
          batchNo: matchedBatchNo,
          batchStatus: refreshedSummary.batchStatus,
          inventoryId: createdInv.id,
          transactionId: createdTx.id,
          transactionNo: createdTx.transactionNo,
          coilDbId: lockedCoil.id,
          coilId: lockedCoil.coilId,
          locationId: targetLoc.id,
          locationCode: targetLoc.locationCode,
          locationStatus: 'OCCUPIED' as LocationStatus,
          weightKg: effectiveWeightKg,
          overrideApplied: validation.overrideApplied,
          confirmedAt: now.toISOString(),
          serverTimestamp: now.toISOString(),
        },
        freedOverrideLocation,
      };
    });

    // Post-commit Realtime SSE broadcasts (for live 3D Warehouse & multi-client sync)
    if (emitEvent && !commitResult.response.idempotentReplay) {
      emitEvent('inbound:confirmed', {
        receiptNo: commitResult.response.receiptNo,
        batchNo: commitResult.response.batchNo,
        batchStatus: commitResult.response.batchStatus,
        coilId: commitResult.response.coilId,
        locationId: commitResult.response.locationId,
        locationCode: commitResult.response.locationCode,
        transactionNo: commitResult.response.transactionNo,
      });
      emitEvent('location:updated', {
        locationId: commitResult.response.locationId,
        locationCode: commitResult.response.locationCode,
        status: 'OCCUPIED',
      });
      if (commitResult.freedOverrideLocation) {
        emitEvent('location:released', {
          locationId: commitResult.freedOverrideLocation.id,
          locationCode: commitResult.freedOverrideLocation.locationCode,
          reason: 'SUPERVISOR_OVERRIDE_RELOCATED',
        });
      }
    }

    return commitResult.response;
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      throw new Error(
        'CONFLICT: เกิดการบันทึกพร้อมกัน (Concurrent Commit) — เหล็กม้วนหรือตำแหน่งจัดเก็บนี้ถูกบันทึกเข้าคลังไปแล้ว'
      );
    }
    throw error;
  }
}

/**
 * Lists Inbound Receiving history (receipts + item details + summary KPIs).
 */
export async function listInboundHistory(filters: {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}): Promise<InboundHistoryResponse> {
  await expireStaleReservations(db);
  const now = new Date();
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.max(5, Math.min(filters.pageSize ?? 20, 100));
  const offset = (page - 1) * pageSize;
  const cleanSearch = filters.search?.trim();

  const conditions = [];
  if (filters.status && filters.status !== 'ALL') {
    conditions.push(eq(inboundReceipts.status, filters.status));
  }
  if (cleanSearch) {
    conditions.push(
      or(
        ilike(inboundReceipts.receiptNo, `%${cleanSearch}%`),
        ilike(inboundReceipts.batchNo, `%${cleanSearch}%`),
        ilike(inboundReceipts.materialCode, `%${cleanSearch}%`)
      )
    );
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult, receiptRows, summaryStats, activeResvCount] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(inboundReceipts).where(whereClause),
    db
      .select({
        id: inboundReceipts.id,
        receiptNo: inboundReceipts.receiptNo,
        batchNo: inboundReceipts.batchNo,
        materialCode: inboundReceipts.materialCode,
        materialDescription: inboundReceipts.materialDescription,
        status: inboundReceipts.status,
        totalExpectedCoils: inboundReceipts.totalExpectedCoils,
        receivedCoilsCount: inboundReceipts.receivedCoilsCount,
        createdByEmail: users.email,
        completedAt: inboundReceipts.completedAt,
        createdAt: inboundReceipts.createdAt,
        updatedAt: inboundReceipts.updatedAt,
      })
      .from(inboundReceipts)
      .leftJoin(users, eq(inboundReceipts.createdByUserId, users.id))
      .where(whereClause)
      .orderBy(desc(inboundReceipts.updatedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({
        totalReceipts: sql<number>`count(*)::int`,
        completedReceipts: sql<number>`count(*) filter (where ${inboundReceipts.status} = 'COMPLETED')::int`,
        partialReceipts: sql<number>`count(*) filter (where ${inboundReceipts.status} = 'PARTIALLY_RECEIVED')::int`,
        totalConfirmedCoils: sql<number>`coalesce(sum(${inboundReceipts.receivedCoilsCount}), 0)::int`,
      })
      .from(inboundReceipts),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(locationReservations)
      .where(
        and(
          eq(locationReservations.status, 'ACTIVE'),
          sql`${locationReservations.expiresAt} > ${now}`
        )
      ),
  ]);

  const receiptIds = receiptRows.map((r) => r.id);
  const itemRows =
    receiptIds.length > 0
      ? await db
          .select({
            itemId: inboundReceiptItems.id,
            receiptId: inboundReceiptItems.receiptId,
            coilDbId: inboundReceiptItems.coilId,
            coilId: coils.coilId,
            status: inboundReceiptItems.status,
            targetLocationId: inboundReceiptItems.targetLocationId,
            confirmedLocationId: inboundReceiptItems.confirmedLocationId,
            scannedCoilCode: inboundReceiptItems.scannedCoilCode,
            scannedLocationCode: inboundReceiptItems.scannedLocationCode,
            overrideReason: inboundReceiptItems.overrideReason,
            confirmedAt: inboundReceiptItems.confirmedAt,
            weightKg: coils.weightKg,
            grossWeightKg: coils.grossWeightKg,
            netWeightKg: coils.netWeightKg,
            grade: coils.grade,
            thicknessMm: coils.thicknessMm,
            widthMm: coils.widthMm,
          })
          .from(inboundReceiptItems)
          .leftJoin(coils, eq(inboundReceiptItems.coilId, coils.id))
          .where(inArray(inboundReceiptItems.receiptId, receiptIds))
          .orderBy(desc(inboundReceiptItems.updatedAt))
      : [];

  const locIds = Array.from(
    new Set(
      itemRows
        .flatMap((i) => [i.targetLocationId, i.confirmedLocationId])
        .filter((v): v is number => v !== null)
    )
  );
  const locRows =
    locIds.length > 0
      ? await db
          .select({ id: storageLocations.id, locationCode: storageLocations.locationCode })
          .from(storageLocations)
          .where(inArray(storageLocations.id, locIds))
      : [];
  const locCodeById = new Map(locRows.map((l) => [l.id, l.locationCode]));

  const itemsByReceipt = new Map<number, InboundHistoryReceipt['items']>();
  for (const row of itemRows) {
    const list = itemsByReceipt.get(row.receiptId) ?? [];
    list.push({
      itemId: row.itemId,
      coilDbId: row.coilDbId ?? null,
      coilId: row.coilId ?? null,
      status: row.status,
      targetLocationCode: row.targetLocationId ? (locCodeById.get(row.targetLocationId) ?? null) : null,
      confirmedLocationCode: row.confirmedLocationId
        ? (locCodeById.get(row.confirmedLocationId) ?? null)
        : null,
      scannedCoilCode: row.scannedCoilCode ?? null,
      scannedLocationCode: row.scannedLocationCode ?? null,
      overrideReason: row.overrideReason ?? null,
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      weightKg: resolveEffectiveCoilWeightKg(row),
      grade: row.grade ?? null,
      thicknessMm: row.thicknessMm ?? null,
      widthMm: row.widthMm ?? null,
    });
    itemsByReceipt.set(row.receiptId, list);
  }

  const receipts: InboundHistoryReceipt[] = receiptRows.map((r) => ({
    id: r.id,
    receiptNo: r.receiptNo,
    batchNo: r.batchNo,
    materialCode: r.materialCode ?? null,
    materialDescription: r.materialDescription ?? null,
    status: r.status,
    totalExpectedCoils: r.totalExpectedCoils,
    receivedCoilsCount: r.receivedCoilsCount,
    createdByEmail: r.createdByEmail ?? null,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    items: itemsByReceipt.get(r.id) ?? [],
  }));

  const stats = summaryStats[0] ?? {
    totalReceipts: 0,
    completedReceipts: 0,
    partialReceipts: 0,
    totalConfirmedCoils: 0,
  };

  return {
    receipts,
    total: countResult[0]?.count ?? 0,
    page,
    pageSize,
    summary: {
      totalReceipts: stats.totalReceipts,
      completedReceipts: stats.completedReceipts,
      partialReceipts: stats.partialReceipts,
      totalConfirmedCoils: stats.totalConfirmedCoils,
      activeReservations: activeResvCount[0]?.count ?? 0,
    },
    serverTimestamp: now.toISOString(),
  };
}

/**
 * Evaluates all active slots in a specific Building/Door Row for operator selection during
 * Guided Inbound Receiving (Scan Batch -> Select Building -> Select Row -> Pick Placeable Slot).
 * Strictly read-only on inventory & locations (only expires stale TTL reservations first).
 */
export async function getPlaceableSlotsForRow(params: {
  rowId: number;
  coilDbId?: number;
}): Promise<InboundRowSlotsResponse> {
  if (!Number.isInteger(params.rowId) || params.rowId <= 0) {
    throw new Error('VALIDATION: กรุณาเลือกแถว (Row) ที่ถูกต้อง');
  }

  await expireStaleReservations(db);
  const now = new Date();

  const [rowMeta] = await db
    .select({
      rowId: warehouseRows.id,
      rowNumber: warehouseRows.rowNumber,
      rowLabel: warehouseRows.label,
      rowMaxLevels: warehouseRows.maxLevels,
      rowAllocationPriority: warehouseRows.allocationPriority,
      rowIsActive: warehouseRows.isActive,
      doorId: buildingDoors.id,
      doorCode: buildingDoors.doorCode,
      doorName: buildingDoors.name,
      doorSortOrder: buildingDoors.sortOrder,
      doorIsActive: buildingDoors.isActive,
      zoneCode: zones.code,
      zoneName: zones.name,
    })
    .from(warehouseRows)
    .innerJoin(buildingDoors, eq(warehouseRows.doorId, buildingDoors.id))
    .innerJoin(zones, eq(buildingDoors.zoneId, zones.id))
    .where(eq(warehouseRows.id, params.rowId))
    .limit(1);

  if (!rowMeta || !rowMeta.rowIsActive || !rowMeta.doorIsActive) {
    throw new Error('NOT_FOUND: ไม่พบข้อมูลแถวจัดเก็บที่เลือก หรือแถวถูกปิดใช้งานแล้ว');
  }

  const [coilRow, rawLocations, levelsInRow, occupiedSupport] = await Promise.all([
    params.coilDbId
      ? db
          .select()
          .from(coils)
          .where(eq(coils.id, params.coilDbId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    db
      .select({
        id: storageLocations.id,
        locationCode: storageLocations.locationCode,
        doorId: storageLocations.doorId,
        rowId: storageLocations.rowId,
        levelId: storageLocations.levelId,
        levelNumber: warehouseLevels.levelNumber,
        levelLabel: warehouseLevels.label,
        levelMaxWeightKg: warehouseLevels.maxWeightKg,
        stackingRule: warehouseLevels.stackingRule,
        slotNumber: storageLocations.slotNumber,
        maxWeightKg: storageLocations.maxWeightKg,
        maxOuterDiameterMm: storageLocations.maxOuterDiameterMm,
        maxWidthMm: storageLocations.maxWidthMm,
        stackingGroup: storageLocations.stackingGroup,
        allocationPriority: storageLocations.allocationPriority,
        status: storageLocations.status,
        isActive: storageLocations.isActive,
      })
      .from(storageLocations)
      .innerJoin(warehouseLevels, eq(storageLocations.levelId, warehouseLevels.id))
      .where(
        and(
          eq(storageLocations.rowId, params.rowId),
          eq(storageLocations.isActive, true),
          eq(warehouseLevels.isActive, true)
        )
      )
      .orderBy(asc(warehouseLevels.levelNumber), asc(storageLocations.slotNumber)),
    db
      .select()
      .from(warehouseLevels)
      .where(and(eq(warehouseLevels.rowId, params.rowId), eq(warehouseLevels.isActive, true)))
      .orderBy(desc(warehouseLevels.levelNumber)),
    loadOccupiedSlotSupport(db),
  ]);

  if (params.coilDbId && !coilRow) {
    throw new Error('NOT_FOUND: ไม่พบข้อมูลเหล็กม้วนที่เลือกจาก SAP Reference');
  }

  const locIds = rawLocations.map((l) => l.id);

  const [activeInvRows, activeResvRows] =
    locIds.length > 0
      ? await Promise.all([
          db
            .select({
              locationId: inventory.currentLocationId,
              coilId: coils.coilId,
              weightKg: coils.weightKg,
              grossWeightKg: coils.grossWeightKg,
              netWeightKg: coils.netWeightKg,
            })
            .from(inventory)
            .innerJoin(coils, eq(inventory.coilId, coils.id))
            .where(
              and(
                inArray(inventory.currentLocationId, locIds),
                inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
              )
            ),
          db
            .select({
              locationId: locationReservations.locationId,
              coilId: coils.coilId,
              reservedByEmail: users.email,
              expiresAt: locationReservations.expiresAt,
            })
            .from(locationReservations)
            .innerJoin(coils, eq(locationReservations.coilId, coils.id))
            .leftJoin(users, eq(locationReservations.reservedByUserId, users.id))
            .where(
              and(
                inArray(locationReservations.locationId, locIds),
                eq(locationReservations.status, 'ACTIVE'),
                sql`${locationReservations.expiresAt} > ${now}`
              )
            ),
        ])
      : [[], []];

  const invByLoc = new Map(
    activeInvRows
      .filter((r): r is typeof r & { locationId: number } => r.locationId !== null)
      .map((r) => [r.locationId, r])
  );
  const resvByLoc = new Map(activeResvRows.map((r) => [r.locationId, r]));

  const coilForEngine: CoilReferenceForAllocation | null = coilRow
    ? {
        coilDbId: coilRow.id,
        coilId: coilRow.coilId,
        batchNo: coilRow.batchNo,
        materialCode: coilRow.materialCode,
        materialDescription: coilRow.materialDescription ?? null,
        thicknessMm: coilRow.thicknessMm ?? null,
        widthMm: coilRow.widthMm ?? null,
        outerDiameterMm: coilRow.outerDiameterMm ?? null,
        grade: coilRow.grade ?? null,
        weightKg: coilRow.weightKg ?? null,
        grossWeightKg: coilRow.grossWeightKg ?? null,
        netWeightKg: coilRow.netWeightKg ?? null,
        lifecycleStatus: coilRow.lifecycleStatus,
      }
    : null;

  const candidates: LocationCandidateForAllocation[] = rawLocations.map((loc) => ({
    id: loc.id,
    locationCode: loc.locationCode,
    doorId: loc.doorId,
    doorCode: rowMeta.doorCode,
    doorSortOrder: rowMeta.doorSortOrder,
    rowId: loc.rowId,
    rowNumber: rowMeta.rowNumber,
    rowMaxLevels: rowMeta.rowMaxLevels,
    rowAllocationPriority: rowMeta.rowAllocationPriority,
    levelId: loc.levelId,
    levelNumber: loc.levelNumber,
    levelMaxWeightKg: loc.levelMaxWeightKg,
    stackingRule: loc.stackingRule as StackingRule,
    slotNumber: loc.slotNumber,
    maxWeightKg: loc.maxWeightKg,
    maxOuterDiameterMm: loc.maxOuterDiameterMm,
    maxWidthMm: loc.maxWidthMm,
    stackingGroup: loc.stackingGroup,
    allocationPriority: loc.allocationPriority,
    status: loc.status as LocationStatus,
    isActive: loc.isActive,
    hasActiveInventory: invByLoc.has(loc.id),
    hasActiveReservation: resvByLoc.has(loc.id),
  }));

  const decisions = evaluateRowSlotsForCoil(coilForEngine, candidates, occupiedSupport);
  const decisionById = new Map(decisions.map((d) => [d.locationId, d]));

  const slotsByLevel = new Map<number, RowSlotEvaluationItem[]>();
  let placeableCount = 0;
  let occupiedCount = 0;
  let reservedCount = 0;
  let blockedCount = 0;
  let unavailableRuleCount = 0;

  for (const loc of rawLocations) {
    const decision = decisionById.get(loc.id)!;
    const inv = invByLoc.get(loc.id) ?? null;
    const resv = resvByLoc.get(loc.id) ?? null;
    const effectiveStatus: LocationStatus = inv
      ? 'OCCUPIED'
      : resv
        ? 'RESERVED'
        : (loc.status as LocationStatus);

    if (decision.placeable) {
      placeableCount++;
    } else if (effectiveStatus === 'OCCUPIED') {
      occupiedCount++;
    } else if (effectiveStatus === 'RESERVED') {
      reservedCount++;
    } else if (effectiveStatus === 'BLOCKED') {
      blockedCount++;
    } else {
      unavailableRuleCount++;
    }

    const item: RowSlotEvaluationItem = {
      locationId: loc.id,
      locationCode: loc.locationCode,
      doorId: loc.doorId,
      doorCode: rowMeta.doorCode,
      rowId: loc.rowId,
      rowNumber: rowMeta.rowNumber,
      levelId: loc.levelId,
      levelNumber: loc.levelNumber,
      levelLabel: loc.levelLabel,
      stackingRule: loc.stackingRule as StackingRule,
      slotNumber: loc.slotNumber,
      maxWeightKg: loc.maxWeightKg,
      levelMaxWeightKg: loc.levelMaxWeightKg,
      maxWidthMm: loc.maxWidthMm,
      maxOuterDiameterMm: loc.maxOuterDiameterMm,
      allocationPriority: loc.allocationPriority,
      status: effectiveStatus,
      placeable: decision.placeable,
      isTopRecommended: decision.isTopRecommended,
      pendingSapWeightWarning: decision.pendingSapWeightWarning,
      reason: decision.reason,
      occupantCoilId: inv?.coilId ?? null,
      occupantWeightKg: inv ? resolveEffectiveCoilWeightKg(inv) : null,
      reservedCoilId: resv?.coilId ?? null,
      reservedByEmail: resv?.reservedByEmail ?? null,
      reservationExpiresAt: resv?.expiresAt ? resv.expiresAt.toISOString() : null,
    };

    const list = slotsByLevel.get(loc.levelId) ?? [];
    list.push(item);
    slotsByLevel.set(loc.levelId, list);
  }

  const levels: RowLevelSlotsGroup[] = levelsInRow.map((lvl) => {
    const levelSlots = slotsByLevel.get(lvl.id) ?? [];
    return {
      levelId: lvl.id,
      levelNumber: lvl.levelNumber,
      label: lvl.label,
      stackingRule: lvl.stackingRule as StackingRule,
      maxWeightKg: lvl.maxWeightKg,
      placeableCount: levelSlots.filter((s) => s.placeable).length,
      totalCount: levelSlots.length,
      slots: levelSlots,
    };
  });

  return {
    building: {
      doorId: rowMeta.doorId,
      doorCode: rowMeta.doorCode,
      doorName: rowMeta.doorName,
      zoneCode: rowMeta.zoneCode,
      zoneName: rowMeta.zoneName,
    },
    row: {
      rowId: rowMeta.rowId,
      rowNumber: rowMeta.rowNumber,
      label: rowMeta.rowLabel,
      maxLevels: rowMeta.rowMaxLevels,
    },
    coil: coilRow
      ? {
          coilDbId: coilRow.id,
          coilId: coilRow.coilId,
          batchNo: coilRow.batchNo,
          effectiveWeightKg: resolveEffectiveCoilWeightKg(coilRow),
          widthMm: coilRow.widthMm ?? null,
          outerDiameterMm: coilRow.outerDiameterMm ?? null,
          grade: coilRow.grade ?? null,
        }
      : null,
    summary: {
      totalSlots: rawLocations.length,
      placeableCount,
      occupiedCount,
      reservedCount,
      blockedCount,
      unavailableRuleCount,
    },
    levels,
    serverTimestamp: now.toISOString(),
  };
}

/**
 * Generates a unique provisional Coil ID for Pre-SAP direct placement while preserving the scanned Batch No.
 */
async function generateProvisionalCoilId(
  tx: DbExecutor,
  batchNo: string
): Promise<string> {
  const existingForBatch = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(coils)
    .where(sql`UPPER(${coils.batchNo}) = UPPER(${batchNo})`);

  const baseSeq = (existingForBatch[0]?.count ?? 0) + 1;
  const cleanBatch = batchNo.replace(/\s+/g, '').slice(0, 32);

  for (let offset = 0; offset < 5; offset++) {
    const seqStr = String(baseSeq + offset).padStart(2, '0');
    const candidate = `PRE-${cleanBatch}-${seqStr}`;
    const conflict = await tx
      .select({ id: coils.id })
      .from(coils)
      .where(eq(coils.coilId, candidate))
      .limit(1);
    if (conflict.length === 0) return candidate;
  }

  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `PRE-${cleanBatch}-${rand}`;
}

/**
 * Direct-to-3D Inbound Placement (Supports BOTH Pre-SAP provisional coils & SAP-referenced coils).
 * - Case A (!params.coilDbId): Pre-SAP Direct Placement — creates provisional coil (`sourceType: 'PRE_SAP_INBOUND'`),
 *   immediately inserts active `inventory`, sets `storage_locations.status = 'OCCUPIED'`, records receipt + ledger + audit.
 *   Allows Level 2+ stacking whenever both lower physical supports exist (flagging `pendingSapWeightWarning: true`).
 * - Case B (params.coilDbId): SAP-Referenced Direct Placement — validates SAP weight/capacity/pyramid rules,
 *   consumes/releases any prior active reservation, and commits coil directly into the selected slot.
 */
export async function directPlaceCoilInSlot(
  params: InboundDirectPlaceRequest,
  actor: InboundActor,
  emitEvent?: InboundEventEmitter
): Promise<InboundDirectPlaceResponse> {
  const normalizedBatch = normalizeScannedIdentifier(params.batchNo);
  const cleanIdempotencyKey = params.idempotencyKey.trim();

  if (!normalizedBatch) {
    throw new Error('VALIDATION: กรุณาสแกนหรือระบุหมายเลข Batch Number');
  }
  if (!Number.isInteger(params.locationId) || params.locationId <= 0) {
    throw new Error('VALIDATION: กรุณาเลือกตำแหน่งจัดเก็บ (Location) ที่ถูกต้อง');
  }
  if (!cleanIdempotencyKey || cleanIdempotencyKey.length < 8) {
    throw new Error('VALIDATION: Idempotency Key ไม่ถูกต้อง');
  }

  const now = new Date();
  await expireStaleReservations(db, now);

  try {
    const commitResult = await db.transaction(async (tx) => {
      await expireStaleReservations(tx, now);

      // 1. Idempotency replay check
      const existingByKey = await tx
        .select({
          item: inboundReceiptItems,
          receiptNo: inboundReceipts.receiptNo,
          batchNo: inboundReceipts.batchNo,
          receiptStatus: inboundReceipts.status,
          coilIdText: coils.coilId,
          coilSourceType: coils.sourceType,
          coilWeightKg: coils.weightKg,
          coilGrossWeightKg: coils.grossWeightKg,
          coilNetWeightKg: coils.netWeightKg,
          locationCode: storageLocations.locationCode,
        })
        .from(inboundReceiptItems)
        .innerJoin(inboundReceipts, eq(inboundReceiptItems.receiptId, inboundReceipts.id))
        .leftJoin(coils, eq(inboundReceiptItems.coilId, coils.id))
        .leftJoin(storageLocations, eq(inboundReceiptItems.confirmedLocationId, storageLocations.id))
        .where(eq(inboundReceiptItems.idempotencyKey, cleanIdempotencyKey))
        .limit(1);

      if (existingByKey[0] && existingByKey[0].item.status === 'CONFIRMED') {
        const hit = existingByKey[0];
        const invHit = hit.item.coilId
          ? await tx
              .select({ id: inventory.id })
              .from(inventory)
              .where(eq(inventory.coilId, hit.item.coilId))
              .orderBy(desc(inventory.createdAt))
              .limit(1)
          : [];
        const txHit = hit.item.coilId
          ? await tx
              .select({ id: stockTransactions.id, transactionNo: stockTransactions.transactionNo })
              .from(stockTransactions)
              .where(
                and(
                  eq(stockTransactions.coilId, hit.item.coilId),
                  eq(stockTransactions.transactionType, 'INBOUND')
                )
              )
              .orderBy(desc(stockTransactions.createdAt))
              .limit(1)
          : [];

        return {
          response: {
            idempotentReplay: true,
            isPendingSapSync: hit.coilSourceType === 'PRE_SAP_INBOUND',
            pendingSapWeightWarning: false,
            receiptId: hit.item.receiptId,
            receiptNo: hit.receiptNo,
            batchNo: hit.batchNo,
            batchStatus:
              hit.receiptStatus === 'COMPLETED'
                ? ('COMPLETED' as const)
                : ('PARTIALLY_RECEIVED' as const),
            inventoryId: invHit[0]?.id ?? 0,
            transactionId: txHit[0]?.id ?? 0,
            transactionNo: txHit[0]?.transactionNo ?? '',
            coilDbId: hit.item.coilId ?? 0,
            coilId: hit.coilIdText ?? hit.item.scannedCoilCode ?? '',
            locationId: hit.item.confirmedLocationId ?? params.locationId,
            locationCode: hit.locationCode ?? hit.item.scannedLocationCode ?? '',
            locationStatus: 'OCCUPIED' as LocationStatus,
            weightKg: resolveEffectiveCoilWeightKg({
              weightKg: hit.coilWeightKg ?? null,
              grossWeightKg: hit.coilGrossWeightKg ?? null,
              netWeightKg: hit.coilNetWeightKg ?? null,
            }),
            confirmedAt: (hit.item.confirmedAt ?? now).toISOString(),
            serverTimestamp: now.toISOString(),
          },
          freedLocation: null as { id: number; locationCode: string } | null,
        };
      }

      // 2. Lock target storage location (FOR UPDATE)
      const [targetLoc] = await tx
        .select()
        .from(storageLocations)
        .where(eq(storageLocations.id, params.locationId))
        .for('update');

      if (!targetLoc || !targetLoc.isActive) {
        throw new Error('NOT_FOUND: ไม่พบตำแหน่งจัดเก็บที่เลือก หรือตำแหน่งถูกปิดใช้งานแล้ว');
      }

      const [targetLevel] = await tx
        .select()
        .from(warehouseLevels)
        .where(eq(warehouseLevels.id, targetLoc.levelId))
        .limit(1);
      const [targetRow] = await tx
        .select()
        .from(warehouseRows)
        .where(eq(warehouseRows.id, targetLoc.rowId))
        .limit(1);

      if (!targetLevel || !targetRow) {
        throw new Error('VALIDATION: โครงสร้างแถวหรือชั้นของตำแหน่งที่เลือกไม่สมบูรณ์');
      }

      // Check active inventory on target location
      const existingLocInv = await tx
        .select({ id: inventory.id })
        .from(inventory)
        .where(
          and(
            eq(inventory.currentLocationId, targetLoc.id),
            inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
          )
        )
        .limit(1);

      if (existingLocInv.length > 0 || targetLoc.status === 'OCCUPIED' || targetLoc.status === 'BLOCKED') {
        throw new Error(
          `CONFLICT: ตำแหน่ง ${targetLoc.locationCode} ไม่ว่าง (สถานะปัจจุบัน: ${targetLoc.status}) กรุณาเลือกตำแหน่งอื่น`
        );
      }

      // Check active reservation on target location
      const [locActiveResv] = await tx
        .select()
        .from(locationReservations)
        .where(
          and(
            eq(locationReservations.locationId, targetLoc.id),
            eq(locationReservations.status, 'ACTIVE'),
            sql`${locationReservations.expiresAt} > ${now}`
          )
        )
        .limit(1);

      if (locActiveResv && (!params.coilDbId || locActiveResv.coilId !== params.coilDbId)) {
        throw new Error(
          `CONFLICT: ตำแหน่ง ${targetLoc.locationCode} ถูกจองไว้ให้เหล็กม้วนอื่นอยู่ กรุณาเลือกตำแหน่งว่างอื่น`
        );
      }

      const occupiedSupport = await loadOccupiedSlotSupport(tx);
      const occupiedByKey = new Map<string, OccupiedSlotSupportInfo>();
      for (const occ of occupiedSupport) {
        occupiedByKey.set(buildSlotSupportKey(occ.rowId, occ.levelNumber, occ.slotNumber), occ);
      }

      let targetCoil: typeof coils.$inferSelect;
      let isPendingSapSync = false;
      let pendingSapWeightWarning = false;
      let effectiveWeightKg: number | null = null;
      let matchedBatchNo = normalizedBatch;
      let freedLocation: { id: number; locationCode: string } | null = null;
      let consumedReservationId: number | null = null;

      if (!params.coilDbId) {
        // ====================================================================
        // CASE A: PRE-SAP DIRECT PLACEMENT (Provisional Coil -> 3D Immediately)
        // ====================================================================
        const pyramidCheck = checkPyramidStackingSupport({
          rowId: targetLoc.rowId,
          rowMaxLevels: targetRow.maxLevels,
          levelNumber: targetLevel.levelNumber,
          slotNumber: targetLoc.slotNumber,
          stackingRule: targetLevel.stackingRule as StackingRule,
          coilWeightKg: null,
          occupiedByKey,
        });

        if (!pyramidCheck.valid) {
          throw new Error(`CONFLICT: ${pyramidCheck.reason ?? 'ไม่ผ่านเงื่อนไขฐานรองรับชั้นวาง'}`);
        }
        pendingSapWeightWarning = Boolean(pyramidCheck.pendingSapWeightWarning);

        const provisionalCoilId = await generateProvisionalCoilId(tx, normalizedBatch);
        const [insertedCoil] = await tx
          .insert(coils)
          .values({
            coilId: provisionalCoilId,
            batchNo: normalizedBatch,
            materialCode: '',
            materialDescription: 'รอเชื่อมข้อมูล SAP (Pre-SAP Inbound)',
            weightKg: null,
            isEstimatedDimensions: true,
            sourceType: 'PRE_SAP_INBOUND',
            lifecycleStatus: 'IN_STOCK',
            importedByUserId: actor.userId,
          })
          .returning();

        targetCoil = insertedCoil;
        isPendingSapSync = true;
        effectiveWeightKg = null;
      } else {
        // ====================================================================
        // CASE B: SAP-REFERENCED DIRECT PLACEMENT
        // ====================================================================
        const [lockedCoil] = await tx
          .select()
          .from(coils)
          .where(eq(coils.id, params.coilDbId))
          .for('update');

        if (!lockedCoil) {
          throw new Error(`NOT_FOUND: ไม่พบข้อมูลเหล็กม้วน #${params.coilDbId}`);
        }
        if (lockedCoil.batchNo.toUpperCase() !== normalizedBatch.toUpperCase()) {
          throw new Error(
            `VALIDATION: เหล็กม้วน ${lockedCoil.coilId} ไม่อยู่ใน Batch ${normalizedBatch}`
          );
        }
        matchedBatchNo = lockedCoil.batchNo;

        const existingCoilInv = await tx
          .select({ id: inventory.id })
          .from(inventory)
          .where(
            and(
              eq(inventory.coilId, lockedCoil.id),
              inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
            )
          )
          .limit(1);

        if (lockedCoil.lifecycleStatus !== 'PENDING_INBOUND' || existingCoilInv.length > 0) {
          throw new Error(
            `CONFLICT: เหล็กม้วน ${lockedCoil.coilId} ถูกรับเข้าคลังไปแล้ว ไม่สามารถวางซ้ำได้`
          );
        }

        const resolvedWeight = resolveEffectiveCoilWeightKg(lockedCoil);
        if (resolvedWeight === null || resolvedWeight <= 0) {
          throw new Error(
            `VALIDATION: เหล็กม้วน ${lockedCoil.coilId} ไม่มีข้อมูลน้ำหนักจาก SAP ไม่สามารถวางได้`
          );
        }
        effectiveWeightKg = resolvedWeight;

        const capCheck = validateCoilCapacityFit({
          coilWeightKg: resolvedWeight,
          coilOuterDiameterMm: lockedCoil.outerDiameterMm,
          coilWidthMm: lockedCoil.widthMm,
          locationMaxWeightKg: targetLoc.maxWeightKg,
          locationMaxOuterDiameterMm: targetLoc.maxOuterDiameterMm,
          locationMaxWidthMm: targetLoc.maxWidthMm,
          levelMaxWeightKg: targetLevel.maxWeightKg,
        });
        if (!capCheck.valid) {
          throw new Error(
            `CONFLICT: ตำแหน่ง ${targetLoc.locationCode} ไม่รองรับขนาด/น้ำหนักของเหล็กม้วน ${lockedCoil.coilId}: ${capCheck.errors.join('; ')}`
          );
        }

        const pyramidCheck = checkPyramidStackingSupport({
          rowId: targetLoc.rowId,
          rowMaxLevels: targetRow.maxLevels,
          levelNumber: targetLevel.levelNumber,
          slotNumber: targetLoc.slotNumber,
          stackingRule: targetLevel.stackingRule as StackingRule,
          coilWeightKg: resolvedWeight,
          occupiedByKey,
        });
        if (!pyramidCheck.valid) {
          throw new Error(`CONFLICT: ${pyramidCheck.reason ?? 'ไม่ผ่านเงื่อนไขฐานรองรับชั้นวาง'}`);
        }
        pendingSapWeightWarning = Boolean(pyramidCheck.pendingSapWeightWarning);

        // Handle any active reservation owned by this coil
        const [coilActiveResv] = await tx
          .select()
          .from(locationReservations)
          .where(
            and(
              eq(locationReservations.coilId, lockedCoil.id),
              eq(locationReservations.status, 'ACTIVE'),
              sql`${locationReservations.expiresAt} > ${now}`
            )
          )
          .limit(1);

        if (coilActiveResv) {
          consumedReservationId = coilActiveResv.id;
          const sameSlot = coilActiveResv.locationId === targetLoc.id;
          await tx
            .update(locationReservations)
            .set({
              status: sameSlot ? 'CONSUMED' : 'RELEASED',
              releasedAt: now,
              releaseReason: sameSlot ? 'CONSUMED_DIRECT_INBOUND' : 'RELOCATED_DIRECT_INBOUND',
            })
            .where(eq(locationReservations.id, coilActiveResv.id));

          if (!sameSlot) {
            const [oldLoc] = await tx
              .select()
              .from(storageLocations)
              .where(eq(storageLocations.id, coilActiveResv.locationId))
              .for('update');
            if (oldLoc && oldLoc.status === 'RESERVED') {
              await tx
                .update(storageLocations)
                .set({ status: 'EMPTY', updatedAt: now })
                .where(eq(storageLocations.id, oldLoc.id));
              freedLocation = { id: oldLoc.id, locationCode: oldLoc.locationCode };
            }
          }
        }

        const [updatedCoil] = await tx
          .update(coils)
          .set({
            lifecycleStatus: 'IN_STOCK',
            updatedAt: now,
          })
          .where(eq(coils.id, lockedCoil.id))
          .returning();

        targetCoil = updatedCoil;
        isPendingSapSync = updatedCoil.sourceType === 'PRE_SAP_INBOUND';
      }

      // 3. Insert active Inventory & set Storage Location -> OCCUPIED
      const [createdInv] = await tx
        .insert(inventory)
        .values({
          coilId: targetCoil.id,
          currentLocationId: targetLoc.id,
          status: 'IN_STOCK',
          inboundDate: now,
          receivedByUserId: actor.userId,
          updatedByUserId: actor.userId,
        })
        .returning();

      await tx
        .update(storageLocations)
        .set({
          status: 'OCCUPIED',
          updatedAt: now,
        })
        .where(eq(storageLocations.id, targetLoc.id));

      // 4. Find or create Inbound Receipt for this Batch
      const existingReceipts = await tx
        .select()
        .from(inboundReceipts)
        .where(
          and(
            eq(inboundReceipts.batchNo, matchedBatchNo),
            inArray(inboundReceipts.status, ['OPEN', 'IN_PROGRESS', 'PARTIALLY_RECEIVED'])
          )
        )
        .orderBy(desc(inboundReceipts.createdAt))
        .limit(1)
        .for('update');

      let receipt = existingReceipts[0];
      if (!receipt) {
        const [createdReceipt] = await tx
          .insert(inboundReceipts)
          .values({
            receiptNo: generateReceiptNo(),
            batchNo: matchedBatchNo,
            importBatchId: targetCoil.importBatchId ?? null,
            materialCode: targetCoil.materialCode || null,
            materialDescription: targetCoil.materialDescription ?? null,
            status: 'IN_PROGRESS',
            totalExpectedCoils: 1,
            receivedCoilsCount: 0,
            createdByUserId: actor.userId,
          })
          .returning();
        receipt = createdReceipt;
      }

      // 5. Upsert Inbound Receipt Item
      const scanEventEntry = {
        timestamp: now.toISOString(),
        actorEmail: actor.email,
        scannedCoilCode: targetCoil.coilId,
        scannedLocationCode: targetLoc.locationCode,
        outcome: 'CONFIRMED' as const,
        message: isPendingSapSync
          ? 'Pre-SAP Direct Placement into 3D Warehouse (รอเชื่อมข้อมูล SAP)'
          : 'Direct Guided Placement into 3D Warehouse',
      };

      const existingItemRows = await tx
        .select()
        .from(inboundReceiptItems)
        .where(
          and(
            eq(inboundReceiptItems.receiptId, receipt.id),
            eq(inboundReceiptItems.coilId, targetCoil.id)
          )
        )
        .limit(1);

      if (existingItemRows[0]) {
        const prevEvents = Array.isArray(existingItemRows[0].scanEventJson)
          ? existingItemRows[0].scanEventJson
          : [];
        await tx
          .update(inboundReceiptItems)
          .set({
            targetLocationId: targetLoc.id,
            confirmedLocationId: targetLoc.id,
            reservationId: consumedReservationId ?? existingItemRows[0].reservationId,
            status: 'CONFIRMED',
            scannedLocationCode: targetLoc.locationCode,
            scannedCoilCode: targetCoil.coilId,
            idempotencyKey: cleanIdempotencyKey,
            scanEventJson: [...prevEvents, scanEventEntry],
            errorMessage: null,
            scannedByUserId: actor.userId,
            confirmedAt: now,
            updatedAt: now,
          })
          .where(eq(inboundReceiptItems.id, existingItemRows[0].id));
      } else {
        await tx.insert(inboundReceiptItems).values({
          receiptId: receipt.id,
          coilId: targetCoil.id,
          targetLocationId: targetLoc.id,
          confirmedLocationId: targetLoc.id,
          reservationId: consumedReservationId,
          status: 'CONFIRMED',
          scannedLocationCode: targetLoc.locationCode,
          scannedCoilCode: targetCoil.coilId,
          idempotencyKey: cleanIdempotencyKey,
          scanEventJson: [scanEventEntry],
          scannedByUserId: actor.userId,
          confirmedAt: now,
        });
      }

      // 6. Insert immutable Stock Transaction Ledger entry
      const [createdTx] = await tx
        .insert(stockTransactions)
        .values({
          transactionNo: generateTransactionNo(),
          transactionType: 'INBOUND',
          coilId: targetCoil.id,
          fromLocationId: null,
          toLocationId: targetLoc.id,
          referenceType: 'INBOUND_RECEIPT',
          referenceId: receipt.id,
          weightKg: effectiveWeightKg ?? 0,
          status: 'COMPLETED',
          isImmutable: true,
          notes: isPendingSapSync
            ? `Batch ${matchedBatchNo} Pre-SAP Direct Placement (รอข้อมูล SAP)`
            : `Batch ${matchedBatchNo} Direct Placement Confirmed`,
          actorUserId: actor.userId,
        })
        .returning();

      // 7. Recompute Batch completion summary & update Receipt
      const refreshedBatchCoils = await tx
        .select({
          id: coils.id,
          lifecycleStatus: coils.lifecycleStatus,
          weightKg: coils.weightKg,
          grossWeightKg: coils.grossWeightKg,
          netWeightKg: coils.netWeightKg,
        })
        .from(coils)
        .where(sql`UPPER(${coils.batchNo}) = UPPER(${matchedBatchNo})`);

      const refreshedSummary = computeBatchSummaryStatus(
        refreshedBatchCoils.map((c) => ({
          isReceived: c.lifecycleStatus === 'IN_STOCK',
          hasActiveReservation: false,
          hasMissingData: false,
          effectiveWeightKg: resolveEffectiveCoilWeightKg(c),
        }))
      );

      const newReceiptStatus =
        !isPendingSapSync && refreshedSummary.batchStatus === 'COMPLETED'
          ? 'COMPLETED'
          : 'PARTIALLY_RECEIVED';

      await tx
        .update(inboundReceipts)
        .set({
          status: newReceiptStatus,
          totalExpectedCoils: refreshedSummary.totalCoils,
          receivedCoilsCount: refreshedSummary.receivedCoils,
          completedAt: newReceiptStatus === 'COMPLETED' ? now : null,
          updatedAt: now,
        })
        .where(eq(inboundReceipts.id, receipt.id));

      // 8. Audit Log
      await tx.insert(auditLogs).values({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: isPendingSapSync ? 'PRE_SAP_INBOUND_CONFIRMED' : 'INBOUND_DIRECT_CONFIRMED',
        entityType: 'inventory',
        entityId: String(createdInv.id),
        beforeJson: {
          locationCode: targetLoc.locationCode,
          locationStatus: targetLoc.status,
        },
        afterJson: {
          inventoryId: createdInv.id,
          transactionNo: createdTx.transactionNo,
          receiptNo: receipt.receiptNo,
          batchNo: matchedBatchNo,
          coilDbId: targetCoil.id,
          coilId: targetCoil.coilId,
          sourceType: targetCoil.sourceType,
          isPendingSapSync,
          pendingSapWeightWarning,
          locationId: targetLoc.id,
          locationCode: targetLoc.locationCode,
          locationStatus: 'OCCUPIED',
          weightKg: effectiveWeightKg,
          freedLocationCode: freedLocation?.locationCode ?? null,
        },
        ipAddress: actor.ip,
      });

      return {
        response: {
          idempotentReplay: false,
          isPendingSapSync,
          pendingSapWeightWarning,
          receiptId: receipt.id,
          receiptNo: receipt.receiptNo,
          batchNo: matchedBatchNo,
          batchStatus: refreshedSummary.batchStatus,
          inventoryId: createdInv.id,
          transactionId: createdTx.id,
          transactionNo: createdTx.transactionNo,
          coilDbId: targetCoil.id,
          coilId: targetCoil.coilId,
          locationId: targetLoc.id,
          locationCode: targetLoc.locationCode,
          locationStatus: 'OCCUPIED' as LocationStatus,
          weightKg: effectiveWeightKg,
          confirmedAt: now.toISOString(),
          serverTimestamp: now.toISOString(),
        },
        freedLocation,
      };
    });

    if (emitEvent && !commitResult.response.idempotentReplay) {
      emitEvent('inbound:confirmed', {
        receiptNo: commitResult.response.receiptNo,
        batchNo: commitResult.response.batchNo,
        batchStatus: commitResult.response.batchStatus,
        coilId: commitResult.response.coilId,
        locationId: commitResult.response.locationId,
        locationCode: commitResult.response.locationCode,
        transactionNo: commitResult.response.transactionNo,
        isPendingSapSync: commitResult.response.isPendingSapSync,
      });
      emitEvent('location:updated', {
        locationId: commitResult.response.locationId,
        locationCode: commitResult.response.locationCode,
        status: 'OCCUPIED',
        isPendingSapSync: commitResult.response.isPendingSapSync,
      });
      if (commitResult.freedLocation) {
        emitEvent('location:released', {
          locationId: commitResult.freedLocation.id,
          locationCode: commitResult.freedLocation.locationCode,
          reason: 'RELOCATED_DIRECT_INBOUND',
        });
      }
    }

    return commitResult.response;
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      throw new Error(
        'CONFLICT: เกิดการบันทึกพร้อมกัน — ตำแหน่งจัดเก็บหรือเหล็กม้วนนี้ถูกวางเข้าคลังไปแล้ว กรุณารีเฟรชและเลือกช่องใหม่'
      );
    }
    throw error;
  }
}

