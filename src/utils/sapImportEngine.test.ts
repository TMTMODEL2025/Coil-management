import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  autoMapSapColumns,
  detectHeaderRowIndex,
  generateErrorReportCsv,
  generateErrorReportXlsx,
  parseSapDate,
  parseSapNumeric,
  parseSpreadsheetBuffer,
  sanitizeFormulaInjection,
  validateSapImportRows,
  validateUploadedFileSecurity,
  type ExistingCoilLookup,
  type PreSapCoilCandidate,
} from './sapImportEngine.ts';

function buildTmtSampleXlsxBuffer(options: { prependBannerRows?: boolean; extraSheet?: boolean } = {}): Buffer {
  const rows: Array<Array<string | number>> = [];
  if (options.prependBannerRows) {
    rows.push(['TMT STEEL PUBLIC COMPANY LIMITED — SAP S/4HANA EXPORT']);
    rows.push(['Exported Date: 21/11/2026']);
    rows.push([]);
  }
  rows.push([
    'ตำแหน่งที่สแกน',
    'Material No.',
    'Description',
    'Batch No.',
    'ความหนา',
    'ความหนาเป้าหมาย',
    'กว้าง',
    'Grade',
    'ผู้ผลิต',
    'Skinpass',
    'Storage Location',
    'น้ำหนัก (Unrestr.)',
    'หมายเลขคอยล์',
    'text สภาพ',
    'HEAT NO.',
    'นน. ชั่งจริง',
  ]);
  rows.push([
    'H7/6/3/1',
    '1HC10000-0003F',
    'เหล็กม้วนดำ A36 หนาxกว้างใดๆxC -Flat',
    '011P066118',
    '20',
    '19.83',
    '1524',
    'SS400/A36',
    'GJ',
    'NONSK',
    '1200',
    '24740',
    'HB02189481',
    'H7$VPE/26060017',
    '911010',
    '24755',
  ]);
  rows.push([
    'H7/6/3/2',
    '1HC10000-0003F',
    'เหล็กม้วนดำ A36 หนาxกว้างใดๆxC -Flat',
    '011P066132',
    '20',
    '19.83',
    '1524',
    'SS400/A36',
    'GJ',
    'NONSK',
    '1200',
    '25100',
    '0012345678',
    'E7$VPE/26060017',
    '911010',
    '25095',
  ]);

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'SAP_COILS');
  if (options.extraSheet) {
    const ws2 = XLSX.utils.aoa_to_sheet([
      ['Coil ID', 'Batch'],
      ['0099887766', '031D140772'],
    ]);
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');
  }
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

