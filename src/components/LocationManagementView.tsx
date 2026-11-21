import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  Plus,
  Layers,
  Pencil,
  X,
  CheckCircle2,
  AlertCircle,
  Boxes,
  DoorOpen,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type {
  ExpandRowSlotsResponse,
  LayoutObjectItem,
  LocationStatus,
  StackingRule,
  StorageLocationItem,
  WarehouseHierarchyData,
} from '../types/wms';
import { ExpandRowSlotsModal } from './warehouse3d/ExpandRowSlotsModal';

type LocationTab = 'locations' | 'hierarchy' | 'layout-objects';

const STATUS_STYLE: Record<LocationStatus, { dot: string; text: string; label: string }> = {
  EMPTY: { dot: 'bg-[#16A34A]', text: 'text-[#15803D]', label: 'EMPTY · ว่าง' },
  OCCUPIED: { dot: 'bg-[#2563EB]', text: 'text-[#1D4ED8]', label: 'OCCUPIED · มีเหล็กม้วน' },
  RESERVED: { dot: 'bg-[#EA580C]', text: 'text-[#C2410C]', label: 'RESERVED · จองชั่วคราว' },
  BLOCKED: { dot: 'bg-[#DC2626]', text: 'text-[#B91C1C]', label: 'BLOCKED · ปิดกั้น' },
};

