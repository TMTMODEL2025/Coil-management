import type { LocationStatus, SceneCoilData, SceneLocationNode, VisualLocationStatus } from '../types/wms';

export type CameraPresetId = 'isometric' | 'top' | 'front' | 'side' | 'reset';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export interface StatusVisualStyle {
  status: VisualLocationStatus;
  hex: string;
  numericColor: number;
  labelTh: string;
  labelEn: string;
  descriptionTh: string;
}

/**
 * Mandatory database-driven color system (Section 9 of Phase 3 specification).
 * Colors are always paired with explicit text labels for accessibility.
 */
export const LOCATION_STATUS_STYLES: Record<VisualLocationStatus, StatusVisualStyle> = {
  EMPTY: {
    status: 'EMPTY',
    hex: '#16A34A',
    numericColor: 0x16a34a,
    labelTh: 'ว่างพร้อมจัดเก็บ',
    labelEn: 'EMPTY',
    descriptionTh: 'ตำแหน่งว่าง พร้อมรับเหล็กม้วนเข้าจัดเก็บ',
  },
  OCCUPIED: {
    status: 'OCCUPIED',
    hex: '#2563EB',
    numericColor: 0x2563eb,
    labelTh: 'มีเหล็กม้วนจัดเก็บ',
    labelEn: 'OCCUPIED',
    descriptionTh: 'มีเหล็กม้วนคงคลังอยู่ในตำแหน่งนี้ (ข้อมูลจริงจาก Inventory)',
  },
  RESERVED: {
    status: 'RESERVED',
    hex: '#EA580C',
    numericColor: 0xea580c,
    labelTh: 'จองตำแหน่ง (Active)',
    labelEn: 'RESERVED',
    descriptionTh: 'มีการจองชั่วคราวที่ยังไม่หมดอายุสำหรับรับเข้าหรือโอนย้าย',
  },
  BLOCKED: {
    status: 'BLOCKED',
    hex: '#DC2626',
    numericColor: 0xdc2626,
    labelTh: 'ปิดใช้งาน / กักกัน',
    labelEn: 'BLOCKED',
    descriptionTh: 'ตำแหน่งถูกปิดใช้งานหรือกักกันพื้นที่ปลอดภัย',
  },
  RECOMMENDED: {
    status: 'RECOMMENDED',
    hex: '#9333EA',
    numericColor: 0x9333ea,
    labelTh: 'ตำแหน่งที่เลือก / ค้นพบ',
    labelEn: 'RECOMMENDED / FOCUS',
    descriptionTh: 'ไฮไลต์ชั่วคราวจากการค้นหาหรือเลือกตำแหน่ง (ไม่เปลี่ยนแปลงสถานะในฐานข้อมูล)',
  },
};

export function resolveVisualStatus(
  dbStatus: LocationStatus,
  isHighlighted: boolean
): VisualLocationStatus {
  if (isHighlighted) return 'RECOMMENDED';
  return dbStatus;
}

export function getStatusVisualStyle(status: VisualLocationStatus): StatusVisualStyle {
  return LOCATION_STATUS_STYLES[status] ?? LOCATION_STATUS_STYLES.EMPTY;
}

export interface ResolvedCoilDimensionsM {
  outerRadiusM: number;
  innerRadiusM: number;
  widthM: number;
  isEstimatedModel: boolean;
}

/**
 * Converts coil dimensions (mm) from PostgreSQL into Three.js meters (1 unit = 1 meter),
 * safely clamping inner radius < outer radius and flagging Estimated Model when DB fields are null.
 */
export function resolveCoilDimensionsMeters(coil: Pick<
  SceneCoilData,
  'outerDiameterMm' | 'innerDiameterMm' | 'widthMm' | 'renderOuterDiameterMm' | 'renderInnerDiameterMm' | 'renderWidthMm' | 'isEstimatedModel'
>): ResolvedCoilDimensionsM {
  const odMm = Math.max(400, Math.min(2600, coil.outerDiameterMm ?? coil.renderOuterDiameterMm ?? 1550));
  const rawIdMm = coil.innerDiameterMm ?? coil.renderInnerDiameterMm ?? 508;
  const idMm = Math.max(180, Math.min(odMm * 0.65, rawIdMm));
  const widthMm = Math.max(300, Math.min(2200, coil.widthMm ?? coil.renderWidthMm ?? 1250));

  return {
    outerRadiusM: Number(((odMm / 1000) / 2).toFixed(4)),
    innerRadiusM: Number(((idMm / 1000) / 2).toFixed(4)),
    widthM: Number((widthMm / 1000).toFixed(4)),
    isEstimatedModel:
      coil.isEstimatedModel ||
      coil.outerDiameterMm === null ||
      coil.innerDiameterMm === null ||
      coil.widthMm === null,
  };
}

export interface SceneBounds {
  centerX: number;
  centerZ: number;
  widthM: number;
  depthM: number;
  heightM: number;
}

export interface EffectiveSceneBounds extends SceneBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Dynamically computes the 3D warehouse floor/portal-frame/camera envelope from both
 * the primary zone dimensions and every active storage location coordinate.
 * Guarantees that expanding rows beyond 12 coils (e.g. 20, 30, 60 coils) seamlessly
 * extends the concrete slab, steel columns, crane runways, and camera bounds.
 */
