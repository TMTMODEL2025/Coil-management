import * as XLSX from 'xlsx';
import type {
  SapDateFormat,
  SapDuplicateType,
  SapTargetFieldDef,
  SapTargetFieldKey,
  SapValidationIssue,
  SapValidationStatus,
  SapWorksheetInfo,
} from '../types/sapImport.ts';

// ============================================================================
// SUPPORTED SAP TARGET FIELDS (PRESERVING LEADING ZEROS FOR IDENTIFIERS)
// ============================================================================
export const SAP_TARGET_FIELDS: SapTargetFieldDef[] = [
  {
    key: 'coil_id',
    labelTh: 'หมายเลขคอยล์ (Coil ID)',
    labelEn: 'Coil ID',
    required: true,
    dataType: 'string_leading_zero',
    descriptionTh: 'รหัสเหล็กม้วนรายลูก (จำเป็น — เก็บเป็น String รักษาเลข 0 ด้านหน้า)',
  },
  {
    key: 'batch_number',
    labelTh: 'เลขที่ Batch (Batch No.)',
    labelEn: 'Batch Number',
    required: true,
    dataType: 'string_leading_zero',
    descriptionTh: 'รหัส Batch จาก SAP (จำเป็น — รักษาเลข 0 ด้านหน้า เช่น 011P066118)',
  },
  {
    key: 'material_code',
    labelTh: 'รหัสสินค้า (Material No.)',
    labelEn: 'Material Code',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'รหัส Material จาก SAP (รักษาเลข 0 ด้านหน้า)',
  },
  {
    key: 'material_description',
    labelTh: 'รายละเอียดสินค้า (Description)',
    labelEn: 'Material Description',
    required: false,
    dataType: 'text',
    descriptionTh: 'คำอธิบายสินค้าเหล็กม้วน',
  },
  {
    key: 'net_weight',
    labelTh: 'น้ำหนักสุทธิ / Unrestr. (kg)',
    labelEn: 'Net Weight (Unrestr.)',
    required: false,
    dataType: 'number',
    descriptionTh: 'น้ำหนัก Unrestricted / Net Weight จาก SAP (kg)',
  },
  {
    key: 'gross_weight',
    labelTh: 'น้ำหนักชั่งจริง / Gross (kg)',
    labelEn: 'Gross / Actual Weight',
    required: false,
    dataType: 'number',
    descriptionTh: 'น้ำหนักชั่งจริง (นน. ชั่งจริง) หรือ Gross Weight (kg)',
  },
  {
    key: 'thickness',
    labelTh: 'ความหนา (mm)',
    labelEn: 'Thickness',
    required: false,
    dataType: 'number',
    descriptionTh: 'ความหนาเหล็กม้วน (mm)',
  },
  {
    key: 'target_thickness',
    labelTh: 'ความหนาเป้าหมาย (mm)',
    labelEn: 'Target Thickness',
    required: false,
    dataType: 'number',
    descriptionTh: 'ความหนาเป้าหมายจาก SAP (mm)',
  },
  {
    key: 'width',
    labelTh: 'ความกว้าง (mm)',
    labelEn: 'Coil Width',
    required: false,
    dataType: 'number',
    descriptionTh: 'ความกว้างหน้าเหล็กม้วน (mm)',
  },
  {
    key: 'outer_diameter',
    labelTh: 'เส้นผ่านศูนย์กลางนอก OD (mm)',
    labelEn: 'Outer Diameter',
    required: false,
    dataType: 'number',
    descriptionTh: 'เส้นผ่านศูนย์กลางภายนอกเหล็กม้วน (mm)',
  },
  {
    key: 'inner_diameter',
    labelTh: 'เส้นผ่านศูนย์กลางใน ID (mm)',
    labelEn: 'Inner Diameter',
    required: false,
    dataType: 'number',
    descriptionTh: 'เส้นผ่านศูนย์กลางรูแกนในเหล็กม้วน (mm)',
  },
  {
    key: 'grade',
    labelTh: 'เกรดเหล็ก (Grade)',
    labelEn: 'Grade',
    required: false,
    dataType: 'text',
    descriptionTh: 'เกรดเหล็ก เช่น SS400/A36, HR1',
  },
  {
    key: 'skinpass',
    labelTh: 'Skinpass',
    labelEn: 'Skinpass',
    required: false,
    dataType: 'text',
    descriptionTh: 'สถานะการรีดปรับผิว เช่น NONSK',
  },
  {
    key: 'heat_no',
    labelTh: 'HEAT NO.',
    labelEn: 'Heat Number',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'หมายเลขหลอมเหล็ก (HEAT NO. — รักษาเลข 0 ด้านหน้า)',
  },
  {
    key: 'plant',
    labelTh: 'โรงงาน (Plant)',
    labelEn: 'Plant',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'รหัส Plant ใน SAP',
  },
  {
    key: 'storage_location',
    labelTh: 'SAP Storage Location',
    labelEn: 'SAP Storage Location',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'รหัส Storage Location จาก SAP เช่น 1200 (ข้อมูลอ้างอิง ไม่ใช่ WMS Slot)',
  },
  {
    key: 'document_number',
    labelTh: 'เลขที่เอกสาร SAP (Mat. Doc)',
    labelEn: 'SAP Document Number',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'เลขที่ Material Document (รักษาเลข 0 ด้านหน้า)',
  },
  {
    key: 'document_item',
    labelTh: 'ลำดับรายการ (Item)',
    labelEn: 'SAP Document Item',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'ลำดับรายการในเอกสาร SAP (รักษาเลข 0 ด้านหน้า)',
  },
  {
    key: 'delivery_number',
    labelTh: 'เลขที่ใบส่งของ (Delivery No.)',
    labelEn: 'Delivery Number',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'เลขที่ Delivery (รักษาเลข 0 ด้านหน้า)',
  },
  {
    key: 'purchase_order',
    labelTh: 'เลขที่ใบสั่งซื้อ (PO)',
    labelEn: 'Purchase Order',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'เลขที่ Purchase Order (รักษาเลข 0 ด้านหน้า)',
  },
  {
    key: 'vendor_code',
    labelTh: 'ผู้ผลิต / รหัสผู้ขาย (Vendor)',
    labelEn: 'Vendor / Mill Code',
    required: false,
    dataType: 'string_leading_zero',
    descriptionTh: 'รหัสผู้ผลิตหรือ Vendor Code เช่น GJ, SA (รักษาเลข 0 ด้านหน้า)',
  },
  {
    key: 'vendor_name',
    labelTh: 'ชื่อผู้ขาย (Vendor Name)',
    labelEn: 'Vendor Name',
    required: false,
    dataType: 'text',
    descriptionTh: 'ชื่อผู้ผลิตหรือผู้จัดจำหน่าย',
  },
  {
    key: 'unit_of_measure',
    labelTh: 'หน่วยนับ (UOM)',
    labelEn: 'Unit of Measure',
    required: false,
    dataType: 'text',
    descriptionTh: 'หน่วยน้ำหนัก เช่น KG, TON (ระบบไม่แปลงหน่วยโดยพลการ)',
  },
  {
    key: 'posting_date',
    labelTh: 'วันที่บันทึกบัญชี (Posting Date)',
    labelEn: 'Posting Date',
    required: false,
    dataType: 'date',
    descriptionTh: 'วันที่ Posting ใน SAP',
  },
  {
    key: 'document_date',
    labelTh: 'วันที่เอกสาร (Document Date)',
    labelEn: 'Document Date',
    required: false,
    dataType: 'date',
    descriptionTh: 'วันที่ออกเอกสาร SAP',
  },
  {
    key: 'reference_text',
    labelTh: 'ข้อความสภาพ / อ้างอิง (text สภาพ)',
    labelEn: 'Reference / Condition Text',
    required: false,
    dataType: 'text',
    descriptionTh: 'ข้อความสภาพหรือหมายเลขอ้างอิงจาก SAP เช่น H7$VPE/26060017',
  },
  {
    key: 'scanned_location_ref',
    labelTh: 'ตำแหน่งอ้างอิงจากไฟล์ (ตำแหน่งที่สแกน)',
    labelEn: 'Source Location Ref (Info Only)',
    required: false,
    dataType: 'text',
    descriptionTh: 'เก็บเป็นข้อความอ้างอิงจากไฟล์เท่านั้น ไม่มีผลต่อ WMS Location หรือ Inventory',
  },
];

export const TARGET_FIELD_BY_KEY = new Map<SapTargetFieldKey, SapTargetFieldDef>(
  SAP_TARGET_FIELDS.map((f) => [f.key, f])
);

