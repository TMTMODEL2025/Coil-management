import type {
  SapDuplicateType,
  SapImportBatchStatus,
  SapImportResultStatus,
  SapValidationSeverity,
  SapValidationStatus,
} from '../../types/sapImport';

export function formatBangkokDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '-';
  return dt.toLocaleString('th-TH', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function generateIdempotencyKey(batchId: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sap-batch-${batchId}-${crypto.randomUUID()}`;
  }
  return `sap-batch-${batchId}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getBatchStatusMeta(status: SapImportBatchStatus): {
  labelTh: string;
  labelEn: string;
  className: string;
} {
  switch (status) {
    case 'COMPLETED':
      return {
        labelTh: 'นำเข้าสำเร็จ',
        labelEn: 'COMPLETED',
        className: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      };
    case 'COMPLETED_WITH_ERRORS':
      return {
        labelTh: 'สำเร็จบางส่วน',
        labelEn: 'PARTIAL',
        className: 'bg-amber-50 text-amber-800 border-amber-200',
      };
    case 'READY_TO_IMPORT':
      return {
        labelTh: 'พร้อมนำเข้า',
        labelEn: 'READY',
        className: 'bg-blue-50 text-blue-800 border-blue-200',
      };
    case 'VALIDATING':
    case 'IMPORTING':
      return {
        labelTh: status === 'VALIDATING' ? 'กำลังตรวจสอบ' : 'กำลังนำเข้า',
        labelEn: status,
        className: 'bg-indigo-50 text-indigo-800 border-indigo-200',
      };
    case 'FAILED':
      return {
        labelTh: 'ล้มเหลว',
        labelEn: 'FAILED',
        className: 'bg-red-50 text-red-800 border-red-200',
      };
    case 'CANCELLED':
      return {
        labelTh: 'ยกเลิกแล้ว',
        labelEn: 'CANCELLED',
        className: 'bg-slate-100 text-slate-600 border-slate-200',
      };
    default:
      return {
        labelTh: 'อัปโหลดแล้ว',
        labelEn: 'UPLOADED',
        className: 'bg-slate-100 text-slate-700 border-slate-200',
      };
  }
}

export function getValidationStatusMeta(status: SapValidationStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'VALID':
      return { label: 'VALID', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'WARNING':
      return { label: 'WARNING', className: 'bg-amber-50 text-amber-800 border-amber-200' };
    case 'DUPLICATE':
      return { label: 'DUPLICATE', className: 'bg-sky-50 text-sky-800 border-sky-200' };
    case 'ERROR':
      return { label: 'ERROR', className: 'bg-red-50 text-red-700 border-red-200' };
  }
}

export function getDuplicateTypeMeta(dup: SapDuplicateType): {
  label: string;
  className: string;
} {
  switch (dup) {
    case 'NEW_RECORD':
      return { label: 'New Record', className: 'text-emerald-700' };
    case 'RECONCILE_PRE_SAP':
      return { label: 'เชื่อมม้วนใน 3D อัตโนมัติ', className: 'text-amber-700 font-semibold' };
    case 'EXISTING_REFERENCE':
      return { label: 'Existing Ref (Skip)', className: 'text-sky-700' };
    case 'DUPLICATE_IN_FILE':
      return { label: 'Duplicate in File', className: 'text-red-700' };
    case 'ALREADY_IN_INVENTORY':
      return { label: 'In Active Inventory', className: 'text-red-800 font-semibold' };
    case 'DATA_CONFLICT':
      return { label: 'Data Conflict', className: 'text-red-700 font-semibold' };
  }
}

export function getImportResultMeta(status: SapImportResultStatus): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'IMPORTED':
      return { label: 'IMPORTED', className: 'text-emerald-700 font-semibold' };
    case 'RECONCILED':
      return { label: 'RECONCILED (อัปเดตม้วนเดิม)', className: 'text-amber-700 font-semibold' };
    case 'SKIPPED_DUPLICATE':
      return { label: 'SKIPPED (DUP)', className: 'text-sky-700' };
    case 'SKIPPED_ERROR':
      return { label: 'SKIPPED (ERR)', className: 'text-amber-700' };
    case 'FAILED':
      return { label: 'FAILED', className: 'text-red-700 font-semibold' };
    default:
      return { label: 'PENDING', className: 'text-slate-500' };
  }
}

export function getSeverityBadgeClass(severity: SapValidationSeverity): string {
  switch (severity) {
    case 'ERROR':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'WARNING':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    default:
      return 'bg-sky-50 text-sky-800 border-sky-200';
  }
}
