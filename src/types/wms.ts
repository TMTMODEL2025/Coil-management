export type NavSectionId =
  | 'dashboard'
  | 'warehouse-3d'
  | 'inbound'
  | 'inventory'
  | 'coil-tracking'
  | 'outbound'
  | 'transfer'
  | 'sap-import'
  | 'locations'
  | 'reports'
  | 'users'
  | 'settings';

export type LocationStatus = 'EMPTY' | 'OCCUPIED' | 'RESERVED' | 'BLOCKED';
export type StackingRule = 'FLOOR_SADDLE' | 'PYRAMID_STACK' | 'RACK_BAY';

export interface WmsUserProfile {
  id: number;
  uid: string;
  email: string;
  displayName: string | null;
  roleId: number;
  roleCode: 'ADMIN' | 'SUPERVISOR' | 'OPERATOR' | 'VIEWER' | string;
  roleName: string;
  isActive: boolean;
}

export interface WarehouseZone {
  id: number;
  code: string;
  name: string;
  description: string | null;
  isEstimatedLayout: boolean;
  widthM: number;
  depthM: number;
  heightM: number;
  isActive: boolean;
}

export interface BuildingDoor {
  id: number;
  zoneId: number;
  doorCode: string;
  name: string;
  description: string | null;
  posX: number;
  posY: number;
  posZ: number;
  facingDirection: string;
  sortOrder: number;
  isActive: boolean;
}

export interface WarehouseRow {
  id: number;
  doorId: number;
  rowNumber: number;
  label: string;
  allocationPriority: number;
  posX: number;
  posZ: number;
  orientationDeg: number;
  slotSpacingM: number;
  maxLevels: number;
  isActive: boolean;
}

export interface LevelStats {
  levelId: number;
  total: number;
  empty: number;
  occupied: number;
  reserved: number;
  blocked: number;
  inactive: number;
}

export interface WarehouseLevel {
  id: number;
  rowId: number;
  levelNumber: number;
  label: string;
  elevationY: number;
  maxWeightKg: number;
  maxSlots: number;
  stackingRule: StackingRule;
  isActive: boolean;
  stats: LevelStats;
}

export interface WarehouseHierarchyData {
  zones: WarehouseZone[];
  doors: BuildingDoor[];
  rows: WarehouseRow[];
  levels: WarehouseLevel[];
}

export interface StorageLocationItem {
  id: number;
  locationCode: string;
  doorId: number;
  doorCode: string;
  rowId: number;
  rowNumber: number;
  levelId: number;
  levelNumber: number;
  stackingRule: StackingRule;
  slotNumber: number;
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
  updatedAt: string;
}

