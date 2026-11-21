import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  auditLogs,
  coils,
  excelColumnMappings,
  excelImportBatches,
  excelImportErrors,
  excelImportStaging,
  inventory,
  locationReservations,
  sapDocumentHeaders,
  sapDocumentItems,
  stockTransactions,
  storageLocations,
  users,
  warehouseLevels,
} from './schema.ts';
import { ensureMasterSeedData } from './seed.ts';
import { writeAuditLog } from './users.ts';
import type { AuditActor } from './warehouse.ts';
import {
  autoMapSapColumns,
  generateErrorReportCsv,
  generateErrorReportXlsx,
  parseSpreadsheetBuffer,
  validateSapImportRows,
  validateUploadedFileSecurity,
  type ExistingCoilLookup,
  type PreSapCoilCandidate,
} from '../utils/sapImportEngine.ts';
import type {
  SapColumnMappingProfile,
  SapDateFormat,
  SapImportBatchStatus,
  SapImportBatchSummary,
  SapImportDashboardResponse,
  SapImportMode,
  SapReferenceCoilRecord,
  SapStagingPreviewRow,
  SapValidationErrorItem,
  SapWorksheetInspectResponse,
} from '../types/sapImport.ts';

export type SapImportEventEmitter = (
  eventName:
    | 'SAP_IMPORT_UPLOADED'
    | 'SAP_IMPORT_VALIDATION_STARTED'
    | 'SAP_IMPORT_VALIDATION_COMPLETED'
    | 'SAP_IMPORT_STARTED'
    | 'SAP_IMPORT_PROGRESS'
    | 'SAP_IMPORT_COMPLETED'
    | 'SAP_IMPORT_FAILED',
  payload: Record<string, unknown>
) => void;

const UPLOAD_ROOT = path.resolve(process.cwd(), '.wms_uploads');

export function getMaxImportFileMb(): number {
  const raw = Number(process.env.SAP_IMPORT_MAX_FILE_MB);
  if (Number.isFinite(raw) && raw >= 1 && raw <= 50) {
    return Math.floor(raw);
  }
  return 15;
}

export function getMaxImportFileBytes(): number {
  return getMaxImportFileMb() * 1024 * 1024;
}

function resolveConfinedUploadPath(storedFileName: string): string {
  const clean = path.basename(storedFileName);
  if (!clean || clean !== storedFileName || clean.includes('..')) {
    throw new Error('SECURITY: Invalid internal upload storage reference.');
  }
  const resolved = path.resolve(UPLOAD_ROOT, clean);
  if (!resolved.startsWith(UPLOAD_ROOT + path.sep)) {
    throw new Error('SECURITY: Upload storage boundary violation.');
  }
  return resolved;
}

async function saveUploadedBufferSecurely(buffer: Buffer, ext: '.xlsx' | '.xls' | '.csv'): Promise<string> {
  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const storedFileName = `${crypto.randomUUID()}${ext}`;
  const fullPath = resolveConfinedUploadPath(storedFileName);
  await fs.writeFile(fullPath, buffer);
  return storedFileName;
}

async function readUploadedBufferSecurely(storedFileName: string): Promise<Buffer> {
  const fullPath = resolveConfinedUploadPath(storedFileName);
  try {
    return await fs.readFile(fullPath);
  } catch {
    throw new Error('NOT_FOUND: ไม่พบไฟล์ต้นฉบับที่อัปโหลดไว้ (อาจถูกยกเลิกหรือล้างไฟล์แล้ว)');
  }
}

async function deleteUploadedFileIfExists(storedFileName: string | null | undefined): Promise<void> {
  if (!storedFileName) return;
  try {
    const fullPath = resolveConfinedUploadPath(storedFileName);
    await fs.unlink(fullPath);
  } catch {
    // Ignore already-removed temp file
  }
}

