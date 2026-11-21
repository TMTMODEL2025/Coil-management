import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { SapReferenceCoilRecord } from '../../types/sapImport';
import { formatBangkokDateTime } from './sapImportFormatters';

interface SapReferenceCoilsTabProps {
  refreshKey: number;
}

export function SapReferenceCoilsTab({ refreshKey }: SapReferenceCoilsTabProps) {
  const [items, setItems] = useState<SapReferenceCoilRecord[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [lifecycleStatus, setLifecycleStatus] = useState('ALL');
  const [page, setPage] = useState(1);

  const loadCoils = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        pageSize: '25',
      });
      if (searchQuery.trim()) qs.set('search', searchQuery.trim());
      if (lifecycleStatus !== 'ALL') qs.set('lifecycleStatus', lifecycleStatus);

      const res = await apiFetch<{
        items: SapReferenceCoilRecord[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`/api/sap-import/reference-coils?${qs.toString()}`);

      setItems(res.items);
      setPagination(res.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดรายการ SAP Reference Coils ได้');
    } finally {
      setLoading(false);
    }
  }, [page, searchQuery, lifecycleStatus]);

  useEffect(() => {
    void loadCoils();
  }, [loadCoils, refreshKey]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              ทะเบียน SAP Reference Coils ที่นำเข้าแล้ว (Pending Inbound Registry)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ข้อมูลอ้างอิงเหล็กม้วนจากไฟล์ SAP Excel ทั้งหมด — รักษาเลขศูนย์นำหน้าครบถ้วนและพร้อมสำหรับการสแกนรับเข้าคลังใน Phase 5
            </p>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-900 font-medium">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
            <span>Reference Only · ยังไม่นับเป็น Active Inventory</span>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearchQuery(searchInput);
          }}
          className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100"
        >
          <div className="relative flex-1 min-w-[220px] max-w-md">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ค้นหา Coil ID, Batch No. (เช่น 011P066118), Material, HEAT..."
              aria-label="ค้นหา SAP Reference Coils"
              className="w-full min-h-[38px] pl-9 pr-3 rounded-md border border-slate-300 text-xs"
            />
          </div>
          <select
            aria-label="กรองตามสถานะ Lifecycle"
            value={lifecycleStatus}
            onChange={(e) => {
              setLifecycleStatus(e.target.value);
              setPage(1);
            }}
            className="min-h-[38px] px-2.5 rounded-md border border-slate-300 text-xs bg-white"
          >
            <option value="ALL">ทุกสถานะ</option>
            <option value="PENDING_INBOUND">PENDING_INBOUND (รอรับเข้า)</option>
            <option value="IN_STOCK">IN_STOCK</option>
            <option value="RESERVED_OUTBOUND">RESERVED_OUTBOUND</option>
            <option value="DISPATCHED">DISPATCHED</option>
          </select>
          <button
            type="submit"
            className="min-h-[38px] px-4 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
          >
            ค้นหา
          </button>
        </form>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold whitespace-nowrap">
                <th className="py-2.5 px-3">Coil ID</th>
                <th className="py-2.5 px-3">Batch No.</th>
                <th className="py-2.5 px-3">Material No.</th>
                <th className="py-2.5 px-3">Description</th>
                <th className="py-2.5 px-3 text-right">Unrestr. (kg)</th>
                <th className="py-2.5 px-3 text-right">ชั่งจริง (kg)</th>
                <th className="py-2.5 px-3">หนา × กว้าง</th>
                <th className="py-2.5 px-3">Grade / Mill</th>
                <th className="py-2.5 px-3">HEAT NO.</th>
                <th className="py-2.5 px-3">ตำแหน่งไฟล์ (Info)</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3">Import Batch / Row</th>
                <th className="py-2.5 px-3">เวลานำเข้า</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-slate-500">
                    กำลังโหลดข้อมูล SAP Reference Coils...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={13} className="py-10 text-center text-slate-500">
                    ยังไม่มีรายการ SAP Reference Coils ในระบบ
                  </td>
                </tr>
              ) : (
                items.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80">
                    <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {c.coilId}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-800 whitespace-nowrap">
                      {c.batchNo}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                      {c.materialCode || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 max-w-[200px] truncate" title={c.materialDescription ?? ''}>
                      {c.materialDescription || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {c.netWeightKg !== null
                        ? c.netWeightKg.toLocaleString('en-US')
                        : c.weightKg !== null
                          ? c.weightKg.toLocaleString('en-US')
                          : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {c.grossWeightKg !== null ? c.grossWeightKg.toLocaleString('en-US') : '-'}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {c.thicknessMm ?? '-'} × {c.widthMm ?? '-'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 whitespace-nowrap">
                      {c.grade || '-'} {c.vendorCode ? `(${c.vendorCode})` : ''}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-700 whitespace-nowrap">
                      {c.heatNo || '-'}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                      {c.scannedLocationRef || '-'}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded border border-blue-200 bg-blue-50 text-blue-800 font-mono text-[10px] font-semibold">
                        {c.lifecycleStatus}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">
                      {c.batchCode || '-'}
                      {c.sourceRowNumber ? ` #${c.sourceRowNumber}` : ''}
                    </td>
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                      {formatBangkokDateTime(c.importedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <span className="font-mono tabular-nums">
            ทั้งหมด {pagination.total} คอยล์ (หน้า {pagination.page} / {pagination.totalPages})
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
    </div>
  );
}
