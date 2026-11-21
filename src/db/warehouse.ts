import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  buildingDoors,
  coils,
  inventory,
  locationReservations,
  roles,
  storageLocations,
  users,
  warehouseLayoutObjects,
  warehouseLevels,
  warehouseRows,
  zones,
} from './schema.ts';
import { writeAuditLog } from './users.ts';
import { expireStaleReservations } from './inbound.ts';
import {
  calculateSlotCoordinates,
  formatLocationCode,
  type LocationStatus,
  type StackingRule,
  validateLocationModificationSafety,
} from '../utils/warehouseMath.ts';

export interface AuditActor {
  userId: number;
  email: string;
  ip?: string | null;
}

export async function getWarehouseSummary() {
  try {
    await expireStaleReservations(db);
    const [zoneCount] = await db.select({ count: sql<number>`count(*)::int` }).from(zones);
    const [doorCount] = await db.select({ count: sql<number>`count(*)::int` }).from(buildingDoors);
    const [rowCount] = await db.select({ count: sql<number>`count(*)::int` }).from(warehouseRows);
    const [levelCount] = await db.select({ count: sql<number>`count(*)::int` }).from(warehouseLevels);
    const [layoutCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(warehouseLayoutObjects);

    const statusRows = await db
      .select({
        status: storageLocations.status,
        isActive: storageLocations.isActive,
        count: sql<number>`count(*)::int`,
      })
      .from(storageLocations)
      .groupBy(storageLocations.status, storageLocations.isActive);

    const statusCounts: Record<string, number> = {
      EMPTY: 0,
      OCCUPIED: 0,
      RESERVED: 0,
      BLOCKED: 0,
      INACTIVE: 0,
      TOTAL: 0,
    };

    for (const row of statusRows) {
      statusCounts.TOTAL += row.count;
      if (!row.isActive) {
        statusCounts.INACTIVE += row.count;
      } else if (row.status in statusCounts) {
        statusCounts[row.status] += row.count;
      }
    }

    const [coilCount] = await db.select({ count: sql<number>`count(*)::int` }).from(coils);
    const [activeInvCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventory)
      .where(inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD']));

    const recentAudit = await db
      .select({
        id: auditLogs.id,
        actorEmail: auditLogs.actorEmail,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(8);

    const estimatedZones = await db
      .select({ id: zones.id })
      .from(zones)
      .where(eq(zones.isEstimatedLayout, true))
      .limit(1);

    return {
      counts: {
        zones: zoneCount?.count ?? 0,
        doors: doorCount?.count ?? 0,
        rows: rowCount?.count ?? 0,
        levels: levelCount?.count ?? 0,
        layoutObjects: layoutCount?.count ?? 0,
        locations: statusCounts,
        coils: coilCount?.count ?? 0,
        activeInventory: activeInvCount?.count ?? 0,
      },
      isEstimatedLayout: estimatedZones.length > 0,
      recentAudit,
      serverTimestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Failed to query warehouse summary:', error);
    throw new Error('Failed to load warehouse summary.', { cause: error });
  }
}

export async function listWarehouseHierarchy() {
  try {
    const allZones = await db.select().from(zones).orderBy(asc(zones.code));
    const allDoors = await db
      .select()
      .from(buildingDoors)
      .orderBy(asc(buildingDoors.sortOrder), asc(buildingDoors.doorCode));
    const allRows = await db
      .select()
      .from(warehouseRows)
      .orderBy(asc(warehouseRows.doorId), asc(warehouseRows.rowNumber));
    const allLevels = await db
      .select()
      .from(warehouseLevels)
      .orderBy(asc(warehouseLevels.rowId), asc(warehouseLevels.levelNumber));

    const locationAgg = await db
      .select({
        levelId: storageLocations.levelId,
        total: sql<number>`count(*)::int`,
        empty: sql<number>`count(*) filter (where ${storageLocations.status} = 'EMPTY' and ${storageLocations.isActive} = true)::int`,
        occupied: sql<number>`count(*) filter (where ${storageLocations.status} = 'OCCUPIED' and ${storageLocations.isActive} = true)::int`,
        reserved: sql<number>`count(*) filter (where ${storageLocations.status} = 'RESERVED' and ${storageLocations.isActive} = true)::int`,
        blocked: sql<number>`count(*) filter (where ${storageLocations.status} = 'BLOCKED' and ${storageLocations.isActive} = true)::int`,
        inactive: sql<number>`count(*) filter (where ${storageLocations.isActive} = false)::int`,
      })
      .from(storageLocations)
      .groupBy(storageLocations.levelId);

    const aggByLevel = new Map(locationAgg.map((a) => [a.levelId, a]));

    const levelsWithCounts = allLevels.map((lvl) => ({
      ...lvl,
      stats: aggByLevel.get(lvl.id) ?? {
        levelId: lvl.id,
        total: 0,
        empty: 0,
        occupied: 0,
        reserved: 0,
        blocked: 0,
        inactive: 0,
      },
    }));

    return {
      zones: allZones,
      doors: allDoors,
      rows: allRows,
      levels: levelsWithCounts,
    };
  } catch (error) {
    console.error('Failed to list warehouse hierarchy:', error);
    throw new Error('Failed to load warehouse master hierarchy.', { cause: error });
  }
}

export async function createBuildingDoor(
  input: {
    zoneId: number;
    doorCode: string;
    name: string;
    description?: string;
    posX: number;
    posY: number;
    posZ: number;
    facingDirection: string;
    sortOrder?: number;
  },
  actor: AuditActor
) {
  try {
    const normalizedCode = input.doorCode.trim().toUpperCase();
    const [created] = await db
      .insert(buildingDoors)
      .values({
        zoneId: input.zoneId,
        doorCode: normalizedCode,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        posX: input.posX,
        posY: input.posY,
        posZ: input.posZ,
        facingDirection: input.facingDirection,
        sortOrder: input.sortOrder ?? 10,
      })
      .returning();

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'CREATE_BUILDING_DOOR',
      entityType: 'building_doors',
      entityId: created.id,
      afterJson: created as unknown as Record<string, unknown>,
      ipAddress: actor.ip,
    });
    return created;
  } catch (error: unknown) {
    console.error('Failed to create building door:', error);
    const pgCode = (error as { code?: string })?.code;
    if (pgCode === '23505') {
      throw new Error(`Building Door "${input.doorCode}" already exists.`, { cause: error });
    }
    throw new Error('Failed to create building door.', { cause: error });
  }
}

export async function updateBuildingDoor(
  id: number,
  input: Partial<{
    name: string;
    description: string | null;
    posX: number;
    posY: number;
    posZ: number;
    facingDirection: string;
    sortOrder: number;
    isActive: boolean;
  }>,
  actor: AuditActor
) {
  try {
    const [before] = await db.select().from(buildingDoors).where(eq(buildingDoors.id, id)).limit(1);
    if (!before) {
      throw new Error('Building door not found.');
    }

    if (input.isActive === false) {
      const occupied = await db
        .select({ id: storageLocations.id })
        .from(storageLocations)
        .where(
          and(
            eq(storageLocations.doorId, id),
            inArray(storageLocations.status, ['OCCUPIED', 'RESERVED'])
          )
        )
        .limit(1);
      if (occupied.length > 0) {
        throw new Error('ไม่สามารถปิดประตูอาคารที่มีเหล็กม้วนหรือการจองค้างอยู่ได้');
      }
    }

    const [updated] = await db
      .update(buildingDoors)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(buildingDoors.id, id))
      .returning();

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'UPDATE_BUILDING_DOOR',
      entityType: 'building_doors',
      entityId: id,
      beforeJson: before as unknown as Record<string, unknown>,
      afterJson: updated as unknown as Record<string, unknown>,
      ipAddress: actor.ip,
    });
    return updated;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('ไม่สามารถปิด')) {
      throw error;
    }
    console.error('Failed to update building door:', error);
    throw new Error('Failed to update building door.', { cause: error });
  }
}