export interface LayoutObjectItem {
  id: number;
  zoneId: number;
  zoneCode: string;
  doorId: number | null;
  objectCode: string;
  name: string;
  objectType: string;
  posX: number;
  posY: number;
  posZ: number;
  widthM: number;
  heightM: number;
  depthM: number;
  rotationYDeg: number;
  colorHex: string;
  metadataJson: Record<string, unknown>;
  isEstimated: boolean;
  isActive: boolean;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: number;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface WarehouseSummaryData {
  counts: {
    zones: number;
    doors: number;
    rows: number;
    levels: number;
    layoutObjects: number;
    locations: {
      EMPTY: number;
      OCCUPIED: number;
      RESERVED: number;
      BLOCKED: number;
      INACTIVE: number;
      TOTAL: number;
    };
    coils: number;
    activeInventory: number;
  };
  isEstimatedLayout: boolean;
  recentAudit: AuditLogEntry[];
  serverTimestamp: string;
}

export interface RoleRecord {
  id: number;
  code: string;
  name: string;
  description: string | null;
}

export interface UserAccessRecord {
  id: number;
  uid: string;
  email: string;
  displayName: string | null;
  roleId: number;
  roleCode: string;
  roleName: string;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

// ============================================================================
// PHASE 3: INTERACTIVE 3D WAREHOUSE TYPES
// ============================================================================

export type VisualLocationStatus = LocationStatus | 'RECOMMENDED';

export type WarehouseRealtimeEventName =
  | 'location:updated'
  | 'location:reserved'
  | 'location:released'
  | 'inbound:confirmed'
  | 'outbound:confirmed'
  | 'transfer:confirmed'
  | 'layout:updated'
  | 'SAP_IMPORT_UPLOADED'
  | 'SAP_IMPORT_VALIDATION_STARTED'
  | 'SAP_IMPORT_VALIDATION_COMPLETED'
  | 'SAP_IMPORT_STARTED'
  | 'SAP_IMPORT_PROGRESS'
  | 'SAP_IMPORT_COMPLETED'
  | 'SAP_IMPORT_FAILED';

export interface WarehouseRealtimeEvent {
  seq: number;
  type: WarehouseRealtimeEventName;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface SceneCoilData {
  inventoryId: number;
  coilDbId: number;
  coilId: string;
  batchNo: string;
  materialCode: string;
  materialDescription: string | null;
  grade?: string | null;
  heatNo?: string | null;
  sourceType?: string;
  isPendingSapSync?: boolean;
  weightKg: number;
  thicknessMm: number | null;
  widthMm: number | null;
  outerDiameterMm: number | null;
  innerDiameterMm: number | null;
  inventoryStatus: string;
  inboundDate: string;
  isEstimatedModel: boolean;
  renderOuterDiameterMm: number;
  renderInnerDiameterMm: number;
  renderWidthMm: number;
}

export interface SceneReservationData {
  reservationId: number;
  coilDbId: number;
  coilId: string;
  reservationType: string;
  expiresAt: string;
}

export interface SceneLocationNode {
  id: number;
  locationCode: string;
  zoneId: number;
  doorId: number;
  doorCode: string;
  rowId: number;
  rowNumber: number;
  rowLabel: string;
  levelId: number;
  levelNumber: number;
  levelLabel: string;
  stackingRule: StackingRule;
  slotNumber: number;
  posX: number;
  posY: number;
  posZ: number;
  widthM: number;
  heightM: number;
  depthM: number;
  maxWeightKg: number;
  currentWeightKg: number;
  availableCapacityKg: number;
  maxOuterDiameterMm: number;
  maxWidthMm: number;
  stackingGroup: string;
  allocationPriority: number;
  status: LocationStatus;
  rawStatus: LocationStatus;
  isActive: boolean;
  isEstimatedCoord: boolean;
  notes: string | null;
  coil: SceneCoilData | null;
  reservation: SceneReservationData | null;
}

export interface SceneCoordinateWarning {
  locationId: number;
  locationCode: string;
  reason: string;
}

export interface Warehouse3DSceneResponse {
  zones: WarehouseZone[];
  doors: BuildingDoor[];
  rows: WarehouseRow[];
  levels: Array<{
    id: number;
    rowId: number;
    levelNumber: number;
    label: string;
    elevationY: number;
    maxWeightKg: number;
    maxSlots: number;
    stackingRule: StackingRule;
    isActive: boolean;
  }>;
  locations: SceneLocationNode[];
  layoutObjects: LayoutObjectItem[];
  coordinateWarnings: SceneCoordinateWarning[];
  summary: {
    totalLocations: number;
    emptyCount: number;
    occupiedCount: number;
    reservedCount: number;
    blockedCount: number;
    activeCoilCount: number;
    pendingSapCoilCount?: number;
    isEstimatedLayout: boolean;
  };
  defaultCoilModelSpec: {
    outerDiameterMm: number;
    innerDiameterMm: number;
    widthMm: number;
    isEstimated: true;
  };
  serverTimestamp: string;
}

export type SceneSearchMatchType =
  | 'LOCATION'
  | 'COIL_STORED'
  | 'COIL_NOT_STORED'
  | 'BATCH'
  | 'DOOR'
  | 'ROW'
  | 'NOT_FOUND';

export interface SceneSearchResult {
  found: boolean;
  query: string;
  matchType: SceneSearchMatchType;
  messageTh: string;
  messageEn: string;
  primaryLocationId: number | null;
  primaryLocationCode: string | null;
  matchedLocationIds: number[];
  matchedDoorId: number | null;
  matchedRowId: number | null;
  unplacedCoils: Array<{
    coilId: string;
    batchNo: string;
    materialCode: string;
    lifecycleStatus: string;
  }>;
}

export interface ExpandRowSlotsRequest {
  targetBaseSlots?: number;
  addSlots?: number;
  syncUpperPyramidLevels?: boolean;
}

export interface ExpandRowSlotsLevelSummary {
  levelId: number;
  levelNumber: number;
  label: string;
  previousSlots: number;
  newMaxSlots: number;
  createdCount: number;
}

export interface ExpandRowSlotsResponse {
  rowId: number;
  doorId: number;
  doorCode: string;
  rowNumber: number;
  rowLabel: string;
  previousBaseSlots: number;
  newBaseSlots: number;
  syncUpperPyramidLevels: boolean;
  createdCount: number;
  skippedCount: number;
  firstCreatedLocationCode: string | null;
  createdCodes: string[];
  levels: ExpandRowSlotsLevelSummary[];
}