function generateBatchCode(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SAP-${y}${m}${d}-${rand}`;
}

function sanitizeBatchSummary(
  row: typeof excelImportBatches.$inferSelect,
  actor?: { email: string | null; displayName: string | null }
): SapImportBatchSummary {
  // Explicitly omit storedFileName and any server filesystem references
  return {
    id: row.id,
    batchCode: row.batchCode,
    fileName: row.fileName,
    fileMimeType: row.fileMimeType ?? null,
    fileExtension: row.fileExtension ?? null,
    fileSizeBytes: row.fileSizeBytes,
    sheetName: row.sheetName,
    headerRowIndex: row.headerRowIndex,
    availableSheets: Array.isArray(row.availableSheetsJson) ? row.availableSheetsJson : [],
    appliedMapping: (row.appliedMappingJson ?? {}) as Record<string, string>,
    dateFormat: (row.dateFormat as SapDateFormat) || 'AUTO',
    importMode: (row.importMode as SapImportMode) || 'STRICT',
    mappingId: row.mappingId ?? null,
    status: row.status as SapImportBatchStatus,
    totalRows: row.totalRows,
    validRows: row.validRows,
    warningRows: row.warningRows,
    duplicateRows: row.duplicateRows,
    errorRows: row.errorRows,
    importedRows: row.importedRows,
    skippedRows: row.skippedRows,
    progressPercent: row.progressPercent,
    errorSummary: row.errorSummary ?? null,
    importedByUserId: row.importedByUserId,
    importedByEmail: actor?.email ?? null,
    importedByName: actor?.displayName ?? null,
    confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function formatMappingProfile(row: typeof excelColumnMappings.$inferSelect): SapColumnMappingProfile {
  return {
    id: row.id,
    profileName: row.profileName,
    description: row.description ?? null,
    sheetNameHint: row.sheetNameHint ?? null,
    headerRowIndex: row.headerRowIndex,
    mappingJson: (row.mappingJson ?? {}) as Record<string, string>,
    dateFormat: (row.dateFormat as SapDateFormat) || 'AUTO',
    decimalSeparator: row.decimalSeparator || '.',
    leadingZeroRulesJson: (row.leadingZeroRulesJson ?? {}) as Record<string, number>,
    isActive: row.isActive,
    isDefault: row.isDefault,
    createdByUserId: row.createdByUserId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ============================================================================
// INVENTORY SAFETY SNAPSHOT (PROVES PHASE 4 NEVER MUTATES LIVE WAREHOUSE STOCK)
// ============================================================================
export async function getInventorySafetySnapshot() {
  const [activeInv] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventory)
    .where(inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD']));

  const [occupiedLocs] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(storageLocations)
    .where(eq(storageLocations.status, 'OCCUPIED'));

  const [activeRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(locationReservations)
    .where(eq(locationReservations.status, 'ACTIVE'));

  const [stockTx] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockTransactions);

  return {
    activeInventoryCount: activeInv?.count ?? 0,
    occupiedLocationCount: occupiedLocs?.count ?? 0,
    activeReservationCount: activeRes?.count ?? 0,
    stockTransactionCount: stockTx?.count ?? 0,
  };
}

// ============================================================================
// 1. IMPORT DASHBOARD & HISTORY
// ============================================================================
export async function getSapImportDashboard(params: {
  search?: string;
  status?: string;
  importedBy?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  pageSize?: number;
}): Promise<SapImportDashboardResponse> {
  await ensureMasterSeedData();

  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
  const offset = (page - 1) * pageSize;

  // Global KPI queries
  const statusAgg = await db
    .select({
      status: excelImportBatches.status,
      warningCount: sql<number>`count(*) FILTER (WHERE ${excelImportBatches.warningRows} > 0)::int`,
      count: sql<number>`count(*)::int`,
    })
    .from(excelImportBatches)
    .groupBy(excelImportBatches.status);

  let totalImportFiles = 0;
  let successfulImports = 0;
  let importsWithWarnings = 0;
  let failedImports = 0;

  for (const row of statusAgg) {
    totalImportFiles += row.count;
    if (row.status === 'COMPLETED') {
      successfulImports += row.count;
      importsWithWarnings += row.warningCount;
    } else if (row.status === 'COMPLETED_WITH_ERRORS') {
      successfulImports += row.count;
      importsWithWarnings += row.count;
    } else if (row.status === 'FAILED') {
      failedImports += row.count;
    }
  }

  const [sapCoilsTotal] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coils)
    .where(inArray(coils.sourceType, ['SAP_EXCEL_IMPORT', 'PRE_SAP_RECONCILED']));

  const [pendingInbound] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coils)
    .where(eq(coils.lifecycleStatus, 'PENDING_INBOUND'));

  // Filtered list query
  const conditions = [];
  if (params.status && params.status !== 'ALL') {
    conditions.push(eq(excelImportBatches.status, params.status));
  }
  if (params.search && params.search.trim()) {
    const term = `%${params.search.trim()}%`;
    conditions.push(
      or(ilike(excelImportBatches.fileName, term), ilike(excelImportBatches.batchCode, term))
    );
  }
  if (params.importedBy && params.importedBy.trim()) {
    const term = `%${params.importedBy.trim()}%`;
    conditions.push(or(ilike(users.email, term), ilike(users.displayName, term)));
  }
  if (params.dateFrom) {
    const dt = new Date(params.dateFrom);
    if (!Number.isNaN(dt.getTime())) {
      conditions.push(gte(excelImportBatches.createdAt, dt));
    }
  }
  if (params.dateTo) {
    const dt = new Date(params.dateTo);
    if (!Number.isNaN(dt.getTime())) {
      dt.setHours(23, 59, 59, 999);
      conditions.push(lte(excelImportBatches.createdAt, dt));
    }
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(excelImportBatches)
    .leftJoin(users, eq(excelImportBatches.importedByUserId, users.id))
    .where(whereClause);

  const rows = await db
    .select({
      batch: excelImportBatches,
      actorEmail: users.email,
      actorName: users.displayName,
    })
    .from(excelImportBatches)
    .leftJoin(users, eq(excelImportBatches.importedByUserId, users.id))
    .where(whereClause)
    .orderBy(desc(excelImportBatches.createdAt))
    .limit(pageSize)
    .offset(offset);

  const total = totalResult?.count ?? 0;
  const safetySnapshot = await getInventorySafetySnapshot();

  return {
    kpis: {
      totalImportFiles,
      successfulImports,
      importsWithWarnings,
      failedImports,
      totalSapReferenceCoils: sapCoilsTotal?.count ?? 0,
      pendingInboundCoils: pendingInbound?.count ?? 0,
    },
    batches: rows.map((r) =>
      sanitizeBatchSummary(r.batch, { email: r.actorEmail, displayName: r.actorName })
    ),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    safetySnapshot,
    maxFileSizeMb: getMaxImportFileMb(),
  };
}

// ============================================================================
// 2. UPLOAD & INITIAL WORKBOOK INSPECTION
// ============================================================================
export async function createUploadBatch(
  params: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
  },
  actor: AuditActor,
  emitEvent?: SapImportEventEmitter
): Promise<SapWorksheetInspectResponse> {
  await ensureMasterSeedData();

  const maxBytes = getMaxImportFileBytes();
  const sec = validateUploadedFileSecurity({
    buffer: params.buffer,
    originalName: params.originalName,
    mimeType: params.mimeType,
    maxBytes,
  });

  if (!sec.valid || !sec.extension) {
    throw new Error(`VALIDATION: ${sec.errorMessage ?? 'ไฟล์ไม่ผ่านการตรวจสอบความปลอดภัย'}`);
  }

  // Parse workbook immediately in memory before writing to disk
  const parsed = parseSpreadsheetBuffer(params.buffer, sec.extension);
  const fileSha256 = crypto.createHash('sha256').update(params.buffer).digest('hex');
  const storedFileName = await saveUploadedBufferSecurely(params.buffer, sec.extension);

  // Pick default active mapping template if any
  const defaultMappings = await db
    .select()
    .from(excelColumnMappings)
    .where(and(eq(excelColumnMappings.isActive, true), eq(excelColumnMappings.isDefault, true)))
    .orderBy(desc(excelColumnMappings.id))
    .limit(1);

  const defaultTemplate = defaultMappings[0] ?? null;
  const suggestedMapping = autoMapSapColumns(parsed.headers, defaultTemplate?.mappingJson ?? null);
  const batchCode = generateBatchCode();

  const [inserted] = await db
    .insert(excelImportBatches)
    .values({
      batchCode,
      fileName: path.basename(params.originalName).slice(0, 255),
      storedFileName,
      fileMimeType: params.mimeType || null,
      fileExtension: sec.extension,
      fileSha256,
      sheetName: parsed.selectedSheet,
      headerRowIndex: parsed.headerRowIndex,
      availableSheetsJson: parsed.worksheets,
      appliedMappingJson: suggestedMapping,
      dateFormat: (defaultTemplate?.dateFormat as SapDateFormat) || 'AUTO',
      importMode: 'STRICT',
      fileSizeBytes: params.buffer.length,
      mappingId: defaultTemplate?.id ?? null,
      status: 'UPLOADED',
      totalRows: parsed.dataRows.length,
      importedByUserId: actor.userId,
    })
    .returning();

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'FILE_UPLOADED',
    entityType: 'excel_import_batches',
    entityId: inserted.batchCode,
    afterJson: {
      batchId: inserted.id,
      batchCode: inserted.batchCode,
      fileName: inserted.fileName,
      fileExtension: inserted.fileExtension,
      fileSizeBytes: inserted.fileSizeBytes,
      sheetName: inserted.sheetName,
      headerRowIndex: inserted.headerRowIndex,
      totalRowsDetected: parsed.dataRows.length,
    },
    ipAddress: actor.ip ?? null,
  });

  emitEvent?.('SAP_IMPORT_UPLOADED', {
    batchId: inserted.id,
    batchCode: inserted.batchCode,
    fileName: inserted.fileName,
    totalRows: parsed.dataRows.length,
  });

  return {
    batch: sanitizeBatchSummary(inserted, { email: actor.email, displayName: null }),
    worksheets: parsed.worksheets,
    selectedSheet: parsed.selectedSheet,
    headerRowIndex: parsed.headerRowIndex,
    headers: parsed.headers,
    rawPreviewRows: parsed.rawPreviewRows,
    sampleByColumn: parsed.sampleByColumn,
    suggestedMapping,
    detectedLeadingZeroWarnings: parsed.detectedLeadingZeroWarnings,
  };
}

// ============================================================================
// 3. INSPECT & SELECT WORKSHEET / HEADER ROW
// ============================================================================
async function loadBatchRowOrThrow(batchId: number) {
  const rows = await db
    .select({
      batch: excelImportBatches,
      actorEmail: users.email,
      actorName: users.displayName,
    })
    .from(excelImportBatches)
    .leftJoin(users, eq(excelImportBatches.importedByUserId, users.id))
    .where(eq(excelImportBatches.id, batchId))
    .limit(1);

  if (rows.length === 0) {
    throw new Error('NOT_FOUND: ไม่พบ Import Batch ที่ระบุ');
  }
  return rows[0];
}

export async function getBatchSummaryById(batchId: number): Promise<SapImportBatchSummary> {
  const row = await loadBatchRowOrThrow(batchId);
  return sanitizeBatchSummary(row.batch, { email: row.actorEmail, displayName: row.actorName });
}

export async function inspectBatchWorksheet(
  batchId: number,
  options?: { sheetName?: string; headerRowIndex?: number; mappingId?: number }
): Promise<SapWorksheetInspectResponse> {
  const { batch, actorEmail, actorName } = await loadBatchRowOrThrow(batchId);
  if (!batch.storedFileName || !batch.fileExtension) {
    throw new Error('NOT_FOUND: ไฟล์ต้นฉบับของ Batch นี้ไม่อยู่ในพื้นที่จัดเก็บชั่วคราวแล้ว');
  }

  const buffer = await readUploadedBufferSecurely(batch.storedFileName);
  const parsed = parseSpreadsheetBuffer(
    buffer,
    batch.fileExtension as '.xlsx' | '.xls' | '.csv',
    options?.sheetName ?? batch.sheetName,
    options?.headerRowIndex ?? batch.headerRowIndex
  );

  let templateMapping: Record<string, string> | null = batch.appliedMappingJson ?? null;
  if (options?.mappingId) {
    const [tpl] = await db
      .select()
      .from(excelColumnMappings)
      .where(eq(excelColumnMappings.id, options.mappingId))
      .limit(1);
    if (tpl) {
      templateMapping = tpl.mappingJson as Record<string, string>;
    }
  }

  const suggestedMapping = autoMapSapColumns(parsed.headers, templateMapping);

  return {
    batch: sanitizeBatchSummary(batch, { email: actorEmail, displayName: actorName }),
    worksheets: parsed.worksheets,
    selectedSheet: parsed.selectedSheet,
    headerRowIndex: parsed.headerRowIndex,
    headers: parsed.headers,
    rawPreviewRows: parsed.rawPreviewRows,
    sampleByColumn: parsed.sampleByColumn,
    suggestedMapping,
    detectedLeadingZeroWarnings: parsed.detectedLeadingZeroWarnings,
  };
}

export async function selectBatchWorksheet(
  batchId: number,
  params: { sheetName: string; headerRowIndex: number },
  actor: AuditActor
): Promise<SapWorksheetInspectResponse> {
  const { batch, actorEmail, actorName } = await loadBatchRowOrThrow(batchId);
  if (['COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELLED', 'IMPORTING'].includes(batch.status)) {
    throw new Error('VALIDATION: ไม่สามารถเปลี่ยน Worksheet ของ Batch ที่ดำเนินการเสร็จสิ้นหรือยกเลิกแล้ว');
  }
  if (!batch.storedFileName || !batch.fileExtension) {
    throw new Error('NOT_FOUND: ไม่พบไฟล์ต้นฉบับสำหรับอัปเดต Worksheet');
  }

  const buffer = await readUploadedBufferSecurely(batch.storedFileName);
  const parsed = parseSpreadsheetBuffer(
    buffer,
    batch.fileExtension as '.xlsx' | '.xls' | '.csv',
    params.sheetName,
    params.headerRowIndex
  );

  const defaultMappings = await db
    .select()
    .from(excelColumnMappings)
    .where(and(eq(excelColumnMappings.isActive, true), eq(excelColumnMappings.isDefault, true)))
    .limit(1);
  const suggestedMapping = autoMapSapColumns(
    parsed.headers,
    (defaultMappings[0]?.mappingJson as Record<string, string> | undefined) ?? null
  );

  const [updated] = await db
    .update(excelImportBatches)
    .set({
      sheetName: parsed.selectedSheet,
      headerRowIndex: parsed.headerRowIndex,
      availableSheetsJson: parsed.worksheets,
      appliedMappingJson: suggestedMapping,
      totalRows: parsed.dataRows.length,
      status: 'UPLOADED',
      updatedAt: new Date(),
    })
    .where(eq(excelImportBatches.id, batchId))
    .returning();

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'WORKSHEET_SELECTED',
    entityType: 'excel_import_batches',
    entityId: updated.batchCode,
    beforeJson: { sheetName: batch.sheetName, headerRowIndex: batch.headerRowIndex },
    afterJson: {
      sheetName: updated.sheetName,
      headerRowIndex: updated.headerRowIndex,
      totalRowsDetected: parsed.dataRows.length,
    },
    ipAddress: actor.ip ?? null,
  });

  return {
    batch: sanitizeBatchSummary(updated, { email: actorEmail, displayName: actorName }),
    worksheets: parsed.worksheets,
    selectedSheet: parsed.selectedSheet,
    headerRowIndex: parsed.headerRowIndex,
    headers: parsed.headers,
    rawPreviewRows: parsed.rawPreviewRows,
    sampleByColumn: parsed.sampleByColumn,
    suggestedMapping,
    detectedLeadingZeroWarnings: parsed.detectedLeadingZeroWarnings,
  };
}

// ============================================================================
// 4. COLUMN MAPPING TEMPLATES CRUD (ADMIN WRITE, ADMIN+SUPERVISOR READ)
// ============================================================================
export async function listMappingTemplates(): Promise<SapColumnMappingProfile[]> {
  await ensureMasterSeedData();
  const rows = await db
    .select()
    .from(excelColumnMappings)
    .orderBy(desc(excelColumnMappings.isDefault), desc(excelColumnMappings.isActive), asc(excelColumnMappings.id));
  return rows.map(formatMappingProfile);
}

export async function createMappingTemplate(
  params: {
    profileName: string;
    description?: string | null;
    sheetNameHint?: string | null;
    headerRowIndex?: number;
    mappingJson: Record<string, string>;
    dateFormat?: SapDateFormat;
    decimalSeparator?: '.' | ',';
    leadingZeroRulesJson?: Record<string, number>;
    isActive?: boolean;
    isDefault?: boolean;
  },
  actor: AuditActor
): Promise<SapColumnMappingProfile> {
  const created = await db.transaction(async (tx) => {
    if (params.isDefault) {
      await tx.update(excelColumnMappings).set({ isDefault: false, updatedAt: new Date() });
    }
    const [row] = await tx
      .insert(excelColumnMappings)
      .values({
        profileName: params.profileName.trim(),
        description: params.description?.trim() || null,
        sheetNameHint: params.sheetNameHint?.trim() || null,
        headerRowIndex: params.headerRowIndex ?? 1,
        mappingJson: params.mappingJson,
        dateFormat: params.dateFormat ?? 'AUTO',
        decimalSeparator: params.decimalSeparator ?? '.',
        leadingZeroRulesJson: params.leadingZeroRulesJson ?? {},
        isActive: params.isActive ?? true,
        isDefault: params.isDefault ?? false,
        createdByUserId: actor.userId,
      })
      .returning();
    return row;
  });

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'MAPPING_CREATED',
    entityType: 'excel_column_mappings',
    entityId: created.id,
    afterJson: {
      profileName: created.profileName,
      isDefault: created.isDefault,
      fieldCount: Object.keys(created.mappingJson || {}).length,
    },
    ipAddress: actor.ip ?? null,
  });

  return formatMappingProfile(created);
}

export async function updateMappingTemplate(
  id: number,
  params: {
    profileName?: string;
    description?: string | null;
    sheetNameHint?: string | null;
    headerRowIndex?: number;
    mappingJson?: Record<string, string>;
    dateFormat?: SapDateFormat;
    decimalSeparator?: '.' | ',';
    leadingZeroRulesJson?: Record<string, number>;
    isActive?: boolean;
    isDefault?: boolean;
  },
  actor: AuditActor
): Promise<SapColumnMappingProfile> {
  const [existing] = await db
    .select()
    .from(excelColumnMappings)
    .where(eq(excelColumnMappings.id, id))
    .limit(1);

  if (!existing) {
    throw new Error('NOT_FOUND: ไม่พบ Mapping Template ที่ระบุ');
  }

  const updated = await db.transaction(async (tx) => {
    if (params.isDefault) {
      await tx.update(excelColumnMappings).set({ isDefault: false, updatedAt: new Date() });
    }
    const [row] = await tx
      .update(excelColumnMappings)
      .set({
        profileName: params.profileName !== undefined ? params.profileName.trim() : existing.profileName,
        description: params.description !== undefined ? params.description : existing.description,
        sheetNameHint: params.sheetNameHint !== undefined ? params.sheetNameHint : existing.sheetNameHint,
        headerRowIndex: params.headerRowIndex ?? existing.headerRowIndex,
        mappingJson: params.mappingJson ?? existing.mappingJson,
        dateFormat: params.dateFormat ?? existing.dateFormat,
        decimalSeparator: params.decimalSeparator ?? existing.decimalSeparator,
        leadingZeroRulesJson: params.leadingZeroRulesJson ?? existing.leadingZeroRulesJson,
        isActive: params.isActive ?? existing.isActive,
        isDefault: params.isDefault ?? existing.isDefault,
        updatedAt: new Date(),
      })
      .where(eq(excelColumnMappings.id, id))
      .returning();
    return row;
  });

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'MAPPING_UPDATED',
    entityType: 'excel_column_mappings',
    entityId: updated.id,
    beforeJson: { profileName: existing.profileName, isDefault: existing.isDefault, isActive: existing.isActive },
    afterJson: { profileName: updated.profileName, isDefault: updated.isDefault, isActive: updated.isActive },
    ipAddress: actor.ip ?? null,
  });

  return formatMappingProfile(updated);
}

export async function deleteMappingTemplate(id: number, actor: AuditActor): Promise<void> {
  const [existing] = await db
    .select()
    .from(excelColumnMappings)
    .where(eq(excelColumnMappings.id, id))
    .limit(1);

  if (!existing) {
    throw new Error('NOT_FOUND: ไม่พบ Mapping Template ที่ระบุ');
  }

  // Nullify references in historical batches before deleting template
  await db.transaction(async (tx) => {
    await tx
      .update(excelImportBatches)
      .set({ mappingId: null })
      .where(eq(excelImportBatches.mappingId, id));
    await tx.delete(excelColumnMappings).where(eq(excelColumnMappings.id, id));
  });

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'MAPPING_DELETED',
    entityType: 'excel_column_mappings',
    entityId: id,
    beforeJson: { profileName: existing.profileName },
    ipAddress: actor.ip ?? null,
  });
}

// ============================================================================
// 5. VALIDATE IMPORT BATCH & WRITE STAGING + ERRORS TO POSTGRESQL
// ============================================================================
async function loadExistingCoilLookupMap(coilIds: string[]): Promise<Map<string, ExistingCoilLookup>> {
  const map = new Map<string, ExistingCoilLookup>();
  const uniqueIds = Array.from(new Set(coilIds.filter(Boolean)));
  if (uniqueIds.length === 0) return map;

  const CHUNK = 500;
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const slice = uniqueIds.slice(i, i + CHUNK);
    const dbCoils = await db
      .select({
        id: coils.id,
        coilId: coils.coilId,
        batchNo: coils.batchNo,
        materialCode: coils.materialCode,
        weightKg: coils.weightKg,
        widthMm: coils.widthMm,
        thicknessMm: coils.thicknessMm,
        lifecycleStatus: coils.lifecycleStatus,
      })
      .from(coils)
      .where(inArray(coils.coilId, slice));

    if (dbCoils.length === 0) continue;

    const coilDbIds = dbCoils.map((c) => c.id);
    const activeInvRows = await db
      .select({
        coilDbId: inventory.coilId,
        locationCode: storageLocations.locationCode,
      })
      .from(inventory)
      .leftJoin(storageLocations, eq(inventory.currentLocationId, storageLocations.id))
      .where(
        and(
          inArray(inventory.coilId, coilDbIds),
          inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
        )
      );

    const activeInvByCoilDbId = new Map<number, string | null>();
    for (const inv of activeInvRows) {
      activeInvByCoilDbId.set(inv.coilDbId, inv.locationCode ?? null);
    }

    for (const c of dbCoils) {
      const hasActiveInventory = activeInvByCoilDbId.has(c.id);
      map.set(c.coilId, {
        coilId: c.coilId,
        batchNo: c.batchNo,
        materialCode: c.materialCode,
        weightKg: c.weightKg,
        widthMm: c.widthMm,
        thicknessMm: c.thicknessMm,
        lifecycleStatus: c.lifecycleStatus,
        hasActiveInventory,
        currentLocationCode: activeInvByCoilDbId.get(c.id) ?? null,
      });
    }
  }

  return map;
}

/**
 * Loads provisional Pre-SAP coils (sourceType = 'PRE_SAP_INBOUND') grouped by UPPER(batchNo)
 * in FIFO order so SAP Excel validation & confirmation can auto-reconcile them in-place.
 */
async function loadPreSapCoilCandidatesByBatch(
  batchNos: string[]
): Promise<Map<string, PreSapCoilCandidate[]>> {
  const map = new Map<string, PreSapCoilCandidate[]>();
  const uniqueUpper = Array.from(
    new Set(batchNos.map((b) => b.trim().toUpperCase()).filter(Boolean))
  );
  if (uniqueUpper.length === 0) return map;

  const preSapRows = await db
    .select({
      coilDbId: coils.id,
      provisionalCoilId: coils.coilId,
      batchNo: coils.batchNo,
      locationId: storageLocations.id,
      locationCode: storageLocations.locationCode,
      rowId: storageLocations.rowId,
      levelNumber: warehouseLevels.levelNumber,
      slotNumber: storageLocations.slotNumber,
      locationMaxWeightKg: storageLocations.maxWeightKg,
      levelMaxWeightKg: warehouseLevels.maxWeightKg,
    })
    .from(coils)
    .leftJoin(
      inventory,
      and(
        eq(inventory.coilId, coils.id),
        inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
      )
    )
    .leftJoin(storageLocations, eq(inventory.currentLocationId, storageLocations.id))
    .leftJoin(warehouseLevels, eq(storageLocations.levelId, warehouseLevels.id))
    .where(
      and(
        eq(coils.sourceType, 'PRE_SAP_INBOUND'),
        inArray(sql`UPPER(${coils.batchNo})`, uniqueUpper)
      )
    )
    .orderBy(asc(coils.createdAt), asc(coils.id));

  if (preSapRows.length === 0) return map;

  // For any Pre-SAP coils stacked on Level 2+, load lower-level support coil weights in the same row
  const upperRowIds = Array.from(
    new Set(
      preSapRows
        .filter((r) => r.rowId !== null && (r.levelNumber ?? 1) >= 2)
        .map((r) => r.rowId as number)
    )
  );

  const supportWeightByKey = new Map<string, number>();
  if (upperRowIds.length > 0) {
    const supportRows = await db
      .select({
        rowId: storageLocations.rowId,
        levelNumber: warehouseLevels.levelNumber,
        slotNumber: storageLocations.slotNumber,
        weightKg: coils.weightKg,
        grossWeightKg: coils.grossWeightKg,
        netWeightKg: coils.netWeightKg,
      })
      .from(inventory)
      .innerJoin(coils, eq(inventory.coilId, coils.id))
      .innerJoin(storageLocations, eq(inventory.currentLocationId, storageLocations.id))
      .innerJoin(warehouseLevels, eq(storageLocations.levelId, warehouseLevels.id))
      .where(
        and(
          inArray(storageLocations.rowId, upperRowIds),
          inArray(inventory.status, ['IN_STOCK', 'RESERVED_OUTBOUND', 'HOLD'])
        )
      );

    for (const sr of supportRows) {
      const eff = sr.weightKg ?? sr.netWeightKg ?? sr.grossWeightKg;
      if (eff !== null && eff > 0) {
        supportWeightByKey.set(`${sr.rowId}:${sr.levelNumber}:${sr.slotNumber}`, eff);
      }
    }
  }

  for (const r of preSapRows) {
    let lowerLeftWeightKg: number | null = null;
    let lowerRightWeightKg: number | null = null;
    if (r.rowId !== null && r.levelNumber !== null && r.levelNumber >= 2 && r.slotNumber !== null) {
      const leftW = supportWeightByKey.get(`${r.rowId}:${r.levelNumber - 1}:${r.slotNumber}`);
      const rightW = supportWeightByKey.get(`${r.rowId}:${r.levelNumber - 1}:${r.slotNumber + 1}`);
      lowerLeftWeightKg = typeof leftW === 'number' && leftW > 0 ? leftW : null;
      lowerRightWeightKg = typeof rightW === 'number' && rightW > 0 ? rightW : null;
    }

    const key = r.batchNo.trim().toUpperCase();
    const list = map.get(key) ?? [];
    list.push({
      coilDbId: r.coilDbId,
      provisionalCoilId: r.provisionalCoilId,
      batchNo: r.batchNo,
      currentLocationCode: r.locationCode ?? null,
      locationMaxWeightKg: r.locationMaxWeightKg ?? null,
      levelMaxWeightKg: r.levelMaxWeightKg ?? null,
      levelNumber: r.levelNumber ?? null,
      slotNumber: r.slotNumber ?? null,
      lowerLeftWeightKg,
      lowerRightWeightKg,
    });
    map.set(key, list);
  }

  return map;
}

export async function validateImportBatch(
  batchId: number,
  params: {
    mapping: Record<string, string>;
    mappingId?: number | null;
    dateFormat: SapDateFormat;
    decimalSeparator?: '.' | ',';
  },
  actor: AuditActor,
  emitEvent?: SapImportEventEmitter
): Promise<{
  batch: SapImportBatchSummary;
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    errorRows: number;
    duplicateRows: number;
    newRecords: number;
    reconcileRecords: number;
  };
}> {
  const { batch, actorEmail, actorName } = await loadBatchRowOrThrow(batchId);
  if (['COMPLETED', 'COMPLETED_WITH_ERRORS', 'CANCELLED', 'IMPORTING'].includes(batch.status)) {
    throw new Error('VALIDATION: ไม่สามารถ Validate Batch ที่นำเข้าเสร็จสิ้นหรือยกเลิกแล้ว');
  }
  if (!batch.storedFileName || !batch.fileExtension) {
    throw new Error('NOT_FOUND: ไม่พบไฟล์ต้นฉบับสำหรับการตรวจสอบข้อมูล');
  }

  if (!params.mapping.coil_id || !params.mapping.batch_number) {
    throw new Error(
      'VALIDATION: กรุณาจับคู่คอลัมน์บังคับอย่างน้อย หมายเลขคอยล์ (coil_id) และ เลขที่ Batch (batch_number) ก่อนตรวจสอบ'
    );
  }

  await db
    .update(excelImportBatches)
    .set({ status: 'VALIDATING', updatedAt: new Date() })
    .where(eq(excelImportBatches.id, batchId));

  emitEvent?.('SAP_IMPORT_VALIDATION_STARTED', {
    batchId: batch.id,
    batchCode: batch.batchCode,
  });

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'VALIDATION_STARTED',
    entityType: 'excel_import_batches',
    entityId: batch.batchCode,
    afterJson: {
      dateFormat: params.dateFormat,
      mappedFields: Object.keys(params.mapping),
    },
    ipAddress: actor.ip ?? null,
  });

  const buffer = await readUploadedBufferSecurely(batch.storedFileName);
  const parsed = parseSpreadsheetBuffer(
    buffer,
    batch.fileExtension as '.xlsx' | '.xls' | '.csv',
    batch.sheetName,
    batch.headerRowIndex
  );

  // Extract all candidate Coil IDs and Batch Numbers to check against PostgreSQL
  const coilCol = params.mapping.coil_id;
  const batchCol = params.mapping.batch_number;
  const candidateCoilIds = parsed.dataRows
    .map((r) => (r.rawByHeader[coilCol] ?? '').trim())
    .filter(Boolean);
  const candidateBatchNos = parsed.dataRows
    .map((r) => (r.rawByHeader[batchCol] ?? '').trim())
    .filter(Boolean);

  const [existingMap, preSapByBatch] = await Promise.all([
    loadExistingCoilLookupMap(candidateCoilIds),
    loadPreSapCoilCandidatesByBatch(candidateBatchNos),
  ]);

  const validation = validateSapImportRows({
    dataRows: parsed.dataRows,
    mapping: params.mapping,
    dateFormat: params.dateFormat,
    decimalSeparator: params.decimalSeparator ?? '.',
    existingCoilsByCoilId: existingMap,
    preSapCoilsByBatchNo: preSapByBatch,
  });

  const nextStatus: SapImportBatchStatus =
    validation.summary.totalRows === 0 ? 'FAILED' : 'READY_TO_IMPORT';
  const errorSummary =
    validation.summary.totalRows === 0
      ? 'ไม่พบแถวข้อมูลใต้ Header Row ที่เลือก'
      : validation.summary.errorRows > 0
        ? `พบข้อผิดพลาด ${validation.summary.errorRows} แถว จากทั้งหมด ${validation.summary.totalRows} แถว`
        : null;

  const updatedBatch = await db.transaction(async (tx) => {
    await tx.delete(excelImportErrors).where(eq(excelImportErrors.importBatchId, batchId));
    await tx.delete(excelImportStaging).where(eq(excelImportStaging.importBatchId, batchId));

    const STAGING_CHUNK = 200;
    for (let i = 0; i < validation.rows.length; i += STAGING_CHUNK) {
      const slice = validation.rows.slice(i, i + STAGING_CHUNK);
      await tx.insert(excelImportStaging).values(
        slice.map((r) => ({
          importBatchId: batchId,
          rowIndex: r.rowIndex,
          rawRowJson: r.rawRowJson,
          mappedDataJson: r.mappedDataJson,
          existingSnapshotJson: r.existingSnapshotJson,
          validationIssuesJson: r.validationIssues,
          coilIdText: r.coilIdText,
          batchNoText: r.batchNoText,
          materialCodeText: r.materialCodeText,
          materialDescription: r.materialDescription,
          plantText: r.plantText,
          sapStorageLocationText: r.sapStorageLocationText,
          materialDocumentText: r.materialDocumentText,
          fiscalYearText: r.fiscalYearText,
          documentItemText: r.documentItemText,
          deliveryNumberText: r.deliveryNumberText,
          purchaseOrderText: r.purchaseOrderText,
          vendorCodeText: r.vendorCodeText,
          vendorNameText: r.vendorNameText,
          weightKg: r.weightKg,
          grossWeightKg: r.grossWeightKg,
          netWeightKg: r.netWeightKg,
          thicknessMm: r.thicknessMm,
          targetThicknessMm: r.targetThicknessMm,
          widthMm: r.widthMm,
          outerDiameterMm: r.outerDiameterMm,
          innerDiameterMm: r.innerDiameterMm,
          gradeText: r.gradeText,
          skinpassText: r.skinpassText,
          heatNoText: r.heatNoText,
          unitOfMeasureText: r.unitOfMeasureText,
          postingDateText: r.postingDateText,
          documentDateText: r.documentDateText,
          referenceText: r.referenceText,
          scannedLocationRefText: r.scannedLocationRefText,
          validationStatus: r.validationStatus,
          duplicateType: r.duplicateType,
          importResultStatus: 'PENDING',
          validationMessage: r.validationMessage,
        }))
      );
    }

    const flatErrors: Array<typeof excelImportErrors.$inferInsert> = [];
    for (const r of validation.rows) {
      for (const issue of r.validationIssues) {
        flatErrors.push({
          importBatchId: batchId,
          rowIndex: r.rowIndex,
          coilIdText: r.coilIdText,
          batchNoText: r.batchNoText,
          columnName: issue.columnName,
          targetField: issue.targetField,
          rawValue: issue.rawValue,
          errorCode: issue.errorCode,
          errorMessage: issue.message,
          severity: issue.severity,
          suggestedResolution: issue.suggestedResolution,
        });
      }
    }

    const ERR_CHUNK = 250;
    for (let i = 0; i < flatErrors.length; i += ERR_CHUNK) {
      await tx.insert(excelImportErrors).values(flatErrors.slice(i, i + ERR_CHUNK));
    }

    const [b] = await tx
      .update(excelImportBatches)
      .set({
        appliedMappingJson: params.mapping,
        mappingId: params.mappingId ?? null,
        dateFormat: params.dateFormat,
        status: nextStatus,
        totalRows: validation.summary.totalRows,
        validRows: validation.summary.validRows,
        warningRows: validation.summary.warningRows,
        duplicateRows: validation.summary.duplicateRows,
        errorRows: validation.summary.errorRows,
        importedRows: 0,
        skippedRows: 0,
        progressPercent: 0,
        errorSummary,
        updatedAt: new Date(),
      })
      .where(eq(excelImportBatches.id, batchId))
      .returning();

    return b;
  });

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'VALIDATION_COMPLETED',
    entityType: 'excel_import_batches',
    entityId: updatedBatch.batchCode,
    afterJson: {
      status: updatedBatch.status,
      ...validation.summary,
    },
    ipAddress: actor.ip ?? null,
  });

  emitEvent?.('SAP_IMPORT_VALIDATION_COMPLETED', {
    batchId: updatedBatch.id,
    batchCode: updatedBatch.batchCode,
    status: updatedBatch.status,
    summary: validation.summary,
  });

  return {
    batch: sanitizeBatchSummary(updatedBatch, { email: actorEmail, displayName: actorName }),
    summary: validation.summary,
  };
}

// ============================================================================
// 6. PREVIEW ROWS & VALIDATION ERRORS & ERROR REPORT EXPORT
// ============================================================================
export async function getBatchPreview(
  batchId: number,
  params: {
    search?: string;
    validationStatus?: string;
    duplicateType?: string;
    importResultStatus?: string;
    page?: number;
    pageSize?: number;
  }
): Promise<{
  batch: SapImportBatchSummary;
  rows: SapStagingPreviewRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  const { batch, actorEmail, actorName } = await loadBatchRowOrThrow(batchId);
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const conditions = [eq(excelImportStaging.importBatchId, batchId)];
  if (params.validationStatus && params.validationStatus !== 'ALL') {
    conditions.push(eq(excelImportStaging.validationStatus, params.validationStatus));
  }
  if (params.duplicateType && params.duplicateType !== 'ALL') {
    conditions.push(eq(excelImportStaging.duplicateType, params.duplicateType));
  }
  if (params.importResultStatus && params.importResultStatus !== 'ALL') {
    conditions.push(eq(excelImportStaging.importResultStatus, params.importResultStatus));
  }
  if (params.search && params.search.trim()) {
    const term = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(excelImportStaging.coilIdText, term),
        ilike(excelImportStaging.batchNoText, term),
        ilike(excelImportStaging.materialCodeText, term),
        ilike(excelImportStaging.materialDescription, term),
        ilike(excelImportStaging.gradeText, term),
        ilike(excelImportStaging.heatNoText, term),
        ilike(excelImportStaging.referenceText, term)
      )!
    );
  }

  const whereClause = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(excelImportStaging)
    .where(whereClause);

  const stagingRows = await db
    .select()
    .from(excelImportStaging)
    .where(whereClause)
    .orderBy(asc(excelImportStaging.rowIndex))
    .limit(pageSize)
    .offset(offset);

  const total = countRow?.count ?? 0;

  return {
    batch: sanitizeBatchSummary(batch, { email: actorEmail, displayName: actorName }),
    rows: stagingRows.map((r) => ({
      id: r.id,
      rowIndex: r.rowIndex,
      coilIdText: r.coilIdText,
      batchNoText: r.batchNoText,
      materialCodeText: r.materialCodeText,
      materialDescription: r.materialDescription,
      plantText: r.plantText,
      sapStorageLocationText: r.sapStorageLocationText,
      weightKg: r.weightKg,
      grossWeightKg: r.grossWeightKg,
      netWeightKg: r.netWeightKg,
      thicknessMm: r.thicknessMm,
      targetThicknessMm: r.targetThicknessMm,
      widthMm: r.widthMm,
      outerDiameterMm: r.outerDiameterMm,
      innerDiameterMm: r.innerDiameterMm,
      gradeText: r.gradeText,
      vendorCodeText: r.vendorCodeText,
      skinpassText: r.skinpassText,
      heatNoText: r.heatNoText,
      unitOfMeasureText: r.unitOfMeasureText,
      postingDateText: r.postingDateText,
      documentDateText: r.documentDateText,
      referenceText: r.referenceText,
      scannedLocationRefText: r.scannedLocationRefText,
      validationStatus: r.validationStatus as SapStagingPreviewRow['validationStatus'],
      duplicateType: r.duplicateType as SapStagingPreviewRow['duplicateType'],
      importResultStatus: r.importResultStatus as SapStagingPreviewRow['importResultStatus'],
      validationMessage: r.validationMessage,
      rawRowJson: (r.rawRowJson ?? {}) as Record<string, string>,
      mappedDataJson: (r.mappedDataJson ?? {}) as Record<string, string | number | null>,
      existingSnapshotJson: (r.existingSnapshotJson ?? null) as Record<string, unknown> | null,
      validationIssuesJson: Array.isArray(r.validationIssuesJson) ? r.validationIssuesJson : [],
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}

export async function getBatchErrors(
  batchId: number,
  severity?: string
): Promise<SapValidationErrorItem[]> {
  await loadBatchRowOrThrow(batchId);
  const conditions = [eq(excelImportErrors.importBatchId, batchId)];
  if (severity && severity !== 'ALL') {
    conditions.push(eq(excelImportErrors.severity, severity));
  }

  const rows = await db
    .select()
    .from(excelImportErrors)
    .where(and(...conditions))
    .orderBy(asc(excelImportErrors.rowIndex), asc(excelImportErrors.id));

  return rows.map((r) => ({
    id: r.id,
    rowIndex: r.rowIndex,
    coilIdText: r.coilIdText,
    batchNoText: r.batchNoText,
    columnName: r.columnName,
    targetField: r.targetField,
    rawValue: r.rawValue,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    severity: r.severity as SapValidationErrorItem['severity'],
    suggestedResolution: r.suggestedResolution,
  }));
}

export async function exportBatchErrorReport(
  batchId: number,
  format: 'csv' | 'xlsx',
  actor: AuditActor
): Promise<{ buffer: Buffer; contentType: string; filename: string }> {
  const { batch } = await loadBatchRowOrThrow(batchId);
  const errors = await getBatchErrors(batchId);

  const safeBatchCode = batch.batchCode.replace(/[^A-Za-z0-9_-]/g, '_');

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'ERROR_REPORT_EXPORTED',
    entityType: 'excel_import_batches',
    entityId: batch.batchCode,
    afterJson: { format, errorRowCount: errors.length },
    ipAddress: actor.ip ?? null,
  });

  if (format === 'xlsx') {
    const buffer = generateErrorReportXlsx(errors);
    return {
      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${safeBatchCode}_error_report.xlsx`,
    };
  }

  const csvText = generateErrorReportCsv(errors);
  return {
    buffer: Buffer.from(csvText, 'utf8'),
    contentType: 'text/csv; charset=utf-8',
    filename: `${safeBatchCode}_error_report.csv`,
  };
}