export async function createWarehouseRow(
  input: {
    doorId: number;
    rowNumber: number;
    label: string;
    allocationPriority: number;
    posX: number;
    posZ: number;
    orientationDeg?: number;
    slotSpacingM: number;
    maxLevels: number;
  },
  actor: AuditActor
) {
  try {
    const [created] = await db
      .insert(warehouseRows)
      .values({
        doorId: input.doorId,
        rowNumber: input.rowNumber,
        label: input.label.trim(),
        allocationPriority: input.allocationPriority,
        posX: input.posX,
        posZ: input.posZ,
        orientationDeg: input.orientationDeg ?? 0,
        slotSpacingM: input.slotSpacingM,
        maxLevels: input.maxLevels,
      })
      .returning();

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'CREATE_WAREHOUSE_ROW',
      entityType: 'warehouse_rows',
      entityId: created.id,
      afterJson: created as unknown as Record<string, unknown>,
      ipAddress: actor.ip,
    });
    return created;
  } catch (error: unknown) {
    console.error('Failed to create warehouse row:', error);
    if ((error as { code?: string })?.code === '23505') {
      throw new Error(`Row ${input.rowNumber} already exists for this building door.`, {
        cause: error,
      });
    }
    throw new Error('Failed to create warehouse row.', { cause: error });
  }
}

export async function createWarehouseLevel(
  input: {
    rowId: number;
    levelNumber: number;
    label: string;
    elevationY?: number;
    maxWeightKg: number;
    maxSlots: number;
    stackingRule: StackingRule;
  },
  actor: AuditActor
) {
  try {
    const [row] = await db
      .select()
      .from(warehouseRows)
      .where(eq(warehouseRows.id, input.rowId))
      .limit(1);
    if (!row) {
      throw new Error('Parent warehouse row not found.');
    }

    const computed = calculateSlotCoordinates({
      rowOriginX: row.posX,
      rowOriginZ: row.posZ,
      slotSpacingM: row.slotSpacingM,
      levelNumber: input.levelNumber,
      slotNumber: 1,
      stackingRule: input.stackingRule,
    });

    const [created] = await db
      .insert(warehouseLevels)
      .values({
        rowId: input.rowId,
        levelNumber: input.levelNumber,
        label: input.label.trim(),
        elevationY: input.elevationY ?? computed.posY,
        maxWeightKg: input.maxWeightKg,
        maxSlots: input.maxSlots,
        stackingRule: input.stackingRule,
      })
      .returning();

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'CREATE_WAREHOUSE_LEVEL',
      entityType: 'warehouse_levels',
      entityId: created.id,
      afterJson: created as unknown as Record<string, unknown>,
      ipAddress: actor.ip,
    });
    return created;
  } catch (error: unknown) {
    console.error('Failed to create warehouse level:', error);
    if ((error as { code?: string })?.code === '23505') {
      throw new Error(`Level ${input.levelNumber} already exists in this row.`, { cause: error });
    }
    throw new Error('Failed to create warehouse level.', { cause: error });
  }
}

export async function listStorageLocations(filters: {
  doorId?: number;
  rowId?: number;
  levelId?: number;
  status?: string;
  isActive?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  try {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(200, Math.max(10, filters.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    const conditions = [];
    if (filters.doorId) conditions.push(eq(storageLocations.doorId, filters.doorId));
    if (filters.rowId) conditions.push(eq(storageLocations.rowId, filters.rowId));
    if (filters.levelId) conditions.push(eq(storageLocations.levelId, filters.levelId));
    if (filters.status && filters.status !== 'ALL') {
      conditions.push(eq(storageLocations.status, filters.status));
    }
    if (typeof filters.isActive === 'boolean') {
      conditions.push(eq(storageLocations.isActive, filters.isActive));
    }
    if (filters.search && filters.search.trim()) {
      conditions.push(ilike(storageLocations.locationCode, `%${filters.search.trim()}%`));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [totalRes] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(storageLocations)
      .where(whereClause);

    const items = await db
      .select({
        id: storageLocations.id,
        locationCode: storageLocations.locationCode,
        doorId: storageLocations.doorId,
        doorCode: buildingDoors.doorCode,
        rowId: storageLocations.rowId,
        rowNumber: warehouseRows.rowNumber,
        levelId: storageLocations.levelId,
        levelNumber: warehouseLevels.levelNumber,
        stackingRule: warehouseLevels.stackingRule,
        slotNumber: storageLocations.slotNumber,
        posX: storageLocations.posX,
        posY: storageLocations.posY,
        posZ: storageLocations.posZ,
        widthM: storageLocations.widthM,
        heightM: storageLocations.heightM,
        depthM: storageLocations.depthM,
        maxWeightKg: storageLocations.maxWeightKg,
        maxOuterDiameterMm: storageLocations.maxOuterDiameterMm,
        maxWidthMm: storageLocations.maxWidthMm,
        stackingGroup: storageLocations.stackingGroup,
        allocationPriority: storageLocations.allocationPriority,
        status: storageLocations.status,
        isActive: storageLocations.isActive,
        isEstimatedCoord: storageLocations.isEstimatedCoord,
        notes: storageLocations.notes,
        updatedAt: storageLocations.updatedAt,
      })
      .from(storageLocations)
      .innerJoin(buildingDoors, eq(storageLocations.doorId, buildingDoors.id))
      .innerJoin(warehouseRows, eq(storageLocations.rowId, warehouseRows.id))
      .innerJoin(warehouseLevels, eq(storageLocations.levelId, warehouseLevels.id))
      .where(whereClause)
      .orderBy(
        asc(buildingDoors.sortOrder),
        asc(warehouseRows.rowNumber),
        asc(warehouseLevels.levelNumber),
        asc(storageLocations.slotNumber)
      )
      .limit(pageSize)
      .offset(offset);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total: totalRes?.count ?? 0,
        totalPages: Math.max(1, Math.ceil((totalRes?.count ?? 0) / pageSize)),
      },
    };
  } catch (error) {
    console.error('Failed to list storage locations:', error);
    throw new Error('Failed to load storage locations.', { cause: error });
  }
}

export async function createStorageLocation(
  input: {
    levelId: number;
    slotNumber: number;
    posX?: number;
    posY?: number;
    posZ?: number;
    widthM?: number;
    heightM?: number;
    depthM?: number;
    maxWeightKg?: number;
    maxOuterDiameterMm?: number;
    maxWidthMm?: number;
    stackingGroup?: string;
    allocationPriority?: number;
    isEstimatedCoord?: boolean;
    notes?: string;
  },
  actor: AuditActor
) {
  try {
    const [levelCtx] = await db
      .select({
        levelId: warehouseLevels.id,
        levelNumber: warehouseLevels.levelNumber,
        levelMaxWeight: warehouseLevels.maxWeightKg,
        stackingRule: warehouseLevels.stackingRule,
        rowId: warehouseRows.id,
        rowNumber: warehouseRows.rowNumber,
        rowPosX: warehouseRows.posX,
        rowPosZ: warehouseRows.posZ,
        slotSpacingM: warehouseRows.slotSpacingM,
        rowPriority: warehouseRows.allocationPriority,
        doorId: buildingDoors.id,
        doorCode: buildingDoors.doorCode,
      })
      .from(warehouseLevels)
      .innerJoin(warehouseRows, eq(warehouseLevels.rowId, warehouseRows.id))
      .innerJoin(buildingDoors, eq(warehouseRows.doorId, buildingDoors.id))
      .where(eq(warehouseLevels.id, input.levelId))
      .limit(1);

    if (!levelCtx) {
      throw new Error('Parent level not found.');
    }

    const locationCode = formatLocationCode(
      levelCtx.doorCode,
      levelCtx.rowNumber,
      levelCtx.levelNumber,
      input.slotNumber
    );

    const autoCoords = calculateSlotCoordinates({
      rowOriginX: levelCtx.rowPosX,
      rowOriginZ: levelCtx.rowPosZ,
      slotSpacingM: levelCtx.slotSpacingM,
      levelNumber: levelCtx.levelNumber,
      slotNumber: input.slotNumber,
      stackingRule: levelCtx.stackingRule as StackingRule,
    });

    const [created] = await db
      .insert(storageLocations)
      .values({
        doorId: levelCtx.doorId,
        rowId: levelCtx.rowId,
        levelId: levelCtx.levelId,
        slotNumber: input.slotNumber,
        locationCode,
        posX: input.posX ?? autoCoords.posX,
        posY: input.posY ?? autoCoords.posY,
        posZ: input.posZ ?? autoCoords.posZ,
        widthM: input.widthM ?? 1.85,
        heightM: input.heightM ?? 1.55,
        depthM: input.depthM ?? 1.85,
        maxWeightKg: input.maxWeightKg ?? levelCtx.levelMaxWeight,
        maxOuterDiameterMm: input.maxOuterDiameterMm ?? 2000,
        maxWidthMm: input.maxWidthMm ?? 1650,
        stackingGroup:
          input.stackingGroup ?? (levelCtx.levelNumber === 1 ? 'HEAVY_BASE' : 'PYRAMID_UPPER'),
        allocationPriority:
          input.allocationPriority ??
          levelCtx.rowPriority * 10 + levelCtx.levelNumber * 10 + input.slotNumber,
        status: 'EMPTY',
        isActive: true,
        isEstimatedCoord: input.isEstimatedCoord ?? input.posX === undefined,
        notes: input.notes?.trim() || null,
      })
      .returning();

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'CREATE_STORAGE_LOCATION',
      entityType: 'storage_locations',
      entityId: created.locationCode,
      afterJson: created as unknown as Record<string, unknown>,
      ipAddress: actor.ip,
    });
    return created;
  } catch (error: unknown) {
    console.error('Failed to create storage location:', error);
    if ((error as { code?: string })?.code === '23505') {
      throw new Error('Location Code or Slot Number already exists.', { cause: error });
    }
    throw new Error('Failed to create storage location.', { cause: error });
  }
}

