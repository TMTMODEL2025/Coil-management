import type { LocationStatus, StackingRule } from './wms';

export type BatchReceiveStatus =
  | 'EMPTY'
  | 'READY_TO_RECEIVE'
  | 'RESERVED_IN_PROGRESS'
  | 'PARTIALLY_RECEIVED'
  | 'COMPLETED';

export type CoilInboundRowStatus =
  | 'PENDING'
  | 'RESERVED'
  | 'EXPIRED_RESERVATION'
  | 'RECEIVED';

export interface ActiveReservationInfo {
  reservationId: number;
  locationId: number;
  locationCode: string;
  doorCode: string;
  rowNumber: number;
  levelNumber: number;
  slotNumber: number;
  reservedByUserId: number;
  reservedByEmail: string | null;
  expiresAt: string;
  isOwnedByActor: boolean;
}

export interface BatchReferenceCoilItem {
  coilDbId: number;
  coilId: string;
  batchNo: string;
  materialCode: string;
  materialDescription: string | null;
  thicknessMm: number | null;
  targetThicknessMm: number | null;
  widthMm: number | null;
  outerDiameterMm: number | null;
  innerDiameterMm: number | null;
  grade: string | null;
  skinpass: string | null;
  heatNo: string | null;
  weightKg: number | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  effectiveWeightKg: number | null;
  unitOfMeasure: string | null;
  sapStorageLocation: string | null;
  scannedLocationRef: string | null;
  lifecycleStatus: string;
  sourceType?: string;
  isPendingSapSync?: boolean;
  inboundStatus: CoilInboundRowStatus;
  missingFields: string[];
  criticalMissingFields: string[];
  hasMissingData: boolean;
  canAutoAllocate: boolean;
  activeReservation: ActiveReservationInfo | null;
  confirmedLocationId: number | null;
  confirmedLocationCode: string | null;
  confirmedAt: string | null;
}

export interface BatchSummaryMetrics {
  totalCoils: number;
  receivedCoils: number;
  reservedCoils: number;
  pendingCoils: number;
  missingDataCoils: number;
  totalWeightKg: number;
  batchStatus: BatchReceiveStatus;
}

export interface PendingSapBatchSummary {
  batchNo: string;
  materialCode: string | null;
  materialDescription: string | null;
  grade: string | null;
  totalCoils: number;
  receivedCoils: number;
  reservedCoils: number;
  pendingCoils: number;
  totalWeightKg: number;
  batchStatus: BatchReceiveStatus;
  pendingSapCoils?: number;
  latestImportedAt: string | null;
}

export interface InboundBatchScanResponse {
  found: boolean;
  preSapMode: boolean;
  batchNo: string;
  materialCode: string | null;
  materialDescription: string | null;
  grade: string | null;
  importBatchId: number | null;
  receiptId: number | null;
  receiptNo: string | null;
  summary: BatchSummaryMetrics;
  coils: BatchReferenceCoilItem[];
  serverTimestamp: string;
}

export interface AllocationRecommendationItem {
  coilDbId: number;
  batchNo: string;
  coilId: string;
  thicknessMm: number | null;
  widthMm: number | null;
  grade: string | null;
  effectiveWeightKg: number | null;
  missingFields: string[];
  recommendedLocationId: number | null;
  recommendedLocationCode: string | null;
  doorCode: string | null;
  rowNumber: number | null;
  levelNumber: number | null;
  slotNumber: number | null;
  stackingRule: StackingRule | null;
  locationMaxWeightKg: number | null;
  alreadyReservedLocationCode: string | null;
  status: 'RECOMMENDED' | 'ALREADY_RESERVED' | 'UNALLOCATABLE';
  reason: string | null;
}

export interface InboundRecommendResponse {
  batchNo: string;
  recommendations: AllocationRecommendationItem[];
  recommendedCount: number;
  unallocatableCount: number;
  alreadyReservedCount: number;
  availableLocationsChecked: number;
  serverTimestamp: string;
}

export interface InboundReserveRequest {
  batchNo: string;
  allocations: Array<{
    coilDbId: number;
    locationId: number;
  }>;
  ttlMinutes?: number;
}

export interface InboundReserveResponse {
  receiptId: number;
  receiptNo: string;
  batchNo: string;
  ttlMinutes: number;
  reservations: Array<{
    reservationId: number;
    coilDbId: number;
    coilId: string;
    locationId: number;
    locationCode: string;
    expiresAt: string;
  }>;
  serverTimestamp: string;
}