export function LocationManagementView() {
  const { profile, realtimeRevision } = useAuth();
  const canManage = profile?.roleCode === 'ADMIN' || profile?.roleCode === 'SUPERVISOR';
  const isAdmin = profile?.roleCode === 'ADMIN';

  const [activeTab, setActiveTab] = useState<LocationTab>('locations');
  const [hierarchy, setHierarchy] = useState<WarehouseHierarchyData | null>(null);
  const [locations, setLocations] = useState<StorageLocationItem[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 40, total: 0, totalPages: 1 });
  const [layoutObjects, setLayoutObjects] = useState<LayoutObjectItem[]>([]);

  // Filters
  const [doorFilter, setDoorFilter] = useState<string>('');
  const [rowFilter, setRowFilter] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [page, setPage] = useState<number>(1);

  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );

  // Modals
  const [editingLocation, setEditingLocation] = useState<StorageLocationItem | null>(null);
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [expandModalTarget, setExpandModalTarget] = useState<{
    doorId?: number | null;
    rowId?: number | null;
  } | null>(null);
  const [showDoorModal, setShowDoorModal] = useState(false);
  const [showRowModal, setShowRowModal] = useState(false);
  const [showLevelModal, setShowLevelModal] = useState(false);
  const [editingLayoutObj, setEditingLayoutObj] = useState<LayoutObjectItem | null>(null);
  const [showNewLayoutObjModal, setShowNewLayoutObjModal] = useState(false);

  const loadMasterData = useCallback(async () => {
    try {
      const [hierRes, objRes] = await Promise.all([
        apiFetch<WarehouseHierarchyData>('/api/warehouse/hierarchy'),
        apiFetch<{ objects: LayoutObjectItem[] }>('/api/warehouse/layout-objects'),
      ]);
      setHierarchy(hierRes);
      setLayoutObjects(objRes.objects);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'ไม่สามารถโหลดโครงสร้างโกดังได้',
      });
    }
  }, []);

  const loadLocations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (doorFilter) params.set('doorId', doorFilter);
      if (rowFilter) params.set('rowId', rowFilter);
      if (levelFilter) params.set('levelId', levelFilter);
      if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      params.set('page', String(page));
      params.set('pageSize', '40');

      const res = await apiFetch<{
        items: StorageLocationItem[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`/api/warehouse/locations?${params.toString()}`);

      setLocations(res.items);
      setPagination(res.pagination);
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'ไม่สามารถโหลดรายการ Location ได้',
      });
    } finally {
      setLoading(false);
    }
  }, [doorFilter, rowFilter, levelFilter, statusFilter, searchQuery, page]);

  useEffect(() => {
    void loadMasterData();
  }, [loadMasterData, realtimeRevision]);

  useEffect(() => {
    void loadLocations();
  }, [loadLocations, realtimeRevision]);

  const doors = hierarchy?.doors ?? [];
  const filteredRows = (hierarchy?.rows ?? []).filter(
    (r) => !doorFilter || r.doorId === Number(doorFilter)
  );
  const filteredLevels = (hierarchy?.levels ?? []).filter(
    (l) => !rowFilter || l.rowId === Number(rowFilter)
  );

  return (
    <div className="space-y-4">
      {/* Header & Segmented Tab Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div
          role="tablist"
          aria-label="Location Management Tabs"
          className="inline-flex items-center p-1 bg-slate-200/80 rounded-lg self-start"
        >
          {(
            [
              { id: 'locations', label: 'ตำแหน่งจัดเก็บ (Slots)' },
              { id: 'hierarchy', label: 'ประตู / แถว / ชั้น (Hierarchy)' },
              { id: 'layout-objects', label: 'โครงสร้าง 3D (Layout Objects)' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`min-h-[38px] px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {activeTab === 'locations' && canManage && (
            <button
              type="button"
              onClick={() =>
                setExpandModalTarget({
                  doorId: doorFilter ? Number(doorFilter) : null,
                  rowId: rowFilter ? Number(rowFilter) : null,
                })
              }
              className="min-h-[40px] px-4 py-2 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0 text-amber-300" aria-hidden="true" />
              <span>ขยายช่องวางทั้งแถว (เกิน 12 ม้วน)</span>
            </button>
          )}
          {activeTab === 'locations' && isAdmin && (
            <button
              type="button"
              onClick={() => setShowBatchModal(true)}
              className="min-h-[40px] px-4 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>สร้างช่องจัดเก็บแบบชุด (Batch Slots)</span>
            </button>
          )}
          {activeTab === 'hierarchy' && isAdmin && (
            <>
              <button
                type="button"
                onClick={() => setShowDoorModal(true)}
                className="min-h-[40px] px-3.5 py-2 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <DoorOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>เพิ่มประตู (Door)</span>
              </button>
              <button
                type="button"
                onClick={() => setShowRowModal(true)}
                className="min-h-[40px] px-3.5 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>เพิ่มแถว (Row)</span>
              </button>
              <button
                type="button"
                onClick={() => setShowLevelModal(true)}
                className="min-h-[40px] px-3.5 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
              >
                <Layers className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>เพิ่มชั้น (Level)</span>
              </button>
            </>
          )}
          {activeTab === 'layout-objects' && isAdmin && (
            <button
              type="button"
              onClick={() => setShowNewLayoutObjModal(true)}
              className="min-h-[40px] px-4 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
            >
              <Boxes className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>เพิ่มวัตถุโครงสร้าง 3D</span>
            </button>
          )}
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          role="alert"
          className={`rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-3 border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            aria-label="ปิดการแจ้งเตือน"
            onClick={() => setFeedback(null)}
            className="text-current opacity-70 hover:opacity-100 cursor-pointer"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 1: STORAGE LOCATIONS TABLE                                       */}
      {/* ==================================================================== */}
      {activeTab === 'locations' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* Filter Toolbar */}
          <div className="p-3.5 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5">
            <div className="relative lg:col-span-2">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="ค้นหา Location เช่น E7/1/3/9"
                aria-label="ค้นหา Location Code"
                className="w-full h-10 pl-9 pr-3 rounded-md border border-slate-300 text-sm font-mono focus:outline-none focus:border-blue-600"
              />
            </div>

            <select
              aria-label="กรองตามประตูอาคาร"
              value={doorFilter}
              onChange={(e) => {
                setDoorFilter(e.target.value);
                setRowFilter('');
                setLevelFilter('');
                setPage(1);
              }}
              className="h-10 px-3 rounded-md border border-slate-300 text-xs font-medium bg-white"
            >
              <option value="">ประตูทั้งหมด (All Doors)</option>
              {doors.map((d) => (
                <option key={d.id} value={d.id}>
                  Door {d.doorCode} — {d.name}
                </option>
              ))}
            </select>

            <select
              aria-label="กรองตามแถว"
              value={rowFilter}
              onChange={(e) => {
                setRowFilter(e.target.value);
                setLevelFilter('');
                setPage(1);
              }}
              className="h-10 px-3 rounded-md border border-slate-300 text-xs font-medium bg-white"
            >
              <option value="">แถวทั้งหมด (All Rows)</option>
              {filteredRows.map((r) => (
                <option key={r.id} value={r.id}>
                  Row {r.rowNumber} ({r.label})
                </option>
              ))}
            </select>

            <select
              aria-label="กรองตามชั้น"
              value={levelFilter}
              onChange={(e) => {
                setLevelFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 rounded-md border border-slate-300 text-xs font-medium bg-white"
            >
              <option value="">ชั้นทั้งหมด (All Levels)</option>
              {filteredLevels.map((l) => (
                <option key={l.id} value={l.id}>
                  Level {l.levelNumber} ({l.stackingRule})
                </option>
              ))}
            </select>

            <select
              aria-label="กรองตามสถานะ"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="h-10 px-3 rounded-md border border-slate-300 text-xs font-medium bg-white"
            >
              <option value="ALL">สถานะทั้งหมด</option>
              <option value="EMPTY">EMPTY (ว่าง)</option>
              <option value="OCCUPIED">OCCUPIED (มีเหล็กม้วน)</option>
              <option value="RESERVED">RESERVED (จองชั่วคราว)</option>
              <option value="BLOCKED">BLOCKED (ปิดกั้น)</option>
            </select>
          </div>

          {/* SAP-Style Compact Data Grid */}
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                <tr>
                  <th className="py-2.5 px-3.5 whitespace-nowrap">Location Code</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Door / Row / Lvl / Slot</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Stacking Rule</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">พิกัด 3D (X, Y, Z m)</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Max Weight (KG)</th>
                  <th className="py-2.5 px-3 text-right whitespace-nowrap">Priority</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
                  <th className="py-2.5 px-3 whitespace-nowrap">State</th>
                  {canManage && <th className="py-2.5 px-3 text-right whitespace-nowrap">จัดการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-slate-500">
                      กำลังโหลดข้อมูลตำแหน่งจัดเก็บจาก PostgreSQL...
                    </td>
                  </tr>
                ) : locations.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-10 text-center text-slate-500">
                      ไม่พบตำแหน่งจัดเก็บที่ตรงกับเงื่อนไขการค้นหา
                    </td>
                  </tr>
                ) : (
                  locations.map((loc) => {
                    const st = STATUS_STYLE[loc.status] ?? STATUS_STYLE.EMPTY;
                    return (
                      <tr
                        key={loc.id}
                        className={`h-10 hover:bg-slate-50/90 ${!loc.isActive ? 'opacity-55 bg-slate-50/50' : ''}`}
                      >
                        <td className="px-3.5 font-mono font-bold text-slate-900 whitespace-nowrap">
                          {loc.locationCode}
                        </td>
                        <td className="px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                          {loc.doorCode} / R{loc.rowNumber} / L{loc.levelNumber} / S{loc.slotNumber}
                        </td>
                        <td className="px-3 text-slate-600 whitespace-nowrap">
                          {loc.stackingRule === 'FLOOR_SADDLE'
                            ? 'Floor Saddle'
                            : loc.stackingRule === 'PYRAMID_STACK'
                              ? 'Pyramid Stack'
                              : 'Rack Bay'}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                          {loc.posX.toFixed(2)}, {loc.posY.toFixed(2)}, {loc.posZ.toFixed(2)}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                          {loc.maxWeightKg.toLocaleString('en-US')}
                        </td>
                        <td className="px-3 text-right font-mono tabular-nums text-slate-600">
                          {loc.allocationPriority}
                        </td>
                        <td className="px-3 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <span className={`w-2 h-2 rounded-xs shrink-0 ${st.dot}`} aria-hidden="true" />
                            <span className={st.text}>{st.label}</span>
                          </span>
                        </td>
                        <td className="px-3 whitespace-nowrap text-slate-600">
                          {loc.isActive ? 'Active' : 'Disabled'}
                          {loc.isEstimatedCoord && (
                            <span className="text-slate-400"> · Est.</span>
                          )}
                        </td>
                        {canManage && (
                          <td className="px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => setEditingLocation(loc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" aria-hidden="true" />
                              <span>แก้ไข</span>
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600">
            <div className="font-mono tabular-nums">
              แสดง {locations.length} จากทั้งหมด {pagination.total} ตำแหน่ง (หน้า {pagination.page}/
              {pagination.totalPages})
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={pagination.page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="min-h-[34px] px-3 rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-50 font-medium cursor-pointer"
              >
                ก่อนหน้า
              </button>
              <button
                type="button"
                disabled={pagination.page >= pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="min-h-[34px] px-3 rounded border border-slate-300 bg-white disabled:opacity-40 hover:bg-slate-50 font-medium cursor-pointer"
              >
                ถัดไป
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: HIERARCHY MASTER (DOORS -> ROWS -> LEVELS)                    */}
      {/* ==================================================================== */}
      {activeTab === 'hierarchy' && hierarchy && (
        <div className="space-y-4">
          {hierarchy.doors.map((door) => {
            const doorRows = hierarchy.rows.filter((r) => r.doorId === door.id);
            return (
              <section
                key={door.id}
                className="bg-white border border-slate-200 rounded-lg overflow-hidden"
              >
                <div className="px-4 py-3 bg-[#0F172A] text-white flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono font-bold text-sm text-blue-300">
                      DOOR {door.doorCode}
                    </span>
                    <span className="mx-2 text-slate-600">/</span>
                    <span className="text-sm font-semibold">{door.name}</span>
                  </div>
                  <div className="text-xs font-mono tabular-nums text-slate-300">
                    พิกัดประตู X:{door.posX} Y:{door.posY} Z:{door.posZ} · ทิศ {door.facingDirection}
                  </div>
                </div>

                {doorRows.length === 0 ? (
                  <div className="p-5 text-sm text-slate-500">
                    ยังไม่มีแถวจัดเก็บภายใต้ประตู {door.doorCode} — กด &ldquo;เพิ่มแถว (Row)&rdquo;
                    ด้านบนเพื่อเริ่มต้น
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200">
                    {doorRows.map((row) => {
                      const rowLevels = hierarchy.levels.filter((l) => l.rowId === row.id);
                      return (
                        <div key={row.id} className="p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                            <div className="text-sm font-semibold text-slate-900">
                              <span className="font-mono text-[#1D4ED8]">Row {row.rowNumber}</span>
                              <span className="mx-2 text-slate-300">·</span>
                              <span>{row.label}</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2.5">
                              <div className="text-xs font-mono tabular-nums text-slate-500">
                                Origin ({row.posX}m, {row.posZ}m) · Spacing {row.slotSpacingM}m ·
                                Priority {row.allocationPriority}
                              </div>
                              {canManage && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandModalTarget({ doorId: door.id, rowId: row.id })
                                  }
                                  className="min-h-[30px] px-2.5 py-1 rounded-md border border-blue-300 bg-blue-50 hover:bg-blue-100 text-[#1D4ED8] text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>ขยายช่องวางเพิ่ม</span>
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="overflow-x-auto border border-slate-200 rounded-md">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                                  <th className="py-2 px-3">Level</th>
                                  <th className="py-2 px-3">Stacking Rule</th>
                                  <th className="py-2 px-3 text-right">Elevation Y (m)</th>
                                  <th className="py-2 px-3 text-right">Max Weight (KG)</th>
                                  <th className="py-2 px-3 text-right">Slots จริง / Max</th>
                                  <th className="py-2 px-3 text-right">EMPTY</th>
                                  <th className="py-2 px-3 text-right">OCCUPIED</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {rowLevels.map((lvl) => (
                                  <tr key={lvl.id} className="h-9">
                                    <td className="px-3 font-mono font-semibold text-slate-900">
                                      L{lvl.levelNumber} · {lvl.label}
                                    </td>
                                    <td className="px-3 text-slate-600">{lvl.stackingRule}</td>
                                    <td className="px-3 text-right font-mono tabular-nums">
                                      {lvl.elevationY.toFixed(2)}
                                    </td>
                                    <td className="px-3 text-right font-mono tabular-nums">
                                      {lvl.maxWeightKg.toLocaleString('en-US')}
                                    </td>
                                    <td className="px-3 text-right font-mono tabular-nums font-semibold">
                                      {lvl.stats.total} / {lvl.maxSlots}
                                    </td>
                                    <td className="px-3 text-right font-mono tabular-nums text-[#16A34A]">
                                      {lvl.stats.empty}
                                    </td>
                                    <td className="px-3 text-right font-mono tabular-nums text-[#2563EB]">
                                      {lvl.stats.occupied}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: 3D WAREHOUSE LAYOUT OBJECTS                                   */}
      {/* ==================================================================== */}
      {activeTab === 'layout-objects' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-slate-900">
              วัตถุโครงสร้างโกดัง 3D (Receiving, Dispatch, Overhead Crane, Aisles, Blocked Zones)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              ค่าพิกัดและขนาดทั้งหมดถูกอ่านโดยตรงจากตาราง{' '}
              <span className="font-mono">warehouse_layout_objects</span> ไม่มีการ Hardcode ใน
              Frontend
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-4">Object Code</th>
                  <th className="py-2.5 px-3">ชื่อวัตถุ</th>
                  <th className="py-2.5 px-3">ประเภท (Type)</th>
                  <th className="py-2.5 px-3 text-right">พิกัด (X, Y, Z m)</th>
                  <th className="py-2.5 px-3 text-right">ขนาด (W × H × D m)</th>
                  <th className="py-2.5 px-3">การวัดขนาด</th>
                  {isAdmin && <th className="py-2.5 px-4 text-right">จัดการ</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {layoutObjects.map((obj) => (
                  <tr key={obj.id} className="h-10 hover:bg-slate-50">
                    <td className="px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                      {obj.objectCode}
                    </td>
                    <td className="px-3 text-slate-800">{obj.name}</td>
                    <td className="px-3 font-mono text-slate-600 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-xs shrink-0 border border-slate-300"
                          style={{ backgroundColor: obj.colorHex }}
                          aria-hidden="true"
                        />
                        {obj.objectType}
                      </span>
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {obj.posX.toFixed(1)}, {obj.posY.toFixed(1)}, {obj.posZ.toFixed(1)}
                    </td>
                    <td className="px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                      {obj.widthM.toFixed(1)} × {obj.heightM.toFixed(1)} × {obj.depthM.toFixed(1)}
                    </td>
                    <td className="px-3 whitespace-nowrap text-slate-600">
                      {obj.isEstimated ? 'Estimated Layout' : 'Measured'}
                    </td>
                    {isAdmin && (
                      <td className="px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setEditingLayoutObj(obj)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 font-medium cursor-pointer"
                        >
                          <Pencil className="w-3 h-3" aria-hidden="true" />
                          <span>ปรับพิกัด</span>
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODALS FOR REAL POSTGRESQL MUTATIONS                                 */}
      {/* ==================================================================== */}
      {editingLocation && (
        <EditLocationModal
          location={editingLocation}
          onClose={() => setEditingLocation(null)}
          onSaved={(msg) => {
            setEditingLocation(null);
            setFeedback({ type: 'success', message: msg });
            void loadLocations();
            void loadMasterData();
          }}
          onError={(msg) => setFeedback({ type: 'error', message: msg })}
        />
      )}

      {showBatchModal && hierarchy && (
        <BatchGenerateSlotsModal
          hierarchy={hierarchy}
          onClose={() => setShowBatchModal(false)}
          onCreated={(msg) => {
            setShowBatchModal(false);
            setFeedback({ type: 'success', message: msg });
            void loadLocations();
            void loadMasterData();
          }}
          onError={(msg) => setFeedback({ type: 'error', message: msg })}
        />
      )}

      {expandModalTarget && hierarchy && (
        <ExpandRowSlotsModal
          doors={hierarchy.doors}
          rows={hierarchy.rows}
          levels={hierarchy.levels.map((l) => ({
            id: l.id,
            rowId: l.rowId,
            levelNumber: l.levelNumber,
            label: l.label,
            maxSlots: l.maxSlots,
            stackingRule: l.stackingRule,
            currentSlotCount: l.stats.total,
          }))}
          initialDoorId={expandModalTarget.doorId}
          initialRowId={expandModalTarget.rowId}
          onClose={() => setExpandModalTarget(null)}
          onExpanded={(result: ExpandRowSlotsResponse) => {
            setExpandModalTarget(null);
            setFeedback({
              type: 'success',
              message: `ขยายแถว ${result.doorCode}/Row ${result.rowNumber} สำเร็จ: ชั้น 1 รองรับ ${result.newBaseSlots} ม้วน (สร้างช่องใหม่ ${result.createdCount} ช่องโดยไม่กระทบสต็อกเดิม)`,
            });
            void loadLocations();
            void loadMasterData();
          }}
        />
      )}

      {showDoorModal && hierarchy && (
        <CreateDoorModal
          zones={hierarchy.zones}
          onClose={() => setShowDoorModal(false)}
          onCreated={(msg) => {
            setShowDoorModal(false);
            setFeedback({ type: 'success', message: msg });
            void loadMasterData();
          }}
          onError={(msg) => setFeedback({ type: 'error', message: msg })}
        />
      )}

      {showRowModal && hierarchy && (
        <CreateRowModal
          doors={hierarchy.doors}
          onClose={() => setShowRowModal(false)}
          onCreated={(msg) => {
            setShowRowModal(false);
            setFeedback({ type: 'success', message: msg });
            void loadMasterData();
          }}
          onError={(msg) => setFeedback({ type: 'error', message: msg })}
        />
      )}

      {showLevelModal && hierarchy && (
        <CreateLevelModal
          hierarchy={hierarchy}
          onClose={() => setShowLevelModal(false)}
          onCreated={(msg) => {
            setShowLevelModal(false);
            setFeedback({ type: 'success', message: msg });
            void loadMasterData();
          }}
          onError={(msg) => setFeedback({ type: 'error', message: msg })}
        />
      )}

      {(editingLayoutObj || showNewLayoutObjModal) && hierarchy && (
        <LayoutObjectModal
          zones={hierarchy.zones}
          existing={editingLayoutObj}
          onClose={() => {
            setEditingLayoutObj(null);
            setShowNewLayoutObjModal(false);
          }}
          onSaved={(msg) => {
            setEditingLayoutObj(null);
            setShowNewLayoutObjModal(false);
            setFeedback({ type: 'success', message: msg });
            void loadMasterData();
          }}
          onError={(msg) => setFeedback({ type: 'error', message: msg })}
        />
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS: REAL DATABASE FORM MODALS
// ============================================================================

function EditLocationModal({
  location,
  onClose,
  onSaved,
  onError,
}: {
  location: StorageLocationItem;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [posX, setPosX] = useState(String(location.posX));
  const [posY, setPosY] = useState(String(location.posY));
  const [posZ, setPosZ] = useState(String(location.posZ));
  const [maxWeightKg, setMaxWeightKg] = useState(String(location.maxWeightKg));
  const [priority, setPriority] = useState(String(location.allocationPriority));
  const [status, setStatus] = useState<LocationStatus>(location.status);
  const [isActive, setIsActive] = useState(location.isActive);
  const [isEstimatedCoord, setIsEstimatedCoord] = useState(location.isEstimatedCoord);
  const [notes, setNotes] = useState(location.notes ?? '');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch(`/api/warehouse/locations/${location.id}`, {
        method: 'PATCH',
        body: {
          posX: Number(posX),
          posY: Number(posY),
          posZ: Number(posZ),
          maxWeightKg: Number(maxWeightKg),
          allocationPriority: Number(priority),
          status,
          isActive,
          isEstimatedCoord,
          notes: notes.trim() || null,
        },
      });
      onSaved(`อัปเดตตำแหน่ง ${location.locationCode} ลงฐานข้อมูลเรียบร้อยแล้ว`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'ไม่สามารถอัปเดตตำแหน่งได้');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-slate-200 max-w-lg w-full overflow-hidden">
        <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between">
          <div>
            <div className="text-xs text-blue-300 font-mono">EDIT STORAGE LOCATION</div>
            <h3 className="text-base font-bold font-mono">{location.locationCode}</h3>
          </div>
          <button
            type="button"
            aria-label="ปิดหน้าต่าง"
            onClick={onClose}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-sm">
          <div className="grid grid-cols-3 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">พิกัด X (m)</span>
              <input
                type="number"
                step="0.01"
                required
                value={posX}
                onChange={(e) => setPosX(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">พิกัด Y (m)</span>
              <input
                type="number"
                step="0.01"
                required
                value={posY}
                onChange={(e) => setPosY(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">พิกัด Z (m)</span>
              <input
                type="number"
                step="0.01"
                required
                value={posZ}
                onChange={(e) => setPosZ(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">รองรับน้ำหนักสูงสุด (KG)</span>
              <input
                type="number"
                min="100"
                step="100"
                required
                value={maxWeightKg}
                onChange={(e) => setMaxWeightKg(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Allocation Priority</span>
              <input
                type="number"
                min="1"
                required
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">สถานะช่อง (Status)</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as LocationStatus)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 bg-white text-xs font-medium"
              >
                <option value="EMPTY">EMPTY (ว่างพร้อมรับเข้า)</option>
                <option value="BLOCKED">BLOCKED (ปิดกั้นชั่วคราว)</option>
                {location.status === 'OCCUPIED' && <option value="OCCUPIED">OCCUPIED (มีสต็อก)</option>}
                {location.status === 'RESERVED' && <option value="RESERVED">RESERVED (ถูกจอง)</option>}
              </select>
            </label>

            <div className="flex flex-col justify-end gap-2 pb-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span>เปิดใช้งานตำแหน่ง (Active)</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEstimatedCoord}
                  onChange={(e) => setIsEstimatedCoord(e.target.checked)}
                />
                <span>พิกัดประมาณการ (Estimated)</span>
              </label>
            </div>
          </div>

          <label className="block">
            <span className="text-xs font-medium text-slate-600">หมายเหตุ (Notes)</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="เช่น ช่องวางสำหรับเหล็กม้วนหน้ากว้างพิเศษ"
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 text-xs"
            />
          </label>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 rounded bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึกการเปลี่ยนแปลง'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function BatchGenerateSlotsModal({
  hierarchy,
  onClose,
  onCreated,
  onError,
}: {
  hierarchy: WarehouseHierarchyData;
  onClose: () => void;
  onCreated: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const firstLevel = hierarchy.levels[0];
  const [levelId, setLevelId] = useState(String(firstLevel?.id ?? ''));
  const [startSlot, setStartSlot] = useState('1');
  const [endSlot, setEndSlot] = useState('12');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch<{ createdCount: number; skippedCount: number }>(
        '/api/warehouse/locations/batch-generate',
        {
          method: 'POST',
          body: {
            levelId: Number(levelId),
            startSlot: Number(startSlot),
            endSlot: Number(endSlot),
          },
        }
      );
      onCreated(
        `สร้างตำแหน่งใหม่สำเร็จ ${res.createdCount} ช่อง (ข้ามช่องที่มีอยู่แล้ว ${res.skippedCount} ช่องโดยไม่กระทบ Inventory เดิม)`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'สร้างตำแหน่งแบบชุดไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full overflow-hidden">
        <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between">
          <h3 className="text-sm font-bold">สร้างช่องจัดเก็บแบบชุด (Batch Generate Slots)</h3>
          <button type="button" onClick={onClose} aria-label="ปิด" className="cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <label className="block">
            <span className="font-medium text-slate-700">เลือกประตู / แถว / ชั้นเป้าหมาย</span>
            <select
              required
              value={levelId}
              onChange={(e) => setLevelId(e.target.value)}
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 bg-white font-mono"
            >
              {hierarchy.levels.map((lvl) => {
                const row = hierarchy.rows.find((r) => r.id === lvl.rowId);
                const door = hierarchy.doors.find((d) => d.id === row?.doorId);
                return (
                  <option key={lvl.id} value={lvl.id}>
                    {door?.doorCode} / Row {row?.rowNumber} / Level {lvl.levelNumber} (
                    {lvl.stackingRule})
                  </option>
                );
              })}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-medium text-slate-700">เริ่มจาก Slot ที่</span>
              <input
                type="number"
                min="1"
                required
                value={startSlot}
                onChange={(e) => setStartSlot(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">ถึง Slot ที่</span>
              <input
                type="number"
                min="1"
                required
                value={endSlot}
                onChange={(e) => setEndSlot(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
          </div>
          <p className="text-slate-500">
            ระบบจะคำนวณพิกัด 3D แบบ Floor Saddle / Pyramid Stacking อัตโนมัติและข้ามรหัสช่องเดิมที่มีอยู่แล้ว
          </p>
          <div className="pt-2 flex justify-end gap-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded border border-slate-300 font-medium cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 rounded bg-[#1D4ED8] text-white font-semibold cursor-pointer"
            >
              {submitting ? 'กำลังสร้าง...' : 'สร้างตำแหน่งจัดเก็บ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateDoorModal({
  zones,
  onClose,
  onCreated,
  onError,
}: {
  zones: WarehouseHierarchyData['zones'];
  onClose: () => void;
  onCreated: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [zoneId, setZoneId] = useState(String(zones[0]?.id ?? ''));
  const [doorCode, setDoorCode] = useState('');
  const [name, setName] = useState('');
  const [posX, setPosX] = useState('24');
  const [posZ, setPosZ] = useState('15');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/warehouse/doors', {
        method: 'POST',
        body: {
          zoneId: Number(zoneId),
          doorCode: doorCode.trim().toUpperCase(),
          name: name.trim(),
          posX: Number(posX),
          posY: 0,
          posZ: Number(posZ),
          facingDirection: 'SOUTH',
        },
      });
      onCreated(`เพิ่มประตูอาคาร ${doorCode.trim().toUpperCase()} เรียบร้อยแล้ว`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'เพิ่มประตูอาคารไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full overflow-hidden">
        <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between">
          <h3 className="text-sm font-bold">เพิ่มประตูอาคาร (Add Building Door)</h3>
          <button type="button" onClick={onClose} aria-label="ปิด" className="cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
          <label className="block">
            <span className="font-medium text-slate-700">Zone</span>
            <select
              value={zoneId}
              onChange={(e) => setZoneId(e.target.value)}
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 bg-white"
            >
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.code} — {z.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="font-medium text-slate-700">รหัสประตู (เช่น E9)</span>
            <input
              type="text"
              required
              value={doorCode}
              onChange={(e) => setDoorCode(e.target.value)}
              placeholder="E9"
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono uppercase"
            />
          </label>
          <label className="block">
            <span className="font-medium text-slate-700">ชื่อประตูอาคาร</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ประตูอาคาร E9 — โซนขยายใหม่"
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-medium text-slate-700">พิกัด X (m)</span>
              <input
                type="number"
                step="0.5"
                required
                value={posX}
                onChange={(e) => setPosX(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">พิกัด Z (m)</span>
              <input
                type="number"
                step="0.5"
                required
                value={posZ}
                onChange={(e) => setPosZ(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-slate-200">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded border border-slate-300 cursor-pointer">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 rounded bg-[#1D4ED8] text-white font-semibold cursor-pointer"
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึกประตูอาคาร'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateRowModal({
  doors,
  onClose,
  onCreated,
  onError,
}: {
  doors: WarehouseHierarchyData['doors'];
  onClose: () => void;
  onCreated: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [doorId, setDoorId] = useState(String(doors[0]?.id ?? ''));
  const [rowNumber, setRowNumber] = useState('4');
  const [label, setLabel] = useState('แถวที่ 4 (Floor Saddle)');
  const [posX, setPosX] = useState('-24');
  const [posZ, setPosZ] = useState('-14');
  const [slotSpacingM, setSlotSpacingM] = useState('2.1');
  const [priority, setPriority] = useState('40');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/warehouse/rows', {
        method: 'POST',
        body: {
          doorId: Number(doorId),
          rowNumber: Number(rowNumber),
          label: label.trim(),
          posX: Number(posX),
          posZ: Number(posZ),
          slotSpacingM: Number(slotSpacingM),
          allocationPriority: Number(priority),
          maxLevels: 4,
        },
      });
      onCreated(`เพิ่มแถวที่ ${rowNumber} เรียบร้อยแล้ว`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'เพิ่มแถวไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full overflow-hidden">
        <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between">
          <h3 className="text-sm font-bold">เพิ่มแถวจัดเก็บ (Add Warehouse Row)</h3>
          <button type="button" onClick={onClose} aria-label="ปิด" className="cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
          <label className="block">
            <span className="font-medium text-slate-700">ประตูอาคาร (Door)</span>
            <select
              value={doorId}
              onChange={(e) => setDoorId(e.target.value)}
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 bg-white font-mono"
            >
              {doors.map((d) => (
                <option key={d.id} value={d.id}>
                  Door {d.doorCode} — {d.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-medium text-slate-700">เลขแถว (Row No.)</span>
              <input
                type="number"
                min="1"
                required
                value={rowNumber}
                onChange={(e) => setRowNumber(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">Allocation Priority</span>
              <input
                type="number"
                min="1"
                required
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
          </div>
          <label className="block">
            <span className="font-medium text-slate-700">ชื่อแถว</span>
            <input
              type="text"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300"
            />
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="font-medium text-slate-700">Origin X (m)</span>
              <input
                type="number"
                step="0.1"
                required
                value={posX}
                onChange={(e) => setPosX(e.target.value)}
                className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">Origin Z (m)</span>
              <input
                type="number"
                step="0.1"
                required
                value={posZ}
                onChange={(e) => setPosZ(e.target.value)}
                className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">Spacing (m)</span>
              <input
                type="number"
                step="0.1"
                required
                value={slotSpacingM}
                onChange={(e) => setSlotSpacingM(e.target.value)}
                className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono"
              />
            </label>
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-slate-200">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded border border-slate-300 cursor-pointer">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 rounded bg-[#1D4ED8] text-white font-semibold cursor-pointer"
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึกแถวจัดเก็บ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateLevelModal({
  hierarchy,
  onClose,
  onCreated,
  onError,
}: {
  hierarchy: WarehouseHierarchyData;
  onClose: () => void;
  onCreated: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [rowId, setRowId] = useState(String(hierarchy.rows[0]?.id ?? ''));
  const [levelNumber, setLevelNumber] = useState('1');
  const [label, setLabel] = useState('ชั้น 1 (Floor Saddle)');
  const [maxWeightKg, setMaxWeightKg] = useState('25000');
  const [maxSlots, setMaxSlots] = useState('10');
  const [stackingRule, setStackingRule] = useState<StackingRule>('FLOOR_SADDLE');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await apiFetch('/api/warehouse/levels', {
        method: 'POST',
        body: {
          rowId: Number(rowId),
          levelNumber: Number(levelNumber),
          label: label.trim(),
          maxWeightKg: Number(maxWeightKg),
          maxSlots: Number(maxSlots),
          stackingRule,
        },
      });
      onCreated(`เพิ่มชั้นที่ ${levelNumber} เรียบร้อยแล้ว`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'เพิ่มชั้นจัดเก็บไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-slate-200 max-w-md w-full overflow-hidden">
        <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between">
          <h3 className="text-sm font-bold">เพิ่มชั้นจัดเก็บ (Add Warehouse Level)</h3>
          <button type="button" onClick={onClose} aria-label="ปิด" className="cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
          <label className="block">
            <span className="font-medium text-slate-700">เลือกแถว (Door / Row)</span>
            <select
              value={rowId}
              onChange={(e) => setRowId(e.target.value)}
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 bg-white font-mono"
            >
              {hierarchy.rows.map((r) => {
                const d = hierarchy.doors.find((x) => x.id === r.doorId);
                return (
                  <option key={r.id} value={r.id}>
                    {d?.doorCode} / Row {r.rowNumber} — {r.label}
                  </option>
                );
              })}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-medium text-slate-700">ชั้นที่ (Level No.)</span>
              <input
                type="number"
                min="1"
                max="10"
                required
                value={levelNumber}
                onChange={(e) => setLevelNumber(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">รูปแบบวางซ้อน</span>
              <select
                value={stackingRule}
                onChange={(e) => setStackingRule(e.target.value as StackingRule)}
                className="mt-1 w-full h-9 px-2 rounded border border-slate-300 bg-white"
              >
                <option value="FLOOR_SADDLE">FLOOR_SADDLE</option>
                <option value="PYRAMID_STACK">PYRAMID_STACK</option>
                <option value="RACK_BAY">RACK_BAY</option>
              </select>
            </label>
          </div>
          <label className="block">
            <span className="font-medium text-slate-700">ชื่อชั้น</span>
            <input
              type="text"
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="font-medium text-slate-700">น้ำหนักสูงสุด (KG)</span>
              <input
                type="number"
                min="1000"
                step="500"
                required
                value={maxWeightKg}
                onChange={(e) => setMaxWeightKg(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">จำนวนช่องสูงสุด</span>
              <input
                type="number"
                min="1"
                max="100"
                required
                value={maxSlots}
                onChange={(e) => setMaxSlots(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono"
              />
            </label>
          </div>
          <div className="pt-2 flex justify-end gap-2 border-t border-slate-200">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded border border-slate-300 cursor-pointer">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 rounded bg-[#1D4ED8] text-white font-semibold cursor-pointer"
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึกชั้นจัดเก็บ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LayoutObjectModal({
  zones,
  existing,
  onClose,
  onSaved,
  onError,
}: {
  zones: WarehouseHierarchyData['zones'];
  existing: LayoutObjectItem | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [zoneId, setZoneId] = useState(String(existing?.zoneId ?? zones[0]?.id ?? ''));
  const [objectCode, setObjectCode] = useState(existing?.objectCode ?? '');
  const [name, setName] = useState(existing?.name ?? '');
  const [objectType, setObjectType] = useState(existing?.objectType ?? 'AISLE');
  const [posX, setPosX] = useState(String(existing?.posX ?? 0));
  const [posY, setPosY] = useState(String(existing?.posY ?? 0.02));
  const [posZ, setPosZ] = useState(String(existing?.posZ ?? 0));
  const [widthM, setWidthM] = useState(String(existing?.widthM ?? 6));
  const [heightM, setHeightM] = useState(String(existing?.heightM ?? 0.2));
  const [depthM, setDepthM] = useState(String(existing?.depthM ?? 4));
  const [isEstimated, setIsEstimated] = useState(existing?.isEstimated ?? true);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (existing) {
        await apiFetch(`/api/warehouse/layout-objects/${existing.id}`, {
          method: 'PATCH',
          body: {
            name: name.trim(),
            posX: Number(posX),
            posY: Number(posY),
            posZ: Number(posZ),
            widthM: Number(widthM),
            heightM: Number(heightM),
            depthM: Number(depthM),
            isEstimated,
          },
        });
        onSaved(`ปรับแก้โครงสร้าง 3D "${existing.objectCode}" เรียบร้อยแล้ว`);
      } else {
        await apiFetch('/api/warehouse/layout-objects', {
          method: 'POST',
          body: {
            zoneId: Number(zoneId),
            objectCode: objectCode.trim().toUpperCase(),
            name: name.trim(),
            objectType,
            posX: Number(posX),
            posY: Number(posY),
            posZ: Number(posZ),
            widthM: Number(widthM),
            heightM: Number(heightM),
            depthM: Number(depthM),
            isEstimated,
          },
        });
        onSaved(`เพิ่มโครงสร้าง 3D "${objectCode.trim().toUpperCase()}" เรียบร้อยแล้ว`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'บันทึกโครงสร้าง 3D ไม่สำเร็จ');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg border border-slate-200 max-w-lg w-full overflow-hidden">
        <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between">
          <h3 className="text-sm font-bold">
            {existing ? `ปรับพิกัดวัตถุ 3D (${existing.objectCode})` : 'เพิ่มวัตถุโครงสร้าง 3D'}
          </h3>
          <button type="button" onClick={onClose} aria-label="ปิด" className="cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-3 text-xs">
          {!existing && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="font-medium text-slate-700">Object Code</span>
                <input
                  type="text"
                  required
                  value={objectCode}
                  onChange={(e) => setObjectCode(e.target.value)}
                  placeholder="OBJ-AISLE-2"
                  className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 font-mono uppercase"
                />
              </label>
              <label className="block">
                <span className="font-medium text-slate-700">ประเภทวัตถุ</span>
                <select
                  value={objectType}
                  onChange={(e) => setObjectType(e.target.value)}
                  className="mt-1 w-full h-9 px-2 rounded border border-slate-300 bg-white font-mono"
                >
                  <option value="RECEIVING_AREA">RECEIVING_AREA</option>
                  <option value="DISPATCH_AREA">DISPATCH_AREA</option>
                  <option value="AISLE">AISLE</option>
                  <option value="CRANE_RUNWAY">CRANE_RUNWAY</option>
                  <option value="CRANE_BRIDGE">CRANE_BRIDGE</option>
                  <option value="BLOCKED_AREA">BLOCKED_AREA</option>
                  <option value="DOOR_GATE">DOOR_GATE</option>
                </select>
              </label>
            </div>
          )}

          {!existing && (
            <label className="block">
              <span className="font-medium text-slate-700">Zone</span>
              <select
                value={zoneId}
                onChange={(e) => setZoneId(e.target.value)}
                className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300 bg-white"
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.code} — {z.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="block">
            <span className="font-medium text-slate-700">ชื่อวัตถุ</span>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full h-9 px-2.5 rounded border border-slate-300"
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="font-medium text-slate-700">X (m)</span>
              <input type="number" step="0.1" required value={posX} onChange={(e) => setPosX(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">Y (m)</span>
              <input type="number" step="0.1" required value={posY} onChange={(e) => setPosY(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">Z (m)</span>
              <input type="number" step="0.1" required value={posZ} onChange={(e) => setPosZ(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <label className="block">
              <span className="font-medium text-slate-700">Width (m)</span>
              <input type="number" step="0.1" min="0.1" required value={widthM} onChange={(e) => setWidthM(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">Height (m)</span>
              <input type="number" step="0.1" min="0.02" required value={heightM} onChange={(e) => setHeightM(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" />
            </label>
            <label className="block">
              <span className="font-medium text-slate-700">Depth (m)</span>
              <input type="number" step="0.1" min="0.1" required value={depthM} onChange={(e) => setDepthM(e.target.value)} className="mt-1 w-full h-9 px-2 rounded border border-slate-300 font-mono" />
            </label>
          </div>

          <label className="inline-flex items-center gap-2 text-slate-700 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={isEstimated}
              onChange={(e) => setIsEstimated(e.target.checked)}
            />
            <span>ระบุเป็น Estimated Layout (ยกเลิกติ๊กเมื่อวัดพื้นที่จริงแล้ว)</span>
          </label>

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-200">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded border border-slate-300 cursor-pointer">
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="h-9 px-4 rounded bg-[#1D4ED8] text-white font-semibold cursor-pointer"
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึกโครงสร้าง 3D'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