describe('Phase 4 SAP Excel Import Engine', () => {
  it('validates file extension, MIME, magic signature, size, and rejects unsafe files', () => {
    const validXlsx = buildTmtSampleXlsxBuffer();
    const okXlsx = validateUploadedFileSecurity({
      buffer: validXlsx,
      originalName: 'tmt_sap_export.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      maxBytes: 15 * 1024 * 1024,
    });
    assert.equal(okXlsx.valid, true);
    assert.equal(okXlsx.extension, '.xlsx');

    // CSV valid
    const csvBuf = Buffer.from('หมายเลขคอยล์,Batch No.\n0012345678,011P066118\n', 'utf8');
    const okCsv = validateUploadedFileSecurity({
      buffer: csvBuf,
      originalName: 'coils.csv',
      mimeType: 'text/csv',
      maxBytes: 15 * 1024 * 1024,
    });
    assert.equal(okCsv.valid, true);

    // Reject macro-enabled xlsm
    const badMacro = validateUploadedFileSecurity({
      buffer: validXlsx,
      originalName: 'coils.xlsm',
      mimeType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
      maxBytes: 15 * 1024 * 1024,
    });
    assert.equal(badMacro.valid, false);
    assert.equal(badMacro.errorCode, 'UNSUPPORTED_EXTENSION');

    // Reject spoofed/corrupted xlsx
    const corrupt = validateUploadedFileSecurity({
      buffer: Buffer.from('not a real zip file'),
      originalName: 'corrupt.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      maxBytes: 15 * 1024 * 1024,
    });
    assert.equal(corrupt.valid, false);
    assert.equal(corrupt.errorCode, 'INVALID_SIGNATURE');

    // Reject oversized file
    const tooLarge = validateUploadedFileSecurity({
      buffer: validXlsx,
      originalName: 'huge.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      maxBytes: 100,
    });
    assert.equal(tooLarge.valid, false);
    assert.equal(tooLarge.errorCode, 'FILE_TOO_LARGE');

    // Reject path traversal filename
    const traversal = validateUploadedFileSecurity({
      buffer: csvBuf,
      originalName: '../etc/passwd.csv',
      mimeType: 'text/csv',
      maxBytes: 1024 * 1024,
    });
    assert.equal(traversal.valid, false);
    assert.equal(traversal.errorCode, 'INVALID_FILENAME');
  });

  it('detects multi-sheet workbooks, offset header rows, preserves leading zeros, and auto-maps TMT Thai/EN columns', () => {
    const buf = buildTmtSampleXlsxBuffer({ prependBannerRows: true, extraSheet: true });
    const parsed = parseSpreadsheetBuffer(buf, '.xlsx');

    assert.equal(parsed.worksheets.length, 2);
    assert.equal(parsed.selectedSheet, 'SAP_COILS');
    assert.equal(parsed.headerRowIndex, 4); // 3 banner/blank rows before Row 4 header!
    assert.equal(parsed.dataRows.length, 2);

    // Leading zeros strictly preserved
    assert.equal(parsed.dataRows[0].rawByHeader['Batch No.'], '011P066118');
    assert.equal(parsed.dataRows[1].rawByHeader['หมายเลขคอยล์'], '0012345678');

    const autoMap = autoMapSapColumns(parsed.headers);
    assert.equal(autoMap.coil_id, 'หมายเลขคอยล์');
    assert.equal(autoMap.batch_number, 'Batch No.');
    assert.equal(autoMap.material_code, 'Material No.');
    assert.equal(autoMap.material_description, 'Description');
    assert.equal(autoMap.thickness, 'ความหนา');
    assert.equal(autoMap.target_thickness, 'ความหนาเป้าหมาย');
    assert.equal(autoMap.width, 'กว้าง');
    assert.equal(autoMap.grade, 'Grade');
    assert.equal(autoMap.vendor_code, 'ผู้ผลิต');
    assert.equal(autoMap.skinpass, 'Skinpass');
    assert.equal(autoMap.storage_location, 'Storage Location');
    assert.equal(autoMap.net_weight, 'น้ำหนัก (Unrestr.)');
    assert.equal(autoMap.gross_weight, 'นน. ชั่งจริง');
    assert.equal(autoMap.reference_text, 'text สภาพ');
    assert.equal(autoMap.heat_no, 'HEAT NO.');
    assert.equal(autoMap.scanned_location_ref, 'ตำแหน่งที่สแกน');
  });

  it('preserves leading zeros in CSV files without stripping to integer', () => {
    const csv = Buffer.from(
      'Coil ID,Batch,Material,Weight (KG)\n0012345678,031D140772,0001HC100,18280\n',
      'utf8'
    );
    const parsed = parseSpreadsheetBuffer(csv, '.csv');
    assert.equal(parsed.dataRows[0].rawByHeader['Coil ID'], '0012345678');
    assert.equal(parsed.dataRows[0].rawByHeader['Batch'], '031D140772');
    assert.equal(parsed.dataRows[0].rawByHeader['Material'], '0001HC100');
  });

  it('validates numeric fields, date formats, and flags ambiguous dates in AUTO mode', () => {
    assert.equal(parseSapNumeric('24,740.50').value, 24740.5);
    assert.ok(parseSapNumeric('-100').error);
    assert.ok(parseSapNumeric('ABC').error);

    assert.equal(parseSapDate('2026-11-21', 'AUTO').isoDate, '2026-11-21');
    assert.equal(parseSapDate('21/11/2026', 'AUTO').isoDate, '2026-11-21');
    assert.equal(parseSapDate('03/04/2026', 'AUTO').status, 'AMBIGUOUS');
    assert.equal(parseSapDate('03/04/2026', 'DD/MM/YYYY').isoDate, '2026-04-03');
    assert.equal(parseSapDate('03/04/2026', 'MM/DD/YYYY').isoDate, '2026-03-04');
    assert.equal(parseSapDate('99/99/2026', 'DD/MM/YYYY').status, 'INVALID');
  });

  it('detects all 3 duplicate levels, data conflicts, empty required fields, and invalid numbers', () => {
    const existing = new Map<string, ExistingCoilLookup>([
      [
        'EXISTING-SAME',
        {
          coilId: 'EXISTING-SAME',
          batchNo: '011P0001',
          materialCode: 'MAT-1',
          weightKg: 20000,
          widthMm: 1200,
          thicknessMm: 2,
          lifecycleStatus: 'PENDING_INBOUND',
          hasActiveInventory: false,
          currentLocationCode: null,
        },
      ],
      [
        'EXISTING-CONFLICT',
        {
          coilId: 'EXISTING-CONFLICT',
          batchNo: '011P0002',
          materialCode: 'MAT-1',
          weightKg: 20000,
          widthMm: 1200,
          thicknessMm: 2,
          lifecycleStatus: 'PENDING_INBOUND',
          hasActiveInventory: false,
          currentLocationCode: null,
        },
      ],
      [
        'IN-STOCK-COIL',
        {
          coilId: 'IN-STOCK-COIL',
          batchNo: '011P0003',
          materialCode: 'MAT-1',
          weightKg: 21000,
          widthMm: 1200,
          thicknessMm: 2,
          lifecycleStatus: 'IN_STOCK',
          hasActiveInventory: true,
          currentLocationCode: 'E7/1/1/1',
        },
      ],
    ]);

    const mapping = {
      coil_id: 'Coil ID',
      batch_number: 'Batch',
      material_code: 'Material',
      net_weight: 'Weight',
      width: 'Width',
    };

    const result = validateSapImportRows({
      dataRows: [
        { rowNumber: 2, rawByHeader: { 'Coil ID': '0012345678', Batch: '011P99', Material: 'MAT-1', Weight: '24740', Width: '1524' }, numericCellHeaders: [] },
        { rowNumber: 3, rawByHeader: { 'Coil ID': '0012345678', Batch: '011P99', Material: 'MAT-1', Weight: '24740', Width: '1524' }, numericCellHeaders: [] },
        { rowNumber: 4, rawByHeader: { 'Coil ID': 'EXISTING-SAME', Batch: '011P0001', Material: 'MAT-1', Weight: '20000', Width: '1200' }, numericCellHeaders: [] },
        { rowNumber: 5, rawByHeader: { 'Coil ID': 'EXISTING-CONFLICT', Batch: 'DIFFERENT-BATCH', Material: 'MAT-1', Weight: '20000', Width: '1200' }, numericCellHeaders: [] },
        { rowNumber: 6, rawByHeader: { 'Coil ID': 'IN-STOCK-COIL', Batch: '011P0003', Material: 'MAT-1', Weight: '21000', Width: '1200' }, numericCellHeaders: [] },
        { rowNumber: 7, rawByHeader: { 'Coil ID': '', Batch: '', Material: 'MAT-1', Weight: '-50', Width: 'BAD' }, numericCellHeaders: [] },
      ],
      mapping,
      dateFormat: 'DD/MM/YYYY',
      existingCoilsByCoilId: existing,
    });

    assert.equal(result.rows[0].duplicateType, 'NEW_RECORD');
    assert.equal(result.rows[0].validationStatus, 'VALID');
    assert.equal(result.rows[1].duplicateType, 'DUPLICATE_IN_FILE');
    assert.equal(result.rows[1].validationStatus, 'ERROR');
    assert.equal(result.rows[2].duplicateType, 'EXISTING_REFERENCE');
    assert.equal(result.rows[2].validationStatus, 'DUPLICATE');
    assert.equal(result.rows[3].duplicateType, 'DATA_CONFLICT');
    assert.equal(result.rows[3].validationStatus, 'ERROR');
    assert.equal(result.rows[4].duplicateType, 'ALREADY_IN_INVENTORY');
    assert.equal(result.rows[4].validationStatus, 'ERROR');
    assert.equal(result.rows[5].validationStatus, 'ERROR');
    assert.equal(result.summary.newRecords, 1);
    assert.equal(result.summary.errorRows, 4);
    assert.equal(result.summary.duplicateRows, 4);
  });

  it('sanitizes formula injection in exported CSV and XLSX error reports', () => {
    assert.equal(sanitizeFormulaInjection('=CMD()'), "'=CMD()");
    assert.equal(sanitizeFormulaInjection('+1+1'), "'+1+1");
    assert.equal(sanitizeFormulaInjection('-2+3'), "'-2+3");
    assert.equal(sanitizeFormulaInjection('@SUM(A1)'), "'@SUM(A1)");
    assert.equal(sanitizeFormulaInjection('0012345678'), '0012345678');

    const csv = generateErrorReportCsv([
      {
        rowIndex: 2,
        coilIdText: '=HYPERLINK("http://evil")',
        batchNoText: '011P066118',
        columnName: 'หมายเลขคอยล์',
        targetField: 'coil_id',
        errorCode: 'TEST',
        errorMessage: '+malicious',
        severity: 'ERROR',
        suggestedResolution: 'Fix value',
      },
    ]);
    assert.ok(csv.includes("'=HYPERLINK"));
    assert.ok(csv.includes("'+malicious"));

    const xlsxBuf = generateErrorReportXlsx([
      {
        rowIndex: 2,
        coilIdText: '0012345678',
        batchNoText: '011P066118',
        columnName: 'หมายเลขคอยล์',
        targetField: 'coil_id',
        errorCode: 'TEST',
        errorMessage: 'Sample error',
        severity: 'ERROR',
        suggestedResolution: 'Fix value',
      },
    ]);
    assert.ok(xlsxBuf.length > 100);
    assert.equal(detectHeaderRowIndex([['Title'], ['หมายเลขคอยล์', 'Batch No.', 'Material No.']]), 2);
  });

  it('matches Pre-SAP provisional coils by Batch No (FIFO) for RECONCILE_PRE_SAP and emits post-sync weight warnings', () => {
    const mapping = {
      coil_id: 'Coil ID',
      batch_number: 'Batch',
      material_code: 'Material',
      net_weight: 'Weight',
      width: 'Width',
    };

    const preSapByBatch = new Map<string, PreSapCoilCandidate[]>([
      [
        '011P066118',
        [
          {
            coilDbId: 501,
            provisionalCoilId: 'PRE-011P066118-01',
            batchNo: '011P066118',
            currentLocationCode: 'E7/1/2/1',
            levelNumber: 2,
            slotNumber: 1,
            locationMaxWeightKg: 20000,
            levelMaxWeightKg: 20000,
            lowerLeftWeightKg: 18000,
            lowerRightWeightKg: 21000,
          },
          {
            coilDbId: 502,
            provisionalCoilId: 'PRE-011P066118-02',
            batchNo: '011P066118',
            currentLocationCode: 'E7/1/1/3',
            levelNumber: 1,
            slotNumber: 3,
            locationMaxWeightKg: 28000,
            levelMaxWeightKg: 28000,
            lowerLeftWeightKg: null,
            lowerRightWeightKg: null,
          },
        ],
      ],
    ]);

    const result = validateSapImportRows({
      dataRows: [
        // Matches first FIFO Pre-SAP coil (Level 2, max 20t, lower support 18t) with 22t weight -> triggers both post-sync warnings
        {
          rowNumber: 2,
          rawByHeader: { 'Coil ID': 'HB02189481', Batch: '011P066118', Material: '1HC10000-0003F', Weight: '22000', Width: '1524' },
          numericCellHeaders: [],
        },
        // Matches second FIFO Pre-SAP coil (Floor Saddle, max 28t) with 19t weight -> clean VALID reconcile
        {
          rowNumber: 3,
          rawByHeader: { 'Coil ID': 'HB02189482', Batch: '011P066118', Material: '1HC10000-0003F', Weight: '19000', Width: '1524' },
          numericCellHeaders: [],
        },
        // Third row for same batch has no remaining Pre-SAP coil -> NEW_RECORD
        {
          rowNumber: 4,
          rawByHeader: { 'Coil ID': 'HB02189483', Batch: '011P066118', Material: '1HC10000-0003F', Weight: '18500', Width: '1524' },
          numericCellHeaders: [],
        },
      ],
      mapping,
      dateFormat: 'DD/MM/YYYY',
      existingCoilsByCoilId: new Map(),
      preSapCoilsByBatchNo: preSapByBatch,
    });

    assert.equal(result.summary.reconcileRecords, 2);
    assert.equal(result.summary.newRecords, 1);
    assert.equal(result.summary.errorRows, 0);

    assert.equal(result.rows[0].duplicateType, 'RECONCILE_PRE_SAP');
    assert.equal(result.rows[0].validationStatus, 'WARNING');
    const row0Codes = result.rows[0].validationIssues.map((i) => i.errorCode);
    assert.ok(row0Codes.includes('POST_SYNC_WEIGHT_OVER_CAPACITY'));
    assert.ok(row0Codes.includes('POST_SYNC_PYRAMID_WEIGHT_WARNING'));

    assert.equal(result.rows[1].duplicateType, 'RECONCILE_PRE_SAP');
    assert.equal(result.rows[1].validationStatus, 'VALID');

    assert.equal(result.rows[2].duplicateType, 'NEW_RECORD');
    assert.equal(result.rows[2].validationStatus, 'VALID');
  });
});