export interface InboundReleaseResponse {
  released: boolean;
  reservationId: number;
  locationId: number;
  locationCode: string;
  coilDbId: number;
  coilId: string;
  serverTimestamp: string;
}

export interface InboundConfirmPlacementRequest {
  batchNo: string;
  scannedCoilId: string;
  scannedLocationCode: string;
  idempotencyKey: string;
  overrideReason?: string;
}

export interface InboundConfirmPlacementResponse {
  idempotentReplay: boolean;
  receiptId: number;
  receiptNo: string;
  batchNo: string;
  batchStatus: BatchReceiveStatus;
  inventoryId: number;
  transactionId: number;
  transactionNo: string;
  coilDbId: number;
  coilId: string;
  locationId: number;
  locationCode: string;
  locationStatus: LocationStatus;
  weightKg: number;
  overrideApplied: boolean;
  confirmedAt: string;
  serverTimestamp: string;
}

export interface InboundHistoryReceiptItem {
  itemId: number;
  coilDbId: number | null;
  coilId: string | null;
  status: string;
  targetLocationCode: string | null;
  confirmedLocationCode: string | null;
  scannedCoilCode: string | null;
  scannedLocationCode: string | null;
  overrideReason: string | null;
  confirmedAt: string | null;
  weightKg: number | null;
  grade: string | null;
  thicknessMm: number | null;
  widthMm: number | null;
}

export interface InboundHistoryReceipt {
  id: number;
  receiptNo: string;
  batchNo: string;
  materialCode: string | null;
  materialDescription: string | null;
  status: string;
  totalExpectedCoils: number;
  receivedCoilsCount: number;
  createdByEmail: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: InboundHistoryReceiptItem[];
}

export interface InboundHistoryResponse {
  receipts: InboundHistoryReceipt[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    totalReceipts: number;
    completedReceipts: number;
    partialReceipts: number;
    totalConfirmedCoils: number;
    activeReservations: number;
  };
  serverTimestamp: string;
}

export interface RowSlotEvaluationItem {
  locationId: number;
  locationCode: string;
  doorId: number;
  doorCode: string;
  rowId: number;
  rowNumber: number;
  levelId: number;
  levelNumber: number;
  levelLabel: string;
  stackingRule: StackingRule;
  slotNumber: number;
  maxWeightKg: number;
  levelMaxWeightKg: number;
  maxWidthMm: number;
  maxOuterDiameterMm: number;
  allocationPriority: number;
  status: LocationStatus;
  placeable: boolean;
  isTopRecommended: boolean;
  pendingSapWeightWarning?: boolean;
  reason: string | null;
  occupantCoilId: string | null;
  occupantWeightKg: number | null;
  reservedCoilId: string | null;
  reservedByEmail: string | null;
  reservationExpiresAt: string | null;
}

export interface InboundDirectPlaceRequest {
  batchNo: string;
  locationId: number;
  coilDbId?: number | null;
  idempotencyKey: string;
}

export interface InboundDirectPlaceResponse {
  idempotentReplay: boolean;
  isPendingSapSync: boolean;
  pendingSapWeightWarning: boolean;
  receiptId: number;
  receiptNo: string;
  batchNo: string;
  batchStatus: BatchReceiveStatus;
  inventoryId: number;
  transactionId: number;
  transactionNo: string;
  coilDbId: number;
  coilId: string;
  locationId: number;
  locationCode: string;
  locationStatus: LocationStatus;
  weightKg: number | null;
  confirmedAt: string;
  serverTimestamp: string;
}

export interface RowLevelSlotsGroup {
  levelId: number;
  levelNumber: number;
  label: string;
  stackingRule: StackingRule;
  maxWeightKg: number;
  placeableCount: number;
  totalCount: number;
  slots: RowSlotEvaluationItem[];
}

export interface InboundRowSlotsResponse {
  building: {
    doorId: number;
    doorCode: string;
    doorName: string;
    zoneCode: string;
    zoneName: string;
  };
  row: {
    rowId: number;
    rowNumber: number;
    label: string;
    maxLevels: number;
  };
  coil: {
    coilDbId: number;
    coilId: string;
    batchNo: string;
    effectiveWeightKg: number | null;
    widthMm: number | null;
    outerDiameterMm: number | null;
    grade: string | null;
  } | null;
  summary: {
    totalSlots: number;
    placeableCount: number;
    occupiedCount: number;
    reservedCount: number;
    blockedCount: number;
    unavailableRuleCount: number;
  };
  levels: RowLevelSlotsGroup[];
  serverTimestamp: string;
}

