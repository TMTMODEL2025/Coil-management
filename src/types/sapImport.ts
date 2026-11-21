export type SapImportBatchStatus =
  | 'UPLOADED'
  | 'VALIDATING'
  | 'READY_TO_IMPORT'
  | 'IMPORTING'
  | 'COMPLETED'
  | 'COMPLETED_WITH_ERRORS'
  | 'FAILED'
  | 'CANCELLED';

export type SapImportMode = 'STRICT' | 'PARTIAL';
export type SapDateFormat = 'AUTO' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
export type SapValidationSeverity = 'ERROR' | 'WARNING' | 'INFO';
export type SapValidationStatus = 'VALID' | 'WARNING' | 'ERROR' | 'DUPLICATE';
export type SapDuplicateType =
  | 'NEW_RECORD'
  | 'RECONCILE_PRE_SAP'
  | 'DUPLICATE_IN_FILE'
  | 'EXISTING_REFERENCE'
  | 'ALREADY_IN_INVENTORY'
  | 'DATA_CONFLICT';
export type SapImportResultStatus =
  | 'PENDING'
  | 'IMPORTED'
  | 'RECONCILED'
  | 'SKIPPED_DUPLICATE'
  | 'SKIPPED_ERROR'
  | 'FAILED';

export type SapTargetFieldKey =
  | 'coil_id'
  | 'batch_number'
  | 'material_code'
  | 'material_description'
  | 'plant'
  | 'storage_location'
  | 'document_number'
  | 'document_item'
  | 'delivery_number'
  | 'purchase_order'
  | 'vendor_code'
  | 'vendor_name'
  | 'gross_weight'
  | 'net_weight'
  | 'width'
  | 'outer_diameter'
  | 'inner_diameter'
  | 'thickness'
  | 'target_thickness'
  | 'grade'
  | 'skinpass'
  | 'heat_no'
  | 'unit_of_measure'
  | 'posting_date'
  | 'document_date'
  | 'reference_text'
  | 'scanned_location_ref';

export interface SapTargetFieldDef {
  key: SapTargetFieldKey;
  labelTh: string;
  labelEn: string;
  required: boolean;
  dataType: 'string_leading_zero' | 'text' | 'number' | 'date';
  descriptionTh: string;
}

export interface SapWorksheetInfo {
  name: string;
  rowCount: number;
  dataRowCount?: number;
  colCount: number;
  detectedHeaderRow: number;
  isHidden?: boolean;
}

export interface SapValidationIssue {
  columnName: string | null;
  targetField: string | null;
  rawValue: string | null;
  errorCode: string;
  message: string;
  severity: SapValidationSeverity;
  suggestedResolution: string;
}

export interface SapColumnMappingProfile {
  id: number;
  profileName: string;
  description: string | null;
  sheetNameHint: string | null;
  headerRowIndex: number;
  mappingJson: Record<string, string>;
  dateFormat: SapDateFormat;
  decimalSeparator: string;
  leadingZeroRulesJson: Record<string, number>;
  isActive: boolean;
  isDefault: boolean;
  createdByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SapImportBatchSummary {
  id: number;
  batchCode: string;
  fileName: string;
  fileMimeType: string | null;
  fileExtension: string | null;
  fileSizeBytes: number;
  sheetName: string;
  headerRowIndex: number;
  availableSheets: SapWorksheetInfo[];
  appliedMapping: Record<string, string>;
  dateFormat: SapDateFormat;
  importMode: SapImportMode;
  mappingId: number | null;
  status: SapImportBatchStatus;
  totalRows: number;
  validRows: number;
  warningRows: number;
  duplicateRows: number;
  errorRows: number;
  importedRows: number;
  skippedRows: number;
  progressPercent: number;
  errorSummary: string | null;
  importedByUserId: number;
  importedByEmail: string | null;
  importedByName: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SapImportDashboardResponse {
  kpis: {
    totalImportFiles: number;
    successfulImports: number;
    importsWithWarnings: number;
    failedImports: number;
    totalSapReferenceCoils: number;
    pendingInboundCoils: number;
  };
  batches: SapImportBatchSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  safetySnapshot: {
    activeInventoryCount: number;
    occupiedLocationCount: number;
    activeReservationCount: number;
    stockTransactionCount: number;
  };
  maxFileSizeMb: number;
}

export interface SapWorksheetInspectResponse {
  batch: SapImportBatchSummary;
  worksheets: SapWorksheetInfo[];
  selectedSheet: string;
  headerRowIndex: number;
  headers: string[];
  rawPreviewRows: Array<{ rowNumber: number; values: string[] }>;
  sampleByColumn: Record<string, string[]>;
  suggestedMapping: Record<string, string>;
  detectedLeadingZeroWarnings: string[];
}

export interface SapStagingPreviewRow {
  id: number;
  rowIndex: number;
  coilIdText: string | null;
  batchNoText: string | null;
  materialCodeText: string | null;
  materialDescription: string | null;
  plantText: string | null;
  sapStorageLocationText: string | null;
  weightKg: number | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  thicknessMm: number | null;
  targetThicknessMm: number | null;
  widthMm: number | null;
  outerDiameterMm: number | null;
  innerDiameterMm: number | null;
  gradeText: string | null;
  vendorCodeText: string | null;
  skinpassText: string | null;
  heatNoText: string | null;
  unitOfMeasureText: string | null;
  postingDateText: string | null;
  documentDateText: string | null;
  referenceText: string | null;
  scannedLocationRefText: string | null;
  validationStatus: SapValidationStatus;
  duplicateType: SapDuplicateType;
  importResultStatus: SapImportResultStatus;
  validationMessage: string | null;
  rawRowJson: Record<string, string>;
  mappedDataJson: Record<string, string | number | null>;
  existingSnapshotJson: Record<string, unknown> | null;
  validationIssuesJson: SapValidationIssue[];
}

export interface SapValidationErrorItem {
  id: number;
  rowIndex: number;
  coilIdText: string | null;
  batchNoText: string | null;
  columnName: string | null;
  targetField: string | null;
  rawValue: string | null;
  errorCode: string;
  errorMessage: string;
  severity: SapValidationSeverity;
  suggestedResolution: string | null;
}

export interface SapReferenceCoilRecord {
  id: number;
  coilId: string;
  batchNo: string;
  materialCode: string;
  materialDescription: string | null;
  plant: string | null;
  sapStorageLocation: string | null;
  weightKg: number | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  thicknessMm: number | null;
  targetThicknessMm: number | null;
  widthMm: number | null;
  outerDiameterMm: number | null;
  innerDiameterMm: number | null;
  grade: string | null;
  vendorCode: string | null;
  skinpass: string | null;
  heatNo: string | null;
  referenceText: string | null;
  scannedLocationRef: string | null;
  sourceType: string;
  sourceRowNumber: number | null;
  lifecycleStatus: string;
  importBatchId: number | null;
  batchCode: string | null;
  importedAt: string | null;
}
