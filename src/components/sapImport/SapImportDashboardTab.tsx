import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Play,
  Search,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { apiDownloadBlob, apiFetch } from '../../lib/api';
import type { SapImportBatchSummary, SapImportDashboardResponse } from '../../types/sapImport';
import {
  formatBangkokDateTime,
  formatFileSize,
  getBatchStatusMeta,
} from './sapImportFormatters';
import { SapBatchPreviewPanel } from './SapBatchPreviewPanel';

interface SapImportDashboardTabProps {
  mode: 'dashboard' | 'history';
  isAdmin: boolean;
  refreshKey: number;
  onStartNewUpload: () => void;
  onResumeBatch: (batch: SapImportBatchSummary) => void;
  onRefreshRequested: () => void;
}

export function SapImportDashboardTab({
  mode,
  isAdmin,
  refreshKey,
  onStartNewUpload,
  onResumeBatch,
  onRefreshRequested,
}: SapImportDashboardTabProps) {
  const [data, setData] = useState<SapImportDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [importedByInput, setImportedByInput] = useState('');
  const [importedByFilter, setImportedByFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const [inspectBatch, setInspectBatch] = useState<SapImportBatchSummary | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set('page', String(page));
      qs.set('pageSize', mode === 'dashboard' ? '10' : '20');
      if (searchQuery.trim()) qs.set('search', searchQuery.trim());
      if (statusFilter !== 'ALL') qs.set('status', statusFilter);
      if (importedByFilter.trim()) qs.set('importedBy', importedByFilter.trim());
      if (dateFrom) qs.set('dateFrom', dateFrom);
      if (dateTo) qs.set('dateTo', dateTo);

      const res = await apiFetch<SapImportDashboardResponse>(
        `/api/sap-import/dashboard?${qs.toString()}`
      );
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูล SAP Import Dashboard ได้');
    } finally {
      setLoading(false);
    }
  }, [page, mode, searchQuery, statusFilter, importedByFilter, dateFrom, dateTo]);

  useEffect(() => {
    void loadData();
  }, [loadData, refreshKey]);

  const handleCancelBatch = async (batch: SapImportBatchSummary) => {
    setCancellingId(batch.id);
    setError(null);
    try {
      await apiFetch(`/api/sap-import/batches/${batch.id}/cancel`, { method: 'POST' });
      onRefreshRequested();
      void loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถยกเลิก Batch ได้');
    } finally {
      setCancellingId(null);
    }
  };

  const handleDownloadErrors = async (batch: SapImportBatchSummary, format: 'csv' | 'xlsx') => {
    try {
      await apiDownloadBlob(
        `/api/sap-import/batches/${batch.id}/error-report?format=${format}`,
        `${batch.batchCode}_error_report.${format}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถดาวน์โหลด Error Report ได้');
    }
  };

  const kpis = data?.kpis;
  const safety = data?.safetySnapshot;

  return (
    <div className="space-y-5">
      {/* Live Inventory Safety Proof Banner */}
      <div className="bg-white border border-emerald-200 rounded-lg px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 text-xs text-slate-700">
          <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <div className="font-semibold text-slate-900">
              SAP Excel-Only Policy &amp; Inventory Isolation Active
            </div>
            <p className="mt-0.5 text-slate-600">
              การนำเข้าไฟล์ SAP Excel บันทึกเฉพาะ{' '}
              <span className="font-mono font-semibold text-slate-800">
                SAP Reference Data (PENDING_INBOUND)
              </span>{' '}
              เท่านั้น — ไม่เชื่อมต่อ SAP API, ไม่เพิ่ม Active Inventory และไม่เปลี่ยนสถานะ Location
              อัตโนมัติ (รับเข้าคลังจริงใน Phase 5)
            </p>
          </div>
        </div>
        {safety && (
          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono tabular-nums shrink-0 bg-emerald-50/70 border border-emerald-200 rounded-md px-3 py-2 text-emerald-950">
            <span>Active Inv: {safety.activeInventoryCount}</span>
            <span className="text-emerald-300">|</span>
            <span>Occupied Loc: {safety.occupiedLocationCount}</span>
            <span className="text-emerald-300">|</span>
            <span>Reservations: {safety.activeReservationCount}</span>
            <span className="text-emerald-300">|</span>
            <span>Stock Tx: {safety.stockTransactionCount}</span>
          </div>
        )}
      </div>

      {/* 6 Summary KPI Cards (Dashboard Mode) */}
      {mode === 'dashboard' && (
        <section aria-label="SAP Import KPIs" className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <div className="bg-white border border-slate-200 rounded-lg p-3.5">
            <div className="text-[11px] font-medium text-slate-500">ไฟล์นำเข้าทั้งหมด</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {kpis?.totalImportFiles ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Total Import Files</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3.5">
            <div className="text-[11px] font-medium text-slate-500">นำเข้าสำเร็จ</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-700">
              {kpis?.successfulImports ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Successful Imports</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3.5">
            <div className="text-[11px] font-medium text-slate-500">มีคำเตือน / บางส่วน</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-amber-700">
              {kpis?.importsWithWarnings ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">With Warnings</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3.5">
            <div className="text-[11px] font-medium text-slate-500">นำเข้าไม่สำเร็จ</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-red-700">
              {kpis?.failedImports ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Failed Imports</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3.5">
            <div className="text-[11px] font-medium text-slate-500">SAP Reference Coils</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-[#1D4ED8]">
              {kpis?.totalSapReferenceCoils ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Total Reference Coils</div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3.5">
            <div className="text-[11px] font-medium text-slate-500">รอรับเข้าคลัง</div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-slate-900">
              {kpis?.pendingInboundCoils ?? 0}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">PENDING_INBOUND</div>
          </div>
        </section>
      )}

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {mode === 'dashboard'
                ? 'กิจกรรมการนำเข้าไฟล์ SAP Excel ล่าสุด (Recent Import Activity)'
                : 'ประวัติการนำเข้าทั้งหมด (Import History & Audit Trace)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ตรวจสอบสถานะ Batch, จำนวนแถว, ข้อผิดพลาด และดาวน์โหลด Error Report ย้อนหลังได้ทุกไฟล์
            </p>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={onStartNewUpload}
              className="min-h-[38px] px-4 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>อัปโหลดไฟล์ SAP Excel ใหม่</span>
            </button>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearchQuery(searchInput);
            setImportedByFilter(importedByInput);
          }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 pt-2 border-t border-slate-100"
        >
          <div className="relative lg:col-span-2">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ชื่อไฟล์ หรือ Batch Code (เช่น SAP-2026...)"
              aria-label="ค้นหาชื่อไฟล์หรือ Batch Code"
              className="w-full min-h-[38px] pl-9 pr-3 rounded-md border border-slate-300 text-xs"
            />
          </div>

          <select
            aria-label="กรองตามสถานะ Batch"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="min-h-[38px] px-2.5 rounded-md border border-slate-300 text-xs bg-white"
          >
            <option value="ALL">สถานะทั้งหมด</option>
            <option value="UPLOADED">UPLOADED</option>
            <option value="READY_TO_IMPORT">READY_TO_IMPORT</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="COMPLETED_WITH_ERRORS">COMPLETED_WITH_ERRORS</option>
            <option value="FAILED">FAILED</option>
            <option value="CANCELLED">CANCELLED</option>
          </select>

          <input
            type="text"
            value={importedByInput}
            onChange={(e) => setImportedByInput(e.target.value)}
            placeholder="ผู้นำเข้า (Email / Name)"
            aria-label="กรองตามผู้นำเข้า"
            className="min-h-[38px] px-3 rounded-md border border-slate-300 text-xs"
          />

          <div className="flex items-center gap-1.5">
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              aria-label="ตั้งแต่วันที่"
              className="w-full min-h-[38px] px-2 rounded-md border border-slate-300 text-xs"
            />
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              aria-label="ถึงวันที่"
              className="w-full min-h-[38px] px-2 rounded-md border border-slate-300 text-xs"
            />
          </div>

          <button
            type="submit"
            className="min-h-[38px] px-3 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
          >
            กรองข้อมูล
          </button>
        </form>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}

      {/* Import Batches Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-3.5">Batch Code</th>
                <th className="py-2.5 px-3.5">File Name / Sheet</th>
                <th className="py-2.5 px-3.5">Status</th>
                <th className="py-2.5 px-3.5 text-right">Rows (Total / Valid / Err / Dup)</th>
                <th className="py-2.5 px-3.5 text-right">Imported</th>
                <th className="py-2.5 px-3.5">Mode</th>
                <th className="py-2.5 px-3.5">ผู้นำเข้า</th>
                <th className="py-2.5 px-3.5">เวลา (Asia/Bangkok)</th>
                <th className="py-2.5 px-3.5 text-right">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && !data ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    กำลังโหลดประวัติการนำเข้า...
                  </td>
                </tr>
              ) : (data?.batches.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-slate-500">
                    ยังไม่มีประวัติการนำเข้าไฟล์ SAP Excel —{' '}
                    {isAdmin
                      ? 'กดปุ่ม "อัปโหลดไฟล์ SAP Excel ใหม่" เพื่อเริ่มต้น'
                      : 'รอผู้ดูแลระบบ (Admin) อัปโหลดไฟล์ SAP Excel'}
                  </td>
                </tr>
              ) : (
                data!.batches.map((b) => {
                  const meta = getBatchStatusMeta(b.status);
                  const canResume =
                    isAdmin && ['UPLOADED', 'READY_TO_IMPORT', 'FAILED'].includes(b.status);
                  const canCancel =
                    isAdmin && ['UPLOADED', 'READY_TO_IMPORT', 'FAILED'].includes(b.status);
                  return (
                    <tr key={b.id} className="hover:bg-slate-50/80">
                      <td className="py-2.5 px-3.5 font-mono font-semibold text-slate-900 whitespace-nowrap">
                        {b.batchCode}
                      </td>
                      <td className="py-2.5 px-3.5 max-w-[260px]">
                        <div className="font-medium text-slate-900 truncate" title={b.fileName}>
                          {b.fileName}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono truncate">
                          Sheet: {b.sheetName} · Row {b.headerRowIndex} ·{' '}
                          {formatFileSize(b.fileSizeBytes)}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded border text-[11px] font-medium ${meta.className}`}
                        >
                          {meta.labelTh}
                        </span>
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                        <span className="text-slate-900 font-semibold">{b.totalRows}</span>
                        <span className="text-slate-300 mx-1">/</span>
                        <span className="text-emerald-700">{b.validRows}</span>
                        <span className="text-slate-300 mx-1">/</span>
                        <span className="text-red-700">{b.errorRows}</span>
                        <span className="text-slate-300 mx-1">/</span>
                        <span className="text-sky-700">{b.duplicateRows}</span>
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono tabular-nums font-semibold text-[#1D4ED8] whitespace-nowrap">
                        {b.importedRows}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono text-slate-600 whitespace-nowrap">
                        {b.importMode}
                      </td>
                      <td className="py-2.5 px-3.5 text-slate-700 max-w-[160px] truncate">
                        {b.importedByEmail || '-'}
                      </td>
                      <td className="py-2.5 px-3.5 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {formatBangkokDateTime(b.confirmedAt || b.createdAt)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {b.totalRows > 0 && (
                            <button
                              type="button"
                              onClick={() => setInspectBatch(b)}
                              className="min-h-[32px] px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Preview</span>
                            </button>
                          )}
                          {(b.errorRows > 0 || b.warningRows > 0 || b.duplicateRows > 0) && (
                            <button
                              type="button"
                              onClick={() => void handleDownloadErrors(b, 'xlsx')}
                              title="ดาวน์โหลด Error Report (.xlsx)"
                              className="min-h-[32px] px-2 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                          {canResume && (
                            <button
                              type="button"
                              onClick={() => onResumeBatch(b)}
                              className="min-h-[32px] px-2.5 py-1 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Play className="w-3 h-3" aria-hidden="true" />
                              <span>ดำเนินการต่อ</span>
                            </button>
                          )}
                          {canCancel && (
                            <button
                              type="button"
                              disabled={cancellingId === b.id}
                              onClick={() => void handleCancelBatch(b)}
                              title="ยกเลิก Batch"
                              className="min-h-[32px] px-2 py-1 rounded border border-red-200 hover:bg-red-50 text-red-700 inline-flex items-center cursor-pointer disabled:opacity-50"
                            >
                              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {data && (
          <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
            <span className="font-mono tabular-nums">
              ทั้งหมด {data.pagination.total} Batches (หน้า {data.pagination.page} /{' '}
              {data.pagination.totalPages})
            </span>
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
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => Math.min(data.pagination.totalPages, p + 1))}
                className="min-h-[34px] px-2.5 rounded border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 inline-flex items-center gap-1 cursor-pointer"
              >
                <span>ถัดไป</span>
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Historical Batch Preview Drawer / Modal */}
      {inspectBatch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`ตรวจสอบข้อมูล Batch ${inspectBatch.batchCode}`}
          className="fixed inset-0 z-40 bg-slate-950/60 flex items-center justify-center p-3 sm:p-6"
        >
          <div className="bg-[#F4F6F9] border border-slate-300 rounded-lg shadow-2xl w-full max-w-6xl max-h-[92vh] flex flex-col overflow-hidden">
            <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-xs font-mono text-blue-300 flex items-center gap-2">
                  <span>{inspectBatch.batchCode}</span>
                  <span>·</span>
                  <span>{inspectBatch.status}</span>
                </div>
                <h3 className="text-sm font-semibold truncate">{inspectBatch.fileName}</h3>
              </div>
              <button
                type="button"
                onClick={() => setInspectBatch(null)}
                className="min-h-[36px] px-3 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-medium cursor-pointer shrink-0"
              >
                ปิดหน้าต่าง
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-5">
              {inspectBatch.status === 'COMPLETED' && (
                <div className="mb-4 bg-emerald-50 border border-emerald-200 rounded-md px-3.5 py-2.5 text-xs text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>
                    Batch นี้ยืนยันนำเข้าเรียบร้อยแล้ว ({inspectBatch.importedRows} SAP Reference Coils
                    สถานะ PENDING_INBOUND) — ไม่มีผลกระทบต่อ Active Inventory
                  </span>
                </div>
              )}
              <SapBatchPreviewPanel batchId={inspectBatch.id} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
