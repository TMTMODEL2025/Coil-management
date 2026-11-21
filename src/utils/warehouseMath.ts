export type LocationStatus = 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'BLOCKED';
export type StackingRule = 'FLOOR_SADDLE' | 'PYRAMID_STACK' | 'RACK_BAY';

export interface ParsedLocationCode {
  doorCode: string;
  rowNumber: number;
  levelNumber: number;
  slotNumber: number;
}

export interface SlotGeometryInput {
  rowOriginX: number;
  rowOriginZ: number;
  slotSpacingM: number;
  levelNumber: number;
  slotNumber: number;
  coilDiameterM?: number;
  stackingRule?: StackingRule;
  saddleHeightM?: number;
}

export interface SlotGeometryOutput {
  posX: number;
  posY: number;
  posZ: number;
}

/**
 * Formats canonical TMT Steel Coil WMS location code: Door/Row/Level/Slot (e.g. E7/1/3/9).
 */
export function formatLocationCode(
  doorCode: string,
  rowNumber: number,
  levelNumber: number,
  slotNumber: number
): string {
  const normalizedDoor = doorCode.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,12}$/.test(normalizedDoor)) {
    throw new Error(`Invalid door code: "${doorCode}"`);
  }
  if (!Number.isInteger(rowNumber) || rowNumber < 1) {
    throw new Error(`Row number must be a positive integer: ${rowNumber}`);
  }
  if (!Number.isInteger(levelNumber) || levelNumber < 1) {
    throw new Error(`Level number must be a positive integer: ${levelNumber}`);
  }
  if (!Number.isInteger(slotNumber) || slotNumber < 1) {
    throw new Error(`Slot number must be a positive integer: ${slotNumber}`);
  }
  return `${normalizedDoor}/${rowNumber}/${levelNumber}/${slotNumber}`;
}

/**
 * Parses a location code like "E7/1/3/9" into structured hierarchy identifiers.
 */
export function parseLocationCode(code: string): ParsedLocationCode | null {
  const trimmed = code.trim().toUpperCase();
  const match = /^([A-Z0-9_-]{1,12})\/(\d+)\/(\d+)\/(\d+)$/.exec(trimmed);
  if (!match) return null;

  const doorCode = match[1];
  const rowNumber = Number(match[2]);
  const levelNumber = Number(match[3]);
  const slotNumber = Number(match[4]);

  if (rowNumber < 1 || levelNumber < 1 || slotNumber < 1) {
    return null;
  }

  return { doorCode, rowNumber, levelNumber, slotNumber };
}

/**
 * Computes 3D coordinates (meters) for a steel coil slot.
 * For Floor Saddle & Pyramid Stacking:
 * - Level 1 rests on floor saddles at y = saddleHeightM (default 0.18m)
 * - Upper levels nest in the valley between two lower coils:
 *   x shifts by +0.5 * slotSpacingM per level above 1,
 *   y rises by sin(60 deg) * coilDiameterM (~0.866 * D) per level.
 * For RACK_BAY:
 * - Slots align vertically with zero X stagger and fixed vertical bay pitch.
 */
export function calculateSlotCoordinates(input: SlotGeometryInput): SlotGeometryOutput {
  const {
    rowOriginX,
    rowOriginZ,
    slotSpacingM,
    levelNumber,
    slotNumber,
    coilDiameterM = 1.55,
    stackingRule = levelNumber === 1 ? 'FLOOR_SADDLE' : 'PYRAMID_STACK',
    saddleHeightM = 0.18,
  } = input;

  const baseSlotX = rowOriginX + (slotNumber - 1) * slotSpacingM;
  const levelIndex = Math.max(0, levelNumber - 1);

  if (stackingRule === 'RACK_BAY') {
    const rackBayPitchY = coilDiameterM + 0.55;
    return {
      posX: round3(baseSlotX),
      posY: round3(saddleHeightM + levelIndex * rackBayPitchY),
      posZ: round3(rowOriginZ),
    };
  }

  // Pyramid stacking geometry: staggered X offset + sin(60°) vertical nesting
  const staggerX = levelIndex * (slotSpacingM * 0.5);
  const verticalStepY = coilDiameterM * 0.8660254;
  return {
    posX: round3(baseSlotX + staggerX),
    posY: round3(saddleHeightM + levelIndex * verticalStepY),
    posZ: round3(rowOriginZ),
  };
}