export const LEADING_ZERO_FIELDS = new Set<SapTargetFieldKey>(
  SAP_TARGET_FIELDS.filter((f) => f.dataType === 'string_leading_zero').map((f) => f.key)
);

// ============================================================================
// 1. FILE UPLOAD SECURITY VALIDATOR (EXT, MIME, MAGIC BYTES, ZIP BOMB, MACRO)
// ============================================================================
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const ALLOWED_MIMES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'text/plain',
  'application/csv',
  'application/octet-stream', // Many OSes send generic octet-stream for .xlsx/.xls/.csv — signature check still strictly gates!
]);

const MAX_ZIP_UNCOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MB uncompressed ceiling
const MAX_ZIP_COMPRESSION_RATIO = 120;
const MAX_ZIP_ENTRIES = 600;

export interface FileSecurityCheckResult {
  valid: boolean;
  extension: '.xlsx' | '.xls' | '.csv' | null;
  errorCode?: string;
  errorMessage?: string;
}

/**
 * Inspects PKZIP Central Directory inside a Buffer to block ZIP Bombs and VBA Macros (vbaProject.bin)
 * before handing the buffer to SheetJS.
 */
function inspectZipSafety(buffer: Buffer): { safe: boolean; reason?: string } {
  // Locate End of Central Directory (EOCD) signature 0x06054b50 from tail
  const minOffset = Math.max(0, buffer.length - 65557);
  let eocdOffset = -1;
  for (let i = buffer.length - 22; i >= minOffset; i--) {
    if (
      buffer[i] === 0x50 &&
      buffer[i + 1] === 0x4b &&
      buffer[i + 2] === 0x05 &&
      buffer[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    return { safe: false, reason: 'ไฟล์ .xlsx เสียหายหรือไม่ใช่โครงสร้าง ZIP Archive ที่ถูกต้อง' };
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirSize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries > MAX_ZIP_ENTRIES) {
    return {
      safe: false,
      reason: `ไฟล์มีโครงสร้างภายในมากผิดปกติ (${totalEntries} entries) ปฏิเสธเพื่อความปลอดภัย`,
    };
  }

  if (centralDirOffset + centralDirSize > buffer.length) {
    return { safe: false, reason: 'โครงสร้าง Central Directory ของไฟล์ .xlsx ไม่สมบูรณ์' };
  }

  let cursor = centralDirOffset;
  let totalUncompressed = 0;
  let totalCompressed = 0;

  for (let idx = 0; idx < totalEntries && cursor + 46 <= buffer.length; idx++) {
    // Central directory header signature 0x02014b50
    if (
      buffer[cursor] !== 0x50 ||
      buffer[cursor + 1] !== 0x4b ||
      buffer[cursor + 2] !== 0x01 ||
      buffer[cursor + 3] !== 0x02
    ) {
      return { safe: false, reason: 'โครงสร้าง ZIP Entry ในไฟล์ .xlsx เสียหาย' };
    }

    const compSize = buffer.readUInt32LE(cursor + 20);
    const uncompSize = buffer.readUInt32LE(cursor + 24);
    const nameLen = buffer.readUInt16LE(cursor + 28);
    const extraLen = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);

    const entryName = buffer
      .subarray(cursor + 46, Math.min(buffer.length, cursor + 46 + nameLen))
      .toString('utf8')
      .toLowerCase();

    // Block Path Traversal inside ZIP entries
    if (entryName.includes('..') || entryName.startsWith('/') || entryName.startsWith('\\')) {
      return { safe: false, reason: 'ตรวจพบ Path Traversal ภายในโครงสร้างไฟล์ .xlsx' };
    }

    // Block embedded VBA Macros inside disguised .xlsx
    if (entryName.includes('vbaproject.bin') || entryName.endsWith('.bin') && entryName.includes('vba')) {
      return {
        safe: false,
        reason: 'ตรวจพบ Macro (VBA) ภายในไฟล์ — ระบบไม่อนุญาตไฟล์ที่มี Macro เพื่อความปลอดภัย',
      };
    }

    totalUncompressed += uncompSize;
    totalCompressed += Math.max(1, compSize);

    if (totalUncompressed > MAX_ZIP_UNCOMPRESSED_BYTES) {
      return {
        safe: false,
        reason: 'ตรวจพบความเสี่ยง ZIP Bomb (ขนาดหลังแตกไฟล์เกินขีดจำกัด 100MB)',
      };
    }

    cursor += 46 + nameLen + extraLen + commentLen;
  }

  if (totalUncompressed > 5 * 1024 * 1024 && totalUncompressed / Math.max(1, totalCompressed) > MAX_ZIP_COMPRESSION_RATIO) {
    return {
      safe: false,
      reason: 'ตรวจพบอัตราบีบอัดผิดปกติ (ZIP Bomb Protection)',
    };
  }

  return { safe: true };
}

export function validateUploadedFileSecurity(params: {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  maxBytes: number;
}): FileSecurityCheckResult {
  const { buffer, originalName, mimeType, maxBytes } = params;

  const cleanName = originalName.trim();
  if (!cleanName || cleanName.includes('..') || cleanName.includes('/') || cleanName.includes('\\')) {
    return {
      valid: false,
      extension: null,
      errorCode: 'INVALID_FILENAME',
      errorMessage: 'ชื่อไฟล์ไม่ถูกต้องหรือมีอักขระ Path ที่ไม่ได้รับอนุญาต',
    };
  }

  const dotIdx = cleanName.lastIndexOf('.');
  const ext = dotIdx >= 0 ? cleanName.slice(dotIdx).toLowerCase() : '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      extension: null,
      errorCode: 'UNSUPPORTED_EXTENSION',
      errorMessage: `รองรับเฉพาะไฟล์ .xlsx, .xls และ .csv เท่านั้น (ไม่รองรับ "${ext || 'ไม่มีนามสกุล'}")`,
    };
  }

  const normalizedMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (normalizedMime && !ALLOWED_MIMES.has(normalizedMime)) {
    return {
      valid: false,
      extension: null,
      errorCode: 'UNSUPPORTED_MIME',
      errorMessage: `MIME Type "${normalizedMime}" ไม่ได้รับอนุญาตสำหรับการนำเข้า SAP Excel`,
    };
  }

  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      extension: null,
      errorCode: 'EMPTY_FILE',
      errorMessage: 'ไฟล์ว่างเปล่า ไม่มีข้อมูลสำหรับนำเข้า',
    };
  }

  if (buffer.length > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(0);
    return {
      valid: false,
      extension: null,
      errorCode: 'FILE_TOO_LARGE',
      errorMessage: `ขนาดไฟล์เกินกำหนดสูงสุดของระบบ (${mb} MB)`,
    };
  }

  // Magic-byte signature verification
  if (ext === '.xlsx') {
    const isPkZip =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      (buffer[2] === 0x03 || buffer[2] === 0x05) &&
      (buffer[3] === 0x04 || buffer[3] === 0x06);
    if (!isPkZip) {
      return {
        valid: false,
        extension: null,
        errorCode: 'INVALID_SIGNATURE',
        errorMessage: 'ลายเซ็นไฟล์ (File Signature) ไม่ตรงกับรูปแบบ .xlsx มาตรฐาน หรือไฟล์เสียหาย',
      };
    }
    const zipSafety = inspectZipSafety(buffer);
    if (!zipSafety.safe) {
      return {
        valid: false,
        extension: null,
        errorCode: 'UNSAFE_ARCHIVE',
        errorMessage: zipSafety.reason,
      };
    }
  } else if (ext === '.xls') {
    const isOle2 =
      buffer.length >= 8 &&
      buffer[0] === 0xd0 &&
      buffer[1] === 0xcf &&
      buffer[2] === 0x11 &&
      buffer[3] === 0xe0 &&
      buffer[4] === 0xa1 &&
      buffer[5] === 0xb1 &&
      buffer[6] === 0x1a &&
      buffer[7] === 0xe1;
    // Note: SAP sometimes exports TSV/HTML/XML with .xls extension — only accept genuine OLE2 BIFF8 .xls
    if (!isOle2) {
      return {
        valid: false,
        extension: null,
        errorCode: 'INVALID_SIGNATURE',
        errorMessage:
          'ลายเซ็นไฟล์ไม่ตรงกับรูปแบบ Excel .xls มาตรฐาน กรุณาบันทึกเป็น .xlsx หรือ .csv จาก Excel ก่อนอัปโหลด',
      };
    }
  } else if (ext === '.csv') {
    // Reject binary files masquerading as CSV (NUL byte check in first 8KB)
    const sampleLen = Math.min(buffer.length, 8192);
    for (let i = 0; i < sampleLen; i++) {
      if (buffer[i] === 0x00) {
        return {
          valid: false,
          extension: null,
          errorCode: 'INVALID_CSV_BINARY',
          errorMessage: 'ไฟล์ .csv มีข้อมูลไบนารีที่ไม่ถูกต้องหรือไม่ใช่ไฟล์ข้อความ',
        };
      }
    }
  }

  return { valid: true, extension: ext as '.xlsx' | '.xls' | '.csv' };
}

