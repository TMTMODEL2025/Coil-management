import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  RotateCcw,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Play,
  Square,
  RefreshCw,
  MapPinned,
  Plus,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type {
  ExpandRowSlotsResponse,
  NavSectionId,
  SceneLocationNode,
  SceneSearchResult,
  Warehouse3DSceneResponse,
} from '../../types/wms';
import { WarehouseScene } from '../../three/WarehouseScene';
import { WarehouseDataService } from '../../three/WarehouseDataService';
import { WarehouseRealtimeService } from '../../three/WarehouseRealtimeService';
import {
  filterSceneLocations,
  LOCATION_STATUS_STYLES,
  type CameraPresetId,
} from '../../three/warehouse3dLogic';
import { CoilDetailPanel } from './CoilDetailPanel';
import { ExpandRowSlotsModal } from './ExpandRowSlotsModal';

interface Warehouse3DViewProps {
  onNavigate: (section: NavSectionId) => void;
  initialFocusLocationCode?: string | null;
  onConsumedFocus?: () => void;
}

const CAMERA_PRESETS: Array<{ id: CameraPresetId; label: string }> = [
  { id: 'isometric', label: 'Isometric' },
  { id: 'top', label: 'Top' },
  { id: 'front', label: 'Front' },
  { id: 'side', label: 'Side' },
  { id: 'reset', label: 'Reset' },
];

