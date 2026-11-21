import { useEffect, useState } from 'react';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { NavSectionId, WarehouseHierarchyData, WarehouseSummaryData } from '../types/wms';

interface DashboardViewProps {
  onNavigate: (section: NavSectionId) => void;
}

export function DashboardView({ onNavigate }: DashboardViewProps) {
  const { realtimeRevision, profile } = useAuth();
  const canAccessSapImport = profile?.roleCode === 'ADMIN' || profile?.roleCode === 'SUPERVISOR';
  const [summary, setSummary] = useState<WarehouseSummaryData | null>(null);
  const [hierarchy, setHierarchy] = useState<WarehouseHierarchyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        setError(null);
        const [sumRes, hierRes] = await Promise.all([
          apiFetch<WarehouseSummaryData>('/api/warehouse/summary'),
          apiFetch<WarehouseHierarchyData>('/api/warehouse/hierarchy'),
        ]);
        if (!active) return;
        setSummary(sumRes);
        setHierarchy(hierRes);
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'ไม่สามารถโหลดข้อมูลภาพรวมคลังสินค้าได้');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [realtimeRevision]);

  if (loading && !summary) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 bg-white border border-slate-200 rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="bg-red-50 border border-red-200 rounded-lg p-5 text-red-900">
        <div className="font-semibold text-sm">ไม่สามารถโหลดข้อมูลจากฐานข้อมูล PostgreSQL ได้</div>
        <p className="mt-1 text-sm text-red-700">{error}</p>
      </div>
    );
  }

  const locs = summary?.counts.locations;
  const doors = hierarchy?.doors ?? [];
  const rows = hierarchy?.rows ?? [];
  const levels = hierarchy?.levels ?? [];

  return (
    <div className="space-y-6">
      {/* Estimated Layout Notice (Required by Part 6.1 until Admin calibrates measured factory dimensions) */}
      {summary?.isEstimatedLayout && (
        <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5 text-sm text-slate-700">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <span className="font-semibold text-slate-900">Estimated Layout Active</span>
              <span className="mx-2 text-slate-300" aria-hidden="true">
                ·
              </span>
              <span>
                พิกัด 3D เริ่มต้นของประตู E7 / E8 ใช้โครงสร้าง Floor Saddle &amp; Pyramid Stacking
                แบบประมาณการ Admin สามารถปรับแก้พิกัดและขนาดจริงได้โดยไม่กระทบสต็อก
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={() => onNavigate('inbound')}
              className="min-h-[38px] px-3.5 py-1.5 rounded-md bg-[#16A34A] hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <span>รับสินค้าเข้าคลัง</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onNavigate('warehouse-3d')}
              className="min-h-[38px] px-3.5 py-1.5 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <span>เปิดคลังสินค้า 3D</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            {canAccessSapImport && (
              <button
                type="button"
                onClick={() => onNavigate('sap-import')}
                className="min-h-[38px] px-3.5 py-1.5 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <span>นำเข้า SAP Excel</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('locations')}
              className="min-h-[38px] px-3.5 py-1.5 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <span>จัดการ Location Master</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Primary KPI Strip */}
      <section aria-label="Warehouse Master Metrics" className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">ตำแหน่งจัดเก็บทั้งหมด (Total Slots)</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {locs?.TOTAL ?? 0}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
            {summary?.counts.doors ?? 0} Doors · {summary?.counts.rows ?? 0} Rows ·{' '}
            {summary?.counts.levels ?? 0} Levels
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">ตำแหน่งว่างพร้อมใช้งาน (EMPTY)</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#16A34A]">
            {locs?.EMPTY ?? 0}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
            Blocked {locs?.BLOCKED ?? 0} · Inactive {locs?.INACTIVE ?? 0}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">เหล็กม้วนคงคลัง (Active Inventory)</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-[#2563EB]">
            {summary?.counts.activeInventory ?? 0}
          </div>
          <div className="mt-1.5 text-xs text-slate-500 font-mono tabular-nums">
            Occupied {locs?.OCCUPIED ?? 0} · Reserved {locs?.RESERVED ?? 0}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-medium text-slate-500">โครงสร้าง 3D โกดัง (Layout Objects)</div>
          <div className="mt-2 text-2xl font-bold font-mono tabular-nums text-slate-900">
            {summary?.counts.layoutObjects ?? 0}
          </div>
          <div className="mt-1.5 text-xs text-slate-500">
            Receiving · Dispatch · Crane · Aisles
          </div>
        </div>
      </section>

      {/* Building Door & Row Capacity Breakdown (SAP Compact Table) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              โครงสร้างตำแหน่งจัดเก็บตามประตูและแถว (Door / Row Capacity)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ข้อมูลจริงจากฐานข้อมูล PostgreSQL — พร้อมสำหรับ 3D Warehouse และ Auto-Allocation
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('locations')}
            className="text-xs font-semibold text-[#1D4ED8] hover:underline whitespace-nowrap cursor-pointer"
          >
            เปิดหน้าจัดการทั้งหมด
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <th className="py-2.5 px-4">Door</th>
                <th className="py-2.5 px-4">Row</th>
                <th className="py-2.5 px-4">โครงสร้างชั้น</th>
                <th className="py-2.5 px-4 text-right">Slots</th>
                <th className="py-2.5 px-4 text-right">EMPTY</th>
                <th className="py-2.5 px-4 text-right">OCCUPIED</th>
                <th className="py-2.5 px-4 text-right">RESERVED</th>
                <th className="py-2.5 px-4 text-right">BLOCKED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const door = doors.find((d) => d.id === row.doorId);
                const rowLevels = levels.filter((l) => l.rowId === row.id);
                const total = rowLevels.reduce((acc, l) => acc + l.stats.total, 0);
                const empty = rowLevels.reduce((acc, l) => acc + l.stats.empty, 0);
                const occupied = rowLevels.reduce((acc, l) => acc + l.stats.occupied, 0);
                const reserved = rowLevels.reduce((acc, l) => acc + l.stats.reserved, 0);
                const blocked = rowLevels.reduce((acc, l) => acc + l.stats.blocked, 0);
                return (
                  <tr key={row.id} className="hover:bg-slate-50/80 h-10">
                    <td className="px-4 font-mono font-semibold text-slate-900">
                      {door?.doorCode ?? '-'}
                    </td>
                    <td className="px-4 text-slate-800">
                      <span className="font-mono font-semibold">Row {row.rowNumber}</span>
                      <span className="mx-1.5 text-slate-300">/</span>
                      <span className="text-slate-500">{row.label}</span>
                    </td>
                    <td className="px-4 text-slate-600 font-mono tabular-nums">
                      {rowLevels.length} Levels (Max {row.maxLevels})
                    </td>
                    <td className="px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                      {total}
                    </td>
                    <td className="px-4 text-right font-mono tabular-nums text-[#16A34A] font-medium">
                      {empty}
                    </td>
                    <td className="px-4 text-right font-mono tabular-nums text-[#2563EB] font-medium">
                      {occupied}
                    </td>
                    <td className="px-4 text-right font-mono tabular-nums text-[#EA580C] font-medium">
                      {reserved}
                    </td>
                    <td className="px-4 text-right font-mono tabular-nums text-[#DC2626] font-medium">
                      {blocked}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bottom 2-Column Grid: Audit Trail + Phase Delivery Status */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              ประวัติการเปลี่ยนแปลงล่าสุด (Audit Trail)
            </h2>
          </div>
          {summary && summary.recentAudit.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2 px-4">เวลา</th>
                    <th className="py-2 px-4">Action</th>
                    <th className="py-2 px-4">Entity</th>
                    <th className="py-2 px-4">ผู้ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.recentAudit.map((log) => (
                    <tr key={log.id} className="h-9 hover:bg-slate-50">
                      <td className="px-4 font-mono tabular-nums text-slate-500 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('th-TH', {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: '2-digit',
                        })}
                      </td>
                      <td className="px-4 font-mono text-slate-800">{log.action}</td>
                      <td className="px-4 font-mono text-slate-600">
                        {log.entityType}:{log.entityId}
                      </td>
                      <td className="px-4 text-slate-600 truncate max-w-[160px]">
                        {log.actorEmail ?? 'system'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-6 text-sm text-slate-500">
              ยังไม่มีรายการแก้ไข Master Data — ทุกการเพิ่มหรือแก้ไข Location จะถูกบันทึกในตาราง{' '}
              <span className="font-mono text-slate-700">audit_logs</span> อัตโนมัติ
            </div>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              ความคืบหน้าการพัฒนาตาม Phase (Sequential Roadmap)
            </h2>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {[
              { phase: 'Phase 1', title: 'Foundation & PostgreSQL 23-Table Schema + Auth/RBAC', status: 'พร้อมใช้งาน', active: true },
              { phase: 'Phase 2', title: 'Warehouse Master & Location Structure (E7/1/3/9)', status: 'พร้อมใช้งาน', active: true },
              { phase: 'Phase 3', title: 'Interactive 3D Warehouse (Floor Saddle, Pyramid, Crane)', status: 'พร้อมใช้งาน', active: true },
              { phase: 'Phase 4', title: 'SAP Excel Import Center (Leading Zeros, Mapping, Staging)', status: 'พร้อมใช้งาน', active: true },
              { phase: 'Phase 5', title: 'Batch-First Inbound Receiving & Auto Location Allocation (Atomic)', status: 'พร้อมใช้งาน', active: true },
              { phase: 'Phase 6', title: 'Inventory Console & Coil Tracking (Immutable History)', status: 'ลำดับถัดไป (รออนุมัติ)', active: false },
              { phase: 'Phase 7–10', title: 'Outbound, Internal Transfer, Reports & Analytics', status: 'รออนุมัติ Phase', active: false },
            ].map((row) => (
              <div key={row.phase} className="px-4 py-2.5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <span className="font-mono font-semibold text-slate-900">{row.phase}</span>
                  <span className="mx-2 text-slate-300">·</span>
                  <span className="text-slate-700">{row.title}</span>
                </div>
                <span
                  className={`font-medium whitespace-nowrap shrink-0 ${
                    row.active ? 'text-[#16A34A]' : 'text-slate-500'
                  }`}
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