// ============================================================================
// 2. CSV / EXCEL FORMULA INJECTION PROTECTION
// ============================================================================
export function sanitizeFormulaInjection(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

// ============================================================================
// 3. WORKBOOK PARSER (SAFE MODE — PRESERVES LEADING ZEROS, NO FORMULA EXEC)
// ============================================================================
export interface ParsedSheetTable {
  worksheets: SapWorksheetInfo[];
  selectedSheet: string;
  headerRowIndex: number; // 1-based row number in worksheet
  headers: string[];
  rawPreviewRows: Array<{ rowNumber: number; values: string[] }>;
  dataRows: Array<{
    rowNumber: number;
    rawByHeader: Record<string, string>;
    numericCellHeaders: string[];
  }>;
  sampleByColumn: Record<string, string[]>;
  detectedLeadingZeroWarnings: string[];
}

function readCellAsPreservedText(cell: XLSX.CellObject | undefined): {
  text: string;
  wasNumericCell: boolean;
  hadZeroPadFormat: boolean;
} {
  if (!cell || cell.v === undefined || cell.v === null) {
    return { text: '', wasNumericCell: false, hadZeroPadFormat: false };
  }
  // Never execute formula — read cached text/value only
  const formatted = typeof cell.w === 'string' && cell.w.length > 0 ? cell.w : String(cell.v);
  const numFmt = typeof cell.z === 'string' ? cell.z : '';
  const hadZeroPadFormat = /^0+$/.test(numFmt.trim());
  return {
    text: formatted.trim(),
    wasNumericCell: cell.t === 'n',
    hadZeroPadFormat,
  };
}

function extractSheetMatrix(ws: XLSX.WorkSheet): {
  matrix: Array<Array<{ text: string; wasNumericCell: boolean; hadZeroPadFormat: boolean }>>;
  rowCount: number;
  colCount: number;
} {
  const ref = ws['!ref'];
  if (!ref) return { matrix: [], rowCount: 0, colCount: 0 };
  const range = XLSX.utils.decode_range(ref);
  const maxRows = Math.min(range.e.r, range.s.r + 25000); // Hard safety cap
  const maxCols = Math.min(range.e.c, range.s.c + 120);

  const matrix: Array<Array<{ text: string; wasNumericCell: boolean; hadZeroPadFormat: boolean }>> = [];
  for (let r = range.s.r; r <= maxRows; r++) {
    const rowCells: Array<{ text: string; wasNumericCell: boolean; hadZeroPadFormat: boolean }> = [];
    for (let c = range.s.c; c <= maxCols; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      rowCells.push(readCellAsPreservedText(ws[addr] as XLSX.CellObject | undefined));
    }
    matrix.push(rowCells);
  }

  return {
    matrix,
    rowCount: maxRows - range.s.r + 1,
    colCount: maxCols - range.s.c + 1,
  };
}

const KNOWN_HEADER_KEYWORDS = [
  'coil',
  'หมายเลขคอยล์',
  'คอยล์',
  'batch',
  'material',
  'description',
  'weight',
  'น้ำหนัก',
  'นน.',
  'width',
  'กว้าง',
  'thickness',
  'ความหนา',
  'grade',
  'heat',
  'plant',
  'storage location',
  'sloc',
  'skinpass',
  'ผู้ผลิต',
  'vendor',
  'ตำแหน่งที่สแกน',
  'text สภาพ',
  'document',
  'posting date',
];

/**
 * Automatically detects the 1-based Header Row index (scanning first 20 rows),
 * supporting SAP exports with report banners / empty rows above the table header.
 */
export function detectHeaderRowIndex(rows: string[][]): number {
  const scanLimit = Math.min(rows.length, 20);
  let bestRow = 1;
  let bestScore = -1;

  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r];
    const nonEmpty = row.map((v) => v.trim()).filter(Boolean);
    if (nonEmpty.length < 2) continue;

    let keywordHits = 0;
    let textLikeCount = 0;
    for (const cell of nonEmpty) {
      const lower = cell.toLowerCase();
      if (KNOWN_HEADER_KEYWORDS.some((kw) => lower.includes(kw))) {
        keywordHits += 3;
      }
      // Headers usually contain letters/Thai characters rather than pure numbers
      if (/[a-zA-Z\u0E00-\u0E7F]/.test(cell)) {
        textLikeCount += 1;
      }
    }

    const score = keywordHits * 4 + textLikeCount;
    if (score > bestScore) {
      bestScore = score;
      bestRow = r + 1;
    }
  }

  return bestRow;
}

