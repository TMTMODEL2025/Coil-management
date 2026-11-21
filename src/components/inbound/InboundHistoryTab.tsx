import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import type { InboundHistoryResponse } from '../../types/inbound';

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-50 border-emerald-200 text-[#16A34A]';
    case 'PARTIALLY_RECEIVED':
      return 'bg-blue-50 border-blue-200 text-[#1D4ED8]';
    case 'IN_PROGRESS':
      return 'bg-orange-50 border-orange-200 text-[#EA580C]';
    case 'CONFIRMED':
      return 'bg-emerald-50 border-emerald-200 text-[#16A34A]';
    case 'RESERVED':
      return 'bg-orange-50 border-orange-200 text-[#EA580C]';
    default:
      return 'bg-slate-100 border-slate-200 text-slate-600';
  }
}

export function InboundHistoryTab() {
  const { realtimeRevision } = useAuth();
  const [data, setData] = useState<InboundHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [expandedIds, setExpandedIds] = useState<number[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      setError(null);
      const qs = new URLSearchParams();
      if (search.trim()) qs.set('search', search.trim());
      if (statusFilter !== 'ALL') qs.set('status', statusFilter);
      qs.set('pageSize', '25');
      const res = await apiFetch<InboundHistoryResponse>(`/api/inbound/history?${qs.toString()}`);
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดประวัติการรับสินค้าเข้าคลังได้');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory, realtimeRevision]);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="text-[11px] text-slate-500">ใบรับเข้าทั้งหมด (Receipts)</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
            {data?.summary.totalReceipts ?? 0}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="text-[11px] text-slate-500">รับครบแล้ว (Completed)</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#16A34A]">
            {data?.summary.completedReceipts ?? 0}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="text-[11px] text-slate-500">รับบางส่วน (Partial)</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#1D4ED8]">
            {data?.summary.partialReceipts ?? 0}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="text-[11px] text-slate-500">คอยล์รับเข้าจริง (Confirmed)</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-slate-900">
            {data?.summary.totalConfirmedCoils ?? 0}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-3.5">
          <div className="text-[11px] text-slate-500">การจองที่ค้างอยู่ (Active Resv.)</div>
          <div className="mt-1 text-xl font-bold font-mono tabular-nums text-[#EA580C]">
            {data?.summary.activeReservations ?? 0}
          </div>
        </div>
      </div>

      {/* Filters & Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[220px]">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                aria-label="ค้นหาประวัติใบรับเข้า"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหา Receipt No., Batch No., Material Code..."
                className="w-full min-h-[38px] pl-9 pr-3 py-1.5 rounded-md border border-slate-300 text-xs text-slate-900"
              />
            </div>
            <select
              aria-label="กรองตามสถานะใบรับเข้า"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="min-h-[38px] px-3 py-1.5 rounded-md border border-slate-300 bg-white text-xs text-slate-900"
            >
              <option value="ALL">ทุกสถานะ (All Status)</option>
              <option value="IN_PROGRESS">IN_PROGRESS</option>
              <option value="PARTIALLY_RECEIVED">PARTIALLY_RECEIVED</option>
              <option value="COMPLETED">COMPLETED</option>
            </select>
          </div>
          <button
            type="button"
            onClick={() => void loadHistory()}
            className="min-h-[38px] px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>รีเฟรช</span>
          </button>
        </div>

        {error && (
          <div role="alert" className="p-4 text-xs text-red-700 bg-red-50 border-b border-red-200">
            {error}
          </div>
        )}

        {loading && !data ? (
          <div className="p-6 text-xs text-slate-500">กำลังโหลดประวัติการรับสินค้า...</div>
        ) : !data || data.receipts.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500">
            ยังไม่มีประวัติการรับสินค้าเข้าคลัง — เมื่อมีการจองตำแหน่งหรือยืนยันวางเหล็กม้วน ข้อมูลจริงจาก PostgreSQL จะแสดงที่นี่
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {data.receipts.map((rcp) => {
              const expanded = expandedIds.includes(rcp.id);
              return (
                <div key={rcp.id}>
                  <button
                    type="button"
                    onClick={() => toggleExpand(rcp.id)}
                    aria-expanded={expanded}
                    className="w-full px-4 py-3 text-left hover:bg-slate-50 flex flex-wrap items-center justify-between gap-3 cursor-pointer"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {expanded ? (
                        <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className="font-mono font-bold text-slate-900">{rcp.receiptNo}</span>
                          <span className="text-slate-300">|</span>
                          <span className="font-mono font-semibold text-[#1D4ED8]">
                            Batch {rcp.batchNo}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${statusBadgeClass(
                              rcp.status
                            )}`}
                          >
                            {rcp.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {rcp.materialCode || '-'} · {rcp.materialDescription || '-'} · โดย{' '}
                          {rcp.createdByEmail || '-'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 text-xs font-mono tabular-nums shrink-0">
                      <span className="text-slate-700 font-semibold">
                        รับแล้ว {rcp.receivedCoilsCount}/{rcp.totalExpectedCoils} ม้วน
                      </span>
                      <span className="text-slate-400">
                        {new Date(rcp.updatedAt).toLocaleString('th-TH', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  </button>

                  {expanded && (
                    <div className="bg-slate-50/70 px-4 pb-4 pt-1 border-t border-slate-100">
                      {rcp.items.length === 0 ? (
                        <div className="text-xs text-slate-500 py-2">ยังไม่มีรายการย่อย</div>
                      ) : (
                        <div className="overflow-x-auto bg-white border border-slate-200 rounded-md">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                                <th className="py-2 px-3">Coil ID</th>
                                <th className="py-2 px-3">สถานะ</th>
                                <th className="py-2 px-3">ตำแหน่งจอง → วางจริง</th>
                                <th className="py-2 px-3 text-right">น้ำหนัก (kg)</th>
                                <th className="py-2 px-3">Override / หมายเหตุ</th>
                                <th className="py-2 px-3">เวลายืนยัน</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {rcp.items.map((item) => (
                                <tr key={item.itemId}>
                                  <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                                    {item.coilId || item.scannedCoilCode || '-'}
                                  </td>
                                  <td className="py-2 px-3">
                                    <span
                                      className={`px-2 py-0.5 rounded border text-[11px] font-semibold ${statusBadgeClass(
                                        item.status
                                      )}`}
                                    >
                                      {item.status}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 font-mono text-slate-800">
                                    {item.targetLocationCode || '-'} →{' '}
                                    <strong>{item.confirmedLocationCode || '-'}</strong>
                                  </td>
                                  <td className="py-2 px-3 text-right font-mono tabular-nums">
                                    {item.weightKg != null
                                      ? item.weightKg.toLocaleString('en-US')
                                      : '-'}
                                  </td>
                                  <td className="py-2 px-3 text-slate-600">
                                    {item.overrideReason || '-'}
                                  </td>
                                  <td className="py-2 px-3 font-mono tabular-nums text-slate-500">
                                    {item.confirmedAt
                                      ? new Date(item.confirmedAt).toLocaleString('th-TH', {
                                          day: '2-digit',
                                          month: '2-digit',
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })
                                      : '-'}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