export function computeEffectiveSceneBounds(
  zones: Array<{ widthM: number; depthM: number; heightM: number }>,
  locations: Array<Pick<SceneLocationNode, 'posX' | 'posY' | 'posZ'>>
): EffectiveSceneBounds {
  const primary = zones[0];
  const baseWidth = primary?.widthM ?? 64;
  const baseDepth = primary?.depthM ?? 38;
  const baseHeight = primary?.heightM ?? 14;

  let minX = -baseWidth / 2;
  let maxX = baseWidth / 2;
  let minZ = -baseDepth / 2;
  let maxZ = baseDepth / 2;
  let maxY = baseHeight;

  const marginX = 7.5;
  const marginZ = 6.5;

  for (const loc of locations) {
    if (!Number.isFinite(loc.posX) || !Number.isFinite(loc.posZ)) continue;
    if (loc.posX - marginX < minX) minX = loc.posX - marginX;
    if (loc.posX + marginX > maxX) maxX = loc.posX + marginX;
    if (loc.posZ - marginZ < minZ) minZ = loc.posZ - marginZ;
    if (loc.posZ + marginZ > maxZ) maxZ = loc.posZ + marginZ;
    if (Number.isFinite(loc.posY) && loc.posY + 6 > maxY) {
      maxY = loc.posY + 6;
    }
  }

  return {
    minX,
    maxX,
    minZ,
    maxZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    widthM: maxX - minX,
    depthM: maxZ - minZ,
    heightM: maxY,
  };
}

export function computeCameraPreset(preset: CameraPresetId, bounds: SceneBounds): CameraPose {
  const cx = bounds.centerX;
  const cz = bounds.centerZ;
  const span = Math.max(bounds.widthM, bounds.depthM, 36);

  switch (preset) {
    case 'top':
      return {
        position: { x: cx, y: span * 0.92, z: cz + 0.8 },
        target: { x: cx, y: 0.5, z: cz },
      };
    case 'front':
      return {
        position: { x: cx, y: Math.max(10, bounds.heightM * 0.85), z: cz + span * 0.72 },
        target: { x: cx, y: 2.2, z: cz - 2 },
      };
    case 'side':
      return {
        position: { x: cx + span * 0.75, y: Math.max(12, bounds.heightM * 0.95), z: cz + 2 },
        target: { x: cx, y: 2.0, z: cz },
      };
    case 'isometric':
    case 'reset':
    default:
      return {
        position: {
          x: cx + span * 0.52,
          y: Math.max(22, span * 0.44),
          z: cz + span * 0.58,
        },
        target: { x: cx - 2, y: 1.5, z: cz },
      };
  }
}

/**
 * Computes a clean focus camera pose for a specific 3D Location coordinate.
 * Guarantees camera stays safely above the concrete floor (y >= 2.2m) and never clips underground.
 */
export function computeLocationFocusPose(point: Vec3): CameraPose {
  const safeY = Math.max(0.4, point.y);
  return {
    position: {
      x: Number((point.x + 6.5).toFixed(3)),
      y: Number(Math.max(4.5, safeY + 5.2).toFixed(3)),
      z: Number((point.z + 8.5).toFixed(3)),
    },
    target: {
      x: Number(point.x.toFixed(3)),
      y: Number((safeY + 0.35).toFixed(3)),
      z: Number(point.z.toFixed(3)),
    },
  };
}

export interface SceneFilterCriteria {
  doorId: number | 'ALL';
  rowId: number | 'ALL';
  levelNumber: number | 'ALL';
}

export function filterSceneLocations(
  locations: SceneLocationNode[],
  criteria: SceneFilterCriteria
): SceneLocationNode[] {
  return locations.filter((loc) => {
    if (criteria.doorId !== 'ALL' && loc.doorId !== criteria.doorId) return false;
    if (criteria.rowId !== 'ALL' && loc.rowId !== criteria.rowId) return false;
    if (criteria.levelNumber !== 'ALL' && loc.levelNumber !== criteria.levelNumber) return false;
    return true;
  });
}

/**
 * Event sequence deduplication guard for real-time SSE updates.
 */
export function shouldAcceptRealtimeSeq(lastSeenSeq: number, incomingSeq: number): boolean {
  if (!Number.isInteger(incomingSeq) || incomingSeq <= 0) return true;
  return incomingSeq > lastSeenSeq;
}

/**
 * Computes flat Float32Array translation + color buffers for InstancedMesh rendering,
 * enabling deterministic benchmarking and validation at 1,000+ slots.
 */
export function buildLocationInstanceBuffers(
  locations: Array<Pick<SceneLocationNode, 'id' | 'posX' | 'posY' | 'posZ' | 'status'>>,
  highlightedIds: ReadonlySet<number>
): {
  count: number;
  positions: Float32Array;
  colorsHex: number[];
} {
  const count = locations.length;
  const positions = new Float32Array(count * 3);
  const colorsHex: number[] = new Array(count);

  for (let i = 0; i < count; i++) {
    const loc = locations[i];
    positions[i * 3] = loc.posX;
    positions[i * 3 + 1] = loc.posY;
    positions[i * 3 + 2] = loc.posZ;
    const visualStatus = resolveVisualStatus(loc.status, highlightedIds.has(loc.id));
    colorsHex[i] = getStatusVisualStyle(visualStatus).numericColor;
  }

  return { count, positions, colorsHex };
}