/**
 * Safety validation before deactivating or blocking a storage location.
 * Ensures layout modifications never orphan active inventory or live reservations.
 */
export function validateLocationModificationSafety(params: {
  currentStatus: LocationStatus;
  hasActiveInventory: boolean;
  hasActiveReservation: boolean;
  requestedIsActive?: boolean;
  requestedStatus?: LocationStatus;
}): { allowed: boolean; reason?: string } {
  const {
    currentStatus,
    hasActiveInventory,
    hasActiveReservation,
    requestedIsActive,
    requestedStatus,
  } = params;

  if (requestedIsActive === false) {
    if (hasActiveInventory || currentStatus === 'OCCUPIED') {
      return {
        allowed: false,
        reason: 'ไม่สามารถปิดใช้งาน Location ที่มีเหล็กม้วนจัดเก็บอยู่ได้ (Occupied location cannot be deactivated)',
      };
    }
    if (hasActiveReservation || currentStatus === 'RESERVED') {
      return {
        allowed: false,
        reason: 'ไม่สามารถปิดใช้งาน Location ที่ถูกจองไว้ชั่วคราวได้ (Reserved location cannot be deactivated)',
      };
    }
  }

  if (requestedStatus && requestedStatus !== currentStatus) {
    if (hasActiveInventory && requestedStatus !== 'OCCUPIED') {
      return {
        allowed: false,
        reason: 'ไม่สามารถเปลี่ยนสถานะ Location ที่มี Inventory Active อยู่โดยตรงได้ ต้องทำผ่าน Outbound หรือ Transfer',
      };
    }
    if (!hasActiveInventory && requestedStatus === 'OCCUPIED') {
      return {
        allowed: false,
        reason: 'ห้ามตั้งสถานะ OCCUPIED ด้วยมือโดยไม่มี Inbound Transaction จากระบบ',
      };
    }
    if (hasActiveReservation && requestedStatus === 'BLOCKED') {
      return {
        allowed: false,
        reason: 'ไม่สามารถ Block ตำแหน่งที่กำลังถูกจองอยู่ได้ กรุณายกเลิก Reservation ก่อน',
      };
    }
  }

  return { allowed: true };
}

/**
 * Validates that a coil's weight & dimensions satisfy a location's capacity limits.
 */
export function validateCoilCapacityFit(params: {
  coilWeightKg: number;
  coilOuterDiameterMm?: number | null;
  coilWidthMm?: number | null;
  locationMaxWeightKg: number;
  locationMaxOuterDiameterMm: number;
  locationMaxWidthMm: number;
  levelMaxWeightKg: number;
}): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (params.coilWeightKg <= 0) {
    errors.push('Coil weight must be positive');
  }
  if (params.coilWeightKg > params.locationMaxWeightKg) {
    errors.push(
      `Weight ${params.coilWeightKg} kg exceeds slot limit ${params.locationMaxWeightKg} kg`
    );
  }
  if (params.coilWeightKg > params.levelMaxWeightKg) {
    errors.push(
      `Weight ${params.coilWeightKg} kg exceeds level limit ${params.levelMaxWeightKg} kg`
    );
  }
  if (
    params.coilOuterDiameterMm != null &&
    params.coilOuterDiameterMm > params.locationMaxOuterDiameterMm
  ) {
    errors.push(
      `Outer diameter ${params.coilOuterDiameterMm} mm exceeds limit ${params.locationMaxOuterDiameterMm} mm`
    );
  }
  if (params.coilWidthMm != null && params.coilWidthMm > params.locationMaxWidthMm) {
    errors.push(`Width ${params.coilWidthMm} mm exceeds limit ${params.locationMaxWidthMm} mm`);
  }

  return { valid: errors.length === 0, errors };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
