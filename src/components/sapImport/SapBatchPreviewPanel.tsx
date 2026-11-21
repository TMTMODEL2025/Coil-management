import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Eye,
  Search,
  X,
} from 'lucide-react';
import { apiDownloadBlob, apiFetch } from '../../lib/api';
import type { SapImportBatchSummary, SapStagingPreviewRow } from '../../types/sapImport';
import {
  getDuplicateTypeMeta,
  getImportResultMeta,
  getSeverityBadgeClass,
  getValidationStatusMeta,
} from './sapImportFormatters';

interface PreviewResponse {
  batch: SapImportBatchSummary;
  rows: SapStagingPreviewRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface SapBatchPreviewPanelProps {
  batchId: number;
  refreshKey?: number;
  onBatchLoaded?: (batch: SapImportBatchSummary) => void;
}

const OPTIONAL_COLUMNS = [
  { key: 'materialDescription', label: 'Description' },
  { key: 'grade', label: 'Grade / Skinpass' },
  { key: 'dimensions', label: 'Thickness / Width' },
  { key: 'grossWeight', label: 'นน. ชั่งจริง (Gross)' },
  { key: 'heatNo', label: 'HEAT NO.' },
  { key: 'sapSloc', label: 'SAP SLoc' },
  { key: 'referenceText', label: 'text สภาพ / Ref' },
  { key: 'scannedLocationRef', label: 'ตำแหน่งอ้างอิง (Info)' },
] as const;

type OptionalColKey = (typeof OPTIONAL_COLUMNS)[number]['key'];

export function SapBatchPreviewPanel({
  batchId,
  refreshKey = 0,
  onBatchLoaded,
}: SapBatchPreviewPanelProps) {
  const [batch, setBatch] = useState<SapImportBatchSummary | null>(null);
  const [rows, setRows] = useState<SapStagingPreviewRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [validationStatus, setValidationStatus] = useState('ALL');
  const [duplicateType, setDuplicateType] = useState('ALL');
  const [importResultStatus, setImportResultStatus] = useState('ALL');
  const [page, setPage] = useState(1);

  const [showColPicker, setShowColPicker] = useState(false);
  const [visibleCols, setVisibleCols] = useState<Record<OptionalColKey, boolean>>({
    materialDescription: true,
    grade: true,
    dimensions: true,
    grossWeight: true,
    heatNo: true,
    sapSloc: false,
    referenceText: false,
    scannedLocationRef: true,
  });

  const [selectedRow, setSelectedRow] = useState<SapStagingPreviewRow | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('pageSize', '25');
      if (searchQuery.trim()) qs.set('search', searchQuery.trim());
      if (validationStatus !== 'ALL') qs.set('validationStatus', validationStatus);
      if (duplicateType !== 'ALL') qs.set('duplicateType', duplicateType);
      if (importResultStatus !== 'ALL') qs.set('importResultStatus', importResultStatus);

      const res = await apiFetch<PreviewResponse>(
        `/api/sap-import/batches/${batchId}/preview?${qs.toString()}`
      );
      setBatch(res.batch);
      setRows(res.rows);
      setPagination(res.pagination);
      onBatchLoaded?.(res.batch);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูล Preview ได้');
    } finally {
      setLoading(false);
    }
  }, [batchId, page, searchQuery, validationStatus, duplicateType, importResultStatus, onBatchLoaded]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview, refreshKey]);

  const handleExportErrors = async (format: 'csv' | 'xlsx') => {
    setExporting(format);
    try {
      await apiDownloadBlob(
        `/api/sap-import/batches/${batchId}/error-report?format=${format}`,
        `${batch?.batchCode || `batch-${batchId}`}_error_report.${format}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถดาวน์โหลด Error Report ได้');
    } finally {
      setExporting(null);
    }
  };

  const toggleColumn = (key: OptionalColKey) => {
    setVisibleCols((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-4">
      {/* Validation & Import Summary Strip */}
      {batch && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="bg-slate-50 border border-slate-200 rounded-md px-3 py-2">
            <div className="text-[11px] text-slate-500">Total Rows</div>
            <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
              {batch.totalRows}
            </div>
          </div>
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-md px-3 py-2">
            <div className="text-[11px] text-emerald-700">Valid (Ready)</div>
            <div className="text-lg font-bold font-mono tabular-nums text-emerald-800">
              {batch.validRows}
            </div>
          </div>
          <div className="bg-amber-50/70 border border-amber-200 rounded-md px-3 py-2">
            <div className="text-[11px] text-amber-800">Warnings</div>
            <div className="text-lg font-bold font-mono tabular-nums text-amber-900">
              {batch.warningRows}
            </div>
          </div>
          <div className="bg-sky-50/70 border border-sky-200 rounded-md px-3 py-2">
            <div className="text-[11px] text-sky-800">Duplicates</div>
            <div className="text-lg font-bold font-mono tabular-nums text-sky-900">
              {batch.duplicateRows}
            </div>
          </div>
          <div className="bg-red-50/70 border border-red-200 rounded-md px-3 py-2">
            <div className="text-[11px] text-red-700">Errors</div>
            <div className="text-lg font-bold font-mono tabular-nums text-red-800">
              {batch.errorRows}
            </div>
          </div>
          <div className="bg-blue-50/70 border border-blue-200 rounded-md px-3 py-2">
            <div className="text-[11px] text-blue-800">Imported / Skipped</div>
            <div className="text-lg font-bold font-mono tabular-nums text-blue-900">
              {batch.importedRows} / {batch.skippedRows}
            </div>
          </div>
        </div>
      )}

      {/* Search, Filter & Export Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearchQuery(searchInput);
          }}
          className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]"
        >
          <div className="relative flex-1 min-w-[200px] max-w-xs">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ค้นหา Coil ID, Batch, Material, HEAT..."
              aria-label="ค้นหาข้อมูลใน Preview"
              className="w-full min-h-[38px] pl-9 pr-3 rounded-md border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <button
            type="submit"
            className="min-h-[38px] px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
          >
            ค้นหา
          </button>

          <select
            aria-label="กรองตามสถานะ Validation"
            value={validationStatus}
            onChange={(e) => {
              setValidationStatus(e.target.value);
              setPage(1);
            }}
            className="min-h-[38px] px-2.5 rounded-md border border-slate-300 text-xs bg-white text-slate-800"
          >
            <option value="ALL">สถานะทั้งหมด (All Status)</option>
            <option value="VALID">VALID</option>
            <option value="WARNING">WARNING</option>
            <option value="DUPLICATE">DUPLICATE</option>
            <option value="ERROR">ERROR</option>
          </select>

          <select
            aria-label="กรองตามประเภทข้อมูลซ้ำ"
            value={duplicateType}
            onChange={(e) => {
              setDuplicateType(e.target.value);
              setPage(1);
            }}
            className="min-h-[38px] px-2.5 rounded-md border border-slate-300 text-xs bg-white text-slate-800"
          >
            <option value="ALL">Duplicate ทั้งหมด</option>
            <option value="NEW_RECORD">New Record</option>
            <option value="RECONCILE_PRE_SAP">เชื่อมม้วนใน 3D อัตโนมัติ (Pre-SAP)</option>
            <option value="EXISTING_REFERENCE">Existing Reference</option>
            <option value="DUPLICATE_IN_FILE">Duplicate in File</option>
            <option value="ALREADY_IN_INVENTORY">Already in Inventory</option>
            <option value="DATA_CONFLICT">Data Conflict</option>
          </select>

          <select
            aria-label="กรองตามผลการนำเข้า"
            value={importResultStatus}
            onChange={(e) => {
              setImportResultStatus(e.target.value);
              setPage(1);
            }}
            className="min-h-[38px] px-2.5 rounded-md border border-slate-300 text-xs bg-white text-slate-800"
          >
            <option value="ALL">ผลนำเข้าทั้งหมด</option>
            <option value="PENDING">PENDING</option>
            <option value="IMPORTED">IMPORTED</option>
            <option value="RECONCILED">RECONCILED (อัปเดตม้วนเดิม)</option>
            <option value="SKIPPED_DUPLICATE">SKIPPED_DUPLICATE</option>
            <option value="SKIPPED_ERROR">SKIPPED_ERROR</option>
          </select>
        </form>

        <div className="flex flex-wrap items-center gap-2 relative">
          <button
            type="button"
            onClick={() => setShowColPicker((v) => !v)}
            className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 cursor-pointer"
          >
            <Columns3 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>คอลัมน์</span>
          </button>

          {showColPicker && (
            <div className="absolute right-0 top-11 z-20 w-56 bg-white border border-slate-200 rounded-lg shadow-lg p-3 space-y-1.5">
              <div className="text-xs font-semibold text-slate-800 pb-1 border-b border-slate-100">
                เลือกแสดงคอลัมน์เพิ่มเติม
              </div>
              {OPTIONAL_COLUMNS.map((c) => (
                <label
                  key={c.key}
                  className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer py-0.5"
                >
                  <input
                    type="checkbox"
                    checked={visibleCols[c.key]}
                    onChange={() => toggleColumn(c.key)}
                    className="rounded border-slate-300"
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          )}

          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => void handleExportErrors('xlsx')}
            className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{exporting === 'xlsx' ? 'กำลังสร้าง...' : 'Error Report (.xlsx)'}</span>
          </button>

          <button
            type="button"
            disabled={exporting !== null}
            onClick={() => void handleExportErrors('csv')}
            className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{exporting === 'csv' ? 'กำลังสร้าง...' : 'Error Report (.csv)'}</span>
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Preview Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-3">Row</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Coil ID</th>
                <th className="py-2.5 px-3">Batch No.</th>
                <th className="py-2.5 px-3">Material No.</th>
                {visibleCols.materialDescription && <th className="py-2.5 px-3">Description</th>}
                <th className="py-2.5 px-3 text-right">Net / Unrestr. (kg)</th>
                {visibleCols.grossWeight && <th className="py-2.5 px-3 text-right">ชั่งจริง (kg)</th>}
                {visibleCols.dimensions && <th className="py-2.5 px-3">หนา × กว้าง (mm)</th>}
                {visibleCols.grade && <th className="py-2.5 px-3">Grade</th>}
                {visibleCols.heatNo && <th className="py-2.5 px-3">HEAT NO.</th>}
                {visibleCols.sapSloc && <th className="py-2.5 px-3">SAP SLoc</th>}
                {visibleCols.referenceText && <th className="py-2.5 px-3">text สภาพ</th>}
                {visibleCols.scannedLocationRef && (
                  <th className="py-2.5 px-3">ตำแหน่งไฟล์ (Info)</th>
                )}
                <th className="py-2.5 px-3">Duplicate Check</th>
                <th className="py-2.5 px-3">Result</th>
                <th className="py-2.5 px-3 text-right">ตรวจสอบ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={16} className="py-10 text-center text-slate-500">
                    กำลังโหลดข้อมูล Preview...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={16} className="py-10 text-center text-slate-500">
                    ไม่พบรายการที่ตรงตามเงื่อนไขการค้นหา
                  </td>
                </tr>
              ) : (
                rows.map((row) => {
                  const vMeta = getValidationStatusMeta(row.validationStatus);
                  const dMeta = getDuplicateTypeMeta(row.duplicateType);
                  const rMeta = getImportResultMeta(row.importResultStatus);
                  return (
                    <tr
                      key={row.id}
                      className={`hover:bg-slate-50/90 ${
                        row.validationStatus === 'ERROR'
                          ? 'bg-red-50/30'
                          : row.validationStatus === 'WARNING'
                            ? 'bg-amber-50/20'
                            : ''
                      }`}
                    >
                      <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500">
                        {row.rowIndex}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border text-[11px] font-mono font-semibold ${vMeta.className}`}
                        >
                          {vMeta.label}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {row.coilIdText || <span className="text-red-500 italic">(ว่าง)</span>}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-800 whitespace-nowrap">
                        {row.batchNoText || <span className="text-red-500 italic">(ว่าง)</span>}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                        {row.materialCodeText || '-'}
                      </td>
                      {visibleCols.materialDescription && (
                        <td className="py-2.5 px-3 text-slate-700 max-w-[220px] truncate" title={row.materialDescription ?? ''}>
                          {row.materialDescription || '-'}
                        </td>
                      )}
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                        {row.netWeightKg !== null
                          ? row.netWeightKg.toLocaleString('en-US')
                          : row.weightKg !== null
                            ? row.weightKg.toLocaleString('en-US')
                            : '-'}
                      </td>
                      {visibleCols.grossWeight && (
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {row.grossWeightKg !== null ? row.grossWeightKg.toLocaleString('en-US') : '-'}
                        </td>
                      )}
                      {visibleCols.dimensions && (
                        <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {row.thicknessMm ?? '-'} × {row.widthMm ?? '-'}
                        </td>
                      )}
                      {visibleCols.grade && (
                        <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                          {row.gradeText || '-'}
                        </td>
                      )}
                      {visibleCols.heatNo && (
                        <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {row.heatNoText || '-'}
                        </td>
                      )}
                      {visibleCols.sapSloc && (
                        <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                          {row.sapStorageLocationText || '-'}
                        </td>
                      )}
                      {visibleCols.referenceText && (
                        <td className="py-2.5 px-3 font-mono text-slate-600 max-w-[160px] truncate">
                          {row.referenceText || '-'}
                        </td>
                      )}
                      {visibleCols.scannedLocationRef && (
                        <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                          {row.scannedLocationRefText || '-'}
                        </td>
                      )}
                      <td className={`py-2.5 px-3 whitespace-nowrap text-[11px] ${dMeta.className}`}>
                        {dMeta.label}
                      </td>
                      <td className={`py-2.5 px-3 whitespace-nowrap font-mono text-[11px] ${rMeta.className}`}>
                        {rMeta.label}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setSelectedRow(row)}
                          aria-label={`ดูรายละเอียดแถวที่ ${row.rowIndex}`}
                          className="min-h-[32px] px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Detail</span>
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div className="font-mono tabular-nums">
            แสดง {rows.length} จากทั้งหมด {pagination.total} แถว (หน้า {pagination.page} /{' '}
            {pagination.totalPages})
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="min-h-[34px] px-2.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>ก่อนหน้า</span>
            </button>
            <button
              type="button"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
              className="min-h-[34px] px-2.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
            >
              <span>ถัดไป</span>
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Row Detail & Conflict Comparison Modal */}
      {selectedRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`รายละเอียดแถวที่ ${selectedRow.rowIndex}`}
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between">
              <div>
                <div className="text-xs font-mono text-blue-300">
                  EXCEL ROW #{selectedRow.rowIndex} · {selectedRow.validationStatus} ·{' '}
                  {selectedRow.duplicateType}
                </div>
                <h3 className="text-sm font-semibold mt-0.5 font-mono">
                  Coil: {selectedRow.coilIdText || '(ไม่มี)'} · Batch:{' '}
                  {selectedRow.batchNoText || '(ไม่มี)'}
                </h3>
              </div>
              <button
                type="button"
                aria-label="ปิดหน้าต่างรายละเอียด"
                onClick={() => setSelectedRow(null)}
                className="min-h-[36px] min-w-[36px] rounded-md hover:bg-slate-800 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
              {/* Validation Issues */}
              {selectedRow.validationIssuesJson.length > 0 && (
                <div className="space-y-2">
                  <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
                    <span>รายการตรวจสอบและข้อผิดพลาด ({selectedRow.validationIssuesJson.length})</span>
                  </div>
                  <div className="space-y-2">
                    {selectedRow.validationIssuesJson.map((issue, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-md border ${getSeverityBadgeClass(issue.severity)}`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 font-mono font-semibold">
                          <span>
                            [{issue.severity}] {issue.errorCode}
                          </span>
                          <span>
                            {issue.columnName ? `Col: ${issue.columnName}` : ''}{' '}
                            {issue.targetField ? `→ ${issue.targetField}` : ''}
                          </span>
                        </div>
                        <p className="mt-1 text-slate-900">{issue.message}</p>
                        {issue.suggestedResolution && (
                          <p className="mt-1 text-[11px] opacity-90">
                            แนวทางแก้ไข: {issue.suggestedResolution}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Side-by-Side Conflict Comparison (Existing DB vs Uploaded File) */}
              {selectedRow.existingSnapshotJson && (
                <div className="border border-red-200 rounded-lg overflow-hidden">
                  <div className="bg-red-50 px-3.5 py-2 font-semibold text-red-900 border-b border-red-200">
                    เปรียบเทียบข้อมูลเดิมในระบบ vs ไฟล์ที่อัปโหลด (Conflict / Duplicate Comparison)
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                          <th className="py-2 px-3">Field</th>
                          <th className="py-2 px-3">Existing in WMS DB</th>
                          <th className="py-2 px-3">Uploaded Excel Row</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-mono">
                        {[
                          ['Coil ID', selectedRow.existingSnapshotJson.coilId, selectedRow.coilIdText],
                          ['Batch No.', selectedRow.existingSnapshotJson.batchNo, selectedRow.batchNoText],
                          [
                            'Material Code',
                            selectedRow.existingSnapshotJson.materialCode,
                            selectedRow.materialCodeText,
                          ],
                          ['Weight (kg)', selectedRow.existingSnapshotJson.weightKg, selectedRow.weightKg],
                          ['Thickness (mm)', selectedRow.existingSnapshotJson.thicknessMm, selectedRow.thicknessMm],
                          ['Width (mm)', selectedRow.existingSnapshotJson.widthMm, selectedRow.widthMm],
                          [
                            'Lifecycle / Location',
                            `${String(selectedRow.existingSnapshotJson.lifecycleStatus ?? '-')} ${
                              selectedRow.existingSnapshotJson.currentLocationCode
                                ? `(${String(selectedRow.existingSnapshotJson.currentLocationCode)})`
                                : ''
                            }`,
                            'PENDING_INBOUND (Reference Only)',
                          ],
                        ].map(([label, oldVal, newVal]) => {
                          const isDiff =
                            label !== 'Lifecycle / Location' &&
                            String(oldVal ?? '') !== String(newVal ?? '');
                          return (
                            <tr key={String(label)} className={isDiff ? 'bg-amber-50/70' : ''}>
                              <td className="py-2 px-3 font-sans font-medium text-slate-700">
                                {String(label)}
                              </td>
                              <td className="py-2 px-3 text-slate-900">{String(oldVal ?? '-')}</td>
                              <td
                                className={`py-2 px-3 ${
                                  isDiff ? 'text-red-700 font-semibold' : 'text-slate-900'
                                }`}
                              >
                                {String(newVal ?? '-')}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Raw Source Excel Row */}
              <div>
                <div className="font-semibold text-slate-900 mb-2">
                  ข้อมูลต้นฉบับจากไฟล์ Excel (Preserved Leading Zeros)
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(selectedRow.rawRowJson).map(([col, val]) => (
                    <div
                      key={col}
                      className="px-3 py-2 rounded border border-slate-200 bg-slate-50 flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-500 truncate">{col}</span>
                      <span className="font-mono font-medium text-slate-900 text-right break-all">
                        {val || '-'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