export function Warehouse3DView({
  onNavigate,
  initialFocusLocationCode,
  onConsumedFocus,
}: Warehouse3DViewProps) {
  const { profile, realtimeConnected, realtimeRevision, lastRealtimeEvent } = useAuth();
  const canExpandLayout = profile?.roleCode === 'ADMIN' || profile?.roleCode === 'SUPERVISOR';

  const [sceneData, setSceneData] = useState<Warehouse3DSceneResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiError, setApiError] = useState<string | null>(null);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);

  // Filters (Door / Row / Level / Pending SAP)
  const [selectedDoorId, setSelectedDoorId] = useState<number | 'ALL'>('ALL');
  const [selectedRowId, setSelectedRowId] = useState<number | 'ALL'>('ALL');
  const [selectedLevelNumber, setSelectedLevelNumber] = useState<number | 'ALL'>('ALL');
  const [pendingSapOnly, setPendingSapOnly] = useState(false);

  // Expand Row Slots Modal & Notice
  const [showExpandModal, setShowExpandModal] = useState(false);
  const [expandNotice, setExpandNotice] = useState<string | null>(null);
  const [pendingFocusCode, setPendingFocusCode] = useState<string | null>(null);

  // Search & Selection (Temporary client-side purple highlight — NEVER mutates DB)
  const [searchInput, setSearchInput] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<SceneSearchResult | null>(null);
  const [selectedLocationId, setSelectedLocationId] = useState<number | null>(null);
  const [highlightedLocationIds, setHighlightedLocationIds] = useState<Set<number>>(new Set());

  // Collapsible Bottom Control Dock & Crane Visual Demo Toggle
  const [dockExpanded, setDockExpanded] = useState(true);
  const [craneDemoActive, setCraneDemoActive] = useState(false);

  // Dedicated Three.js mount container + stable engine ref
  const canvasMountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<WarehouseScene | null>(null);
  const realtimeServiceRef = useRef<WarehouseRealtimeService | null>(null);

  // Callback ref so Three.js mount effect never depends on React UI state
  const handleSelectFrom3DRef = useRef<(loc: SceneLocationNode | null) => void>(() => {});

  handleSelectFrom3DRef.current = (loc: SceneLocationNode | null) => {
    if (!loc) return;
    setSelectedLocationId(loc.id);
    setHighlightedLocationIds(new Set([loc.id]));
    setSearchResult(null);
  };

  // Load real PostgreSQL 3D scene data
  const loadSceneData = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const data = await WarehouseDataService.fetchScene();
      setSceneData(data);
      setApiError(null);
    } catch (err) {
      setApiError(
        err instanceof Error
          ? err.message
          : 'ไม่สามารถโหลดข้อมูลคลังสินค้า 3D จากฐานข้อมูล PostgreSQL ได้'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + realtime service lifecycle
  useEffect(() => {
    void loadSceneData(true);

    const rtService = new WarehouseRealtimeService(() => {
      void loadSceneData(false);
    }, 240);
    realtimeServiceRef.current = rtService;

    return () => {
      rtService.dispose();
      realtimeServiceRef.current = null;
    };
  }, [loadSceneData]);

  // Forward SSE connection status, events, and manual refresh into WarehouseRealtimeService
  useEffect(() => {
    realtimeServiceRef.current?.handleConnectionChange(realtimeConnected);
  }, [realtimeConnected]);

  useEffect(() => {
    if (lastRealtimeEvent) {
      realtimeServiceRef.current?.handleRealtimeEvent(lastRealtimeEvent);
    }
  }, [lastRealtimeEvent]);

  useEffect(() => {
    if (realtimeRevision > 0) {
      realtimeServiceRef.current?.requestManualSync();
    }
  }, [realtimeRevision]);

  // Initialize Three.js WebGL Engine ONCE on mount (never re-created on HUD state changes)
  useEffect(() => {
    const container = canvasMountRef.current;
    if (!container) return;

    try {
      const engine = new WarehouseScene(container, {
        onSelectLocation: (loc) => handleSelectFrom3DRef.current(loc),
        onContextLost: () => setContextLost(true),
        onContextRestored: () => setContextLost(false),
      });
      engineRef.current = engine;
      setWebglError(null);
    } catch (err) {
      const msg =
        err instanceof Error && err.message === 'WEBGL_UNAVAILABLE'
          ? 'เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับ WebGL สำหรับแสดงผล 3D Warehouse'
          : 'ไม่สามารถเริ่มต้น WebGL 3D Engine ได้';
      setWebglError(msg);
    }

    return () => {
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Derived filter options
  const availableRows = useMemo(() => {
    if (!sceneData) return [];
    if (selectedDoorId === 'ALL') return sceneData.rows;
    return sceneData.rows.filter((r) => r.doorId === selectedDoorId);
  }, [sceneData, selectedDoorId]);

  const availableLevelNumbers = useMemo(() => {
    if (!sceneData) return [];
    const nums = new Set<number>();
    const rowIds = new Set(availableRows.map((r) => r.id));
    for (const lvl of sceneData.levels) {
      if (selectedRowId !== 'ALL' && lvl.rowId !== selectedRowId) continue;
      if (selectedDoorId !== 'ALL' && !rowIds.has(lvl.rowId)) continue;
      nums.add(lvl.levelNumber);
    }
    return Array.from(nums).sort((a, b) => a - b);
  }, [sceneData, availableRows, selectedDoorId, selectedRowId]);

  // Filtered locations displayed in the 3D scene
  const filteredLocations = useMemo(() => {
    if (!sceneData) return [];
    const base = filterSceneLocations(sceneData.locations, {
      doorId: selectedDoorId,
      rowId: selectedRowId,
      levelNumber: selectedLevelNumber,
    });
    if (!pendingSapOnly) return base;
    return base.filter((loc) => loc.coil?.isPendingSapSync === true);
  }, [sceneData, selectedDoorId, selectedRowId, selectedLevelNumber, pendingSapOnly]);

  // Consume deep-link focus location (e.g. immediately after Inbound placement or Row Slot Expansion)
  const effectiveFocusCode = initialFocusLocationCode ?? pendingFocusCode;
  useEffect(() => {
    if (!effectiveFocusCode || !sceneData) return;
    const upper = effectiveFocusCode.trim().toUpperCase();
    const target = sceneData.locations.find((l) => l.locationCode.toUpperCase() === upper);
    if (!target) {
      if (initialFocusLocationCode) onConsumedFocus?.();
      if (pendingFocusCode) setPendingFocusCode(null);
      return;
    }
    setSelectedDoorId('ALL');
    setSelectedRowId('ALL');
    setSelectedLevelNumber('ALL');
    setPendingSapOnly(false);
    setSelectedLocationId(target.id);
    setHighlightedLocationIds(new Set([target.id]));
    const timer = window.setTimeout(() => {
      engineRef.current?.focusLocationById(target.id);
      if (initialFocusLocationCode) onConsumedFocus?.();
      if (pendingFocusCode) setPendingFocusCode(null);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [effectiveFocusCode, initialFocusLocationCode, pendingFocusCode, sceneData, onConsumedFocus]);

  const handleRowExpanded = useCallback(
    async (result: ExpandRowSlotsResponse) => {
      setShowExpandModal(false);
      setExpandNotice(
        `ขยายแถว ${result.doorCode}/Row ${result.rowNumber} สำเร็จ: ชั้น 1 รองรับ ${result.newBaseSlots} ม้วน (สร้างใหม่ ${result.createdCount} ช่อง)`
      );
      if (result.firstCreatedLocationCode) {
        setPendingFocusCode(result.firstCreatedLocationCode);
      }
      await loadSceneData(false);
    },
    [loadSceneData]
  );

  const levelSlotCountsById = useMemo(() => {
    const counts = new Map<number, number>();
    if (!sceneData) return counts;
    for (const loc of sceneData.locations) {
      counts.set(loc.levelId, (counts.get(loc.levelId) ?? 0) + 1);
    }
    return counts;
  }, [sceneData]);

  const selectedLocation = useMemo(() => {
    if (!sceneData || selectedLocationId === null) return null;
    return sceneData.locations.find((l) => l.id === selectedLocationId) ?? null;
  }, [sceneData, selectedLocationId]);

  // Sync warehouse structure when PostgreSQL scene data updates
  useEffect(() => {
    if (!sceneData || !engineRef.current) return;
    engineRef.current.syncStructure(sceneData);
  }, [sceneData]);

  // Sync filtered locations & coils to InstancedMesh
  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.syncLocations(
      filteredLocations,
      highlightedLocationIds,
      selectedLocationId
    );
  }, [filteredLocations, highlightedLocationIds, selectedLocationId]);

  // Fast highlight update without mesh rebuild
  useEffect(() => {
    if (!engineRef.current) return;
    engineRef.current.updateHighlights(highlightedLocationIds, selectedLocationId);
  }, [highlightedLocationIds, selectedLocationId]);

  // Sync Crane Visual Demo mode
  useEffect(() => {
    engineRef.current?.setCraneVisualDemo(craneDemoActive);
  }, [craneDemoActive]);

  // Search handler (queries real PostgreSQL via GET /api/warehouse/3d-search)
  const executeSearch = useCallback(
    async (rawTerm: string) => {
      const term = rawTerm.trim();
      if (!term) {
        setSearchResult(null);
        setHighlightedLocationIds(new Set());
        setSelectedLocationId(null);
        return;
      }

      setSearching(true);
      try {
        const res = await WarehouseDataService.search(term);
        setSearchResult(res);

        if (res.found && res.matchedLocationIds.length > 0) {
          // Reset restrictive filters if target location is hidden by active filter
          setSelectedDoorId('ALL');
          setSelectedRowId('ALL');
          setSelectedLevelNumber('ALL');
          setPendingSapOnly(false);

          const nextHighlight = new Set(res.matchedLocationIds);
          setHighlightedLocationIds(nextHighlight);
          if (res.primaryLocationId !== null) {
            setSelectedLocationId(res.primaryLocationId);
            // Focus camera on next animation frame after filters clear
            window.requestAnimationFrame(() => {
              engineRef.current?.focusLocationById(res.primaryLocationId!);
            });
          }
        } else {
          setHighlightedLocationIds(new Set());
          setSelectedLocationId(null);
        }
      } catch (err) {
        setSearchResult({
          found: false,
          query: term,
          matchType: 'NOT_FOUND',
          messageTh:
            err instanceof Error ? err.message : 'เกิดข้อผิดพลาดระหว่างค้นหาข้อมูลจากฐานข้อมูล',
          messageEn: 'Search request failed.',
          primaryLocationId: null,
          primaryLocationCode: null,
          matchedLocationIds: [],
          matchedDoorId: null,
          matchedRowId: null,
          unplacedCoils: [],
        });
      } finally {
        setSearching(false);
      }
    },
    []
  );

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeSearch(searchInput);
  };

  const handleClearSearch = () => {
    setSearchInput('');
    setSearchResult(null);
    setHighlightedLocationIds(new Set());
    setSelectedLocationId(null);
  };

  const handleCameraPreset = (preset: CameraPresetId) => {
    engineRef.current?.setCameraPreset(preset);
  };

  const handleFocusLocation = (loc: SceneLocationNode) => {
    engineRef.current?.focusLocationById(loc.id);
  };

  const summary = sceneData?.summary;

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Compact Top Operational Search & Summary Strip */}
      <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-2.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
          {/* Search Form */}
          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2 flex-1 max-w-2xl">
            <div className="relative flex-1 min-w-0">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="ค้นหา Location (เช่น E7/1/3/9), Coil ID, Batch, Door (E7/E8)..."
                aria-label="ค้นหาตำแหน่งจัดเก็บหรือเหล็กม้วนในคลัง 3D"
                className="w-full min-h-[40px] pl-9 pr-8 rounded-md border border-slate-300 bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-[#1D4ED8]"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  aria-label="ล้างคำค้นหา"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={searching}
              className="min-h-[40px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap shrink-0 cursor-pointer"
            >
              {searching ? 'กำลังค้นหา...' : 'ค้นหา / โฟกัส'}
            </button>
          </form>

          {/* Real-Time PostgreSQL Status Summary Counters */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-500">Slots:</span>
              <span className="font-mono font-bold tabular-nums text-slate-900">
                {filteredLocations.length}
                {summary && filteredLocations.length !== summary.totalLocations
                  ? `/${summary.totalLocations}`
                  : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#16A34A]" aria-hidden="true" />
              <span className="text-slate-600">ว่าง</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {summary?.emptyCount ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#2563EB]" aria-hidden="true" />
              <span className="text-slate-600">มีม้วน</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {summary?.activeCoilCount ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#EA580C]" aria-hidden="true" />
              <span className="text-slate-600">จอง</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {summary?.reservedCount ?? 0}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-[#DC2626]" aria-hidden="true" />
              <span className="text-slate-600">ปิด</span>
              <span className="font-mono font-semibold tabular-nums text-slate-900">
                {summary?.blockedCount ?? 0}
              </span>
            </div>
            {(summary?.pendingSapCoilCount ?? 0) > 0 && (
              <button
                type="button"
                onClick={() => setPendingSapOnly((v) => !v)}
                className={`flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-semibold cursor-pointer transition-colors ${
                  pendingSapOnly
                    ? 'bg-[#F59E0B] border-amber-600 text-slate-950'
                    : 'bg-amber-50 border-amber-300 text-amber-900 hover:bg-amber-100'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-sm ${pendingSapOnly ? 'bg-slate-950' : 'bg-[#F59E0B]'}`}
                  aria-hidden="true"
                />
                <span>รอข้อมูล SAP</span>
                <span className="font-mono tabular-nums">{summary?.pendingSapCoilCount ?? 0}</span>
              </button>
            )}

            {summary?.isEstimatedLayout && (
              <span className="px-2 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-800 font-medium text-[11px] whitespace-nowrap">
                Estimated Layout · Floor Saddle &amp; Crane
              </span>
            )}
          </div>
        </div>

        {/* Quick Search Hints + Live Search Feedback */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100 text-xs">
          <div className="flex flex-wrap items-center gap-1.5 text-slate-500">
            <span>ตัวอย่างค้นหาเร็ว:</span>
            {['E7/1/3/9', 'E7/1/1/1', 'E7/2/4/9', 'E8'].map((sample) => (
              <button
                key={sample}
                type="button"
                onClick={() => {
                  setSearchInput(sample);
                  void executeSearch(sample);
                }}
                className="px-2 py-0.5 rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 font-mono text-[11px] text-slate-700 cursor-pointer"
              >
                {sample}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {canExpandLayout && sceneData && sceneData.rows.length > 0 && (
              <button
                type="button"
                onClick={() => setShowExpandModal(true)}
                className="min-h-[30px] px-2.5 py-1 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                <span>ขยายช่องวางแถว (เพิ่มเกิน 12 ม้วน)</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => void loadSceneData(false)}
              className="text-xs font-medium text-[#1D4ED8] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              <span>ซิงก์ข้อมูลจาก PostgreSQL</span>
            </button>
          </div>
        </div>

        {expandNotice && (
          <div
            role="status"
            className="rounded-md px-3 py-2 text-xs bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between gap-2"
          >
            <span className="font-medium">{expandNotice}</span>
            <button
              type="button"
              onClick={() => setExpandNotice(null)}
              aria-label="ปิดข้อความ"
              className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Search Result Feedback Banner (Location Not Found / Coil Not Stored / Found) */}
        {searchResult && (
          <div
            role="status"
            className={`rounded-md px-3 py-2 text-xs flex items-start justify-between gap-3 border ${
              !searchResult.found
                ? 'bg-red-50 border-red-200 text-red-900'
                : searchResult.matchType === 'COIL_NOT_STORED'
                  ? 'bg-amber-50 border-amber-200 text-amber-900'
                  : 'bg-purple-50 border-purple-200 text-purple-900'
            }`}
          >
            <div className="space-y-1">
              <div className="font-semibold">{searchResult.messageTh}</div>
              <div className="text-[11px] opacity-80">{searchResult.messageEn}</div>
              {searchResult.unplacedCoils.length > 0 && (
                <div className="pt-1 flex flex-wrap gap-1.5">
                  {searchResult.unplacedCoils.map((c) => (
                    <span
                      key={c.coilId}
                      className="px-2 py-0.5 rounded bg-amber-100 border border-amber-300 font-mono text-[11px]"
                    >
                      {c.coilId} ({c.lifecycleStatus})
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleClearSearch}
              aria-label="ปิดข้อความค้นหา"
              className="p-1 opacity-70 hover:opacity-100 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* Coordinate Warning Banner (if any DB location has missing/invalid coordinates) */}
        {sceneData && sceneData.coordinateWarnings.length > 0 && (
          <div
            role="alert"
            className="bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs text-amber-900 flex items-center gap-2"
          >
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
            <span>
              พบตำแหน่งจัดเก็บ {sceneData.coordinateWarnings.length} รายการที่พิกัด 3D ไม่สมบูรณ์
              (ไม่ถูกนำมาแสดงผลเพื่อป้องกันข้อผิดพลาด):{' '}
              <span className="font-mono">
                {sceneData.coordinateWarnings
                  .slice(0, 5)
                  .map((w) => w.locationCode)
                  .join(', ')}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Main Unobstructed 3D Warehouse Canvas Container */}
      <div className="relative flex-1 min-h-[470px] h-[calc(100vh-250px)] lg:min-h-[560px] rounded-lg overflow-hidden border border-slate-800 bg-[#0B1526]">
        {/* Dedicated Empty WebGL Mount Div (Initialized Once) */}
        <div ref={canvasMountRef} className="w-full h-full" />

        {/* Empty Inventory Truth Notice (Subtle corner label when Active Coils = 0) */}
        {!loading && !apiError && !webglError && summary && summary.activeCoilCount === 0 && (
          <div className="pointer-events-none absolute top-3 left-3 z-10 bg-[#0F172A]/90 border border-slate-700 rounded-md px-3 py-1.5 text-[11px] text-slate-200">
            Active Inventory: <span className="font-mono font-bold text-emerald-400">0 Coils</span>{' '}
            — แสดงเฉพาะตำแหน่งว่างจริงจากฐานข้อมูล ({summary.totalLocations} Slots)
          </div>
        )}

        {/* Loading Overlay */}
        {loading && !sceneData && !webglError && (
          <div className="absolute inset-0 z-20 bg-[#0B1526]/90 flex flex-col items-center justify-center p-6 text-center text-slate-200">
            <div className="w-7 h-7 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
            <div className="mt-3 text-sm font-semibold">กำลังโหลดโครงสร้างคลังสินค้า 3D...</div>
            <div className="mt-1 text-xs text-slate-400">
              เชื่อมต่อข้อมูล Location, Floor Saddle และ Active Inventory จาก Cloud SQL PostgreSQL
            </div>
          </div>
        )}

        {/* API Error Fallback (Never displays mock data!) */}
        {apiError && (
          <div
            role="alert"
            className="absolute inset-0 z-30 bg-[#0B1526]/95 flex items-center justify-center p-6"
          >
            <div className="max-w-md w-full bg-[#0F172A] border border-red-800 rounded-lg p-5 text-slate-100 space-y-3">
              <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>ไม่สามารถโหลดข้อมูล 3D Warehouse จากฐานข้อมูลได้</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{apiError}</p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void loadSceneData(true)}
                  className="min-h-[38px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#2563EB] text-white text-xs font-semibold cursor-pointer"
                >
                  ลองเชื่อมต่อใหม่
                </button>
                <button
                  type="button"
                  onClick={() => onNavigate('locations')}
                  className="min-h-[38px] px-4 rounded-md border border-slate-700 hover:bg-slate-800 text-slate-200 text-xs font-medium cursor-pointer"
                >
                  ดูแบบตาราง Location
                </button>
              </div>
            </div>
          </div>
        )}

        {/* WebGL Unavailable Fallback */}
        {webglError && (
          <div
            role="alert"
            className="absolute inset-0 z-30 bg-[#0B1526] flex items-center justify-center p-6"
          >
            <div className="max-w-md w-full bg-[#0F172A] border border-amber-700 rounded-lg p-5 text-slate-100 space-y-3">
              <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
                <AlertTriangle className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>อุปกรณ์ไม่รองรับการแสดงผล 3D WebGL</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{webglError}</p>
              <button
                type="button"
                onClick={() => onNavigate('locations')}
                className="min-h-[40px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#2563EB] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <MapPinned className="w-4 h-4" aria-hidden="true" />
                <span>เปิดหน้าจัดการ Location แบบตาราง</span>
              </button>
            </div>
          </div>
        )}

        {/* WebGL Context Lost Notice */}
        {contextLost && !webglError && (
          <div className="absolute inset-0 z-30 bg-[#0B1526]/90 flex items-center justify-center p-4">
            <div className="bg-[#0F172A] border border-amber-600 rounded-lg px-5 py-4 text-xs text-amber-200">
              WebGL Context ถูกพักชั่วคราว — กำลังกู้คืนหน้าจอ 3D Warehouse อัตโนมัติ...
            </div>
          </div>
        )}

        {/* Module 9: Coil & Location Detail Panel (Shown ONLY on click/search selection) */}
        {selectedLocation && (
          <CoilDetailPanel
            location={selectedLocation}
            isHighlighted={highlightedLocationIds.has(selectedLocation.id)}
            onFocusCamera={handleFocusLocation}
            onClose={() => {
              setSelectedLocationId(null);
              setHighlightedLocationIds(new Set());
            }}
          />
        )}

        {/* Collapsible Bottom Dock (Solid/RGBA dark surface — NO backdrop-blur over WebGL) */}
        {!webglError && (
          <div
            className={`absolute z-10 left-2 bottom-2 ${
              selectedLocation ? 'right-2 lg:right-[368px]' : 'right-2'
            } flex flex-col items-start pointer-events-none`}
          >
            <button
              type="button"
              onClick={() => setDockExpanded((v) => !v)}
              className="pointer-events-auto mb-1.5 px-3 py-1.5 rounded-md bg-[#0F172A]/95 border border-slate-700 text-[11px] font-semibold text-slate-200 hover:bg-slate-800 flex items-center gap-1.5 cursor-pointer shadow"
            >
              {dockExpanded ? (
                <>
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>ซ่อนแถบควบคุม 3D</span>
                </>
              ) : (
                <>
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>แสดงแถบควบคุมกล้อง / ตัวกรอง / สัญลักษณ์สี</span>
                </>
              )}
            </button>

            {dockExpanded && (
              <div className="pointer-events-auto w-full bg-[#0F172A]/95 border border-slate-700 rounded-lg px-3 py-2.5 text-slate-100 shadow-xl space-y-2">
                {/* Row 1: Camera Presets + Hierarchy Filters + Crane Visual Demo */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {/* Camera Presets */}
                  <div className="flex flex-wrap items-center gap-1">
                    {CAMERA_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleCameraPreset(preset.id)}
                        className="min-h-[32px] px-2.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] font-medium text-slate-100 flex items-center gap-1 cursor-pointer"
                      >
                        {preset.id === 'reset' && (
                          <RotateCcw className="w-3 h-3" aria-hidden="true" />
                        )}
                        <span>{preset.label}</span>
                      </button>
                    ))}
                  </div>

                  {/* Door / Row / Level Filters */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <select
                      aria-label="กรองตามประตูอาคาร (Building Door)"
                      value={selectedDoorId}
                      onChange={(e) => {
                        const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                        setSelectedDoorId(val);
                        setSelectedRowId('ALL');
                        setSelectedLevelNumber('ALL');
                      }}
                      className="min-h-[32px] px-2 rounded bg-slate-900 border border-slate-700 text-slate-100 text-[11px]"
                    >
                      <option value="ALL">Door ทั้งหมด</option>
                      {sceneData?.doors.map((d) => (
                        <option key={d.id} value={d.id}>
                          Door {d.doorCode}
                        </option>
                      ))}
                    </select>

                    <select
                      aria-label="กรองตามแถวจัดเก็บ (Row)"
                      value={selectedRowId}
                      onChange={(e) => {
                        const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                        setSelectedRowId(val);
                        setSelectedLevelNumber('ALL');
                      }}
                      className="min-h-[32px] px-2 rounded bg-slate-900 border border-slate-700 text-slate-100 text-[11px]"
                    >
                      <option value="ALL">Row ทั้งหมด</option>
                      {availableRows.map((r) => {
                        const door = sceneData?.doors.find((d) => d.id === r.doorId);
                        return (
                          <option key={r.id} value={r.id}>
                            {door?.doorCode ?? ''}/Row {r.rowNumber}
                          </option>
                        );
                      })}
                    </select>

                    <select
                      aria-label="กรองตามชั้นจัดเก็บ (Level)"
                      value={selectedLevelNumber}
                      onChange={(e) => {
                        const val = e.target.value === 'ALL' ? 'ALL' : Number(e.target.value);
                        setSelectedLevelNumber(val);
                      }}
                      className="min-h-[32px] px-2 rounded bg-slate-900 border border-slate-700 text-slate-100 text-[11px]"
                    >
                      <option value="ALL">Level ทั้งหมด</option>
                      {availableLevelNumbers.map((lvlNum) => (
                        <option key={lvlNum} value={lvlNum}>
                          Level {lvlNum}
                        </option>
                      ))}
                    </select>

                    {/* Pending SAP Coils Filter Toggle */}
                    <button
                      type="button"
                      onClick={() => setPendingSapOnly((v) => !v)}
                      title="แสดงเฉพาะม้วนเหล็กที่รับเข้าก่อนอัปโหลด SAP Excel (รอเชื่อมข้อมูล SAP)"
                      className={`min-h-[32px] px-2.5 rounded border text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer ${
                        pendingSapOnly
                          ? 'bg-[#F59E0B] border-amber-400 text-slate-950'
                          : 'bg-slate-800 border-slate-700 text-amber-300 hover:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`w-2 h-2 rounded-sm ${pendingSapOnly ? 'bg-slate-950' : 'bg-[#F59E0B]'}`}
                        aria-hidden="true"
                      />
                      <span>รอข้อมูล SAP ({summary?.pendingSapCoilCount ?? 0})</span>
                    </button>

                    {/* Opt-in Overhead Crane Visual Demonstration */}
                    <button
                      type="button"
                      onClick={() => setCraneDemoActive((v) => !v)}
                      title="สาธิตการเคลื่อนที่ของเครนเหนือศีรษะเพื่อการแสดงผลเท่านั้น ไม่กระทบข้อมูลสต็อก"
                      className={`min-h-[32px] px-2.5 rounded border text-[11px] font-medium flex items-center gap-1.5 cursor-pointer ${
                        craneDemoActive
                          ? 'bg-amber-600 border-amber-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                      }`}
                    >
                      {craneDemoActive ? (
                        <Square className="w-3 h-3" aria-hidden="true" />
                      ) : (
                        <Play className="w-3 h-3" aria-hidden="true" />
                      )}
                      <span>Crane Demo (Visual Only)</span>
                    </button>
                  </div>
                </div>

                {/* Row 2: Mandatory 5-Status Color Legend with Text Labels */}
                <div className="pt-1.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
                    {(
                      ['EMPTY', 'OCCUPIED', 'RESERVED', 'BLOCKED', 'RECOMMENDED'] as const
                    ).map((key) => {
                      const st = LOCATION_STATUS_STYLES[key];
                      return (
                        <span key={key} className="inline-flex items-center gap-1.5 text-slate-200">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{ backgroundColor: st.hex }}
                            aria-hidden="true"
                          />
                          <span className="font-mono font-semibold">{st.labelEn}</span>
                          <span className="text-slate-400 hidden sm:inline">{st.labelTh}</span>
                        </span>
                      );
                    })}
                    <span className="inline-flex items-center gap-1.5 text-amber-300">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0 bg-[#F59E0B]"
                        aria-hidden="true"
                      />
                      <span className="font-mono font-semibold">PENDING SAP</span>
                      <span className="text-amber-200/80 hidden sm:inline">รอข้อมูล SAP</span>
                    </span>
                  </div>
                  <span className="text-slate-400 hidden md:inline">
                    คลิกตำแหน่งหรือม้วนเหล็กเพื่อดูรายละเอียด · ลากเพื่อหมุนมุมมอง
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showExpandModal && sceneData && (
        <ExpandRowSlotsModal
          doors={sceneData.doors}
          rows={sceneData.rows}
          levels={sceneData.levels.map((l) => ({
            id: l.id,
            rowId: l.rowId,
            levelNumber: l.levelNumber,
            label: l.label,
            maxSlots: l.maxSlots,
            stackingRule: l.stackingRule,
            currentSlotCount: levelSlotCountsById.get(l.id) ?? 0,
          }))}
          initialDoorId={selectedDoorId === 'ALL' ? null : selectedDoorId}
          initialRowId={selectedRowId === 'ALL' ? null : selectedRowId}
          onClose={() => setShowExpandModal(false)}
          onExpanded={(result) => void handleRowExpanded(result)}
        />
      )}
    </div>
  );
}