export function parseSpreadsheetBuffer(
  buffer: Buffer,
  extension: '.xlsx' | '.xls' | '.csv',
  requestedSheetName?: string,
  requestedHeaderRow?: number
): ParsedSheetTable {
  let wb: XLSX.WorkBook;
  try {
    if (extension === '.csv') {
      const csvText = buffer.toString('utf8').replace(/^\uFEFF/, '');
      wb = XLSX.read(csvText, {
        type: 'string',
        raw: true, // Preserve exact strings for CSV so leading zeros never turn into numbers
        cellFormula: false,
        cellHTML: false,
        cellNF: true,
        cellText: true,
        cellDates: false,
        bookVBA: false,
      });
    } else {
      wb = XLSX.read(buffer, {
        type: 'buffer',
        raw: false,
        cellFormula: false, // Never parse/execute formulas
        cellHTML: false,
        cellNF: true,
        cellText: true,
        cellDates: false,
        bookVBA: false,
      });
    }
  } catch (err) {
    throw new Error(
      `ไม่สามารถอ่านไฟล์สเปรดชีตได้ (ไฟล์อาจเสียหายหรือเข้ารหัสผ่าน): ${
        err instanceof Error ? err.message : 'parse error'
      }`,
      { cause: err }
    );
  }

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    throw new Error('ไม่พบ Worksheet ภายในไฟล์ที่อัปโหลด');
  }

  const EXCEL_FORMULA_ERROR_TOKENS = new Set([
    '#REF!',
    '#N/A',
    '#VALUE!',
    '#DIV/0!',
    '#NAME?',
    '#NUM!',
    '#NULL!',
  ]);

  const isBlankOrFormulaOnlyRow = (
    row: Array<{ text: string; wasNumericCell: boolean; hadZeroPadFormat: boolean }>
  ) => row.every((c) => c.text === '' || EXCEL_FORMULA_ERROR_TOKENS.has(c.text.toUpperCase()));

  // Detect hidden / veryHidden Excel worksheets from workbook metadata (Hidden: 1 or 2)
  const hiddenSheetSet = new Set<string>();
  const wbSheetMeta = wb.Workbook?.Sheets ?? [];
  for (let i = 0; i < wb.SheetNames.length; i++) {
    const meta = wbSheetMeta[i];
    if (meta && (meta.Hidden === 1 || meta.Hidden === 2)) {
      hiddenSheetSet.add(wb.SheetNames[i]);
    }
  }

  const worksheets: SapWorksheetInfo[] = [];
  const matricesBySheet = new Map<string, ReturnType<typeof extractSheetMatrix>>();

  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const extracted = extractSheetMatrix(ws);
    matricesBySheet.set(name, extracted);
    const textMatrix = extracted.matrix.map((row) => row.map((c) => c.text));
    const detectedHeaderRow = detectHeaderRowIndex(textMatrix);
    let nonEmptyDataRows = 0;
    for (let r = detectedHeaderRow; r < extracted.matrix.length; r++) {
      if (!isBlankOrFormulaOnlyRow(extracted.matrix[r])) {
        nonEmptyDataRows++;
      }
    }
    worksheets.push({
      name,
      rowCount: extracted.rowCount,
      dataRowCount: nonEmptyDataRows,
      colCount: extracted.colCount,
      detectedHeaderRow,
      isHidden: hiddenSheetSet.has(name),
    });
  }

  // Sort visible sheets first while preserving original order within each group
  worksheets.sort((a, b) => Number(Boolean(a.isHidden)) - Number(Boolean(b.isHidden)));

  let selectedSheet: string;
  if (requestedSheetName && wb.SheetNames.includes(requestedSheetName)) {
    selectedSheet = requestedSheetName;
  } else {
    // Only consider visible sheets for auto-selection if any visible sheet exists
    const visibleSheets = worksheets.filter((w) => !w.isHidden);
    const candidateSheets = visibleSheets.length > 0 ? visibleSheets : worksheets;

    if (candidateSheets.length === 1) {
      selectedSheet = candidateSheets[0].name;
    } else {
      // Score candidate sheets by SAP coil header matches so cover/summary sheets don't win
      let bestSheet = candidateSheets[0].name;
      let bestScore = -1;
      for (const wsInfo of candidateSheets) {
        const mat = matricesBySheet.get(wsInfo.name);
        if (!mat || mat.matrix.length === 0) continue;
        const hdrRow = mat.matrix[wsInfo.detectedHeaderRow - 1] ?? [];
        const hdrTexts = hdrRow.map((c, idx) => c.text || `Column_${idx + 1}`);
        const mapped = autoMapSapColumns(hdrTexts);
        const requiredHits =
          (mapped.coil_id ? 1 : 0) +
          (mapped.batch_number ? 1 : 0) +
          (mapped.material_code ? 1 : 0);
        const totalMapped = Object.keys(mapped).length;
        const hasData = (wsInfo.dataRowCount ?? 0) > 0 ? 1 : 0;
        const score = requiredHits * 1000 + totalMapped * 20 + hasData * 10;
        if (score > bestScore) {
          bestScore = score;
          bestSheet = wsInfo.name;
        }
      }
      selectedSheet = bestScore > 0 ? bestSheet : candidateSheets[0].name;
    }
  }

  const sheetInfo = worksheets.find((w) => w.name === selectedSheet) ?? worksheets[0];
  const extracted = matricesBySheet.get(selectedSheet) ?? { matrix: [], rowCount: 0, colCount: 0 };

  const headerRowIndex =
    requestedHeaderRow && requestedHeaderRow >= 1 && requestedHeaderRow <= Math.max(1, extracted.rowCount)
      ? requestedHeaderRow
      : sheetInfo.detectedHeaderRow;

  const headerCells = extracted.matrix[headerRowIndex - 1] ?? [];
  const seenHeaderCounts = new Map<string, number>();
  const headers = headerCells.map((cell, idx) => {
    const base = cell.text || `Column_${idx + 1}`;
    const count = seenHeaderCounts.get(base) ?? 0;
    seenHeaderCounts.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });

  // Raw top-15 rows preview for Step 2 Header Row picker
  const rawPreviewRows = extracted.matrix.slice(0, 15).map((row, i) => ({
    rowNumber: i + 1,
    values: row.map((c) => c.text),
  }));

  const dataRows: ParsedSheetTable['dataRows'] = [];
  const sampleByColumn: Record<string, string[]> = {};
  const numericWarnCols = new Set<string>();
  for (const h of headers) sampleByColumn[h] = [];

  for (let r = headerRowIndex; r < extracted.matrix.length; r++) {
    const row = extracted.matrix[r];
    if (isBlankOrFormulaOnlyRow(row)) continue;

    const rawByHeader: Record<string, string> = {};
    const numericCellHeaders: string[] = [];

    for (let c = 0; c < headers.length; c++) {
      const h = headers[c];
      const cell = row[c] ?? { text: '', wasNumericCell: false, hadZeroPadFormat: false };
      rawByHeader[h] = cell.text;
      if (cell.wasNumericCell) {
        numericCellHeaders.push(h);
        if (!cell.hadZeroPadFormat && /^\d{4,}$/.test(cell.text)) {
          numericWarnCols.add(h);
        }
      }
      if (cell.text && sampleByColumn[h].length < 4) {
        sampleByColumn[h].push(cell.text);
      }
    }

    dataRows.push({
      rowNumber: r + 1, // 1-based original Excel row number
      rawByHeader,
      numericCellHeaders,
    });
  }

  return {
    worksheets,
    selectedSheet,
    headerRowIndex,
    headers,
    rawPreviewRows,
    dataRows,
    sampleByColumn,
    detectedLeadingZeroWarnings: Array.from(numericWarnCols),
  };
}

// ============================================================================
// 4. AUTO COLUMN MAPPING (REAL TMT THAI/EN SAP HEADERS + SAP S/4HANA STANDARD)
// ============================================================================
const HEADER_ALIASES: Record<SapTargetFieldKey, string[]> = {
  coil_id: ['หมายเลขคอยล์', 'coil id', 'coil_id', 'coil no', 'coil number', 'คอยล์', 'serial no'],
  batch_number: ['batch no.', 'batch no', 'batch', 'batch_number', 'charg', 'เลขที่ batch', 'แบทช์'],
  material_code: ['material no.', 'material no', 'material code', 'material', 'matnr', 'รหัสสินค้า', 'material_code'],
  material_description: ['description', 'material description', 'maktx', 'รายละเอียดสินค้า', 'desc'],
  plant: ['plant', 'werks', 'โรงงาน'],
  storage_location: ['storage location', 'sloc', 'lgort', 'sap storage location', 'คลัง sap'],
  document_number: ['material document', 'document number', 'mat doc', 'mblnr', 'เลขที่เอกสาร'],
  document_item: ['document item', 'item', 'zeile', 'ลำดับรายการ'],
  delivery_number: ['delivery number', 'delivery no', 'delivery', 'vbeln', 'ใบส่งของ'],
  purchase_order: ['purchase order', 'po', 'po no', 'ebeln', 'ใบสั่งซื้อ'],
  vendor_code: ['ผู้ผลิต', 'vendor code', 'vendor', 'lifnr', 'supplier code', 'mill'],
  vendor_name: ['vendor name', 'supplier name', 'ชื่อผู้ผลิต', 'ชื่อผู้ขาย'],
  net_weight: ['น้ำหนัก (unrestr.)', 'น้ำหนัก (unrestr)', 'unrestricted', 'net weight', 'weight (kg)', 'weight', 'น้ำหนักสุทธิ', 'น้ำหนัก'],
  gross_weight: ['นน. ชั่งจริง', 'น้ำหนักชั่งจริง', 'gross weight', 'actual weight', 'นน.ชั่งจริง'],
  thickness: ['ความหนา', 'thickness (mm)', 'thickness', 'thick'],
  target_thickness: ['ความหนาเป้าหมาย', 'target thickness', 'aim thickness'],
  width: ['กว้าง', 'ความกว้าง', 'width (mm)', 'width', 'coil width'],
  outer_diameter: ['outer diameter (mm)', 'outer diameter', 'od', 'od (mm)', 'เส้นผ่านศูนย์กลางนอก'],
  inner_diameter: ['inner diameter (mm)', 'inner diameter', 'id (mm)', 'bore', 'เส้นผ่านศูนย์กลางใน'],
  grade: ['grade', 'steel grade', 'เกรด', 'เกรดเหล็ก'],
  skinpass: ['skinpass', 'skin pass'],
  heat_no: ['heat no.', 'heat no', 'heat number', 'heat', 'เลขหลอม'],
  unit_of_measure: ['unit of measure', 'uom', 'unit', 'meins', 'หน่วย', 'หน่วยนับ'],
  posting_date: ['posting date', 'budat', 'วันที่บันทึก'],
  document_date: ['document date', 'bldat', 'วันที่เอกสาร'],
  reference_text: ['text สภาพ', 'reference text', 'reference', 'remark', 'condition text', 'หมายเหตุ'],
  scanned_location_ref: ['ตำแหน่งที่สแกน', 'scanned location', 'location ref', 'bin ref'],
};