// ============================================================================
// 7. ATOMIC CONFIRM IMPORT (SAP REFERENCE ONLY — ZERO INVENTORY SIDE EFFECTS!)
// ============================================================================
export async function confirmImportBatch(
  batchId: number,
  params: {
    importMode: SapImportMode;
    idempotencyKey: string;
  },
  actor: AuditActor,
  emitEvent?: SapImportEventEmitter
): Promise<{
  batch: SapImportBatchSummary;
  idempotentReplay: boolean;
  importedCount: number;
  reconciledCount: number;
  skippedCount: number;
  safetySnapshot: Awaited<ReturnType<typeof getInventorySafetySnapshot>>;
}> {
  const cleanKey = params.idempotencyKey.trim();
  if (!cleanKey || cleanKey.length < 8 || cleanKey.length > 128) {
    throw new Error('VALIDATION: Idempotency Key ไม่ถูกต้อง');
  }

  // Fast idempotency check before entering lock
  const existingByKey = await db
    .select({
      batch: excelImportBatches,
      actorEmail: users.email,
      actorName: users.displayName,
    })
    .from(excelImportBatches)
    .leftJoin(users, eq(excelImportBatches.importedByUserId, users.id))
    .where(eq(excelImportBatches.idempotencyKey, cleanKey))
    .limit(1);

  if (existingByKey.length > 0) {
    const existingBatch = existingByKey[0];
    if (existingBatch.batch.id !== batchId) {
      throw new Error('CONFLICT: Idempotency Key นี้ถูกใช้งานกับ Import Batch อื่นแล้ว');
    }
    if (['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(existingBatch.batch.status)) {
      const safetySnapshot = await getInventorySafetySnapshot();
      return {
        batch: sanitizeBatchSummary(existingBatch.batch, {
          email: existingBatch.actorEmail,
          displayName: existingBatch.actorName,
        }),
        idempotentReplay: true,
        importedCount: existingBatch.batch.importedRows,
        reconciledCount: 0,
        skippedCount: existingBatch.batch.skippedRows,
        safetySnapshot,
      };
    }
  }

  emitEvent?.('SAP_IMPORT_STARTED', {
    batchId,
    importMode: params.importMode,
  });

  const progressSnapshots: Array<{ processed: number; total: number; percent: number }> = [];

  try {
    const txResult = await db.transaction(async (tx) => {
      // Acquire exclusive row lock on the batch to prevent concurrent double-confirm
      const lockedRows = await tx
        .select()
        .from(excelImportBatches)
        .where(eq(excelImportBatches.id, batchId))
        .for('update');

      if (lockedRows.length === 0) {
        throw new Error('NOT_FOUND: ไม่พบ Import Batch ที่ระบุ');
      }
      const lockedBatch = lockedRows[0];

      // Idempotent replay inside lock
      if (
        lockedBatch.idempotencyKey === cleanKey &&
        ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(lockedBatch.status)
      ) {
        return {
          batch: lockedBatch,
          idempotentReplay: true,
          importedCount: lockedBatch.importedRows,
          reconciledCount: 0,
          skippedCount: lockedBatch.skippedRows,
        };
      }

      if (lockedBatch.status !== 'READY_TO_IMPORT') {
        throw new Error(
          `VALIDATION: Batch นี้อยู่ในสถานะ "${lockedBatch.status}" ไม่สามารถยืนยันนำเข้าซ้ำได้`
        );
      }

      if (params.importMode === 'STRICT' && lockedBatch.errorRows > 0) {
        throw new Error(
          `VALIDATION: Strict Mode ไม่อนุญาตให้นำเข้าเนื่องจากยังพบข้อผิดพลาด ${lockedBatch.errorRows} แถว — กรุณาแก้ไขไฟล์หรือเปลี่ยนเป็น Partial Mode`
        );
      }

      const stagingRows = await tx
        .select()
        .from(excelImportStaging)
        .where(eq(excelImportStaging.importBatchId, batchId))
        .orderBy(asc(excelImportStaging.rowIndex));

      if (stagingRows.length === 0) {
        throw new Error('VALIDATION: ไม่พบข้อมูล Staging สำหรับนำเข้า');
      }

      // Live re-check of existing Coil IDs inside transaction (prevents concurrent cross-batch race)
      const candidateCoilIds = stagingRows
        .map((r) => r.coilIdText)
        .filter((v): v is string => Boolean(v));

      const existingCoilIdSet = new Set<string>();
      const LOOKUP_CHUNK = 500;
      for (let i = 0; i < candidateCoilIds.length; i += LOOKUP_CHUNK) {
        const slice = candidateCoilIds.slice(i, i + LOOKUP_CHUNK);
        const found = await tx
          .select({ coilId: coils.coilId })
          .from(coils)
          .where(inArray(coils.coilId, slice));
        for (const f of found) existingCoilIdSet.add(f.coilId);
      }

      // Lock all provisional Pre-SAP coils matching batch numbers in this upload (FIFO order)
      const candidateBatchNosUpper = Array.from(
        new Set(
          stagingRows
            .map((r) => r.batchNoText?.trim().toUpperCase())
            .filter((v): v is string => Boolean(v))
        )
      );

      const preSapQueueByBatch = new Map<string, Array<typeof coils.$inferSelect>>();
      if (candidateBatchNosUpper.length > 0) {
        const lockedPreSapCoils = await tx
          .select()
          .from(coils)
          .where(
            and(
              eq(coils.sourceType, 'PRE_SAP_INBOUND'),
              inArray(sql`UPPER(${coils.batchNo})`, candidateBatchNosUpper)
            )
          )
          .orderBy(asc(coils.createdAt), asc(coils.id))
          .for('update');

        for (const pc of lockedPreSapCoils) {
          const key = pc.batchNo.trim().toUpperCase();
          const list = preSapQueueByBatch.get(key) ?? [];
          list.push(pc);
          preSapQueueByBatch.set(key, list);
        }
      }

      await tx.insert(auditLogs).values({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: 'IMPORT_CONFIRMED',
        entityType: 'excel_import_batches',
        entityId: lockedBatch.batchCode,
        afterJson: {
          importMode: params.importMode,
          totalRows: stagingRows.length,
          idempotencyKey: cleanKey,
        },
        ipAddress: actor.ip ?? null,
      });

      const now = new Date();
      let importedCount = 0;
      let reconciledCount = 0;
      let skippedDuplicateCount = 0;
      let skippedErrorCount = 0;
      const insertedInThisTx = new Set<string>();

      const headerIdCache = new Map<string, number>();
      const CHUNK_SIZE = 100;

      for (let offset = 0; offset < stagingRows.length; offset += CHUNK_SIZE) {
        const chunk = stagingRows.slice(offset, offset + CHUNK_SIZE);

        for (const row of chunk) {
          // 1. Error rows (blocked in Strict; skipped in Partial)
          if (row.validationStatus === 'ERROR') {
            skippedErrorCount++;
            await tx
              .update(excelImportStaging)
              .set({ importResultStatus: 'SKIPPED_ERROR' })
              .where(eq(excelImportStaging.id, row.id));
            continue;
          }

          // 2. Duplicate / Already existing in DB or earlier in same transaction
          const coilIdVal = row.coilIdText?.trim() ?? '';
          const batchNoVal = row.batchNoText?.trim() ?? '';
          if (
            !coilIdVal ||
            !batchNoVal ||
            row.duplicateType === 'EXISTING_REFERENCE' ||
            existingCoilIdSet.has(coilIdVal) ||
            insertedInThisTx.has(coilIdVal)
          ) {
            skippedDuplicateCount++;
            await tx
              .update(excelImportStaging)
              .set({ importResultStatus: 'SKIPPED_DUPLICATE' })
              .where(eq(excelImportStaging.id, row.id));
            continue;
          }

          // 3. Optional SAP Document Header + Item linkage (strictly reference data only)
          let sapDocItemId: number | null = null;
          if (row.materialDocumentText && row.documentItemText) {
            const fiscalYear = row.fiscalYearText || String(now.getFullYear());
            const headerKey = `${row.materialDocumentText}::${fiscalYear}`;
            let headerId = headerIdCache.get(headerKey);
            if (!headerId) {
              await tx
                .insert(sapDocumentHeaders)
                .values({
                  materialDocument: row.materialDocumentText,
                  fiscalYear,
                  plant: row.plantText,
                  sapStorageLocation: row.sapStorageLocationText,
                  importBatchId: lockedBatch.id,
                })
                .onConflictDoNothing();

              const [hdr] = await tx
                .select({ id: sapDocumentHeaders.id })
                .from(sapDocumentHeaders)
                .where(
                  and(
                    eq(sapDocumentHeaders.materialDocument, row.materialDocumentText),
                    eq(sapDocumentHeaders.fiscalYear, fiscalYear)
                  )
                )
                .limit(1);
              if (hdr) {
                headerId = hdr.id;
                headerIdCache.set(headerKey, hdr.id);
              }
            }

            if (headerId) {
              await tx
                .insert(sapDocumentItems)
                .values({
                  headerId,
                  documentItem: row.documentItemText,
                  coilIdText: coilIdVal,
                  batchNo: batchNoVal,
                  materialCode: row.materialCodeText ?? '',
                  materialDescription: row.materialDescription,
                  weightKg: row.weightKg,
                  saleOrder: row.saleOrderText,
                })
                .onConflictDoNothing();

              const [item] = await tx
                .select({ id: sapDocumentItems.id })
                .from(sapDocumentItems)
                .where(
                  and(
                    eq(sapDocumentItems.headerId, headerId),
                    eq(sapDocumentItems.documentItem, row.documentItemText)
                  )
                )
                .limit(1);
              if (item) {
                sapDocItemId = item.id;
              }
            }
          }

          // 4. Auto-Reconcile matching Pre-SAP provisional coil in-place (FIFO) OR insert new SAP Reference Coil
          //    NEVER mutates inventory, storage_locations, location_reservations, or stock_transactions!
          const hasPhysicalDimensions =
            row.widthMm !== null && row.outerDiameterMm !== null && row.innerDiameterMm !== null;

          const batchKeyUpper = batchNoVal.toUpperCase();
          const preSapQueue = preSapQueueByBatch.get(batchKeyUpper);
          const preSapTarget =
            preSapQueue && preSapQueue.length > 0 ? preSapQueue.shift()! : null;

          if (preSapTarget) {
            await tx
              .update(coils)
              .set({
                coilId: coilIdVal, // Replace provisional PRE-... ID with official SAP Coil ID
                batchNo: batchNoVal,
                materialCode: row.materialCodeText ?? '',
                materialDescription: row.materialDescription,
                plant: row.plantText,
                sapStorageLocation: row.sapStorageLocationText,
                saleOrder: row.saleOrderText,
                deliveryNumber: row.deliveryNumberText,
                purchaseOrder: row.purchaseOrderText,
                vendorCode: row.vendorCodeText,
                vendorName: row.vendorNameText,
                weightKg: row.weightKg,
                grossWeightKg: row.grossWeightKg,
                netWeightKg: row.netWeightKg,
                thicknessMm: row.thicknessMm,
                targetThicknessMm: row.targetThicknessMm,
                widthMm: row.widthMm,
                outerDiameterMm: row.outerDiameterMm,
                innerDiameterMm: row.innerDiameterMm,
                grade: row.gradeText,
                skinpass: row.skinpassText,
                heatNo: row.heatNoText,
                unitOfMeasure: row.unitOfMeasureText,
                postingDate: row.postingDateText,
                documentDate: row.documentDateText,
                referenceText: row.referenceText,
                scannedLocationRef: row.scannedLocationRefText,
                isEstimatedDimensions: !hasPhysicalDimensions,
                sourceType: 'PRE_SAP_RECONCILED',
                sourceRowNumber: row.rowIndex,
                importedByUserId: actor.userId,
                importedAt: now,
                sapDocumentItemId: sapDocItemId,
                importBatchId: lockedBatch.id,
                updatedAt: now,
                // IMPORTANT: lifecycleStatus ('IN_STOCK'), inventory, and 3D storage_location remain untouched!
              })
              .where(eq(coils.id, preSapTarget.id));

            await tx.insert(auditLogs).values({
              actorUserId: actor.userId,
              actorEmail: actor.email,
              action: 'PRE_SAP_COIL_RECONCILED',
              entityType: 'coils',
              entityId: String(preSapTarget.id),
              beforeJson: {
                coilId: preSapTarget.coilId,
                batchNo: preSapTarget.batchNo,
                sourceType: preSapTarget.sourceType,
                weightKg: preSapTarget.weightKg,
              },
              afterJson: {
                coilId: coilIdVal,
                batchNo: batchNoVal,
                sourceType: 'PRE_SAP_RECONCILED',
                weightKg: row.weightKg,
                grade: row.gradeText,
                importBatchCode: lockedBatch.batchCode,
              },
              ipAddress: actor.ip ?? null,
            });

            insertedInThisTx.add(coilIdVal);
            importedCount++;
            reconciledCount++;

            await tx
              .update(excelImportStaging)
              .set({ importResultStatus: 'RECONCILED' })
              .where(eq(excelImportStaging.id, row.id));
          } else {
            await tx.insert(coils).values({
              coilId: coilIdVal, // Leading zeros preserved strictly as TEXT
              batchNo: batchNoVal, // Leading zeros preserved strictly as TEXT
              materialCode: row.materialCodeText ?? '',
              materialDescription: row.materialDescription,
              plant: row.plantText,
              sapStorageLocation: row.sapStorageLocationText,
              saleOrder: row.saleOrderText,
              deliveryNumber: row.deliveryNumberText,
              purchaseOrder: row.purchaseOrderText,
              vendorCode: row.vendorCodeText,
              vendorName: row.vendorNameText,
              weightKg: row.weightKg,
              grossWeightKg: row.grossWeightKg,
              netWeightKg: row.netWeightKg,
              thicknessMm: row.thicknessMm,
              targetThicknessMm: row.targetThicknessMm,
              widthMm: row.widthMm,
              outerDiameterMm: row.outerDiameterMm,
              innerDiameterMm: row.innerDiameterMm,
              grade: row.gradeText,
              skinpass: row.skinpassText,
              heatNo: row.heatNoText,
              unitOfMeasure: row.unitOfMeasureText,
              postingDate: row.postingDateText,
              documentDate: row.documentDateText,
              referenceText: row.referenceText,
              scannedLocationRef: row.scannedLocationRefText,
              isEstimatedDimensions: !hasPhysicalDimensions,
              sourceType: 'SAP_EXCEL_IMPORT',
              sourceRowNumber: row.rowIndex,
              importedByUserId: actor.userId,
              importedAt: now,
              lifecycleStatus: 'PENDING_INBOUND', // MANDATORY SAFETY RULE
              sapDocumentItemId: sapDocItemId,
              importBatchId: lockedBatch.id,
            });

            insertedInThisTx.add(coilIdVal);
            importedCount++;

            await tx
              .update(excelImportStaging)
              .set({ importResultStatus: 'IMPORTED' })
              .where(eq(excelImportStaging.id, row.id));
          }
        }

        const processed = Math.min(stagingRows.length, offset + chunk.length);
        const percent = Math.round((processed / stagingRows.length) * 100);
        progressSnapshots.push({ processed, total: stagingRows.length, percent });
      }

      const skippedTotal = skippedDuplicateCount + skippedErrorCount;
      const finalStatus: SapImportBatchStatus =
        skippedErrorCount > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';

      const [finalBatch] = await tx
        .update(excelImportBatches)
        .set({
          importMode: params.importMode,
          idempotencyKey: cleanKey,
          status: finalStatus,
          importedRows: importedCount,
          skippedRows: skippedTotal,
          progressPercent: 100,
          confirmedAt: now,
          updatedAt: now,
        })
        .where(eq(excelImportBatches.id, batchId))
        .returning();

      await tx.insert(auditLogs).values({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: 'IMPORT_COMPLETED',
        entityType: 'excel_import_batches',
        entityId: finalBatch.batchCode,
        afterJson: {
          status: finalStatus,
          importMode: params.importMode,
          importedRows: importedCount,
          reconciledPreSapCoils: reconciledCount,
          skippedDuplicates: skippedDuplicateCount,
          skippedErrors: skippedErrorCount,
          inventoryCreated: 0,
          locationsMutated: 0,
        },
        ipAddress: actor.ip ?? null,
      });

      return {
        batch: finalBatch,
        idempotentReplay: false,
        importedCount,
        reconciledCount,
        skippedCount: skippedTotal,
      };
    });

    // Post-commit SSE notifications
    if (!txResult.idempotentReplay) {
      for (const snap of progressSnapshots) {
        emitEvent?.('SAP_IMPORT_PROGRESS', {
          batchId: txResult.batch.id,
          batchCode: txResult.batch.batchCode,
          ...snap,
        });
      }
      emitEvent?.('SAP_IMPORT_COMPLETED', {
        batchId: txResult.batch.id,
        batchCode: txResult.batch.batchCode,
        status: txResult.batch.status,
        importedRows: txResult.importedCount,
        reconciledCount: txResult.reconciledCount,
        skippedRows: txResult.skippedCount,
      });
    }

    const safetySnapshot = await getInventorySafetySnapshot();
    const { actorEmail, actorName } = await loadBatchRowOrThrow(batchId);

    return {
      batch: sanitizeBatchSummary(txResult.batch, { email: actorEmail, displayName: actorName }),
      idempotentReplay: txResult.idempotentReplay,
      importedCount: txResult.importedCount,
      reconciledCount: txResult.reconciledCount,
      skippedCount: txResult.skippedCount,
      safetySnapshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาดระหว่างยืนยันการนำเข้า';
    // Only log IMPORT_FAILED for non-validation failures or record cleanly
    try {
      await writeAuditLog({
        actorUserId: actor.userId,
        actorEmail: actor.email,
        action: 'IMPORT_FAILED',
        entityType: 'excel_import_batches',
        entityId: String(batchId),
        afterJson: { reason: message.slice(0, 300) },
        ipAddress: actor.ip ?? null,
      });
    } catch {
      // Do not shadow original error
    }
    emitEvent?.('SAP_IMPORT_FAILED', {
      batchId,
      reason: message.replace(/^(VALIDATION|NOT_FOUND|CONFLICT):/, '').trim(),
    });
    throw error;
  }
}

// ============================================================================
// 8. CANCEL UNCONFIRMED BATCH & CLEAN UP UPLOADED FILE
// ============================================================================
export async function cancelImportBatch(batchId: number, actor: AuditActor): Promise<SapImportBatchSummary> {
  const { batch, actorEmail, actorName } = await loadBatchRowOrThrow(batchId);
  if (!['UPLOADED', 'READY_TO_IMPORT', 'FAILED'].includes(batch.status)) {
    throw new Error(
      `VALIDATION: ไม่สามารถยกเลิก Batch ที่อยู่ในสถานะ "${batch.status}" ได้`
    );
  }

  await deleteUploadedFileIfExists(batch.storedFileName);

  const [updated] = await db
    .update(excelImportBatches)
    .set({
      status: 'CANCELLED',
      storedFileName: null,
      cancelledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(excelImportBatches.id, batchId))
    .returning();

  await writeAuditLog({
    actorUserId: actor.userId,
    actorEmail: actor.email,
    action: 'IMPORT_CANCELLED',
    entityType: 'excel_import_batches',
    entityId: updated.batchCode,
    beforeJson: { status: batch.status },
    afterJson: { status: 'CANCELLED' },
    ipAddress: actor.ip ?? null,
  });

  return sanitizeBatchSummary(updated, { email: actorEmail, displayName: actorName });
}

// ============================================================================
// 9. SAP REFERENCE COILS REGISTRY (READ-ONLY TRACKING OF PENDING_INBOUND COILS)
// ============================================================================
export async function listSapReferenceCoils(params: {
  search?: string;
  batchId?: number;
  lifecycleStatus?: string;
  page?: number;
  pageSize?: number;
}): Promise<{
  items: SapReferenceCoilRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 50));
  const offset = (page - 1) * pageSize;

  const conditions = [inArray(coils.sourceType, ['SAP_EXCEL_IMPORT', 'PRE_SAP_RECONCILED'])];
  if (params.batchId) {
    conditions.push(eq(coils.importBatchId, params.batchId));
  }
  if (params.lifecycleStatus && params.lifecycleStatus !== 'ALL') {
    conditions.push(eq(coils.lifecycleStatus, params.lifecycleStatus));
  }
  if (params.search && params.search.trim()) {
    const term = `%${params.search.trim()}%`;
    conditions.push(
      or(
        ilike(coils.coilId, term),
        ilike(coils.batchNo, term),
        ilike(coils.materialCode, term),
        ilike(coils.materialDescription, term),
        ilike(coils.grade, term),
        ilike(coils.heatNo, term),
        ilike(coils.referenceText, term)
      )!
    );
  }

  const whereClause = and(...conditions);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(coils)
    .where(whereClause);

  const rows = await db
    .select({
      coil: coils,
      batchCode: excelImportBatches.batchCode,
    })
    .from(coils)
    .leftJoin(excelImportBatches, eq(coils.importBatchId, excelImportBatches.id))
    .where(whereClause)
    .orderBy(desc(coils.importedAt), desc(coils.id))
    .limit(pageSize)
    .offset(offset);

  const total = countRow?.count ?? 0;

  return {
    items: rows.map(({ coil, batchCode }) => ({
      id: coil.id,
      coilId: coil.coilId,
      batchNo: coil.batchNo,
      materialCode: coil.materialCode,
      materialDescription: coil.materialDescription,
      plant: coil.plant,
      sapStorageLocation: coil.sapStorageLocation,
      weightKg: coil.weightKg,
      grossWeightKg: coil.grossWeightKg,
      netWeightKg: coil.netWeightKg,
      thicknessMm: coil.thicknessMm,
      targetThicknessMm: coil.targetThicknessMm,
      widthMm: coil.widthMm,
      outerDiameterMm: coil.outerDiameterMm,
      innerDiameterMm: coil.innerDiameterMm,
      grade: coil.grade,
      vendorCode: coil.vendorCode,
      skinpass: coil.skinpass,
      heatNo: coil.heatNo,
      referenceText: coil.referenceText,
      scannedLocationRef: coil.scannedLocationRef,
      sourceType: coil.sourceType,
      sourceRowNumber: coil.sourceRowNumber,
      lifecycleStatus: coil.lifecycleStatus,
      importBatchId: coil.importBatchId,
      batchCode: batchCode ?? null,
      importedAt: coil.importedAt ? coil.importedAt.toISOString() : null,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  };
}
