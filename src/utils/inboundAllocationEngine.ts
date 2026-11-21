import { validateCoilCapacityFit, type LocationStatus, type StackingRule } from './warehouseMath.ts';
import type { BatchReceiveStatus } from '../types/inbound.ts';

export interface CoilReferenceForAllocation {
  coilDbId: number;
  coilId: string;
  batchNo: string;
  materialCode: string;
  materialDescription: string | null;
  thicknessMm: number | null;
  widthMm: number | null;
  outerDiameterMm: number | null;
  grade: string | null;
  weightKg: number | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  lifecycleStatus: string;
  hasActiveInventory?: boolean;
  activeReservationLocationCode?: string | null;
}

export interface MissingDataAnalysis {
  effectiveWeightKg: number | null;
  missingFields: string[];
  criticalMissingFields: string[];
  hasMissingData: boolean;
  canAutoAllocate: boolean;
}

export interface LocationCandidateForAllocation {
  id: number;
  locationCode: string;
  doorId: number;
  doorCode: string;
  doorSortOrder: number;
  rowId: number;
  rowNumber: number;
  rowMaxLevels: number;
  rowAllocationPriority: number;
  levelId: number;
  levelNumber: number;
  levelMaxWeightKg: number;
  stackingRule: StackingRule;
  slotNumber: number;
  maxWeightKg: number;
  maxOuterDiameterMm: number;
  maxWidthMm: number;
  stackingGroup: string;
  allocationPriority: number;
  status: LocationStatus;
  isActive: boolean;
  hasActiveInventory: boolean;
  hasActiveReservation: boolean;
}

export interface OccupiedSlotSupportInfo {
  rowId: number;
  levelNumber: number;
  slotNumber: number;
  locationCode: string;
  coilWeightKg: number;
}

export interface AllocationDecision {
  coilDbId: number;
  batchNo: string;
  coilId: string;
  thicknessMm: number | null;
  widthMm: number | null;
  grade: string | null;
  effectiveWeightKg: number | null;
  missingFields: string[];
  recommendedLocation: LocationCandidateForAllocation | null;
  alreadyReservedLocationCode: string | null;
  status: 'RECOMMENDED' | 'ALREADY_RESERVED' | 'UNALLOCATABLE';
  reason: string | null;
}

export interface AllocationOptions {
  preferredDoorId?: number;
  preferredRowId?: number;
  strictDoorFilter?: boolean;
  strictRowFilter?: boolean;
}

/**
 * Normalizes a scanned identifier (Batch Number or Coil ID) while STRICTLY preserving leading zeros.
 * Never parses as a Number and never strips leading '0' characters.
 */
export function normalizeScannedIdentifier(raw: string): string {
  return raw.trim();
}

/**
 * Normalizes a scanned Location Code (e.g. " e7/1/1/1 " -> "E7/1/1/1").
 */
export function normalizeScannedLocationCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/**
 * Computes conservative effective weight (in kg) from SAP reference fields without fabricating values.
 * Uses the largest positive value among grossWeightKg, netWeightKg, and weightKg so saddle/level
 * weight safety limits are never underestimated.
 */