function normalizeHeaderToken(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function autoMapSapColumns(
  headers: string[],
  templateMapping?: Record<string, string> | null
): Record<string, string> {
  const result: Record<string, string> = {};
  const usedHeaders = new Set<string>();
  const normalizedHeaderMap = new Map<string, string>();
  for (const h of headers) {
    normalizedHeaderMap.set(normalizeHeaderToken(h), h);
  }

  // 1. Apply explicit Template mapping first if column exists in uploaded file
  if (templateMapping) {
    for (const [targetKey, sourceCol] of Object.entries(templateMapping)) {
      if (!TARGET_FIELD_BY_KEY.has(targetKey as SapTargetFieldKey)) continue;
      if (!sourceCol) continue;
      const matched = normalizedHeaderMap.get(normalizeHeaderToken(sourceCol));
      if (matched && !usedHeaders.has(matched)) {
        result[targetKey] = matched;
        usedHeaders.add(matched);
      }
    }
  }

  // 2. Auto-match remaining fields via exact alias first, then contains alias
  for (const field of SAP_TARGET_FIELDS) {
    if (result[field.key]) continue;
    const aliases = HEADER_ALIASES[field.key] ?? [];

    // Exact match pass
    let found: string | undefined;
    for (const alias of aliases) {
      const exact = normalizedHeaderMap.get(normalizeHeaderToken(alias));
      if (exact && !usedHeaders.has(exact)) {
        found = exact;
        break;
      }
    }

    // Partial/contains pass (careful not to confuse "ความหนา" with "ความหนาเป้าหมาย")
    if (!found) {
      for (const h of headers) {
        if (usedHeaders.has(h)) continue;
        const normH = normalizeHeaderToken(h);
        if (field.key === 'thickness' && normH.includes('เป้าหมาย')) continue;
        if (field.key === 'net_weight' && normH.includes('ชั่งจริง')) continue;
        if (aliases.some((alias) => normH === alias || (alias.length >= 4 && normH.includes(alias)))) {
          found = h;
          break;
        }
      }
    }

    if (found) {
      result[field.key] = found;
      usedHeaders.add(found);
    }
  }

  return result;
}

// ============================================================================
// 5. NUMERIC & DATE PARSERS (STRICT — NEVER GUESSES AMBIGUOUS DATES OR UNITS)
// ============================================================================
export function parseSapNumeric(
  rawValue: string | undefined | null,
  decimalSeparator: '.' | ',' = '.'
): { value: number | null; error?: string } {
  if (rawValue === undefined || rawValue === null) return { value: null };
  const trimmed = rawValue.trim();
  if (!trimmed) return { value: null };

  // Strip spaces & thousand separators according to configured decimalSeparator
  let normalized = trimmed.replace(/\s+/g, '');
  if (decimalSeparator === ',') {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return { value: null, error: `ค่าตัวเลขไม่ถูกต้อง ("${trimmed}")` };
  }

  const num = Number(normalized);
  if (!Number.isFinite(num)) {
    return { value: null, error: `ไม่สามารถแปลงค่าตัวเลขได้ ("${trimmed}")` };
  }
  if (num < 0) {
    return { value: null, error: `ค่าต้องไม่ติดลบ ("${trimmed}")` };
  }
  return { value: num };
}

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function formatYmd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function parseSapDate(
  rawValue: string | undefined | null,
  dateFormat: SapDateFormat = 'AUTO'
): { isoDate: string | null; status: 'OK' | 'EMPTY' | 'AMBIGUOUS' | 'INVALID'; message?: string } {
  if (rawValue === undefined || rawValue === null) return { isoDate: null, status: 'EMPTY' };
  const trimmed = rawValue.trim();
  if (!trimmed) return { isoDate: null, status: 'EMPTY' };

  // 1. Excel Serial Date (5-digit integer between 25000 and 75000, e.g. 46085)
  if (/^\d{5}(\.\d+)?$/.test(trimmed)) {
    const serial = Math.floor(Number(trimmed));
    if (serial >= 25000 && serial <= 75000) {
      const utcMs = Date.UTC(1899, 11, 30) + serial * 86400_000;
      const dt = new Date(utcMs);
      return {
        isoDate: formatYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()),
        status: 'OK',
      };
    }
  }

  // 2. ISO YYYY-MM-DD (unambiguous)
  const isoMatch = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(trimmed);
  if (isoMatch) {
    const y = Number(isoMatch[1]);
    const m = Number(isoMatch[2]);
    const d = Number(isoMatch[3]);
    if (isValidYmd(y, m, d)) {
      return { isoDate: formatYmd(y, m, d), status: 'OK' };
    }
    return { isoDate: null, status: 'INVALID', message: `วันที่ไม่ถูกต้อง ("${trimmed}")` };
  }

  // 3. Slash/Dash/Dot DD/MM/YYYY or MM/DD/YYYY
  const dmyMatch = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(trimmed);
  if (dmyMatch) {
    const p1 = Number(dmyMatch[1]);
    const p2 = Number(dmyMatch[2]);
    const y = Number(dmyMatch[3]);

    if (dateFormat === 'DD/MM/YYYY') {
      if (isValidYmd(y, p2, p1)) return { isoDate: formatYmd(y, p2, p1), status: 'OK' };
      return { isoDate: null, status: 'INVALID', message: `วันที่ไม่ตรงรูปแบบ DD/MM/YYYY ("${trimmed}")` };
    }

    if (dateFormat === 'MM/DD/YYYY') {
      if (isValidYmd(y, p1, p2)) return { isoDate: formatYmd(y, p1, p2), status: 'OK' };
      return { isoDate: null, status: 'INVALID', message: `วันที่ไม่ตรงรูปแบบ MM/DD/YYYY ("${trimmed}")` };
    }

    // AUTO mode: never guess ambiguous dates where both p1 <= 12 and p2 <= 12 and p1 !== p2!
    if (p1 <= 12 && p2 <= 12 && p1 !== p2) {
      return {
        isoDate: null,
        status: 'AMBIGUOUS',
        message: `วันที่กำกวม ("${trimmed}") ไม่สามารถระบุได้ว่าเป็น DD/MM/YYYY หรือ MM/DD/YYYY กรุณาเลือก Date Format ก่อนนำเข้า`,
      };
    }

    if (p1 > 12 && isValidYmd(y, p2, p1)) {
      return { isoDate: formatYmd(y, p2, p1), status: 'OK' };
    }
    if (p2 > 12 && isValidYmd(y, p1, p2)) {
      return { isoDate: formatYmd(y, p1, p2), status: 'OK' };
    }
    if (p1 === p2 && isValidYmd(y, p1, p2)) {
      return { isoDate: formatYmd(y, p1, p2), status: 'OK' };
    }
    return { isoDate: null, status: 'INVALID', message: `วันที่ไม่ถูกต้อง ("${trimmed}")` };
  }

  return { isoDate: null, status: 'INVALID', message: `รูปแบบวันที่ไม่รองรับ ("${trimmed}")` };
}

// ============================================================================
// 6. VALIDATION & 3-LEVEL DUPLICATE DETECTION ENGINE
// ============================================================================
export interface ExistingCoilLookup {
  coilId: string;
  batchNo: string;
  materialCode: string;
  weightKg: number | null;
  widthMm: number | null;
  thicknessMm: number | null;
  lifecycleStatus: string;
  hasActiveInventory: boolean;
  currentLocationCode: string | null;
}

export interface PreSapCoilCandidate {
  coilDbId: number;
  provisionalCoilId: string;
  batchNo: string;
  currentLocationCode: string | null;
  levelNumber: number | null;
  slotNumber: number | null;
  locationMaxWeightKg: number | null;
  levelMaxWeightKg: number | null;
  lowerLeftWeightKg: number | null;
  lowerRightWeightKg: number | null;
}

export interface ValidatedStagingRow {
  rowIndex: number;
  rawRowJson: Record<string, string>;
  mappedDataJson: Record<string, string | number | null>;
  existingSnapshotJson: Record<string, unknown> | null;
  validationIssues: SapValidationIssue[];
  coilIdText: string | null;
  batchNoText: string | null;
  materialCodeText: string | null;
  materialDescription: string | null;
  plantText: string | null;
  sapStorageLocationText: string | null;
  materialDocumentText: string | null;
  fiscalYearText: string | null;
  documentItemText: string | null;
  deliveryNumberText: string | null;
  purchaseOrderText: string | null;
  vendorCodeText: string | null;
  vendorNameText: string | null;
  weightKg: number | null;
  grossWeightKg: number | null;
  netWeightKg: number | null;
  thicknessMm: number | null;
  targetThicknessMm: number | null;
  widthMm: number | null;
  outerDiameterMm: number | null;
  innerDiameterMm: number | null;
  gradeText: string | null;
  skinpassText: string | null;
  heatNoText: string | null;
  unitOfMeasureText: string | null;
  postingDateText: string | null;
  documentDateText: string | null;
  referenceText: string | null;
  scannedLocationRefText: string | null;
  validationStatus: SapValidationStatus;
  duplicateType: SapDuplicateType;
  validationMessage: string | null;
}

export interface BatchValidationResult {
  rows: ValidatedStagingRow[];
  summary: {
    totalRows: number;
    validRows: number;
    warningRows: number;
    errorRows: number;
    duplicateRows: number;
    newRecords: number;
    reconcileRecords: number;
  };
}