export async function updateStorageLocation(
  id: number,
  input: Partial<{
    posX: number;
    posY: number;
    posZ: number;
    widthM: number;
    heightM: number;
    depthM: number;
    maxWeightKg: number;
    maxOuterDiameterMm: number;
    maxWidthMm: number;
    stackingGroup: string;
    allocationPriority: number;
    status: LocationStatus;
    isActive: boolean;
    isEstimatedCoord: boolean;
    notes: string | null;
  }>,
  actor: AuditActor
) {
  try {
    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(storageLocations)
        .where(eq(storageLocations.id, id))
        .for('update')
        .limit(1);

      if (!current) {
        throw new Error('NOT_FOUND: Storage location not found.');
      }

      const activeInv = await tx
        .select({ id: inventory.id })
        .from(inventory)
        .where(
          and(
            eq(inventory.currentLocationId, id),
            inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
          )
        )
        .limit(1);

      const activeRes = await tx
        .select({ id: locationReservations.id })
        .from(locationReservations)
        .where(
          and(
            eq(locationReservations.locationId, id),
            eq(locationReservations.status, 'ACTIVE')
          )
        )
        .limit(1);

      const safety = validateLocationModificationSafety({
        currentStatus: current.status as LocationStatus,
        hasActiveInventory: activeInv.length > 0,
        hasActiveReservation: activeRes.length > 0,
        requestedIsActive: input.isActive,
        requestedStatus: input.status,
      });

      if (!safety.allowed) {
        throw new Error(`VALIDATION: ${safety.reason}`);
      }

      const [updated] = await tx
        .update(storageLocations)
        .set({
          ...input,
          updatedAt: new Date(),
        })
        .where(eq(storageLocations.id, id))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: 'UPDATE_STORAGE_LOCATION',
        entityType: 'storage_locations',
        entityId: updated.locationCode,
        beforeJson: current as unknown as Record<string, unknown>,
        afterJson: updated as unknown as Record<string, unknown>,
        ipAddress: actor.ip ?? null,
      });

      return updated;
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('VALIDATION:') || error.message.startsWith('NOT_FOUND:'))
    ) {
      throw error;
    }
    console.error('Failed to update storage location:', error);
    throw new Error('Failed to update storage location.', { cause: error });
  }
}

export async function batchGenerateLocations(
  input: {
    levelId: number;
    startSlot: number;
    endSlot: number;
    maxWeightKg?: number;
    widthM?: number;
    heightM?: number;
    depthM?: number;
    stackingGroup?: string;
    isEstimatedCoord?: boolean;
  },
  actor: AuditActor
) {
  try {
    const [levelCtx] = await db
      .select({
        levelId: warehouseLevels.id,
        levelNumber: warehouseLevels.levelNumber,
        levelMaxWeight: warehouseLevels.maxWeightKg,
        stackingRule: warehouseLevels.stackingRule,
        rowId: warehouseRows.id,
        rowNumber: warehouseRows.rowNumber,
        rowPosX: warehouseRows.posX,
        rowPosZ: warehouseRows.posZ,
        slotSpacingM: warehouseRows.slotSpacingM,
        rowPriority: warehouseRows.allocationPriority,
        doorId: buildingDoors.id,
        doorCode: buildingDoors.doorCode,
      })
      .from(warehouseLevels)
      .innerJoin(warehouseRows, eq(warehouseLevels.rowId, warehouseRows.id))
      .innerJoin(buildingDoors, eq(warehouseRows.doorId, buildingDoors.id))
      .where(eq(warehouseLevels.id, input.levelId))
      .limit(1);

    if (!levelCtx) {
      throw new Error('NOT_FOUND: Target level not found.');
    }

    const toInsert: Array<typeof storageLocations.$inferInsert> = [];
    for (let slot = input.startSlot; slot <= input.endSlot; slot++) {
      const coords = calculateSlotCoordinates({
        rowOriginX: levelCtx.rowPosX,
        rowOriginZ: levelCtx.rowPosZ,
        slotSpacingM: levelCtx.slotSpacingM,
        levelNumber: levelCtx.levelNumber,
        slotNumber: slot,
        stackingRule: levelCtx.stackingRule as StackingRule,
      });
      toInsert.push({
        doorId: levelCtx.doorId,
        rowId: levelCtx.rowId,
        levelId: levelCtx.levelId,
        slotNumber: slot,
        locationCode: formatLocationCode(
          levelCtx.doorCode,
          levelCtx.rowNumber,
          levelCtx.levelNumber,
          slot
        ),
        posX: coords.posX,
        posY: coords.posY,
        posZ: coords.posZ,
        widthM: input.widthM ?? 1.85,
        heightM: input.heightM ?? 1.55,
        depthM: input.depthM ?? 1.85,
        maxWeightKg: input.maxWeightKg ?? levelCtx.levelMaxWeight,
        maxOuterDiameterMm: 2000,
        maxWidthMm: 1650,
        stackingGroup:
          input.stackingGroup ?? (levelCtx.levelNumber === 1 ? 'HEAVY_BASE' : 'PYRAMID_UPPER'),
        allocationPriority:
          levelCtx.rowPriority * 10 + levelCtx.levelNumber * 10 + slot,
        status: 'EMPTY',
        isActive: true,
        isEstimatedCoord: input.isEstimatedCoord ?? true,
      });
    }

    const inserted = await db
      .insert(storageLocations)
      .values(toInsert)
      .onConflictDoNothing({ target: storageLocations.locationCode })
      .returning({ id: storageLocations.id, locationCode: storageLocations.locationCode });

    await db
      .update(warehouseLevels)
      .set({
        maxSlots: sql`GREATEST(${warehouseLevels.maxSlots}, ${input.endSlot})`,
      })
      .where(eq(warehouseLevels.id, levelCtx.levelId));

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'BATCH_GENERATE_LOCATIONS',
      entityType: 'warehouse_levels',
      entityId: levelCtx.levelId,
      afterJson: {
        doorCode: levelCtx.doorCode,
        rowNumber: levelCtx.rowNumber,
        levelNumber: levelCtx.levelNumber,
        requestedRange: `${input.startSlot}-${input.endSlot}`,
        createdCount: inserted.length,
        skippedExistingCount: toInsert.length - inserted.length,
      },
      ipAddress: actor.ip,
    });

    return {
      createdCount: inserted.length,
      skippedCount: toInsert.length - inserted.length,
      createdCodes: inserted.map((i) => i.locationCode),
    };
  } catch (error) {
    console.error('Failed to batch generate locations:', error);
    throw new Error('Failed to batch generate storage locations.', { cause: error });
  }
}

