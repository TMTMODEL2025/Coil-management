import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ============================================================================
// 1. ROLES
// ============================================================================
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(), // ADMIN | SUPERVISOR | OPERATOR | VIEWER
  name: text('name').notNull(),
  description: text('description'),
  permissionsJson: jsonb('permissions_json').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// 2. USERS
// ============================================================================
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(), // Firebase Auth UID
    email: text('email').notNull().unique(),
    displayName: text('display_name'),
    roleId: integer('role_id')
      .references(() => roles.id)
      .notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    lastLoginAt: timestamp('last_login_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_users_role_id').on(table.roleId)]
);

// ============================================================================
// 3. ZONES
// ============================================================================
export const zones = pgTable('zones', {
  id: serial('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  isEstimatedLayout: boolean('is_estimated_layout').default(true).notNull(),
  widthM: doublePrecision('width_m').default(60).notNull(),
  depthM: doublePrecision('depth_m').default(40).notNull(),
  heightM: doublePrecision('height_m').default(14).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// 4. BUILDING DOORS
// ============================================================================
export const buildingDoors = pgTable(
  'building_doors',
  {
    id: serial('id').primaryKey(),
    zoneId: integer('zone_id')
      .references(() => zones.id)
      .notNull(),
    doorCode: text('door_code').notNull().unique(), // e.g., E7
    name: text('name').notNull(),
    description: text('description'),
    posX: doublePrecision('pos_x').default(0).notNull(),
    posY: doublePrecision('pos_y').default(0).notNull(),
    posZ: doublePrecision('pos_z').default(0).notNull(),
    facingDirection: text('facing_direction').default('SOUTH').notNull(),
    sortOrder: integer('sort_order').default(1).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_building_doors_zone_id').on(table.zoneId)]
);

// ============================================================================
// 5. WAREHOUSE ROWS
// ============================================================================
export const warehouseRows = pgTable(
  'warehouse_rows',
  {
    id: serial('id').primaryKey(),
    doorId: integer('door_id')
      .references(() => buildingDoors.id)
      .notNull(),
    rowNumber: integer('row_number').notNull(),
    label: text('label').notNull(),
    allocationPriority: integer('allocation_priority').default(100).notNull(),
    posX: doublePrecision('pos_x').default(0).notNull(),
    posZ: doublePrecision('pos_z').default(0).notNull(),
    orientationDeg: doublePrecision('orientation_deg').default(0).notNull(),
    slotSpacingM: doublePrecision('slot_spacing_m').default(2.1).notNull(),
    maxLevels: integer('max_levels').default(4).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_warehouse_rows_door_row').on(table.doorId, table.rowNumber),
    check('chk_warehouse_rows_row_positive', sql`${table.rowNumber} > 0`),
    check('chk_warehouse_rows_max_levels_positive', sql`${table.maxLevels} > 0`),
  ]
);

// ============================================================================
// 6. WAREHOUSE LEVELS
// ============================================================================
export const warehouseLevels = pgTable(
  'warehouse_levels',
  {
    id: serial('id').primaryKey(),
    rowId: integer('row_id')
      .references(() => warehouseRows.id)
      .notNull(),
    levelNumber: integer('level_number').notNull(),
    label: text('label').notNull(),
    elevationY: doublePrecision('elevation_y').default(0).notNull(),
    maxWeightKg: doublePrecision('max_weight_kg').default(25000).notNull(),
    maxSlots: integer('max_slots').default(10).notNull(),
    stackingRule: text('stacking_rule').default('FLOOR_SADDLE').notNull(), // FLOOR_SADDLE | PYRAMID_STACK | RACK_BAY
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_warehouse_levels_row_level').on(table.rowId, table.levelNumber),
    check('chk_warehouse_levels_level_positive', sql`${table.levelNumber} > 0`),
    check('chk_warehouse_levels_weight_positive', sql`${table.maxWeightKg} > 0`),
  ]
);

// ============================================================================
// 7. STORAGE LOCATIONS (e.g. E7/1/3/9)
// ============================================================================
export const storageLocations = pgTable(
  'storage_locations',
  {
    id: serial('id').primaryKey(),
    doorId: integer('door_id')
      .references(() => buildingDoors.id)
      .notNull(),
    rowId: integer('row_id')
      .references(() => warehouseRows.id)
      .notNull(),
    levelId: integer('level_id')
      .references(() => warehouseLevels.id)
      .notNull(),
    slotNumber: integer('slot_number').notNull(),
    locationCode: text('location_code').notNull().unique(), // e.g. E7/1/3/9
    posX: doublePrecision('pos_x').notNull(),
    posY: doublePrecision('pos_y').notNull(),
    posZ: doublePrecision('pos_z').notNull(),
    widthM: doublePrecision('width_m').default(1.8).notNull(),
    heightM: doublePrecision('height_m').default(1.6).notNull(),
    depthM: doublePrecision('depth_m').default(1.8).notNull(),
    maxWeightKg: doublePrecision('max_weight_kg').default(25000).notNull(),
    maxOuterDiameterMm: doublePrecision('max_outer_diameter_mm').default(2000).notNull(),
    maxWidthMm: doublePrecision('max_width_mm').default(1650).notNull(),
    stackingGroup: text('stacking_group').default('STANDARD_HR').notNull(),
    allocationPriority: integer('allocation_priority').default(100).notNull(),
    status: text('status').default('EMPTY').notNull(), // EMPTY | OCCUPIED | RESERVED | BLOCKED
    isActive: boolean('is_active').default(true).notNull(),
    isEstimatedCoord: boolean('is_estimated_coord').default(true).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_storage_locations_level_slot').on(table.levelId, table.slotNumber),
    index('idx_storage_locations_code').on(table.locationCode),
    index('idx_storage_locations_status').on(table.status),
    index('idx_storage_locations_hierarchy').on(table.doorId, table.rowId, table.levelId),
    check(
      'chk_storage_locations_status',
      sql`${table.status} IN ('EMPTY', 'OCCUPIED', 'RESERVED', 'BLOCKED')`
    ),
    check('chk_storage_locations_slot_positive', sql`${table.slotNumber} > 0`),
    check('chk_storage_locations_weight_positive', sql`${table.maxWeightKg} > 0`),
  ]
);

// ============================================================================
// 8. WAREHOUSE LAYOUT OBJECTS (3D Architectural & Functional Elements)
// ============================================================================
export const warehouseLayoutObjects = pgTable(
  'warehouse_layout_objects',
  {
    id: serial('id').primaryKey(),
    zoneId: integer('zone_id')
      .references(() => zones.id)
      .notNull(),
    doorId: integer('door_id').references(() => buildingDoors.id),
    objectCode: text('object_code').notNull().unique(),
    name: text('name').notNull(),
    objectType: text('object_type').notNull(), // RECEIVING_AREA | DISPATCH_AREA | CRANE_RUNWAY | CRANE_BRIDGE | AISLE | BLOCKED_AREA | BUILDING_SHELL | DOOR_GATE | NAVIGATION_WAYPOINT
    posX: doublePrecision('pos_x').default(0).notNull(),
    posY: doublePrecision('pos_y').default(0).notNull(),
    posZ: doublePrecision('pos_z').default(0).notNull(),
    widthM: doublePrecision('width_m').default(4).notNull(),
    heightM: doublePrecision('height_m').default(0.2).notNull(),
    depthM: doublePrecision('depth_m').default(4).notNull(),
    rotationYDeg: doublePrecision('rotation_y_deg').default(0).notNull(),
    colorHex: text('color_hex').default('#334155').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().default({}).notNull(),
    isEstimated: boolean('is_estimated').default(true).notNull(),
    isActive: boolean('is_active').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_layout_objects_zone_type').on(table.zoneId, table.objectType)]
);

// ============================================================================
// 9. EXCEL COLUMN MAPPINGS (SAP Reference Excel Import)
// ============================================================================
export const excelColumnMappings = pgTable('excel_column_mappings', {
  id: serial('id').primaryKey(),
  profileName: text('profile_name').notNull().unique(),
  description: text('description'),
  sheetNameHint: text('sheet_name_hint'),
  headerRowIndex: integer('header_row_index').default(1).notNull(),
  mappingJson: jsonb('mapping_json').$type<Record<string, string>>().notNull(),
  dateFormat: text('date_format').default('AUTO').notNull(), // AUTO | DD/MM/YYYY | MM/DD/YYYY | YYYY-MM-DD
  decimalSeparator: text('decimal_separator').default('.').notNull(),
  leadingZeroRulesJson: jsonb('leading_zero_rules_json').$type<Record<string, number>>().default({}).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdByUserId: integer('created_by_user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// 10. EXCEL IMPORT BATCHES
// ============================================================================
export const excelImportBatches = pgTable(
  'excel_import_batches',
  {
    id: serial('id').primaryKey(),
    batchCode: text('batch_code').notNull().unique(),
    fileName: text('file_name').notNull(),
    storedFileName: text('stored_file_name'), // Internal UUID filename — NEVER exposed to client
    fileMimeType: text('file_mime_type'),
    fileExtension: text('file_extension'),
    fileSha256: text('file_sha256'),
    sheetName: text('sheet_name').notNull(),
    headerRowIndex: integer('header_row_index').default(1).notNull(),
    availableSheetsJson: jsonb('available_sheets_json')
      .$type<Array<{ name: string; rowCount: number; colCount: number; detectedHeaderRow: number }>>()
      .default([])
      .notNull(),
    appliedMappingJson: jsonb('applied_mapping_json').$type<Record<string, string>>().default({}).notNull(),
    dateFormat: text('date_format').default('AUTO').notNull(),
    importMode: text('import_mode').default('STRICT').notNull(), // STRICT | PARTIAL
    idempotencyKey: text('idempotency_key').unique(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    mappingId: integer('mapping_id').references(() => excelColumnMappings.id),
    status: text('status').default('UPLOADED').notNull(), // UPLOADED | VALIDATING | READY_TO_IMPORT | IMPORTING | COMPLETED | COMPLETED_WITH_ERRORS | FAILED | CANCELLED
    totalRows: integer('total_rows').default(0).notNull(),
    validRows: integer('valid_rows').default(0).notNull(),
    warningRows: integer('warning_rows').default(0).notNull(),
    duplicateRows: integer('duplicate_rows').default(0).notNull(),
    errorRows: integer('error_rows').default(0).notNull(),
    importedRows: integer('imported_rows').default(0).notNull(),
    skippedRows: integer('skipped_rows').default(0).notNull(),
    progressPercent: integer('progress_percent').default(0).notNull(),
    errorSummary: text('error_summary'),
    importedByUserId: integer('imported_by_user_id')
      .references(() => users.id)
      .notNull(),
    confirmedAt: timestamp('confirmed_at'),
    cancelledAt: timestamp('cancelled_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_excel_import_batches_status').on(table.status),
    index('idx_excel_import_batches_created_at').on(table.createdAt),
    index('idx_excel_import_batches_user').on(table.importedByUserId),
  ]
);

// ============================================================================
// 11. EXCEL IMPORT STAGING (Strings preserved for Leading Zeros)
// ============================================================================
export const excelImportStaging = pgTable(
  'excel_import_staging',
  {
    id: serial('id').primaryKey(),
    importBatchId: integer('import_batch_id')
      .references(() => excelImportBatches.id)
      .notNull(),
    rowIndex: integer('row_index').notNull(),
    rawRowJson: jsonb('raw_row_json').$type<Record<string, string>>().notNull(),
    mappedDataJson: jsonb('mapped_data_json').$type<Record<string, string | number | null>>().default({}).notNull(),
    existingSnapshotJson: jsonb('existing_snapshot_json').$type<Record<string, unknown> | null>(),
    validationIssuesJson: jsonb('validation_issues_json')
      .$type<
        Array<{
          columnName: string | null;
          targetField: string | null;
          rawValue: string | null;
          errorCode: string;
          message: string;
          severity: 'ERROR' | 'WARNING' | 'INFO';
          suggestedResolution: string;
        }>
      >()
      .default([])
      .notNull(),
    coilIdText: text('coil_id_text'),
    batchNoText: text('batch_no_text'),
    materialCodeText: text('material_code_text'),
    materialDescription: text('material_description'),
    plantText: text('plant_text'),
    sapStorageLocationText: text('sap_storage_location_text'),
    materialDocumentText: text('material_document_text'),
    fiscalYearText: text('fiscal_year_text'),
    documentItemText: text('document_item_text'),
    deliveryNumberText: text('delivery_number_text'),
    purchaseOrderText: text('purchase_order_text'),
    vendorCodeText: text('vendor_code_text'),
    vendorNameText: text('vendor_name_text'),
    weightKg: doublePrecision('weight_kg'),
    grossWeightKg: doublePrecision('gross_weight_kg'),
    netWeightKg: doublePrecision('net_weight_kg'),
    thicknessMm: doublePrecision('thickness_mm'),
    targetThicknessMm: doublePrecision('target_thickness_mm'),
    widthMm: doublePrecision('width_mm'),
    outerDiameterMm: doublePrecision('outer_diameter_mm'),
    innerDiameterMm: doublePrecision('inner_diameter_mm'),
    gradeText: text('grade_text'),
    skinpassText: text('skinpass_text'),
    heatNoText: text('heat_no_text'),
    unitOfMeasureText: text('unit_of_measure_text'),
    postingDateText: text('posting_date_text'),
    documentDateText: text('document_date_text'),
    referenceText: text('reference_text'),
    scannedLocationRefText: text('scanned_location_ref_text'),
    saleOrderText: text('sale_order_text'),
    validationStatus: text('validation_status').default('VALID').notNull(), // VALID | WARNING | ERROR | DUPLICATE
    duplicateType: text('duplicate_type').default('NEW_RECORD').notNull(), // NEW_RECORD | DUPLICATE_IN_FILE | EXISTING_REFERENCE | ALREADY_IN_INVENTORY | DATA_CONFLICT
    importResultStatus: text('import_result_status').default('PENDING').notNull(), // PENDING | IMPORTED | SKIPPED_DUPLICATE | SKIPPED_ERROR | FAILED
    validationMessage: text('validation_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_excel_staging_batch_row').on(table.importBatchId, table.rowIndex),
    index('idx_excel_staging_batch').on(table.importBatchId),
    index('idx_excel_staging_coil').on(table.coilIdText),
    index('idx_excel_staging_validation').on(table.importBatchId, table.validationStatus),
  ]
);

// ============================================================================
// 12. EXCEL IMPORT ERRORS
// ============================================================================
export const excelImportErrors = pgTable(
  'excel_import_errors',
  {
    id: serial('id').primaryKey(),
    importBatchId: integer('import_batch_id')
      .references(() => excelImportBatches.id)
      .notNull(),
    rowIndex: integer('row_index').notNull(),
    coilIdText: text('coil_id_text'),
    batchNoText: text('batch_no_text'),
    columnName: text('column_name'),
    targetField: text('target_field'),
    rawValue: text('raw_value'),
    errorCode: text('error_code').notNull(),
    errorMessage: text('error_message').notNull(),
    severity: text('severity').default('ERROR').notNull(), // ERROR | WARNING | INFO
    suggestedResolution: text('suggested_resolution'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_excel_errors_batch').on(table.importBatchId),
    index('idx_excel_errors_severity').on(table.importBatchId, table.severity),
  ]
);

// ============================================================================
// 13. SAP DOCUMENT HEADERS
// ============================================================================
export const sapDocumentHeaders = pgTable(
  'sap_document_headers',
  {
    id: serial('id').primaryKey(),
    materialDocument: text('material_document').notNull(), // Preserves leading zeros
    fiscalYear: text('fiscal_year').notNull(),
    plant: text('plant'),
    sapStorageLocation: text('sap_storage_location'),
    importBatchId: integer('import_batch_id').references(() => excelImportBatches.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sap_doc_headers_doc_year').on(table.materialDocument, table.fiscalYear),
  ]
);

// ============================================================================
// 14. SAP DOCUMENT ITEMS
// ============================================================================
export const sapDocumentItems = pgTable(
  'sap_document_items',
  {
    id: serial('id').primaryKey(),
    headerId: integer('header_id')
      .references(() => sapDocumentHeaders.id)
      .notNull(),
    documentItem: text('document_item').notNull(), // Preserves leading zeros
    coilIdText: text('coil_id_text').notNull(),
    batchNo: text('batch_no').notNull(),
    materialCode: text('material_code').notNull(),
    materialDescription: text('material_description'),
    weightKg: doublePrecision('weight_kg'),
    saleOrder: text('sale_order'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_sap_doc_items_header_item').on(table.headerId, table.documentItem),
    index('idx_sap_doc_items_batch').on(table.batchNo),
    index('idx_sap_doc_items_coil').on(table.coilIdText),
  ]
);

// ============================================================================
// 15. COILS (Master Coil Reference from SAP Excel — Leading Zeros Preserved)
// ============================================================================
export const coils = pgTable(
  'coils',
  {
    id: serial('id').primaryKey(),
    coilId: text('coil_id').notNull().unique(), // TEXT strictly preserves leading zeros
    batchNo: text('batch_no').notNull(),
    materialCode: text('material_code').default('').notNull(),
    materialDescription: text('material_description'),
    plant: text('plant'),
    sapStorageLocation: text('sap_storage_location'),
    saleOrder: text('sale_order'),
    deliveryNumber: text('delivery_number'),
    purchaseOrder: text('purchase_order'),
    vendorCode: text('vendor_code'),
    vendorName: text('vendor_name'),
    weightKg: doublePrecision('weight_kg'),
    grossWeightKg: doublePrecision('gross_weight_kg'),
    netWeightKg: doublePrecision('net_weight_kg'),
    thicknessMm: doublePrecision('thickness_mm'),
    targetThicknessMm: doublePrecision('target_thickness_mm'),
    widthMm: doublePrecision('width_mm'),
    outerDiameterMm: doublePrecision('outer_diameter_mm'),
    innerDiameterMm: doublePrecision('inner_diameter_mm'),
    grade: text('grade'),
    skinpass: text('skinpass'),
    heatNo: text('heat_no'),
    unitOfMeasure: text('unit_of_measure'),
    postingDate: text('posting_date'),
    documentDate: text('document_date'),
    referenceText: text('reference_text'),
    scannedLocationRef: text('scanned_location_ref'),
    isEstimatedDimensions: boolean('is_estimated_dimensions').default(true).notNull(),
    sourceType: text('source_type').default('SAP_EXCEL_IMPORT').notNull(),
    sourceRowNumber: integer('source_row_number'),
    importedByUserId: integer('imported_by_user_id').references(() => users.id),
    importedAt: timestamp('imported_at'),
    lifecycleStatus: text('lifecycle_status').default('PENDING_INBOUND').notNull(), // PENDING_INBOUND | IN_STOCK | RESERVED_OUTBOUND | HOLD | DISPATCHED
    sapDocumentItemId: integer('sap_document_item_id').references(() => sapDocumentItems.id),
    importBatchId: integer('import_batch_id').references(() => excelImportBatches.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_coils_coil_id').on(table.coilId),
    index('idx_coils_batch_no').on(table.batchNo),
    index('idx_coils_material_code').on(table.materialCode),
    index('idx_coils_lifecycle_status').on(table.lifecycleStatus),
    index('idx_coils_import_batch').on(table.importBatchId),
    check('chk_coils_weight_positive', sql`${table.weightKg} IS NULL OR ${table.weightKg} > 0`),
    check(
      'chk_coils_lifecycle_status',
      sql`${table.lifecycleStatus} IN ('PENDING_INBOUND', 'IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD', 'DISPATCHED')`
    ),
  ]
);

// ============================================================================
// 16. INVENTORY (Active Warehouse Occupancy — Enforces 1 Coil <-> 1 Location)
// ============================================================================
export const inventory = pgTable(
  'inventory',
  {
    id: serial('id').primaryKey(),
    coilId: integer('coil_id')
      .references(() => coils.id)
      .notNull(),
    currentLocationId: integer('current_location_id').references(() => storageLocations.id),
    status: text('status').default('IN_STOCK').notNull(), // IN_STOCK | RESERVED_OUTBOUND | HOLD | DISPATCHED
    inboundDate: timestamp('inbound_date').defaultNow().notNull(),
    dispatchedAt: timestamp('dispatched_at'),
    receivedByUserId: integer('received_by_user_id').references(() => users.id),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    // DB-level guarantee: 1 Location holds at most 1 active Coil
    uniqueIndex('idx_inventory_one_active_coil_per_location')
      .on(table.currentLocationId)
      .where(
        sql`${table.currentLocationId} IS NOT NULL AND ${table.status} IN ('IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD')`
      ),
    // DB-level guarantee: 1 Coil occupies at most 1 active Location
    uniqueIndex('idx_inventory_one_active_location_per_coil')
      .on(table.coilId)
      .where(sql`${table.status} IN ('IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD')`),
    index('idx_inventory_status').on(table.status),
    check(
      'chk_inventory_status',
      sql`${table.status} IN ('IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD', 'DISPATCHED')`
    ),
  ]
);

// ============================================================================
// 17. INBOUND RECEIPTS
// ============================================================================
export const inboundReceipts = pgTable(
  'inbound_receipts',
  {
    id: serial('id').primaryKey(),
    receiptNo: text('receipt_no').notNull().unique(),
    batchNo: text('batch_no').notNull(),
    importBatchId: integer('import_batch_id').references(() => excelImportBatches.id),
    materialCode: text('material_code'),
    materialDescription: text('material_description'),
    status: text('status').default('OPEN').notNull(), // OPEN | IN_PROGRESS | PARTIALLY_RECEIVED | COMPLETED | CANCELLED
    totalExpectedCoils: integer('total_expected_coils').default(0).notNull(),
    receivedCoilsCount: integer('received_coils_count').default(0).notNull(),
    notes: text('notes'),
    createdByUserId: integer('created_by_user_id')
      .references(() => users.id)
      .notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_inbound_receipts_batch').on(table.batchNo),
    index('idx_inbound_receipts_status').on(table.status),
  ]
);

// ============================================================================
// 18. INBOUND RECEIPT ITEMS
// ============================================================================
export const inboundReceiptItems = pgTable(
  'inbound_receipt_items',
  {
    id: serial('id').primaryKey(),
    receiptId: integer('receipt_id')
      .references(() => inboundReceipts.id)
      .notNull(),
    coilId: integer('coil_id').references(() => coils.id),
    targetLocationId: integer('target_location_id').references(() => storageLocations.id),
    confirmedLocationId: integer('confirmed_location_id').references(() => storageLocations.id),
    reservationId: integer('reservation_id').references(() => locationReservations.id),
    status: text('status').default('PENDING').notNull(), // PENDING | RESERVED | CONFIRMED | FAILED_SCAN
    scannedLocationCode: text('scanned_location_code'),
    scannedCoilCode: text('scanned_coil_code'),
    idempotencyKey: text('idempotency_key').unique(),
    overrideReason: text('override_reason'),
    scanEventJson: jsonb('scan_event_json')
      .$type<
        Array<{
          timestamp: string;
          actorEmail: string | null;
          scannedCoilCode: string;
          scannedLocationCode: string;
          outcome: 'CONFIRMED' | 'REJECTED';
          message: string;
        }>
      >()
      .default([])
      .notNull(),
    errorMessage: text('error_message'),
    scannedByUserId: integer('scanned_by_user_id').references(() => users.id),
    confirmedAt: timestamp('confirmed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_inbound_items_receipt').on(table.receiptId),
    index('idx_inbound_items_coil').on(table.coilId),
    index('idx_inbound_items_receipt_coil').on(table.receiptId, table.coilId),
  ]
);

// ============================================================================
// 19. OUTBOUND ORDERS (WMS-Only — No SAP Outbound API)
// ============================================================================
export const outboundOrders = pgTable(
  'outbound_orders',
  {
    id: serial('id').primaryKey(),
    orderNo: text('order_no').notNull().unique(),
    referenceNo: text('reference_no'),
    customerName: text('customer_name'),
    truckPlate: text('truck_plate'),
    status: text('status').default('DRAFT').notNull(), // DRAFT | PICKING | COMPLETED | CANCELLED
    notes: text('notes'),
    createdByUserId: integer('created_by_user_id')
      .references(() => users.id)
      .notNull(),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_outbound_orders_status').on(table.status)]
);

// ============================================================================
// 20. OUTBOUND ORDER ITEMS
// ============================================================================
export const outboundOrderItems = pgTable(
  'outbound_order_items',
  {
    id: serial('id').primaryKey(),
    outboundOrderId: integer('outbound_order_id')
      .references(() => outboundOrders.id)
      .notNull(),
    coilId: integer('coil_id')
      .references(() => coils.id)
      .notNull(),
    sourceLocationId: integer('source_location_id').references(() => storageLocations.id),
    status: text('status').default('PENDING').notNull(), // PENDING | PICKED | DISPATCHED | CANCELLED
    pickedByUserId: integer('picked_by_user_id').references(() => users.id),
    pickedAt: timestamp('picked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_outbound_items_order').on(table.outboundOrderId),
    index('idx_outbound_items_coil').on(table.coilId),
  ]
);

// ============================================================================
// 21. LOCATION RESERVATIONS (TTL-bound exclusive lock)
// ============================================================================
export const locationReservations = pgTable(
  'location_reservations',
  {
    id: serial('id').primaryKey(),
    locationId: integer('location_id')
      .references(() => storageLocations.id)
      .notNull(),
    coilId: integer('coil_id')
      .references(() => coils.id)
      .notNull(),
    inboundReceiptId: integer('inbound_receipt_id').references(() => inboundReceipts.id),
    reservationType: text('reservation_type').notNull(), // INBOUND | TRANSFER
    status: text('status').default('ACTIVE').notNull(), // ACTIVE | CONSUMED | RELEASED | EXPIRED
    releaseReason: text('release_reason'),
    reservedByUserId: integer('reserved_by_user_id')
      .references(() => users.id)
      .notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    releasedAt: timestamp('released_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    // DB-level guarantee: A reserved location cannot be double-allocated
    uniqueIndex('idx_reservation_one_active_per_location')
      .on(table.locationId)
      .where(sql`${table.status} = 'ACTIVE'`),
    uniqueIndex('idx_reservation_one_active_per_coil')
      .on(table.coilId)
      .where(sql`${table.status} = 'ACTIVE'`),
    index('idx_reservation_expires_at').on(table.expiresAt),
    check(
      'chk_reservation_status',
      sql`${table.status} IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')`
    ),
  ]
);

// ============================================================================
// 22. STOCK TRANSACTIONS (Immutable Ledger — Never directly deleted/edited)
// ============================================================================
export const stockTransactions = pgTable(
  'stock_transactions',
  {
    id: serial('id').primaryKey(),
    transactionNo: text('transaction_no').notNull().unique(),
    transactionType: text('transaction_type').notNull(), // INBOUND | OUTBOUND | TRANSFER | ADJUSTMENT
    coilId: integer('coil_id')
      .references(() => coils.id)
      .notNull(),
    fromLocationId: integer('from_location_id').references(() => storageLocations.id),
    toLocationId: integer('to_location_id').references(() => storageLocations.id),
    referenceType: text('reference_type'), // INBOUND_RECEIPT | OUTBOUND_ORDER | TRANSFER | ADJUSTMENT
    referenceId: integer('reference_id'),
    weightKg: doublePrecision('weight_kg').notNull(),
    status: text('status').default('COMPLETED').notNull(), // COMPLETED
    isImmutable: boolean('is_immutable').default(true).notNull(),
    notes: text('notes'),
    actorUserId: integer('actor_user_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_stock_tx_coil').on(table.coilId),
    index('idx_stock_tx_type').on(table.transactionType),
    index('idx_stock_tx_created_at').on(table.createdAt),
    check(
      'chk_stock_tx_type',
      sql`${table.transactionType} IN ('INBOUND', 'OUTBOUND', 'TRANSFER', 'ADJUSTMENT')`
    ),
  ]
);

// ============================================================================
// 23. AUDIT LOGS
// ============================================================================
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    beforeJson: jsonb('before_json').$type<Record<string, unknown> | null>(),
    afterJson: jsonb('after_json').$type<Record<string, unknown> | null>(),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_logs_entity').on(table.entityType, table.entityId),
    index('idx_audit_logs_created_at').on(table.createdAt),
  ]
);

// ============================================================================
// DRIZZLE RELATIONS
// ============================================================================
export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one }) => ({
  role: one(roles, {
    fields: [users.roleId],
    references: [roles.id],
  }),
}));

export const zonesRelations = relations(zones, ({ many }) => ({
  doors: many(buildingDoors),
  layoutObjects: many(warehouseLayoutObjects),
}));

export const buildingDoorsRelations = relations(buildingDoors, ({ one, many }) => ({
  zone: one(zones, {
    fields: [buildingDoors.zoneId],
    references: [zones.id],
  }),
  rows: many(warehouseRows),
  locations: many(storageLocations),
}));

export const warehouseRowsRelations = relations(warehouseRows, ({ one, many }) => ({
  door: one(buildingDoors, {
    fields: [warehouseRows.doorId],
    references: [buildingDoors.id],
  }),
  levels: many(warehouseLevels),
  locations: many(storageLocations),
}));

export const warehouseLevelsRelations = relations(warehouseLevels, ({ one, many }) => ({
  row: one(warehouseRows, {
    fields: [warehouseLevels.rowId],
    references: [warehouseRows.id],
  }),
  locations: many(storageLocations),
}));

export const storageLocationsRelations = relations(storageLocations, ({ one }) => ({
  door: one(buildingDoors, {
    fields: [storageLocations.doorId],
    references: [buildingDoors.id],
  }),
  row: one(warehouseRows, {
    fields: [storageLocations.rowId],
    references: [warehouseRows.id],
  }),
  level: one(warehouseLevels, {
    fields: [storageLocations.levelId],
    references: [warehouseLevels.id],
  }),
}));