export function validateSapImportRows(params: {
  dataRows: ParsedSheetTable['dataRows'];
  mapping: Record<string, string>;
  dateFormat: SapDateFormat;
  decimalSeparator?: '.' | ',';
  existingCoilsByCoilId: Map<string, ExistingCoilLookup>;
  preSapCoilsByBatchNo?: Map<string, PreSapCoilCandidate[]>;
}): BatchValidationResult {
  const {
    dataRows,
    mapping,
    dateFormat,
    decimalSeparator = '.',
    existingCoilsByCoilId,
    preSapCoilsByBatchNo,
  } = params;

  const seenCoilIdsInFile = new Map<string, number>(); // coilId -> first rowNumber
  const consumedPreSapQueueByBatch = new Map<string, PreSapCoilCandidate[]>();
  if (preSapCoilsByBatchNo) {
    for (const [k, list] of preSapCoilsByBatchNo.entries()) {
      consumedPreSapQueueByBatch.set(k.toUpperCase(), [...list]);
    }
  }
  const validatedRows: ValidatedStagingRow[] = [];

  let validRows = 0;
  let warningRows = 0;
  let errorRows = 0;
  let duplicateRows = 0;
  let newRecords = 0;
  let reconcileRecords = 0;

  const readFieldRaw = (raw: Record<string, string>, key: SapTargetFieldKey): { col: string | null; val: string } => {
    const col = mapping[key] ?? null;
    if (!col) return { col: null, val: '' };
    return { col, val: (raw[col] ?? '').trim() };
  };

  for (const row of dataRows) {
    const issues: SapValidationIssue[] = [];
    const numericSet = new Set(row.numericCellHeaders);

    // 1. Extract String / Leading-Zero fields (strictly as String)
    const coilIdField = readFieldRaw(row.rawByHeader, 'coil_id');
    const batchField = readFieldRaw(row.rawByHeader, 'batch_number');
    const matCodeField = readFieldRaw(row.rawByHeader, 'material_code');
    const matDescField = readFieldRaw(row.rawByHeader, 'material_description');
    const plantField = readFieldRaw(row.rawByHeader, 'plant');
    const slocField = readFieldRaw(row.rawByHeader, 'storage_location');
    const docNumField = readFieldRaw(row.rawByHeader, 'document_number');
    const docItemField = readFieldRaw(row.rawByHeader, 'document_item');
    const deliveryField = readFieldRaw(row.rawByHeader, 'delivery_number');
    const poField = readFieldRaw(row.rawByHeader, 'purchase_order');
    const vendorCodeField = readFieldRaw(row.rawByHeader, 'vendor_code');
    const vendorNameField = readFieldRaw(row.rawByHeader, 'vendor_name');
    const gradeField = readFieldRaw(row.rawByHeader, 'grade');
    const skinpassField = readFieldRaw(row.rawByHeader, 'skinpass');
    const heatNoField = readFieldRaw(row.rawByHeader, 'heat_no');
    const uomField = readFieldRaw(row.rawByHeader, 'unit_of_measure');
    const refTextField = readFieldRaw(row.rawByHeader, 'reference_text');
    const scanLocField = readFieldRaw(row.rawByHeader, 'scanned_location_ref');

    // Warn if an identifier cell was stored as pure Excel Number (potential source leading-zero loss)
    for (const [fieldKey, fieldObj] of [
      ['coil_id', coilIdField],
      ['batch_number', batchField],
      ['material_code', matCodeField],
      ['document_number', docNumField],
      ['document_item', docItemField],
    ] as const) {
      if (fieldObj.col && fieldObj.val && numericSet.has(fieldObj.col) && /^\d+$/.test(fieldObj.val)) {
        issues.push({
          columnName: fieldObj.col,
          targetField: fieldKey,
          rawValue: fieldObj.val,
          errorCode: 'NUMERIC_IDENTIFIER_WARNING',
          message: `คอลัมน์ "${fieldObj.col}" ถูกจัดเก็บเป็น Numeric Cell ใน Excel ต้นทาง อาจสูญเสียเลข 0 ด้านหน้า (ระบบไม่เดาเติมเลข 0 อัตโนมัติ)`,
          severity: 'WARNING',
          suggestedResolution: 'ตรวจสอบความถูกต้องของเลขศูนย์ด้านหน้าหรือจัดรูปแบบคอลัมน์ใน Excel เป็น Text',
        });
      }
    }

    // 2. Required fields check
    if (!coilIdField.val) {
      issues.push({
        columnName: coilIdField.col,
        targetField: 'coil_id',
        rawValue: '',
        errorCode: 'REQUIRED_COIL_ID',
        message: 'ไม่พบหมายเลขคอยล์ (Coil ID ห้ามว่าง)',
        severity: 'ERROR',
        suggestedResolution: 'ระบุ Coil ID ในไฟล์ต้นทางหรือตรวจสอบการ Mapping คอลัมน์ coil_id',
      });
    }
    if (!batchField.val) {
      issues.push({
        columnName: batchField.col,
        targetField: 'batch_number',
        rawValue: '',
        errorCode: 'REQUIRED_BATCH_NO',
        message: 'ไม่พบเลขที่ Batch (Batch Number ห้ามว่าง)',
        severity: 'ERROR',
        suggestedResolution: 'ระบุ Batch Number ในไฟล์ต้นทางหรือตรวจสอบการ Mapping คอลัมน์ batch_number',
      });
    }

    // 3. Numeric fields validation
    const parseNumField = (key: SapTargetFieldKey, mustBePositiveIfPresent = true): number | null => {
      const f = readFieldRaw(row.rawByHeader, key);
      if (!f.val) return null;
      const parsed = parseSapNumeric(f.val, decimalSeparator);
      if (parsed.error) {
        issues.push({
          columnName: f.col,
          targetField: key,
          rawValue: f.val,
          errorCode: `INVALID_${key.toUpperCase()}`,
          message: `${key}: ${parsed.error}`,
          severity: 'ERROR',
          suggestedResolution: 'แก้ไขค่าให้เป็นตัวเลขที่ไม่ติดลบและใช้เครื่องหมายทศนิยมให้ถูกต้อง',
        });
        return null;
      }
      if (mustBePositiveIfPresent && parsed.value !== null && parsed.value <= 0) {
        issues.push({
          columnName: f.col,
          targetField: key,
          rawValue: f.val,
          errorCode: `NON_POSITIVE_${key.toUpperCase()}`,
          message: `${key} ต้องมากกว่า 0 ("${f.val}")`,
          severity: 'ERROR',
          suggestedResolution: 'ระบุค่ามากกว่า 0 หรือเว้นว่างหากไม่มีข้อมูล',
        });
        return null;
      }
      return parsed.value;
    };

    const netWeightKg = parseNumField('net_weight', true);
    const grossWeightKg = parseNumField('gross_weight', true);
    const thicknessMm = parseNumField('thickness', true);
    const targetThicknessMm = parseNumField('target_thickness', true);
    const widthMm = parseNumField('width', true);
    const outerDiameterMm = parseNumField('outer_diameter', true);
    const innerDiameterMm = parseNumField('inner_diameter', true);

    if (
      outerDiameterMm !== null &&
      innerDiameterMm !== null &&
      innerDiameterMm >= outerDiameterMm
    ) {
      issues.push({
        columnName: mapping['inner_diameter'] ?? null,
        targetField: 'inner_diameter',
        rawValue: String(innerDiameterMm),
        errorCode: 'INVALID_DIAMETER_RATIO',
        message: 'Inner Diameter (ID) ต้องน้อยกว่า Outer Diameter (OD)',
        severity: 'ERROR',
        suggestedResolution: 'ตรวจสอบค่า OD และ ID ที่สลับกันในไฟล์ต้นทาง',
      });
    }

    // Check UOM consistency warning (never auto-convert!)
    const uomUpper = uomField.val.toUpperCase();
    if (uomUpper && !['KG', 'KGM', 'KGS'].includes(uomUpper)) {
      issues.push({
        columnName: uomField.col,
        targetField: 'unit_of_measure',
        rawValue: uomField.val,
        errorCode: 'NON_KG_UNIT_WARNING',
        message: `พบหน่วยนับ "${uomField.val}" ซึ่งไม่ใช่ KG — ระบบจะไม่แปลงหน่วยโดยอัตโนมัติ`,
        severity: 'WARNING',
        suggestedResolution: 'ตรวจสอบหน่วยน้ำหนักในไฟล์ SAP ให้สอดคล้องกับหน่วย KG ของระบบ',
      });
    }

    // Effective primary weight (prefers Net/Unrestricted weight, falls back to Gross/Actual weight)
    const effectiveWeightKg = netWeightKg ?? grossWeightKg ?? null;

    // 4. Date fields validation (including ambiguous date protection)
    const parseDateField = (key: 'posting_date' | 'document_date'): string | null => {
      const f = readFieldRaw(row.rawByHeader, key);
      if (!f.val) return null;
      const parsed = parseSapDate(f.val, dateFormat);
      if (parsed.status === 'INVALID') {
        issues.push({
          columnName: f.col,
          targetField: key,
          rawValue: f.val,
          errorCode: `INVALID_${key.toUpperCase()}`,
          message: parsed.message ?? 'วันที่ไม่ถูกต้อง',
          severity: 'ERROR',
          suggestedResolution: 'ตรวจสอบรูปแบบวันที่ในไฟล์ต้นทางให้ถูกต้อง',
        });
        return null;
      }
      if (parsed.status === 'AMBIGUOUS') {
        issues.push({
          columnName: f.col,
          targetField: key,
          rawValue: f.val,
          errorCode: `AMBIGUOUS_${key.toUpperCase()}`,
          message: parsed.message ?? 'วันที่กำกวม',
          severity: 'WARNING',
          suggestedResolution: 'เลือก Date Format (DD/MM/YYYY หรือ MM/DD/YYYY) ในขั้นตอน Mapping แล้วกด Validate ใหม่',
        });
        return f.val;
      }
      return parsed.isoDate;
    };

    const postingDateText = parseDateField('posting_date');
    const documentDateText = parseDateField('document_date');

    // 5. 3-Level Duplicate Detection (File -> Active Inventory -> Existing Reference / Conflict)
    let duplicateType: SapDuplicateType = 'NEW_RECORD';
    let existingSnapshotJson: Record<string, unknown> | null = null;

    if (coilIdField.val) {
      const firstSeenRow = seenCoilIdsInFile.get(coilIdField.val);
      if (firstSeenRow !== undefined) {
        duplicateType = 'DUPLICATE_IN_FILE';
        issues.push({
          columnName: coilIdField.col,
          targetField: 'coil_id',
          rawValue: coilIdField.val,
          errorCode: 'DUPLICATE_IN_FILE',
          message: `พบ Coil ID "${coilIdField.val}" ซ้ำภายในไฟล์เดียวกัน (ซ้ำกับแถวที่ ${firstSeenRow})`,
          severity: 'ERROR',
          suggestedResolution: 'ลบแถวที่ซ้ำออกจากไฟล์ Excel ก่อนนำเข้า (ระบบจะไม่นำเข้าแถวซ้ำ)',
        });
      } else {
        seenCoilIdsInFile.set(coilIdField.val, row.rowNumber);

        const existing = existingCoilsByCoilId.get(coilIdField.val);
        if (existing) {
          existingSnapshotJson = {
            coilId: existing.coilId,
            batchNo: existing.batchNo,
            materialCode: existing.materialCode,
            weightKg: existing.weightKg,
            widthMm: existing.widthMm,
            thicknessMm: existing.thicknessMm,
            lifecycleStatus: existing.lifecycleStatus,
            hasActiveInventory: existing.hasActiveInventory,
            currentLocationCode: existing.currentLocationCode,
          };

          if (existing.hasActiveInventory) {
            duplicateType = 'ALREADY_IN_INVENTORY';
            issues.push({
              columnName: coilIdField.col,
              targetField: 'coil_id',
              rawValue: coilIdField.val,
              errorCode: 'ALREADY_IN_INVENTORY',
              message: `Coil ID "${coilIdField.val}" อยู่ใน Active Inventory แล้ว (${existing.currentLocationCode ?? existing.lifecycleStatus}) — ห้ามเขียนทับสต็อกจริง`,
              severity: 'ERROR',
              suggestedResolution: 'ข้ามรายการนี้ ระบบป้องกันการเขียนทับข้อมูลสต็อกที่รับเข้าคลังแล้ว',
            });
          } else {
            // Compare key attributes to detect DATA_CONFLICT vs identical EXISTING_REFERENCE
            const batchMismatch = Boolean(batchField.val && existing.batchNo !== batchField.val);
            const matMismatch = Boolean(
              matCodeField.val && existing.materialCode && existing.materialCode !== matCodeField.val
            );
            const weightMismatch =
              effectiveWeightKg !== null &&
              existing.weightKg !== null &&
              Math.abs(existing.weightKg - effectiveWeightKg) > 0.01;

            if (batchMismatch || matMismatch || weightMismatch) {
              duplicateType = 'DATA_CONFLICT';
              const diffs: string[] = [];
              if (batchMismatch) diffs.push(`Batch (${existing.batchNo} ≠ ${batchField.val})`);
              if (matMismatch) diffs.push(`Material (${existing.materialCode} ≠ ${matCodeField.val})`);
              if (weightMismatch) diffs.push(`Weight (${existing.weightKg} ≠ ${effectiveWeightKg})`);

              issues.push({
                columnName: coilIdField.col,
                targetField: 'coil_id',
                rawValue: coilIdField.val,
                errorCode: 'DATA_CONFLICT',
                message: `ข้อมูล Coil ID "${coilIdField.val}" ขัดแย้งกับข้อมูล SAP Reference เดิม: ${diffs.join(', ')}`,
                severity: 'ERROR',
                suggestedResolution: 'ตรวจสอบความแตกต่างระหว่างข้อมูลเดิมและข้อมูลใหม่ก่อนดำเนินการ (ระบบไม่เขียนทับอัตโนมัติ)',
              });
            } else {
              duplicateType = 'EXISTING_REFERENCE';
              issues.push({
                columnName: coilIdField.col,
                targetField: 'coil_id',
                rawValue: coilIdField.val,
                errorCode: 'EXISTING_REFERENCE',
                message: `Coil ID "${coilIdField.val}" มีอยู่ในฐานข้อมูล SAP Reference แล้ว (สถานะ ${existing.lifecycleStatus}) — ระบบจะข้ามไม่นำเข้าซ้ำ`,
                severity: 'INFO',
                suggestedResolution: 'ไม่จำเป็นต้องแก้ไข ระบบจะข้ามรายการนี้โดยอัตโนมัติเพื่อป้องกันข้อมูลซ้ำ',
              });
            }
          }
        } else if (batchField.val) {
          // Check if there is an unmatched Pre-SAP provisional coil already placed in 3D under this Batch No.
          const queue = consumedPreSapQueueByBatch.get(batchField.val.toUpperCase());
          const matchedPreSap = queue && queue.length > 0 ? queue.shift() : undefined;
          if (matchedPreSap) {
            duplicateType = 'RECONCILE_PRE_SAP';
            existingSnapshotJson = {
              reconcileCoilDbId: matchedPreSap.coilDbId,
              coilId: matchedPreSap.provisionalCoilId,
              batchNo: matchedPreSap.batchNo,
              currentLocationCode: matchedPreSap.currentLocationCode,
              levelNumber: matchedPreSap.levelNumber,
              slotNumber: matchedPreSap.slotNumber,
              sourceType: 'PRE_SAP_INBOUND',
            };

            const locText = matchedPreSap.currentLocationCode ?? '3D Warehouse';
            issues.push({
              columnName: batchField.col,
              targetField: 'batch_number',
              rawValue: batchField.val,
              errorCode: 'RECONCILE_PRE_SAP_MATCH',
              message: `พบม้วนเหล็กรับเข้าก่อน SAP ในตำแหน่ง ${locText} (${matchedPreSap.provisionalCoilId}) — ระบบจะจับคู่เติมข้อมูล SAP ลงม้วนเดิมอัตโนมัติโดยคงตำแหน่ง 3D เดิม`,
              severity: 'INFO',
              suggestedResolution: 'กดยืนยันนำเข้าเพื่ออัปเดตสเปก SAP ลงม้วนเหล็กในตำแหน่ง 3D เดิมโดยอัตโนมัติ',
            });

            // Post-Sync Weight Safety Verification for Pre-SAP coils
            const maxSapWeight = Math.max(netWeightKg ?? 0, grossWeightKg ?? 0);
            if (maxSapWeight > 0) {
              const capLimit = Math.min(
                matchedPreSap.locationMaxWeightKg ?? Infinity,
                matchedPreSap.levelMaxWeightKg ?? Infinity
              );
              if (Number.isFinite(capLimit) && maxSapWeight > capLimit) {
                issues.push({
                  columnName: mapping['gross_weight'] ?? mapping['net_weight'] ?? null,
                  targetField: 'gross_weight',
                  rawValue: String(maxSapWeight),
                  errorCode: 'POST_SYNC_WEIGHT_OVER_CAPACITY',
                  message: `คำเตือนความปลอดภัย: น้ำหนักจริงจาก SAP (${maxSapWeight.toLocaleString('en-US')} kg) เกินพิกัดรับน้ำหนักของตำแหน่ง ${locText} (Max ${capLimit.toLocaleString('en-US')} kg)`,
                  severity: 'WARNING',
                  suggestedResolution: 'แจ้งหัวหน้าคลังตรวจสอบและย้ายม้วนเหล็กไปยังตำแหน่งที่รองรับน้ำหนักได้',
                });
              }

              if ((matchedPreSap.levelNumber ?? 1) >= 2) {
                const lowerLeft = matchedPreSap.lowerLeftWeightKg;
                const lowerRight = matchedPreSap.lowerRightWeightKg;
                if (
                  (lowerLeft !== null && lowerLeft > 0 && maxSapWeight > lowerLeft) ||
                  (lowerRight !== null && lowerRight > 0 && maxSapWeight > lowerRight)
                ) {
                  issues.push({
                    columnName: mapping['gross_weight'] ?? mapping['net_weight'] ?? null,
                    targetField: 'gross_weight',
                    rawValue: String(maxSapWeight),
                    errorCode: 'POST_SYNC_PYRAMID_WEIGHT_WARNING',
                    message: `คำเตือนซ้อนชั้น ${matchedPreSap.levelNumber}: น้ำหนักจาก SAP (${maxSapWeight.toLocaleString('en-US')} kg) หนักกว่าม้วนรองรับด้านล่างที่ตำแหน่ง ${locText}`,
                    severity: 'WARNING',
                    suggestedResolution: 'แจ้งหัวหน้าคลังตรวจสอบการจัดเรียง Pyramid Stacking เพื่อความปลอดภัย',
                  });
                }
              }
            }
          }
        }
      }
    }

    // 6. Final Row Classification
    const hasError = issues.some((i) => i.severity === 'ERROR');
    const hasWarning = issues.some((i) => i.severity === 'WARNING');

    let validationStatus: SapValidationStatus;
    if (duplicateType === 'EXISTING_REFERENCE' && !hasError) {
      validationStatus = 'DUPLICATE';
      duplicateRows++;
    } else if (
      duplicateType === 'DUPLICATE_IN_FILE' ||
      duplicateType === 'ALREADY_IN_INVENTORY' ||
      duplicateType === 'DATA_CONFLICT'
    ) {
      validationStatus = hasError ? 'ERROR' : 'DUPLICATE';
      duplicateRows++;
      if (hasError) errorRows++;
    } else if (hasError) {
      validationStatus = 'ERROR';
      errorRows++;
    } else if (hasWarning) {
      validationStatus = 'WARNING';
      warningRows++;
      validRows++;
      if (duplicateType === 'RECONCILE_PRE_SAP') reconcileRecords++;
      else newRecords++;
    } else {
      validationStatus = 'VALID';
      validRows++;
      if (duplicateType === 'RECONCILE_PRE_SAP') reconcileRecords++;
      else newRecords++;
    }

    const mappedDataJson: Record<string, string | number | null> = {
      coil_id: coilIdField.val || null,
      batch_number: batchField.val || null,
      material_code: matCodeField.val || null,
      material_description: matDescField.val || null,
      plant: plantField.val || null,
      storage_location: slocField.val || null,
      document_number: docNumField.val || null,
      document_item: docItemField.val || null,
      delivery_number: deliveryField.val || null,
      purchase_order: poField.val || null,
      vendor_code: vendorCodeField.val || null,
      vendor_name: vendorNameField.val || null,
      net_weight: netWeightKg,
      gross_weight: grossWeightKg,
      thickness: thicknessMm,
      target_thickness: targetThicknessMm,
      width: widthMm,
      outer_diameter: outerDiameterMm,
      inner_diameter: innerDiameterMm,
      grade: gradeField.val || null,
      skinpass: skinpassField.val || null,
      heat_no: heatNoField.val || null,
      unit_of_measure: uomField.val || null,
      posting_date: postingDateText,
      document_date: documentDateText,
      reference_text: refTextField.val || null,
      scanned_location_ref: scanLocField.val || null,
    };

    validatedRows.push({
      rowIndex: row.rowNumber,
      rawRowJson: row.rawByHeader,
      mappedDataJson,
      existingSnapshotJson,
      validationIssues: issues,
      coilIdText: coilIdField.val || null,
      batchNoText: batchField.val || null,
      materialCodeText: matCodeField.val || null,
      materialDescription: matDescField.val || null,
      plantText: plantField.val || null,
      sapStorageLocationText: slocField.val || null,
      materialDocumentText: docNumField.val || null,
      fiscalYearText: postingDateText ? postingDateText.slice(0, 4) : null,
      documentItemText: docItemField.val || null,
      deliveryNumberText: deliveryField.val || null,
      purchaseOrderText: poField.val || null,
      vendorCodeText: vendorCodeField.val || null,
      vendorNameText: vendorNameField.val || null,
      weightKg: effectiveWeightKg,
      grossWeightKg,
      netWeightKg,
      thicknessMm,
      targetThicknessMm,
      widthMm,
      outerDiameterMm,
      innerDiameterMm,
      gradeText: gradeField.val || null,
      skinpassText: skinpassField.val || null,
      heatNoText: heatNoField.val || null,
      unitOfMeasureText: uomField.val || null,
      postingDateText,
      documentDateText,
      referenceText: refTextField.val || null,
      scannedLocationRefText: scanLocField.val || null,
      validationStatus,
      duplicateType,
      validationMessage: issues.length > 0 ? issues.map((i) => i.message).join(' | ') : null,
    });
  }

  return {
    rows: validatedRows,
    summary: {
      totalRows: validatedRows.length,
      validRows,
      warningRows,
      errorRows,
      duplicateRows,
      newRecords,
      reconcileRecords,
    },
  };
}