/**
 * Expands a warehouse row's Level 1 (Floor Saddle) capacity beyond its initial slot count (e.g. > 12 coils)
 * and optionally auto-expands upper Pyramid Stacking levels (Level k => targetBaseSlots - (k - 1)).
 * Strictly additive: NEVER deletes, moves, or mutates existing slots, coils, or reservations.
 */
export async function expandRowSlots(
  input: {
    rowId: number;
    targetBaseSlots?: number;
    addSlots?: number;
    syncUpperPyramidLevels?: boolean;
  },
  actor: AuditActor
) {
  const syncUpper = input.syncUpperPyramidLevels !== false;

  try {
    return await db.transaction(async (tx) => {
      const [rowCtx] = await tx
        .select({
          rowId: warehouseRows.id,
          rowNumber: warehouseRows.rowNumber,
          rowLabel: warehouseRows.label,
          rowPosX: warehouseRows.posX,
          rowPosZ: warehouseRows.posZ,
          slotSpacingM: warehouseRows.slotSpacingM,
          rowPriority: warehouseRows.allocationPriority,
          doorId: buildingDoors.id,
          doorCode: buildingDoors.doorCode,
        })
        .from(warehouseRows)
        .innerJoin(buildingDoors, eq(warehouseRows.doorId, buildingDoors.id))
        .where(eq(warehouseRows.id, input.rowId))
        .limit(1);

      if (!rowCtx) {
        throw new Error('NOT_FOUND: ไม่พบแถวจัดเก็บ (Row) ที่ระบุ');
      }

      const levelsInRow = await tx
        .select()
        .from(warehouseLevels)
        .where(eq(warehouseLevels.rowId, rowCtx.rowId))
        .orderBy(asc(warehouseLevels.levelNumber));

      if (levelsInRow.length === 0) {
        throw new Error('VALIDATION: แถวนี้ยังไม่มีชั้นวาง (Level) กรุณาเพิ่มชั้นที่ 1 ก่อน');
      }

      const existingSlotsInRow = await tx
        .select({
          levelId: storageLocations.levelId,
          slotNumber: storageLocations.slotNumber,
        })
        .from(storageLocations)
        .where(eq(storageLocations.rowId, rowCtx.rowId));

      const maxSlotByLevelId = new Map<number, number>();
      const slotCountByLevelId = new Map<number, number>();
      for (const s of existingSlotsInRow) {
        maxSlotByLevelId.set(s.levelId, Math.max(maxSlotByLevelId.get(s.levelId) ?? 0, s.slotNumber));
        slotCountByLevelId.set(s.levelId, (slotCountByLevelId.get(s.levelId) ?? 0) + 1);
      }

      const baseLevel =
        levelsInRow.find((l) => l.levelNumber === 1) ?? levelsInRow[0];
      const previousBaseSlots = Math.max(
        maxSlotByLevelId.get(baseLevel.id) ?? 0,
        slotCountByLevelId.get(baseLevel.id) ?? 0,
        baseLevel.maxSlots
      );

      let newBaseSlots: number;
      if (typeof input.targetBaseSlots === 'number') {
        newBaseSlots = input.targetBaseSlots;
      } else if (typeof input.addSlots === 'number') {
        newBaseSlots = previousBaseSlots + input.addSlots;
      } else {
        throw new Error('VALIDATION: กรุณาระบุจำนวนช่องที่ต้องการเพิ่มหรือจำนวนช่องชั้น 1 เป้าหมาย');
      }

      if (!Number.isInteger(newBaseSlots) || newBaseSlots < 1 || newBaseSlots > 100) {
        throw new Error('VALIDATION: จำนวนช่องชั้น 1 ต่อแถวต้องอยู่ระหว่าง 1 ถึง 100 ม้วน');
      }

      let totalCreated = 0;
      let totalSkipped = 0;
      const allCreatedCodes: string[] = [];
      let firstFloorCreatedCode: string | null = null;
      const levelSummaries: Array<{
        levelId: number;
        levelNumber: number;
        label: string;
        previousSlots: number;
        newMaxSlots: number;
        createdCount: number;
      }> = [];

      for (const lvl of levelsInRow) {
        const isBase = lvl.levelNumber === 1;
        if (!isBase && !syncUpper) {
          levelSummaries.push({
            levelId: lvl.id,
            levelNumber: lvl.levelNumber,
            label: lvl.label,
            previousSlots: slotCountByLevelId.get(lvl.id) ?? 0,
            newMaxSlots: lvl.maxSlots,
            createdCount: 0,
          });
          continue;
        }

        const levelTargetSlots = isBase
          ? newBaseSlots
          : lvl.stackingRule === 'PYRAMID_STACK'
            ? Math.max(1, newBaseSlots - (lvl.levelNumber - 1))
            : newBaseSlots;

        const existingMax = maxSlotByLevelId.get(lvl.id) ?? 0;
        const effectiveMaxSlots = Math.max(lvl.maxSlots, existingMax, levelTargetSlots);

        const toInsert: Array<typeof storageLocations.$inferInsert> = [];
        for (let slot = 1; slot <= levelTargetSlots; slot++) {
          const coords = calculateSlotCoordinates({
            rowOriginX: rowCtx.rowPosX,
            rowOriginZ: rowCtx.rowPosZ,
            slotSpacingM: rowCtx.slotSpacingM,
            levelNumber: lvl.levelNumber,
            slotNumber: slot,
            stackingRule: lvl.stackingRule as StackingRule,
          });

          toInsert.push({
            doorId: rowCtx.doorId,
            rowId: rowCtx.rowId,
            levelId: lvl.id,
            slotNumber: slot,
            locationCode: formatLocationCode(
              rowCtx.doorCode,
              rowCtx.rowNumber,
              lvl.levelNumber,
              slot
            ),
            posX: coords.posX,
            posY: coords.posY,
            posZ: coords.posZ,
            widthM: 1.85,
            heightM: 1.55,
            depthM: 1.85,
            maxWeightKg: lvl.maxWeightKg,
            maxOuterDiameterMm: 2000,
            maxWidthMm: 1650,
            stackingGroup: lvl.levelNumber === 1 ? 'HEAVY_BASE' : 'PYRAMID_UPPER',
            allocationPriority: rowCtx.rowPriority * 10 + lvl.levelNumber * 10 + slot,
            status: 'EMPTY',
            isActive: true,
            isEstimatedCoord: true,
          });
        }

        const inserted =
          toInsert.length > 0
            ? await tx
                .insert(storageLocations)
                .values(toInsert)
                .onConflictDoNothing({ target: storageLocations.locationCode })
                .returning({ id: storageLocations.id, locationCode: storageLocations.locationCode })
            : [];

        if (effectiveMaxSlots !== lvl.maxSlots) {
          await tx
            .update(warehouseLevels)
            .set({ maxSlots: effectiveMaxSlots })
            .where(eq(warehouseLevels.id, lvl.id));
        }

        const skipped = toInsert.length - inserted.length;
        totalCreated += inserted.length;
        totalSkipped += skipped;
        for (const row of inserted) {
          allCreatedCodes.push(row.locationCode);
          if (isBase && !firstFloorCreatedCode) {
            firstFloorCreatedCode = row.locationCode;
          }
        }

        levelSummaries.push({
          levelId: lvl.id,
          levelNumber: lvl.levelNumber,
          label: lvl.label,
          previousSlots: slotCountByLevelId.get(lvl.id) ?? 0,
          newMaxSlots: effectiveMaxSlots,
          createdCount: inserted.length,
        });
      }

      await tx.insert(auditLogs).values({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: 'EXPAND_ROW_SLOTS',
        entityType: 'warehouse_rows',
        entityId: String(rowCtx.rowId),
        beforeJson: {
          doorCode: rowCtx.doorCode,
          rowNumber: rowCtx.rowNumber,
          previousBaseSlots,
        },
        afterJson: {
          doorCode: rowCtx.doorCode,
          rowNumber: rowCtx.rowNumber,
          newBaseSlots,
          syncUpperPyramidLevels: syncUpper,
          createdCount: totalCreated,
          skippedCount: totalSkipped,
          levels: levelSummaries,
        },
        ipAddress: actor.ip ?? null,
      });

      return {
        rowId: rowCtx.rowId,
        doorId: rowCtx.doorId,
        doorCode: rowCtx.doorCode,
        rowNumber: rowCtx.rowNumber,
        rowLabel: rowCtx.rowLabel,
        previousBaseSlots,
        newBaseSlots: Math.max(previousBaseSlots, newBaseSlots),
        syncUpperPyramidLevels: syncUpper,
        createdCount: totalCreated,
        skippedCount: totalSkipped,
        firstCreatedLocationCode: firstFloorCreatedCode ?? allCreatedCodes[0] ?? null,
        createdCodes: allCreatedCodes,
        levels: levelSummaries,
      };
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('NOT_FOUND:') || error.message.startsWith('VALIDATION:'))
    ) {
      throw error;
    }
    console.error('Failed to expand row slots:', error);
    throw new Error('ไม่สามารถขยายจำนวนช่องวางในแถวได้', { cause: error });
  }
}