export function resolveEffectiveCoilWeightKg(coil: {
  grossWeightKg?: number | null;
  netWeightKg?: number | null;
  weightKg?: number | null;
}): number | null {
  const candidates = [coil.grossWeightKg, coil.netWeightKg, coil.weightKg].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/**
 * Analyzes missing SAP Reference attributes for a coil.
 * Missing fields are reported honestly and NEVER fabricated.
 */
export function analyzeCoilMissingData(coil: {
  materialCode?: string | null;
  materialDescription?: string | null;
  thicknessMm?: number | null;
  widthMm?: number | null;
  grade?: string | null;
  weightKg?: number | null;
  grossWeightKg?: number | null;
  netWeightKg?: number | null;
}): MissingDataAnalysis {
  const effectiveWeightKg = resolveEffectiveCoilWeightKg(coil);
  const missingFields: string[] = [];
  const criticalMissingFields: string[] = [];

  if (effectiveWeightKg === null) {
    missingFields.push('weight');
    criticalMissingFields.push('weight');
  }
  if (coil.thicknessMm == null || !Number.isFinite(coil.thicknessMm) || coil.thicknessMm <= 0) {
    missingFields.push('thicknessMm');
  }
  if (coil.widthMm == null || !Number.isFinite(coil.widthMm) || coil.widthMm <= 0) {
    missingFields.push('widthMm');
  }
  if (!coil.grade || coil.grade.trim() === '') {
    missingFields.push('grade');
  }
  if (!coil.materialCode || coil.materialCode.trim() === '') {
    missingFields.push('materialCode');
  }
  if (!coil.materialDescription || coil.materialDescription.trim() === '') {
    missingFields.push('materialDescription');
  }

  return {
    effectiveWeightKg,
    missingFields,
    criticalMissingFields,
    hasMissingData: missingFields.length > 0,
    canAutoAllocate: criticalMissingFields.length === 0,
  };
}

/**
 * Computes real-time Batch Receiving Status from the coils belonging to a Batch Number.
 */
export function computeBatchSummaryStatus(
  coils: Array<{
    isReceived: boolean;
    hasActiveReservation: boolean;
    hasMissingData: boolean;
    effectiveWeightKg: number | null;
  }>
): {
  totalCoils: number;
  receivedCoils: number;
  reservedCoils: number;
  pendingCoils: number;
  missingDataCoils: number;
  totalWeightKg: number;
  batchStatus: BatchReceiveStatus;
} {
  const totalCoils = coils.length;
  let receivedCoils = 0;
  let reservedCoils = 0;
  let pendingCoils = 0;
  let missingDataCoils = 0;
  let totalWeightKg = 0;

  for (const c of coils) {
    if (c.isReceived) {
      receivedCoils++;
    } else {
      pendingCoils++;
      if (c.hasActiveReservation) {
        reservedCoils++;
      }
    }
    if (c.hasMissingData) {
      missingDataCoils++;
    }
    if (c.effectiveWeightKg != null && Number.isFinite(c.effectiveWeightKg) && c.effectiveWeightKg > 0) {
      totalWeightKg += c.effectiveWeightKg;
    }
  }

  let batchStatus: BatchReceiveStatus;
  if (totalCoils === 0) {
    batchStatus = 'EMPTY';
  } else if (receivedCoils === totalCoils) {
    batchStatus = 'COMPLETED';
  } else if (receivedCoils > 0 && pendingCoils > 0) {
    batchStatus = 'PARTIALLY_RECEIVED';
  } else if (reservedCoils > 0) {
    batchStatus = 'RESERVED_IN_PROGRESS';
  } else {
    batchStatus = 'READY_TO_RECEIVE';
  }

  return {
    totalCoils,
    receivedCoils,
    reservedCoils,
    pendingCoils,
    missingDataCoils,
    totalWeightKg: Math.round(totalWeightKg * 100) / 100,
    batchStatus,
  };
}

export function buildSlotSupportKey(rowId: number, levelNumber: number, slotNumber: number): string {
  return `${rowId}:${levelNumber}:${slotNumber}`;
}

/**
 * Verifies physical stacking safety for a steel coil slot:
 * - Level 1 / FLOOR_SADDLE / RACK_BAY: directly supported by floor saddle or rack bay.
 * - Level L > 1 with PYRAMID_STACK:
 *   1. Must not exceed row.maxLevels.
 *   2. BOTH lower supporting slots (rowId, L-1, slot S) and (rowId, L-1, slot S+1) MUST be physically OCCUPIED.
 *   3. Upper coil weight MUST NOT exceed either lower supporting coil's weight (center-of-gravity & crush safety).
 */
export function checkPyramidStackingSupport(params: {
  rowId: number;
  rowMaxLevels: number;
  levelNumber: number;
  slotNumber: number;
  stackingRule: StackingRule;
  coilWeightKg: number | null;
  occupiedByKey: Map<string, OccupiedSlotSupportInfo>;
}): { valid: boolean; pendingSapWeightWarning?: boolean; reason?: string } {
  const { rowId, rowMaxLevels, levelNumber, slotNumber, stackingRule, coilWeightKg, occupiedByKey } =
    params;

  if (levelNumber > rowMaxLevels) {
    return {
      valid: false,
      reason: `ชั้นที่ ${levelNumber} เกินจำนวนชั้นสูงสุดของแถว (Max ${rowMaxLevels} Levels)`,
    };
  }

  if (levelNumber === 1 || stackingRule === 'FLOOR_SADDLE' || stackingRule === 'RACK_BAY') {
    return { valid: true, pendingSapWeightWarning: false };
  }

  const lowerLevel = levelNumber - 1;
  const leftKey = buildSlotSupportKey(rowId, lowerLevel, slotNumber);
  const rightKey = buildSlotSupportKey(rowId, lowerLevel, slotNumber + 1);

  const leftSupport = occupiedByKey.get(leftKey);
  const rightSupport = occupiedByKey.get(rightKey);

  if (!leftSupport || !rightSupport) {
    return {
      valid: false,
      reason: `ตำแหน่งชั้นบน (Pyramid Level ${levelNumber} Slot ${slotNumber}) ต้องมีเหล็กม้วนวางจริงครบทั้ง 2 ลูกด้านล่าง (Level ${lowerLevel} Slot ${slotNumber} และ ${slotNumber + 1}) ก่อน`,
    };
  }

  // If upper coil has no SAP weight yet, allow stacking on physically supported slots with pending-weight advisory
  if (coilWeightKg === null || !Number.isFinite(coilWeightKg) || coilWeightKg <= 0) {
    return {
      valid: true,
      pendingSapWeightWarning: true,
      reason: 'รอน้ำหนักจาก SAP — วางซ้อนได้ (ฐานล่างรองรับครบ 2 ลูก) และระบบจะตรวจน้ำหนักซ้ำเมื่ออัปโหลด SAP',
    };
  }

  // If either lower supporting coil is a Pre-SAP coil (weight not synced yet, recorded as 0), allow with advisory
  const leftUnknown = !Number.isFinite(leftSupport.coilWeightKg) || leftSupport.coilWeightKg <= 0;
  const rightUnknown = !Number.isFinite(rightSupport.coilWeightKg) || rightSupport.coilWeightKg <= 0;
  if (leftUnknown || rightUnknown) {
    // Still check any known lower coil's weight
    if (!leftUnknown && coilWeightKg > leftSupport.coilWeightKg) {
      return {
        valid: false,
        reason: `น้ำหนักเหล็กม้วนชั้นบน (${coilWeightKg} kg) หนักกว่าเหล็กม้วนรองรับด้านล่าง (${leftSupport.locationCode}: ${leftSupport.coilWeightKg} kg)`,
      };
    }
    if (!rightUnknown && coilWeightKg > rightSupport.coilWeightKg) {
      return {
        valid: false,
        reason: `น้ำหนักเหล็กม้วนชั้นบน (${coilWeightKg} kg) หนักกว่าเหล็กม้วนรองรับด้านล่าง (${rightSupport.locationCode}: ${rightSupport.coilWeightKg} kg)`,
      };
    }
    return {
      valid: true,
      pendingSapWeightWarning: true,
      reason: 'ม้วนเหล็กรองรับด้านล่างยังรอน้ำหนักจาก SAP — จะตรวจสอบความปลอดภัยซ้ำเมื่ออัปโหลด SAP',
    };
  }

  if (coilWeightKg > leftSupport.coilWeightKg || coilWeightKg > rightSupport.coilWeightKg) {
    return {
      valid: false,
      reason: `น้ำหนักเหล็กม้วนชั้นบน (${coilWeightKg} kg) ต้องไม่หนักกว่าเหล็กม้วนรองรับด้านล่าง (${leftSupport.locationCode}: ${leftSupport.coilWeightKg} kg, ${rightSupport.locationCode}: ${rightSupport.coilWeightKg} kg)`,
    };
  }

  return { valid: true, pendingSapWeightWarning: false };
}

/**
 * Deterministic Multi-Coil Auto Location Allocator.
 * Guarantees 1 Coil = 1 Unique EMPTY Location respecting:
 * - Active & EMPTY status (no active inventory, no active reservation, not BLOCKED)
 * - Capacity fit (slot maxWeightKg, level maxWeightKg, maxWidthMm, maxOuterDiameterMm)
 * - Pyramid stacking physical support & weight stability
 * - Priority ordering: preferred door/row -> lowest level (floor saddles first) -> row priority -> slot priority -> slot order
 */
export function allocateLocationsForCoils(
  coils: CoilReferenceForAllocation[],
  allLocations: LocationCandidateForAllocation[],
  occupiedSupport: OccupiedSlotSupportInfo[],
  options: AllocationOptions = {}
): AllocationDecision[] {
  const occupiedByKey = new Map<string, OccupiedSlotSupportInfo>();
  for (const occ of occupiedSupport) {
    occupiedByKey.set(buildSlotSupportKey(occ.rowId, occ.levelNumber, occ.slotNumber), occ);
  }

  // Filter strictly eligible EMPTY locations
  const eligibleLocations = allLocations.filter((loc) => {
    if (!loc.isActive) return false;
    if (loc.status !== 'EMPTY') return false;
    if (loc.hasActiveInventory || loc.hasActiveReservation) return false;
    if (options.strictDoorFilter && options.preferredDoorId && loc.doorId !== options.preferredDoorId) {
      return false;
    }
    if (options.strictRowFilter && options.preferredRowId && loc.rowId !== options.preferredRowId) {
      return false;
    }
    return true;
  });

  // Sort locations deterministically
  const sortedLocations = [...eligibleLocations].sort((a, b) => {
    if (options.preferredDoorId) {
      const aDoorPref = a.doorId === options.preferredDoorId ? 0 : 1;
      const bDoorPref = b.doorId === options.preferredDoorId ? 0 : 1;
      if (aDoorPref !== bDoorPref) return aDoorPref - bDoorPref;
    }
    if (options.preferredRowId) {
      const aRowPref = a.rowId === options.preferredRowId ? 0 : 1;
      const bRowPref = b.rowId === options.preferredRowId ? 0 : 1;
      if (aRowPref !== bRowPref) return aRowPref - bRowPref;
    }
    // Floor Saddle Level 1 strongly preferred over Pyramid stacking
    if (a.levelNumber !== b.levelNumber) return a.levelNumber - b.levelNumber;
    if (a.rowAllocationPriority !== b.rowAllocationPriority) {
      return a.rowAllocationPriority - b.rowAllocationPriority;
    }
    if (a.allocationPriority !== b.allocationPriority) {
      return a.allocationPriority - b.allocationPriority;
    }
    if (a.doorSortOrder !== b.doorSortOrder) return a.doorSortOrder - b.doorSortOrder;
    if (a.rowNumber !== b.rowNumber) return a.rowNumber - b.rowNumber;
    return a.slotNumber - b.slotNumber;
  });

  // Sort pending coils deterministically: heaviest coils allocate first so heavy coils get strongest saddles
  const indexedCoils = coils.map((coil, originalIndex) => ({
    coil,
    originalIndex,
    analysis: analyzeCoilMissingData(coil),
  }));

  const allocationOrder = [...indexedCoils].sort((a, b) => {
    const wa = a.analysis.effectiveWeightKg ?? -1;
    const wb = b.analysis.effectiveWeightKg ?? -1;
    if (wa !== wb) return wb - wa;
    return a.coil.coilId.localeCompare(b.coil.coilId);
  });

  const claimedLocationIds = new Set<number>();
  const decisionByOriginalIndex = new Map<number, AllocationDecision>();

  for (const item of allocationOrder) {
    const { coil, originalIndex, analysis } = item;

    if (coil.activeReservationLocationCode) {
      decisionByOriginalIndex.set(originalIndex, {
        coilDbId: coil.coilDbId,
        batchNo: coil.batchNo,
        coilId: coil.coilId,
        thicknessMm: coil.thicknessMm,
        widthMm: coil.widthMm,
        grade: coil.grade,
        effectiveWeightKg: analysis.effectiveWeightKg,
        missingFields: analysis.missingFields,
        recommendedLocation: null,
        alreadyReservedLocationCode: coil.activeReservationLocationCode,
        status: 'ALREADY_RESERVED',
        reason: `จองตำแหน่ง ${coil.activeReservationLocationCode} ไว้แล้ว`,
      });
      continue;
    }

    if (!analysis.canAutoAllocate || analysis.effectiveWeightKg === null) {
      decisionByOriginalIndex.set(originalIndex, {
        coilDbId: coil.coilDbId,
        batchNo: coil.batchNo,
        coilId: coil.coilId,
        thicknessMm: coil.thicknessMm,
        widthMm: coil.widthMm,
        grade: coil.grade,
        effectiveWeightKg: analysis.effectiveWeightKg,
        missingFields: analysis.missingFields,
        recommendedLocation: null,
        alreadyReservedLocationCode: null,
        status: 'UNALLOCATABLE',
        reason:
          'ข้อมูลน้ำหนักจาก SAP ขาดหาย (Missing Weight) — ไม่สามารถจัดสรรตำแหน่งอัตโนมัติอย่างปลอดภัยได้ กรุณาตรวจสอบไฟล์ SAP',
      });
      continue;
    }

    let matchedLoc: LocationCandidateForAllocation | null = null;
    let lastRejectionReason: string | null = null;

    for (const loc of sortedLocations) {
      if (claimedLocationIds.has(loc.id)) continue;

      const capCheck = validateCoilCapacityFit({
        coilWeightKg: analysis.effectiveWeightKg,
        coilOuterDiameterMm: coil.outerDiameterMm,
        coilWidthMm: coil.widthMm,
        locationMaxWeightKg: loc.maxWeightKg,
        locationMaxOuterDiameterMm: loc.maxOuterDiameterMm,
        locationMaxWidthMm: loc.maxWidthMm,
        levelMaxWeightKg: loc.levelMaxWeightKg,
      });

      if (!capCheck.valid) {
        lastRejectionReason = capCheck.errors[0] ?? 'เกินขีดจำกัดความจุตำแหน่ง';
        continue;
      }

      const pyramidCheck = checkPyramidStackingSupport({
        rowId: loc.rowId,
        rowMaxLevels: loc.rowMaxLevels,
        levelNumber: loc.levelNumber,
        slotNumber: loc.slotNumber,
        stackingRule: loc.stackingRule,
        coilWeightKg: analysis.effectiveWeightKg,
        occupiedByKey,
      });

      if (!pyramidCheck.valid) {
        lastRejectionReason = pyramidCheck.reason ?? 'ไม่ผ่านเงื่อนไขการซ้อน Pyramid';
        continue;
      }

      matchedLoc = loc;
      break;
    }

    if (matchedLoc) {
      claimedLocationIds.add(matchedLoc.id);
      decisionByOriginalIndex.set(originalIndex, {
        coilDbId: coil.coilDbId,
        batchNo: coil.batchNo,
        coilId: coil.coilId,
        thicknessMm: coil.thicknessMm,
        widthMm: coil.widthMm,
        grade: coil.grade,
        effectiveWeightKg: analysis.effectiveWeightKg,
        missingFields: analysis.missingFields,
        recommendedLocation: matchedLoc,
        alreadyReservedLocationCode: null,
        status: 'RECOMMENDED',
        reason: null,
      });
    } else {
      decisionByOriginalIndex.set(originalIndex, {
        coilDbId: coil.coilDbId,
        batchNo: coil.batchNo,
        coilId: coil.coilId,
        thicknessMm: coil.thicknessMm,
        widthMm: coil.widthMm,
        grade: coil.grade,
        effectiveWeightKg: analysis.effectiveWeightKg,
        missingFields: analysis.missingFields,
        recommendedLocation: null,
        alreadyReservedLocationCode: null,
        status: 'UNALLOCATABLE',
        reason:
          lastRejectionReason ??
          'ไม่พบตำแหน่งว่าง (EMPTY) ที่รองรับน้ำหนัก ขนาด และเงื่อนไขการซ้อนได้อย่างปลอดภัย',
      });
    }
  }

  // Return in original coil list order for predictable UI presentation
  return coils.map((_, idx) => decisionByOriginalIndex.get(idx)!);
}

export interface RowSlotEvaluationDecision {
  locationId: number;
  locationCode: string;
  placeable: boolean;
  isTopRecommended: boolean;
  pendingSapWeightWarning: boolean;
  reason: string | null;
}

/**
 * Evaluates every active slot in a single chosen Row for a specific coil (or Pre-SAP provisional
 * placement when coil is null), applying physical safety rules:
 * - Active & EMPTY status (no active inventory, no active reservation, not BLOCKED)
 * - Capacity fit when SAP weight/dimensions are present
 * - Pyramid stacking physical 2-coil support for Level >= 2 (in Pre-SAP mode without weight yet,
 *   physically supported Level 2+ slots are placeable with pendingSapWeightWarning=true)
 * Marks the optimal placeable slot (lowest level -> lowest priority -> lowest slot) with isTopRecommended=true.
 */
export function evaluateRowSlotsForCoil(
  coil: CoilReferenceForAllocation | null,
  rowLocations: LocationCandidateForAllocation[],
  occupiedSupport: OccupiedSlotSupportInfo[]
): RowSlotEvaluationDecision[] {
  const occupiedByKey = new Map<string, OccupiedSlotSupportInfo>();
  for (const occ of occupiedSupport) {
    occupiedByKey.set(buildSlotSupportKey(occ.rowId, occ.levelNumber, occ.slotNumber), occ);
  }

  const analysis = coil ? analyzeCoilMissingData(coil) : null;
  const effectiveWeightKg = analysis?.effectiveWeightKg ?? null;

  const evaluations = rowLocations.map((loc): RowSlotEvaluationDecision & { _loc: LocationCandidateForAllocation } => {
    if (!loc.isActive) {
      return {
        locationId: loc.id,
        locationCode: loc.locationCode,
        placeable: false,
        isTopRecommended: false,
        pendingSapWeightWarning: false,
        reason: 'ตำแหน่งปิดใช้งาน (INACTIVE)',
        _loc: loc,
      };
    }

    if (loc.status === 'BLOCKED') {
      return {
        locationId: loc.id,
        locationCode: loc.locationCode,
        placeable: false,
        isTopRecommended: false,
        pendingSapWeightWarning: false,
        reason: 'ตำแหน่งถูกระงับการใช้งาน (BLOCKED)',
        _loc: loc,
      };
    }

    if (loc.hasActiveInventory || loc.status === 'OCCUPIED') {
      return {
        locationId: loc.id,
        locationCode: loc.locationCode,
        placeable: false,
        isTopRecommended: false,
        pendingSapWeightWarning: false,
        reason: 'มีเหล็กม้วนวางอยู่แล้ว (OCCUPIED)',
        _loc: loc,
      };
    }

    if (loc.hasActiveReservation || loc.status === 'RESERVED') {
      return {
        locationId: loc.id,
        locationCode: loc.locationCode,
        placeable: false,
        isTopRecommended: false,
        pendingSapWeightWarning: false,
        reason: 'ตำแหน่งถูกจองอยู่ (RESERVED)',
        _loc: loc,
      };
    }

    if (coil) {
      if (!analysis?.canAutoAllocate || effectiveWeightKg === null) {
        return {
          locationId: loc.id,
          locationCode: loc.locationCode,
          placeable: false,
          isTopRecommended: false,
          pendingSapWeightWarning: false,
          reason: 'ข้อมูลน้ำหนักม้วนเหล็กจาก SAP ขาดหาย (Missing Weight)',
          _loc: loc,
        };
      }

      const capCheck = validateCoilCapacityFit({
        coilWeightKg: effectiveWeightKg,
        coilOuterDiameterMm: coil.outerDiameterMm,
        coilWidthMm: coil.widthMm,
        locationMaxWeightKg: loc.maxWeightKg,
        locationMaxOuterDiameterMm: loc.maxOuterDiameterMm,
        locationMaxWidthMm: loc.maxWidthMm,
        levelMaxWeightKg: loc.levelMaxWeightKg,
      });

      if (!capCheck.valid) {
        return {
          locationId: loc.id,
          locationCode: loc.locationCode,
          placeable: false,
          isTopRecommended: false,
          pendingSapWeightWarning: false,
          reason: capCheck.errors[0] ?? 'น้ำหนักหรือขนาดเกินขีดจำกัดของช่องนี้',
          _loc: loc,
        };
      }

      const pyramidCheck = checkPyramidStackingSupport({
        rowId: loc.rowId,
        rowMaxLevels: loc.rowMaxLevels,
        levelNumber: loc.levelNumber,
        slotNumber: loc.slotNumber,
        stackingRule: loc.stackingRule,
        coilWeightKg: effectiveWeightKg,
        occupiedByKey,
      });

      if (!pyramidCheck.valid) {
        return {
          locationId: loc.id,
          locationCode: loc.locationCode,
          placeable: false,
          isTopRecommended: false,
          pendingSapWeightWarning: false,
          reason: pyramidCheck.reason ?? 'ไม่ผ่านเงื่อนไขการซ้อน Pyramid',
          _loc: loc,
        };
      }

      return {
        locationId: loc.id,
        locationCode: loc.locationCode,
        placeable: true,
        isTopRecommended: false,
        pendingSapWeightWarning: Boolean(pyramidCheck.pendingSapWeightWarning),
        reason: pyramidCheck.pendingSapWeightWarning ? (pyramidCheck.reason ?? null) : null,
        _loc: loc,
      };
    }

    // Pre-SAP mode (coil === null: no SAP weight yet)
    const pyramidCheck = checkPyramidStackingSupport({
      rowId: loc.rowId,
      rowMaxLevels: loc.rowMaxLevels,
      levelNumber: loc.levelNumber,
      slotNumber: loc.slotNumber,
      stackingRule: loc.stackingRule,
      coilWeightKg: null,
      occupiedByKey,
    });

    if (!pyramidCheck.valid) {
      return {
        locationId: loc.id,
        locationCode: loc.locationCode,
        placeable: false,
        isTopRecommended: false,
        pendingSapWeightWarning: false,
        reason: pyramidCheck.reason ?? 'ไม่ผ่านเงื่อนไขการซ้อน Pyramid',
        _loc: loc,
      };
    }

    return {
      locationId: loc.id,
      locationCode: loc.locationCode,
      placeable: true,
      isTopRecommended: false,
      pendingSapWeightWarning: Boolean(pyramidCheck.pendingSapWeightWarning),
      reason: pyramidCheck.pendingSapWeightWarning ? (pyramidCheck.reason ?? null) : null,
      _loc: loc,
    };
  });

  // Identify #1 top recommended placeable slot (Floor Saddle first -> priority -> slot number)
  const placeableItems = evaluations
    .filter((e) => e.placeable)
    .sort((a, b) => {
      if (a._loc.levelNumber !== b._loc.levelNumber) {
        return a._loc.levelNumber - b._loc.levelNumber;
      }
      if (a._loc.allocationPriority !== b._loc.allocationPriority) {
        return a._loc.allocationPriority - b._loc.allocationPriority;
      }
      return a._loc.slotNumber - b._loc.slotNumber;
    });

  if (placeableItems.length > 0) {
    placeableItems[0].isTopRecommended = true;
  }

  return evaluations.map(({ _loc: _unused, ...rest }) => rest);
}

export interface PhysicalPlacementValidationInput {
  batchNo: string;
  actorUserId: number;
  actorRoleCode: string;
  now: Date;
  overrideReason?: string | null;
  coil: {
    id: number;
    coilId: string;
    batchNo: string;
    lifecycleStatus: string;
    effectiveWeightKg: number | null;
    widthMm: number | null;
    outerDiameterMm: number | null;
    hasActiveInventory: boolean;
  } | null;
  targetLocation: {
    id: number;
    locationCode: string;
    rowId: number;
    rowMaxLevels: number;
    levelNumber: number;
    slotNumber: number;
    stackingRule: StackingRule;
    maxWeightKg: number;
    levelMaxWeightKg: number;
    maxOuterDiameterMm: number;
    maxWidthMm: number;
    status: LocationStatus;
    isActive: boolean;
    hasActiveInventory: boolean;
  } | null;
  coilActiveReservation: {
    id: number;
    locationId: number;
    locationCode: string;
    reservedByUserId: number;
    expiresAt: Date;
    status: string;
  } | null;
  coilHadExpiredReservation: boolean;
  locationActiveReservation: {
    id: number;
    coilId: number;
    reservedByUserId: number;
    expiresAt: Date;
    status: string;
  } | null;
  occupiedByKey: Map<string, OccupiedSlotSupportInfo>;
}

export interface PhysicalPlacementValidationResult {
  valid: boolean;
  errorCode?:
    | 'COIL_NOT_FOUND'
    | 'COIL_NOT_IN_BATCH'
    | 'COIL_ALREADY_RECEIVED'
    | 'MISSING_COIL_WEIGHT'
    | 'LOCATION_NOT_FOUND'
    | 'LOCATION_INACTIVE'
    | 'LOCATION_BLOCKED'
    | 'LOCATION_OCCUPIED'
    | 'RESERVATION_EXPIRED'
    | 'RESERVATION_OWNED_BY_OTHER'
    | 'RESERVATION_REQUIRED'
    | 'LOCATION_MISMATCH'
    | 'LOCATION_RESERVED_BY_OTHER'
    | 'CAPACITY_EXCEEDED'
    | 'PYRAMID_UNSUPPORTED';
  httpStatus?: 400 | 403 | 404 | 409;
  message?: string;
  overrideApplied: boolean;
}

/**
 * Pure 8-point server-side validation for Physical Placement Confirmation.
 * Guarantees zero inventory corruption, strict batch/coil/location matching,
 * reservation ownership & TTL enforcement, capacity fit, and pyramid support.
 */
export function validatePhysicalPlacementScan(
  input: PhysicalPlacementValidationInput
): PhysicalPlacementValidationResult {
  const {
    batchNo,
    actorUserId,
    actorRoleCode,
    now,
    overrideReason,
    coil,
    targetLocation,
    coilActiveReservation,
    coilHadExpiredReservation,
    locationActiveReservation,
    occupiedByKey,
  } = input;

  const isElevatedRole = actorRoleCode === 'ADMIN' || actorRoleCode === 'SUPERVISOR';
  const cleanOverrideReason = overrideReason?.trim() ?? '';

  // 1. Coil exists and belongs to the scanned Batch
  if (!coil) {
    return {
      valid: false,
      errorCode: 'COIL_NOT_FOUND',
      httpStatus: 404,
      message: 'ไม่พบ Coil ID นี้ในข้อมูลอ้างอิงจาก SAP (SAP Reference Data)',
      overrideApplied: false,
    };
  }

  if (coil.batchNo !== batchNo) {
    return {
      valid: false,
      errorCode: 'COIL_NOT_IN_BATCH',
      httpStatus: 400,
      message: `Coil ID ${coil.coilId} ไม่อยู่ใน Batch ${batchNo} (อยู่ใน Batch ${coil.batchNo})`,
      overrideApplied: false,
    };
  }

  // 2. Coil must NOT already be received / in active inventory
  if (coil.hasActiveInventory || coil.lifecycleStatus !== 'PENDING_INBOUND') {
    return {
      valid: false,
      errorCode: 'COIL_ALREADY_RECEIVED',
      httpStatus: 409,
      message: `Coil ID ${coil.coilId} ถูกรับเข้าคลังแล้ว (สถานะปัจจุบัน: ${coil.lifecycleStatus}) ห้ามรับซ้ำ`,
      overrideApplied: false,
    };
  }

  // 3. Valid coil weight required (never fabricate weight)
  if (coil.effectiveWeightKg == null || coil.effectiveWeightKg <= 0) {
    return {
      valid: false,
      errorCode: 'MISSING_COIL_WEIGHT',
      httpStatus: 400,
      message: `Coil ID ${coil.coilId} ไม่มีข้อมูลน้ำหนักจาก SAP (Missing Weight) ไม่สามารถยืนยันรับเข้าคลังได้`,
      overrideApplied: false,
    };
  }

  // 4. Target location must exist, be active, unblocked, and unoccupied
  if (!targetLocation) {
    return {
      valid: false,
      errorCode: 'LOCATION_NOT_FOUND',
      httpStatus: 404,
      message: 'ไม่พบตำแหน่งจัดเก็บ (Location Code) นี้ในระบบ Warehouse Master',
      overrideApplied: false,
    };
  }

  if (!targetLocation.isActive) {
    return {
      valid: false,
      errorCode: 'LOCATION_INACTIVE',
      httpStatus: 409,
      message: `ตำแหน่ง ${targetLocation.locationCode} ถูกปิดใช้งาน (Inactive)`,
      overrideApplied: false,
    };
  }

  if (targetLocation.status === 'BLOCKED') {
    return {
      valid: false,
      errorCode: 'LOCATION_BLOCKED',
      httpStatus: 409,
      message: `ตำแหน่ง ${targetLocation.locationCode} ถูกระงับการใช้งาน (BLOCKED)`,
      overrideApplied: false,
    };
  }

  if (targetLocation.hasActiveInventory || targetLocation.status === 'OCCUPIED') {
    return {
      valid: false,
      errorCode: 'LOCATION_OCCUPIED',
      httpStatus: 409,
      message: `ตำแหน่ง ${targetLocation.locationCode} มีเหล็กม้วนจัดเก็บอยู่แล้ว (OCCUPIED) ตามกฎ 1 Location = 1 Coil`,
      overrideApplied: false,
    };
  }

  // 5. Location must not be actively reserved for a DIFFERENT coil
  if (
    locationActiveReservation &&
    locationActiveReservation.status === 'ACTIVE' &&
    locationActiveReservation.expiresAt > now &&
    locationActiveReservation.coilId !== coil.id
  ) {
    return {
      valid: false,
      errorCode: 'LOCATION_RESERVED_BY_OTHER',
      httpStatus: 409,
      message: `ตำแหน่ง ${targetLocation.locationCode} ถูกจองไว้สำหรับเหล็กม้วนลูกอื่นแล้ว`,
      overrideApplied: false,
    };
  }

  // 6. Reservation & Location Match / Authorized Override check
  let overrideApplied = false;

  if (coilActiveReservation) {
    if (coilActiveReservation.status !== 'ACTIVE' || coilActiveReservation.expiresAt <= now) {
      return {
        valid: false,
        errorCode: 'RESERVATION_EXPIRED',
        httpStatus: 409,
        message: `การจองตำแหน่ง ${coilActiveReservation.locationCode} หมดอายุแล้ว (EXPIRED) กรุณาจองตำแหน่งใหม่ก่อนยืนยัน`,
        overrideApplied: false,
      };
    }

    if (coilActiveReservation.reservedByUserId !== actorUserId && !isElevatedRole) {
      return {
        valid: false,
        errorCode: 'RESERVATION_OWNED_BY_OTHER',
        httpStatus: 403,
        message: `ตำแหน่ง ${coilActiveReservation.locationCode} ถูกจองโดยผู้ใช้งานอื่น`,
        overrideApplied: false,
      };
    }

    if (coilActiveReservation.locationId !== targetLocation.id) {
      if (!isElevatedRole) {
        return {
          valid: false,
          errorCode: 'LOCATION_MISMATCH',
          httpStatus: 409,
          message: `ตำแหน่งที่สแกน (${targetLocation.locationCode}) ไม่ตรงกับตำแหน่งที่จองไว้ (${coilActiveReservation.locationCode})`,
          overrideApplied: false,
        };
      }
      if (cleanOverrideReason.length < 3) {
        return {
          valid: false,
          errorCode: 'LOCATION_MISMATCH',
          httpStatus: 400,
          message: `ตำแหน่งที่สแกน (${targetLocation.locationCode}) ต่างจากตำแหน่งที่จองไว้ (${coilActiveReservation.locationCode}) กรุณาระบุเหตุผล Override อย่างน้อย 3 ตัวอักษร`,
          overrideApplied: false,
        };
      }
      overrideApplied = true;
    }
  } else {
    if (coilHadExpiredReservation) {
      return {
        valid: false,
        errorCode: 'RESERVATION_EXPIRED',
        httpStatus: 409,
        message: `การจองตำแหน่งของ Coil ${coil.coilId} หมดอายุแล้ว กรุณากดแนะนำและจองตำแหน่งใหม่`,
        overrideApplied: false,
      };
    }

    if (!isElevatedRole || cleanOverrideReason.length < 3) {
      return {
        valid: false,
        errorCode: 'RESERVATION_REQUIRED',
        httpStatus: 409,
        message: `Coil ${coil.coilId} ยังไม่ได้จองตำแหน่งจัดเก็บ กรุณากดจัดสรรและจองตำแหน่ง (Reserve) ก่อนยืนยันวางสินค้า`,
        overrideApplied: false,
      };
    }
    overrideApplied = true;
  }

  // 7. Capacity check (weight, level max weight, width, outer diameter)
  const capCheck = validateCoilCapacityFit({
    coilWeightKg: coil.effectiveWeightKg,
    coilOuterDiameterMm: coil.outerDiameterMm,
    coilWidthMm: coil.widthMm,
    locationMaxWeightKg: targetLocation.maxWeightKg,
    locationMaxOuterDiameterMm: targetLocation.maxOuterDiameterMm,
    locationMaxWidthMm: targetLocation.maxWidthMm,
    levelMaxWeightKg: targetLocation.levelMaxWeightKg,
  });

  if (!capCheck.valid) {
    return {
      valid: false,
      errorCode: 'CAPACITY_EXCEEDED',
      httpStatus: 409,
      message: `ตำแหน่ง ${targetLocation.locationCode} ไม่ผ่านเงื่อนไข Capacity: ${capCheck.errors.join('; ')}`,
      overrideApplied: false,
    };
  }

  // 8. Pyramid stacking physical support & weight stability check
  const pyramidCheck = checkPyramidStackingSupport({
    rowId: targetLocation.rowId,
    rowMaxLevels: targetLocation.rowMaxLevels,
    levelNumber: targetLocation.levelNumber,
    slotNumber: targetLocation.slotNumber,
    stackingRule: targetLocation.stackingRule,
    coilWeightKg: coil.effectiveWeightKg,
    occupiedByKey,
  });

  if (!pyramidCheck.valid) {
    return {
      valid: false,
      errorCode: 'PYRAMID_UNSUPPORTED',
      httpStatus: 409,
      message: pyramidCheck.reason ?? `ตำแหน่ง ${targetLocation.locationCode} ไม่ผ่านเงื่อนไขการซ้อน Pyramid`,
      overrideApplied: false,
    };
  }

  return {
    valid: true,
    overrideApplied,
  };
}