// ============================================================================
// 7. ERROR REPORT EXPORT (CSV & XLSX WITH FORMULA INJECTION PROTECTION)
// ============================================================================
export interface ErrorReportRowInput {
  rowIndex: number;
  coilIdText: string | null;
  batchNoText: string | null;
  columnName: string | null;
  targetField: string | null;
  errorCode: string;
  errorMessage: string;
  severity: string;
  suggestedResolution: string | null;
}

function escapeCsvCell(value: unknown): string {
  const safe = sanitizeFormulaInjection(value);
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function generateErrorReportCsv(errors: ErrorReportRowInput[]): string {
  const headers = [
    'Original Row Number',
    'Coil ID',
    'Batch',
    'Source Column',
    'Target Field',
    'Error Code',
    'Error Description',
    'Severity',
    'Suggested Resolution',
  ];

  const lines = [headers.join(',')];
  for (const err of errors) {
    lines.push(
      [
        err.rowIndex,
        escapeCsvCell(err.coilIdText ?? ''),
        escapeCsvCell(err.batchNoText ?? ''),
        escapeCsvCell(err.columnName ?? ''),
        escapeCsvCell(err.targetField ?? ''),
        escapeCsvCell(err.errorCode),
        escapeCsvCell(err.errorMessage),
        escapeCsvCell(err.severity),
        escapeCsvCell(err.suggestedResolution ?? ''),
      ].join(',')
    );
  }
  // Prepend UTF-8 BOM so Thai characters open cleanly in Microsoft Excel
  return `\uFEFF${lines.join('\r\n')}`;
}

export function generateErrorReportXlsx(errors: ErrorReportRowInput[]): Buffer {
  const aoa: Array<Array<string | number>> = [
    [
      'Original Row Number',
      'Coil ID',
      'Batch',
      'Source Column',
      'Target Field',
      'Error Code',
      'Error Description',
      'Severity',
      'Suggested Resolution',
    ],
  ];

  for (const err of errors) {
    aoa.push([
      err.rowIndex,
      sanitizeFormulaInjection(err.coilIdText ?? ''),
      sanitizeFormulaInjection(err.batchNoText ?? ''),
      sanitizeFormulaInjection(err.columnName ?? ''),
      sanitizeFormulaInjection(err.targetField ?? ''),
      sanitizeFormulaInjection(err.errorCode),
      sanitizeFormulaInjection(err.errorMessage),
      sanitizeFormulaInjection(err.severity),
      sanitizeFormulaInjection(err.suggestedResolution ?? ''),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'SAP_Import_Errors');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}