export async function listLayoutObjects() {
  try {
    return await db
      .select({
        id: warehouseLayoutObjects.id,
        zoneId: warehouseLayoutObjects.zoneId,
        zoneCode: zones.code,
        doorId: warehouseLayoutObjects.doorId,
        objectCode: warehouseLayoutObjects.objectCode,
        name: warehouseLayoutObjects.name,
        objectType: warehouseLayoutObjects.objectType,
        posX: warehouseLayoutObjects.posX,
        posY: warehouseLayoutObjects.posY,
        posZ: warehouseLayoutObjects.posZ,
        widthM: warehouseLayoutObjects.widthM,
        heightM: warehouseLayoutObjects.heightM,
        depthM: warehouseLayoutObjects.depthM,
        rotationYDeg: warehouseLayoutObjects.rotationYDeg,
        colorHex: warehouseLayoutObjects.colorHex,
        metadataJson: warehouseLayoutObjects.metadataJson,
        isEstimated: warehouseLayoutObjects.isEstimated,
        isActive: warehouseLayoutObjects.isActive,
        updatedAt: warehouseLayoutObjects.updatedAt,
      })
      .from(warehouseLayoutObjects)
      .innerJoin(zones, eq(warehouseLayoutObjects.zoneId, zones.id))
      .orderBy(asc(warehouseLayoutObjects.objectType), asc(warehouseLayoutObjects.objectCode));
  } catch (error) {
    console.error('Failed to list layout objects:', error);
    throw new Error('Failed to load warehouse 3D layout objects.', { cause: error });
  }
}

export async function createLayoutObject(
  input: {
    zoneId: number;
    doorId?: number | null;
    objectCode: string;
    name: string;
    objectType: string;
    posX: number;
    posY: number;
    posZ: number;
    widthM: number;
    heightM: number;
    depthM: number;
    rotationYDeg?: number;
    colorHex?: string;
    isEstimated?: boolean;
  },
  actor: AuditActor
) {
  try {
    const [created] = await db
      .insert(warehouseLayoutObjects)
      .values({
        zoneId: input.zoneId,
        doorId: input.doorId ?? null,
        objectCode: input.objectCode.trim().toUpperCase(),
        name: input.name.trim(),
        objectType: input.objectType,
        posX: input.posX,
        posY: input.posY,
        posZ: input.posZ,
        widthM: input.widthM,
        heightM: input.heightM,
        depthM: input.depthM,
        rotationYDeg: input.rotationYDeg ?? 0,
        colorHex: input.colorHex ?? '#334155',
        isEstimated: input.isEstimated ?? true,
        isActive: true,
      })
      .returning();

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'CREATE_LAYOUT_OBJECT',
      entityType: 'warehouse_layout_objects',
      entityId: created.objectCode,
      afterJson: created as unknown as Record<string, unknown>,
      ipAddress: actor.ip,
    });
    return created;
  } catch (error: unknown) {
    console.error('Failed to create layout object:', error);
    if ((error as { code?: string })?.code === '23505') {
      throw new Error(`Layout object code "${input.objectCode}" already exists.`, { cause: error });
    }
    throw new Error('Failed to create 3D layout object.', { cause: error });
  }
}

export async function updateLayoutObject(
  id: number,
  input: Partial<{
    name: string;
    posX: number;
    posY: number;
    posZ: number;
    widthM: number;
    heightM: number;
    depthM: number;
    rotationYDeg: number;
    colorHex: string;
    isEstimated: boolean;
    isActive: boolean;
  }>,
  actor: AuditActor
) {
  try {
    const [before] = await db
      .select()
      .from(warehouseLayoutObjects)
      .where(eq(warehouseLayoutObjects.id, id))
      .limit(1);
    if (!before) {
      throw new Error('NOT_FOUND: Layout object not found.');
    }

    const [updated] = await db
      .update(warehouseLayoutObjects)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(warehouseLayoutObjects.id, id))
      .returning();

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'UPDATE_LAYOUT_OBJECT',
      entityType: 'warehouse_layout_objects',
      entityId: updated.objectCode,
      beforeJson: before as unknown as Record<string, unknown>,
      afterJson: updated as unknown as Record<string, unknown>,
      ipAddress: actor.ip,
    });
    return updated;
  } catch (error) {
    console.error('Failed to update layout object:', error);
    throw new Error('Failed to update 3D layout object.', { cause: error });
  }
}

export async function listUsersAndRoles() {
  try {
    const allUsers = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        displayName: users.displayName,
        roleId: users.roleId,
        roleCode: roles.code,
        roleName: roles.name,
        isActive: users.isActive,
        lastLoginAt: users.lastLoginAt,
        createdAt: users.createdAt,
      })
      .from(users)
      .innerJoin(roles, eq(users.roleId, roles.id))
      .orderBy(asc(users.id));

    const allRoles = await db.select().from(roles).orderBy(asc(roles.id));
    return { users: allUsers, roles: allRoles };
  } catch (error) {
    console.error('Failed to list users and roles:', error);
    throw new Error('Failed to load users and roles.', { cause: error });
  }
}

export async function updateUserAccess(
  targetUserId: number,
  input: { roleId?: number; isActive?: boolean },
  actor: AuditActor
) {
  try {
    if (targetUserId === actor.userId && input.isActive === false) {
      throw new Error('VALIDATION: Cannot deactivate your own Admin account.');
    }

    const [before] = await db.select().from(users).where(eq(users.id, targetUserId)).limit(1);
    if (!before) {
      throw new Error('NOT_FOUND: User not found.');
    }

    const [updated] = await db
      .update(users)
      .set({
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, targetUserId))
      .returning();

    await writeAuditLog({
      actorUserId: actor.userId,
      actorEmail: actor.email,
      action: 'UPDATE_USER_ACCESS',
      entityType: 'users',
      entityId: targetUserId,
      beforeJson: { roleId: before.roleId, isActive: before.isActive },
      afterJson: { roleId: updated.roleId, isActive: updated.isActive },
      ipAddress: actor.ip,
    });
    return updated;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith('VALIDATION:') || error.message.startsWith('NOT_FOUND:'))
    ) {
      throw error;
    }
    console.error('Failed to update user access:', error);
    throw new Error('Failed to update user role or status.', { cause: error });
  }
}

// ============================================================================
// PHASE 3: INTERACTIVE 3D WAREHOUSE QUERIES (REAL POSTGRESQL DATA ONLY)
// ============================================================================

const DEFAULT_ESTIMATED_COIL_MODEL = {
  outerDiameterMm: 1550,
  innerDiameterMm: 508,
  widthMm: 1250,
  isEstimated: true as const,
};

function isValidCoordinateSet(loc: {
  posX: number;
  posY: number;
  posZ: number;
  widthM: number;
  heightM: number;
  depthM: number;
}): { valid: boolean; reason?: string } {
  if (
    !Number.isFinite(loc.posX) ||
    !Number.isFinite(loc.posY) ||
    !Number.isFinite(loc.posZ)
  ) {
    return { valid: false, reason: 'Missing or non-finite X/Y/Z coordinates' };
  }
  if (
    !Number.isFinite(loc.widthM) ||
    !Number.isFinite(loc.heightM) ||
    !Number.isFinite(loc.depthM) ||
    loc.widthM <= 0 ||
    loc.heightM <= 0 ||
    loc.depthM <= 0
  ) {
    return { valid: false, reason: 'Invalid non-positive slot dimensions' };
  }
  return { valid: true };
}

export async function getWarehouse3DScene(filters: { zoneId?: number; doorId?: number } = {}) {
  try {
    await expireStaleReservations(db);
    const allZones = await db
      .select()
      .from(zones)
      .where(filters.zoneId ? and(eq(zones.id, filters.zoneId), eq(zones.isActive, true)) : eq(zones.isActive, true))
      .orderBy(asc(zones.code));

    const zoneIds = allZones.map((z) => z.id);
    if (zoneIds.length === 0) {
      return {
        zones: [],
        doors: [],
        rows: [],
        levels: [],
        locations: [],
        layoutObjects: [],
        coordinateWarnings: [],
        summary: {
          totalLocations: 0,
          emptyCount: 0,
          occupiedCount: 0,
          reservedCount: 0,
          blockedCount: 0,
          activeCoilCount: 0,
          pendingSapCoilCount: 0,
          isEstimatedLayout: false,
        },
        defaultCoilModelSpec: DEFAULT_ESTIMATED_COIL_MODEL,
        serverTimestamp: new Date().toISOString(),
      };
    }

    const doorConditions = [inArray(buildingDoors.zoneId, zoneIds), eq(buildingDoors.isActive, true)];
    if (filters.doorId) {
      doorConditions.push(eq(buildingDoors.id, filters.doorId));
    }

    const allDoors = await db
      .select()
      .from(buildingDoors)
      .where(and(...doorConditions))
      .orderBy(asc(buildingDoors.sortOrder), asc(buildingDoors.doorCode));

    const doorIds = allDoors.map((d) => d.id);
    const doorById = new Map(allDoors.map((d) => [d.id, d]));

    const allRows =
      doorIds.length > 0
        ? await db
            .select()
            .from(warehouseRows)
            .where(and(inArray(warehouseRows.doorId, doorIds), eq(warehouseRows.isActive, true)))
            .orderBy(asc(warehouseRows.doorId), asc(warehouseRows.rowNumber))
        : [];
    const rowById = new Map(allRows.map((r) => [r.id, r]));
    const rowIds = allRows.map((r) => r.id);

    const allLevels =
      rowIds.length > 0
        ? await db
            .select()
            .from(warehouseLevels)
            .where(and(inArray(warehouseLevels.rowId, rowIds), eq(warehouseLevels.isActive, true)))
            .orderBy(asc(warehouseLevels.rowId), asc(warehouseLevels.levelNumber))
        : [];
    const levelById = new Map(allLevels.map((l) => [l.id, l]));

    const layoutObjectsRaw = await db
      .select({
        id: warehouseLayoutObjects.id,
        zoneId: warehouseLayoutObjects.zoneId,
        zoneCode: zones.code,
        doorId: warehouseLayoutObjects.doorId,
        objectCode: warehouseLayoutObjects.objectCode,
        name: warehouseLayoutObjects.name,
        objectType: warehouseLayoutObjects.objectType,
        posX: warehouseLayoutObjects.posX,
        posY: warehouseLayoutObjects.posY,
        posZ: warehouseLayoutObjects.posZ,
        widthM: warehouseLayoutObjects.widthM,
        heightM: warehouseLayoutObjects.heightM,
        depthM: warehouseLayoutObjects.depthM,
        rotationYDeg: warehouseLayoutObjects.rotationYDeg,
        colorHex: warehouseLayoutObjects.colorHex,
        metadataJson: warehouseLayoutObjects.metadataJson,
        isEstimated: warehouseLayoutObjects.isEstimated,
        isActive: warehouseLayoutObjects.isActive,
        updatedAt: warehouseLayoutObjects.updatedAt,
      })
      .from(warehouseLayoutObjects)
      .innerJoin(zones, eq(warehouseLayoutObjects.zoneId, zones.id))
      .where(
        and(inArray(warehouseLayoutObjects.zoneId, zoneIds), eq(warehouseLayoutObjects.isActive, true))
      )
      .orderBy(asc(warehouseLayoutObjects.objectType), asc(warehouseLayoutObjects.objectCode));

    const rawLocations =
      doorIds.length > 0
        ? await db
            .select()
            .from(storageLocations)
            .where(and(inArray(storageLocations.doorId, doorIds), eq(storageLocations.isActive, true)))
            .orderBy(
              asc(storageLocations.doorId),
              asc(storageLocations.rowId),
              asc(storageLocations.levelId),
              asc(storageLocations.slotNumber)
            )
        : [];

    const locationIds = rawLocations.map((l) => l.id);

    // Fetch ONLY real active inventory occupying these locations
    const activeInventoryRows =
      locationIds.length > 0
        ? await db
            .select({
              inventoryId: inventory.id,
              currentLocationId: inventory.currentLocationId,
              inventoryStatus: inventory.status,
              inboundDate: inventory.inboundDate,
              coilDbId: coils.id,
              coilId: coils.coilId,
              batchNo: coils.batchNo,
              materialCode: coils.materialCode,
              materialDescription: coils.materialDescription,
              weightKg: coils.weightKg,
              thicknessMm: coils.thicknessMm,
              widthMm: coils.widthMm,
              outerDiameterMm: coils.outerDiameterMm,
              innerDiameterMm: coils.innerDiameterMm,
              grade: coils.grade,
              heatNo: coils.heatNo,
              sourceType: coils.sourceType,
              isEstimatedDimensions: coils.isEstimatedDimensions,
            })
            .from(inventory)
            .innerJoin(coils, eq(inventory.coilId, coils.id))
            .where(
              and(
                inArray(inventory.currentLocationId, locationIds),
                inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
              )
            )
        : [];

    const inventoryByLocId = new Map<number, (typeof activeInventoryRows)[number]>();
    for (const inv of activeInventoryRows) {
      if (inv.currentLocationId !== null) {
        inventoryByLocId.set(inv.currentLocationId, inv);
      }
    }

    // Fetch ONLY active, non-expired reservations
    const now = new Date();
    const activeReservationRows =
      locationIds.length > 0
        ? await db
            .select({
              reservationId: locationReservations.id,
              locationId: locationReservations.locationId,
              coilDbId: coils.id,
              coilId: coils.coilId,
              reservationType: locationReservations.reservationType,
              expiresAt: locationReservations.expiresAt,
            })
            .from(locationReservations)
            .innerJoin(coils, eq(locationReservations.coilId, coils.id))
            .where(
              and(
                inArray(locationReservations.locationId, locationIds),
                eq(locationReservations.status, 'ACTIVE'),
                sql`${locationReservations.expiresAt} > ${now}`
              )
            )
        : [];

    const reservationByLocId = new Map<number, (typeof activeReservationRows)[number]>();
    for (const resRow of activeReservationRows) {
      reservationByLocId.set(resRow.locationId, resRow);
    }

    const coordinateWarnings: Array<{ locationId: number; locationCode: string; reason: string }> = [];
    let emptyCount = 0;
    let occupiedCount = 0;
    let reservedCount = 0;
    let blockedCount = 0;
    let activeCoilCount = 0;
    let pendingSapCoilCount = 0;

    const locations = [];

    for (const loc of rawLocations) {
      const door = doorById.get(loc.doorId);
      const row = rowById.get(loc.rowId);
      const level = levelById.get(loc.levelId);
      if (!door || !row || !level) continue;

      const coordCheck = isValidCoordinateSet(loc);
      if (!coordCheck.valid) {
        coordinateWarnings.push({
          locationId: loc.id,
          locationCode: loc.locationCode,
          reason: coordCheck.reason ?? 'Invalid coordinates',
        });
        continue;
      }

      const inv = inventoryByLocId.get(loc.id) ?? null;
      const resv = reservationByLocId.get(loc.id) ?? null;

      // Determine truthful effective status strictly from DB state
      let effectiveStatus: LocationStatus;
      if (loc.status === 'BLOCKED') {
        effectiveStatus = 'BLOCKED';
      } else if (inv) {
        effectiveStatus = 'OCCUPIED';
      } else if (resv) {
        effectiveStatus = 'RESERVED';
      } else {
        effectiveStatus = 'EMPTY';
      }

      if (effectiveStatus === 'EMPTY') emptyCount++;
      else if (effectiveStatus === 'OCCUPIED') occupiedCount++;
      else if (effectiveStatus === 'RESERVED') reservedCount++;
      else if (effectiveStatus === 'BLOCKED') blockedCount++;

      let coilData = null;
      let currentWeightKg = 0;
      if (inv) {
        activeCoilCount++;
        const isPendingSapSync = inv.sourceType === 'PRE_SAP_INBOUND';
        if (isPendingSapSync) pendingSapCoilCount++;
        currentWeightKg = inv.weightKg ?? 0;
        const missingDims =
          inv.outerDiameterMm === null ||
          inv.innerDiameterMm === null ||
          inv.widthMm === null ||
          inv.isEstimatedDimensions;

        coilData = {
          inventoryId: inv.inventoryId,
          coilDbId: inv.coilDbId,
          coilId: inv.coilId,
          batchNo: inv.batchNo,
          materialCode: inv.materialCode,
          materialDescription: inv.materialDescription,
          weightKg: inv.weightKg ?? 0,
          thicknessMm: inv.thicknessMm,
          widthMm: inv.widthMm,
          outerDiameterMm: inv.outerDiameterMm,
          innerDiameterMm: inv.innerDiameterMm,
          grade: inv.grade ?? null,
          heatNo: inv.heatNo ?? null,
          sourceType: inv.sourceType,
          isPendingSapSync,
          inventoryStatus: inv.inventoryStatus,
          inboundDate: inv.inboundDate.toISOString(),
          isEstimatedModel: missingDims,
          renderOuterDiameterMm: inv.outerDiameterMm ?? DEFAULT_ESTIMATED_COIL_MODEL.outerDiameterMm,
          renderInnerDiameterMm: inv.innerDiameterMm ?? DEFAULT_ESTIMATED_COIL_MODEL.innerDiameterMm,
          renderWidthMm: inv.widthMm ?? DEFAULT_ESTIMATED_COIL_MODEL.widthMm,
        };
      }

      const reservationData = resv
        ? {
            reservationId: resv.reservationId,
            coilDbId: resv.coilDbId,
            coilId: resv.coilId,
            reservationType: resv.reservationType,
            expiresAt: resv.expiresAt.toISOString(),
          }
        : null;

      locations.push({
        id: loc.id,
        locationCode: loc.locationCode,
        zoneId: door.zoneId,
        doorId: loc.doorId,
        doorCode: door.doorCode,
        rowId: loc.rowId,
        rowNumber: row.rowNumber,
        rowLabel: row.label,
        levelId: loc.levelId,
        levelNumber: level.levelNumber,
        levelLabel: level.label,
        stackingRule: level.stackingRule as StackingRule,
        slotNumber: loc.slotNumber,
        posX: loc.posX,
        posY: loc.posY,
        posZ: loc.posZ,
        widthM: loc.widthM,
        heightM: loc.heightM,
        depthM: loc.depthM,
        maxWeightKg: loc.maxWeightKg,
        currentWeightKg,
        availableCapacityKg: Math.max(0, loc.maxWeightKg - currentWeightKg),
        maxOuterDiameterMm: loc.maxOuterDiameterMm,
        maxWidthMm: loc.maxWidthMm,
        stackingGroup: loc.stackingGroup,
        allocationPriority: loc.allocationPriority,
        status: effectiveStatus,
        rawStatus: loc.status as LocationStatus,
        isActive: loc.isActive,
        isEstimatedCoord: loc.isEstimatedCoord,
        notes: loc.notes,
        coil: coilData,
        reservation: reservationData,
      });
    }

    return {
      zones: allZones,
      doors: allDoors,
      rows: allRows,
      levels: allLevels,
      locations,
      layoutObjects: layoutObjectsRaw,
      coordinateWarnings,
      summary: {
        totalLocations: locations.length,
        emptyCount,
        occupiedCount,
        reservedCount,
        blockedCount,
        activeCoilCount,
        pendingSapCoilCount,
        isEstimatedLayout: allZones.some((z) => z.isEstimatedLayout),
      },
      defaultCoilModelSpec: DEFAULT_ESTIMATED_COIL_MODEL,
      serverTimestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Failed to query warehouse 3D scene:', error);
    throw new Error('Failed to load 3D warehouse scene data from PostgreSQL.', { cause: error });
  }
}

export async function searchWarehouse3D(rawQuery: string) {
  const query = rawQuery.trim();
  if (!query) {
    return {
      found: false,
      query: '',
      matchType: 'NOT_FOUND' as const,
      messageTh: 'กรุณาระบุ Location Code, Coil ID, Batch, Door หรือ Row ที่ต้องการค้นหา',
      messageEn: 'Please enter a Location Code, Coil ID, Batch, Building Door, or Row.',
      primaryLocationId: null,
      primaryLocationCode: null,
      matchedLocationIds: [],
      matchedDoorId: null,
      matchedRowId: null,
      unplacedCoils: [],
    };
  }

  try {
    const upper = query.toUpperCase();

    // 1. Exact Location Code match (e.g. E7/1/3/9)
    const exactLocs = await db
      .select({
        id: storageLocations.id,
        locationCode: storageLocations.locationCode,
        doorId: storageLocations.doorId,
        rowId: storageLocations.rowId,
      })
      .from(storageLocations)
      .where(and(eq(storageLocations.isActive, true), ilike(storageLocations.locationCode, query)))
      .limit(1);

    if (exactLocs.length > 0) {
      const loc = exactLocs[0];
      return {
        found: true,
        query,
        matchType: 'LOCATION' as const,
        messageTh: `พบตำแหน่งจัดเก็บ ${loc.locationCode}`,
        messageEn: `Found Storage Location ${loc.locationCode}`,
        primaryLocationId: loc.id,
        primaryLocationCode: loc.locationCode,
        matchedLocationIds: [loc.id],
        matchedDoorId: loc.doorId,
        matchedRowId: loc.rowId,
        unplacedCoils: [],
      };
    }

    // 2. Coil ID match (exact or partial — preserving leading zeros as TEXT)
    const matchedCoils = await db
      .select({
        coilDbId: coils.id,
        coilId: coils.coilId,
        batchNo: coils.batchNo,
        materialCode: coils.materialCode,
        lifecycleStatus: coils.lifecycleStatus,
      })
      .from(coils)
      .where(ilike(coils.coilId, `%${query}%`))
      .limit(20);

    if (matchedCoils.length > 0) {
      const coilIds = matchedCoils.map((c) => c.coilDbId);
      const placed = await db
        .select({
          locationId: storageLocations.id,
          locationCode: storageLocations.locationCode,
          doorId: storageLocations.doorId,
          rowId: storageLocations.rowId,
          coilDbId: inventory.coilId,
        })
        .from(inventory)
        .innerJoin(storageLocations, eq(inventory.currentLocationId, storageLocations.id))
        .where(
          and(
            inArray(inventory.coilId, coilIds),
            inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
          )
        );

      if (placed.length > 0) {
        return {
          found: true,
          query,
          matchType: 'COIL_STORED' as const,
          messageTh: `พบเหล็กม้วนที่จัดเก็บอยู่ในตำแหน่ง ${placed[0].locationCode} (${placed.length} รายการ)`,
          messageEn: `Found stored coil at ${placed[0].locationCode} (${placed.length} match${placed.length > 1 ? 'es' : ''})`,
          primaryLocationId: placed[0].locationId,
          primaryLocationCode: placed[0].locationCode,
          matchedLocationIds: placed.map((p) => p.locationId),
          matchedDoorId: placed[0].doorId,
          matchedRowId: placed[0].rowId,
          unplacedCoils: [],
        };
      }

      // Coil exists in SAP reference master, NOT yet stored in warehouse
      return {
        found: true,
        query,
        matchType: 'COIL_NOT_STORED' as const,
        messageTh: `พบ Coil "${matchedCoils[0].coilId}" ในระบบ แต่ Coil ยังไม่ได้จัดเก็บในคลัง`,
        messageEn: `Coil "${matchedCoils[0].coilId}" exists in master data but is not currently stored in the warehouse.`,
        primaryLocationId: null,
        primaryLocationCode: null,
        matchedLocationIds: [],
        matchedDoorId: null,
        matchedRowId: null,
        unplacedCoils: matchedCoils.map((c) => ({
          coilId: c.coilId,
          batchNo: c.batchNo,
          materialCode: c.materialCode,
          lifecycleStatus: c.lifecycleStatus,
        })),
      };
    }

    // 3. Batch No match
    const matchedBatchCoils = await db
      .select({
        coilDbId: coils.id,
        coilId: coils.coilId,
        batchNo: coils.batchNo,
        materialCode: coils.materialCode,
        lifecycleStatus: coils.lifecycleStatus,
      })
      .from(coils)
      .where(ilike(coils.batchNo, `%${query}%`))
      .limit(50);

    if (matchedBatchCoils.length > 0) {
      const coilIds = matchedBatchCoils.map((c) => c.coilDbId);
      const placed = await db
        .select({
          locationId: storageLocations.id,
          locationCode: storageLocations.locationCode,
          doorId: storageLocations.doorId,
          rowId: storageLocations.rowId,
        })
        .from(inventory)
        .innerJoin(storageLocations, eq(inventory.currentLocationId, storageLocations.id))
        .where(
          and(
            inArray(inventory.coilId, coilIds),
            inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
          )
        );

      if (placed.length > 0) {
        return {
          found: true,
          query,
          matchType: 'BATCH' as const,
          messageTh: `พบ Batch "${query}" จัดเก็บอยู่ ${placed.length} ตำแหน่ง (ตำแหน่งแรก: ${placed[0].locationCode})`,
          messageEn: `Found Batch "${query}" across ${placed.length} stored location(s).`,
          primaryLocationId: placed[0].locationId,
          primaryLocationCode: placed[0].locationCode,
          matchedLocationIds: placed.map((p) => p.locationId),
          matchedDoorId: placed[0].doorId,
          matchedRowId: placed[0].rowId,
          unplacedCoils: [],
        };
      }

      return {
        found: true,
        query,
        matchType: 'COIL_NOT_STORED' as const,
        messageTh: `พบ Batch "${query}" (${matchedBatchCoils.length} ม้วน) แต่ยังไม่ได้จัดเก็บในคลัง`,
        messageEn: `Found Batch "${query}" (${matchedBatchCoils.length} coil(s)), none currently stored in warehouse.`,
        primaryLocationId: null,
        primaryLocationCode: null,
        matchedLocationIds: [],
        matchedDoorId: null,
        matchedRowId: null,
        unplacedCoils: matchedBatchCoils.slice(0, 10).map((c) => ({
          coilId: c.coilId,
          batchNo: c.batchNo,
          materialCode: c.materialCode,
          lifecycleStatus: c.lifecycleStatus,
        })),
      };
    }

    // 4. Building Door match (e.g. E7, E8)
    const matchedDoors = await db
      .select()
      .from(buildingDoors)
      .where(and(eq(buildingDoors.isActive, true), ilike(buildingDoors.doorCode, upper)))
      .limit(1);

    if (matchedDoors.length > 0) {
      const door = matchedDoors[0];
      const doorLocs = await db
        .select({ id: storageLocations.id, locationCode: storageLocations.locationCode })
        .from(storageLocations)
        .where(and(eq(storageLocations.doorId, door.id), eq(storageLocations.isActive, true)))
        .orderBy(asc(storageLocations.rowId), asc(storageLocations.levelId), asc(storageLocations.slotNumber));

      return {
        found: true,
        query,
        matchType: 'DOOR' as const,
        messageTh: `พบประตูอาคาร ${door.doorCode} (${doorLocs.length} ตำแหน่งจัดเก็บ)`,
        messageEn: `Found Building Door ${door.doorCode} (${doorLocs.length} storage locations)`,
        primaryLocationId: doorLocs[0]?.id ?? null,
        primaryLocationCode: doorLocs[0]?.locationCode ?? null,
        matchedLocationIds: doorLocs.map((l) => l.id),
        matchedDoorId: door.id,
        matchedRowId: null,
        unplacedCoils: [],
      };
    }

    // 5. Door/Row prefix or Row number match (e.g. "E7/1" or "ROW 2" or partial location code)
    const rowMatch = /^ROW\s*(\d+)$/i.exec(query);
    if (rowMatch) {
      const rowNum = Number(rowMatch[1]);
      const matchedRows = await db
        .select({ id: warehouseRows.id, doorId: warehouseRows.doorId, rowNumber: warehouseRows.rowNumber })
        .from(warehouseRows)
        .where(and(eq(warehouseRows.rowNumber, rowNum), eq(warehouseRows.isActive, true)));

      if (matchedRows.length > 0) {
        const rowIds = matchedRows.map((r) => r.id);
        const rowLocs = await db
          .select({
            id: storageLocations.id,
            locationCode: storageLocations.locationCode,
            doorId: storageLocations.doorId,
            rowId: storageLocations.rowId,
          })
          .from(storageLocations)
          .where(and(inArray(storageLocations.rowId, rowIds), eq(storageLocations.isActive, true)))
          .orderBy(asc(storageLocations.levelId), asc(storageLocations.slotNumber));

        if (rowLocs.length > 0) {
          return {
            found: true,
            query,
            matchType: 'ROW' as const,
            messageTh: `พบแถวจัดเก็บ Row ${rowNum} (${rowLocs.length} ตำแหน่ง)`,
            messageEn: `Found Row ${rowNum} (${rowLocs.length} storage locations)`,
            primaryLocationId: rowLocs[0].id,
            primaryLocationCode: rowLocs[0].locationCode,
            matchedLocationIds: rowLocs.map((l) => l.id),
            matchedDoorId: rowLocs[0].doorId,
            matchedRowId: rowLocs[0].rowId,
            unplacedCoils: [],
          };
        }
      }
    }

    // 6. Partial Location Code match (e.g. E7/1/3)
    const partialLocs = await db
      .select({
        id: storageLocations.id,
        locationCode: storageLocations.locationCode,
        doorId: storageLocations.doorId,
        rowId: storageLocations.rowId,
      })
      .from(storageLocations)
      .where(and(eq(storageLocations.isActive, true), ilike(storageLocations.locationCode, `%${query}%`)))
      .orderBy(asc(storageLocations.locationCode))
      .limit(50);

    if (partialLocs.length > 0) {
      return {
        found: true,
        query,
        matchType: 'LOCATION' as const,
        messageTh: `พบตำแหน่งที่ตรงกับ "${query}" จำนวน ${partialLocs.length} ตำแหน่ง (โฟกัสที่ ${partialLocs[0].locationCode})`,
        messageEn: `Found ${partialLocs.length} location(s) matching "${query}" (focused on ${partialLocs[0].locationCode})`,
        primaryLocationId: partialLocs[0].id,
        primaryLocationCode: partialLocs[0].locationCode,
        matchedLocationIds: partialLocs.map((l) => l.id),
        matchedDoorId: partialLocs[0].doorId,
        matchedRowId: partialLocs[0].rowId,
        unplacedCoils: [],
      };
    }

    return {
      found: false,
      query,
      matchType: 'NOT_FOUND' as const,
      messageTh: `Location Not Found — ไม่พบข้อมูล "${query}" ในฐานข้อมูลคลังสินค้า`,
      messageEn: `Location Not Found — No matching location, coil, batch, door, or row for "${query}".`,
      primaryLocationId: null,
      primaryLocationCode: null,
      matchedLocationIds: [],
      matchedDoorId: null,
      matchedRowId: null,
      unplacedCoils: [],
    };
  } catch (error) {
    console.error('Failed to search 3D warehouse:', error);
    throw new Error('Failed to search warehouse data.', { cause: error });
  }
}

