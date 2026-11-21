import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Box,
  Building2,
  CheckCircle2,
  Clock,
  Layers,
  LayoutGrid,
  Lock,
  MapPin,
  Plus,
  RefreshCw,
  ScanBarcode,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import type { ExpandRowSlotsResponse, NavSectionId, WarehouseHierarchyData } from '../../types/wms';
import { ExpandRowSlotsModal } from '../warehouse3d/ExpandRowSlotsModal';
import type {
  BatchReceiveStatus,
  InboundBatchScanResponse,
  InboundConfirmPlacementResponse,
  InboundDirectPlaceResponse,
  InboundRowSlotsResponse,
  PendingSapBatchSummary,
  RowSlotEvaluationItem,
} from '../../types/inbound';

interface InboundBatchWorkflowTabProps {
  onNavigate: (section: NavSectionId) => void;
  onOpenLocationIn3D?: (locationCode: string) => void;
  canWrite: boolean;
  canOverride: boolean;
}

interface PickedLocationAssignment {
  coilDbId: number;
  coilId: string;
  effectiveWeightKg: number | null;
  locationId: number;
  locationCode: string;
  doorCode: string;
  rowNumber: number;
  levelNumber: number;
  slotNumber: number;
  maxWeightKg: number;
}

function formatNumber(val: number | null | undefined, digits = 0): string {
  if (val == null || !Number.isFinite(val)) return '-';
  return val.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatBatchStatusLabel(status: BatchReceiveStatus): { text: string; tone: string } {
  switch (status) {
    case 'COMPLETED':
      return { text: 'รับครบแล้ว (COMPLETED)', tone: 'text-[#16A34A] bg-emerald-50 border-emerald-200' };
    case 'PARTIALLY_RECEIVED':
      return { text: 'รับบางส่วนแล้ว (PARTIAL)', tone: 'text-[#1D4ED8] bg-blue-50 border-blue-200' };
    case 'RESERVED_IN_PROGRESS':
      return { text: 'จองตำแหน่งแล้ว (RESERVED)', tone: 'text-[#EA580C] bg-orange-50 border-orange-200' };
    case 'READY_TO_RECEIVE':
      return { text: 'พร้อมรับเข้า (READY)', tone: 'text-slate-700 bg-slate-100 border-slate-200' };
    default:
      return { text: 'ไม่พบข้อมูล (EMPTY)', tone: 'text-slate-500 bg-slate-50 border-slate-200' };
  }
}

function formatRemainingTtl(expiresAtIso: string, nowMs: number): string {
  const diffSec = Math.max(0, Math.floor((new Date(expiresAtIso).getTime() - nowMs) / 1000));
  if (diffSec === 0) return 'หมดอายุแล้ว';
  const min = Math.floor(diffSec / 60);
  const sec = diffSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `inb-${crypto.randomUUID()}`;
  }
  return `inb-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function InboundBatchWorkflowTab({
  onNavigate,
  onOpenLocationIn3D,
  canWrite,
  canOverride,
}: InboundBatchWorkflowTabProps) {
  const { realtimeRevision } = useAuth();

  // Step 1: Scan Batch State
  const [batchInput, setBatchInput] = useState('');
  const [pendingBatches, setPendingBatches] = useState<PendingSapBatchSummary[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);
  const [scanningBatch, setScanningBatch] = useState(false);
  const [batchData, setBatchData] = useState<InboundBatchScanResponse | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);

  // Step 2–5: Building -> Row -> Placeable Slots -> Operator Pick State
  const [hierarchy, setHierarchy] = useState<WarehouseHierarchyData | null>(null);
  const [activeCoilDbId, setActiveCoilDbId] = useState<number | null>(null);
  const [selectedDoorId, setSelectedDoorId] = useState<number | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);
  const [rowSlotsData, setRowSlotsData] = useState<InboundRowSlotsResponse | null>(null);
  const [loadingRowSlots, setLoadingRowSlots] = useState(false);
  const [rowSlotsError, setRowSlotsError] = useState<string | null>(null);
  const [slotViewMode, setSlotViewMode] = useState<'placeable' | 'all'>('placeable');
  const [pickedAssignments, setPickedAssignments] = useState<Record<number, PickedLocationAssignment>>({});
  const [selectedPreSapSlot, setSelectedPreSapSlot] = useState<RowSlotEvaluationItem | null>(null);
  const [showExpandRowModal, setShowExpandRowModal] = useState(false);

  // Direct-to-3D Placement & Reservation Action State
  const [placingDirect, setPlacingDirect] = useState(false);
  const [lastDirectPlacement, setLastDirectPlacement] = useState<InboundDirectPlaceResponse | null>(null);
  const [ttlMinutes, setTtlMinutes] = useState<number>(30);
  const [reserving, setReserving] = useState(false);
  const [releasingId, setReleasingId] = useState<number | null>(null);
  const [workflowNotice, setWorkflowNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Step 6: Physical Placement Confirmation State
  const [scannedCoilId, setScannedCoilId] = useState('');
  const [scannedLocationCode, setScannedLocationCode] = useState('');
  const [overrideReason, setOverrideReason] = useState('');
  const [showOverrideField, setShowOverrideField] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [lastConfirmation, setLastConfirmation] = useState<InboundConfirmPlacementResponse | null>(null);
  const pendingIdempotencyKeyRef = useRef<string>(createIdempotencyKey());
  const directPlaceIdempotencyKeyRef = useRef<string>(createIdempotencyKey());

  // Live countdown ticker for reservation TTL
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const batchInputRef = useRef<HTMLInputElement | null>(null);
  const coilScanInputRef = useRef<HTMLInputElement | null>(null);
  const locationScanInputRef = useRef<HTMLInputElement | null>(null);

  const loadPendingBatches = useCallback(async () => {
    try {
      const res = await apiFetch<{ batches: PendingSapBatchSummary[] }>(
        '/api/inbound/pending-batches?limit=24'
      );
      setPendingBatches(res.batches);
    } catch {
      // Non-fatal; operator can still scan Batch manually
    } finally {
      setLoadingPending(false);
    }
  }, []);

  const loadHierarchy = useCallback(async () => {
    try {
      const h = await apiFetch<WarehouseHierarchyData>('/api/warehouse/hierarchy');
      setHierarchy(h);
    } catch {
      // Non-fatal
    }
  }, []);

  useEffect(() => {
    void loadPendingBatches();
    void loadHierarchy();
  }, [loadPendingBatches, loadHierarchy, realtimeRevision]);

  const executeBatchScan = useCallback(
    async (targetBatchNo: string, preserveSelections = false) => {
      const cleaned = targetBatchNo.trim();
      if (!cleaned) {
        setScanError('กรุณาสแกนหรือพิมพ์หมายเลข Batch Number');
        return;
      }
      setScanningBatch(true);
      setScanError(null);
      if (!preserveSelections) {
        setWorkflowNotice(null);
      }
      try {
        const res = await apiFetch<InboundBatchScanResponse>(
          `/api/inbound/batches/${encodeURIComponent(cleaned)}`
        );
        setBatchData(res);
        setBatchInput(res.batchNo);

        const nextPendingAllocatable = res.coils.filter(
          (c) => c.inboundStatus !== 'RECEIVED' && !c.activeReservation && c.canAutoAllocate
        );

        if (!preserveSelections) {
          setPickedAssignments({});
          setSelectedPreSapSlot(null);
          setLastConfirmation(null);
          setLastDirectPlacement(null);
          setActiveCoilDbId(nextPendingAllocatable[0]?.coilDbId ?? null);
          directPlaceIdempotencyKeyRef.current = createIdempotencyKey();
        } else {
          // Prune picked assignments for coils that are no longer pending
          const validPendingSet = new Set(nextPendingAllocatable.map((c) => c.coilDbId));
          setPickedAssignments((prev) => {
            const next: Record<number, PickedLocationAssignment> = {};
            for (const [k, v] of Object.entries(prev)) {
              const id = Number(k);
              if (validPendingSet.has(id)) next[id] = v;
            }
            return next;
          });
          setActiveCoilDbId((prev) =>
            prev && validPendingSet.has(prev) ? prev : (nextPendingAllocatable[0]?.coilDbId ?? null)
          );
        }
      } catch (err) {
        setScanError(
          err instanceof Error ? err.message : 'ไม่สามารถค้นหาข้อมูล Batch จากฐานข้อมูลได้'
        );
      } finally {
        setScanningBatch(false);
      }
    },
    []
  );

  // Auto-refresh active batch when SSE realtime events arrive
  const activeBatchNoRef = useRef<string | null>(null);
  activeBatchNoRef.current = batchData ? batchData.batchNo : null;
  useEffect(() => {
    if (realtimeRevision > 0 && activeBatchNoRef.current) {
      void executeBatchScan(activeBatchNoRef.current, true);
    }
  }, [realtimeRevision, executeBatchScan]);

  const isPreSapMode = Boolean(batchData && (!batchData.found || batchData.preSapMode));

  // Load live placeable slots whenever selectedRowId or activeCoilDbId changes
  const fetchRowSlots = useCallback(async (rowId: number, coilDbId: number | null) => {
    setLoadingRowSlots(true);
    setRowSlotsError(null);
    try {
      const qs = new URLSearchParams({ rowId: String(rowId) });
      if (coilDbId) qs.set('coilDbId', String(coilDbId));
      const res = await apiFetch<InboundRowSlotsResponse>(`/api/inbound/row-slots?${qs.toString()}`);
      setRowSlotsData(res);
    } catch (err) {
      setRowSlotsError(
        err instanceof Error ? err.message : 'ไม่สามารถโหลดพื้นที่ที่สามารถวางได้ของแถวนี้'
      );
      setRowSlotsData(null);
    } finally {
      setLoadingRowSlots(false);
    }
  }, []);

  useEffect(() => {
    if (selectedRowId && batchData) {
      void fetchRowSlots(selectedRowId, isPreSapMode ? null : activeCoilDbId);
    } else {
      setRowSlotsData(null);
      setRowSlotsError(null);
    }
  }, [selectedRowId, activeCoilDbId, batchData, isPreSapMode, realtimeRevision, fetchRowSlots]);

  const handleBatchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void executeBatchScan(batchInput, false);
  };

  const openLocationIn3D = (locationCode: string) => {
    if (onOpenLocationIn3D) {
      onOpenLocationIn3D(locationCode);
    } else {
      onNavigate('warehouse-3d');
    }
  };

  const allocatablePendingCoils = useMemo(() => {
    if (!batchData?.found || batchData.preSapMode) return [];
    return batchData.coils.filter(
      (c) => c.inboundStatus !== 'RECEIVED' && !c.activeReservation && c.canAutoAllocate
    );
  }, [batchData]);

  const activeCoil = useMemo(() => {
    if (!activeCoilDbId) return allocatablePendingCoils[0] ?? null;
    return allocatablePendingCoils.find((c) => c.coilDbId === activeCoilDbId) ?? allocatablePendingCoils[0] ?? null;
  }, [allocatablePendingCoils, activeCoilDbId]);

  const reservedCoils = useMemo(() => {
    if (!batchData?.found) return [];
    return batchData.coils.filter((c) => c.activeReservation !== null);
  }, [batchData]);

  // Compute Building (Door) cards with live empty slot stats from hierarchy
  const buildingCards = useMemo(() => {
    if (!hierarchy) return [];
    const zoneById = new Map(hierarchy.zones.map((z) => [z.id, z]));
    const rowsByDoor = new Map<number, typeof hierarchy.rows>();
    for (const r of hierarchy.rows) {
      if (!r.isActive) continue;
      const list = rowsByDoor.get(r.doorId) ?? [];
      list.push(r);
      rowsByDoor.set(r.doorId, list);
    }
    const levelsByRow = new Map<number, typeof hierarchy.levels>();
    for (const lvl of hierarchy.levels) {
      if (!lvl.isActive) continue;
      const list = levelsByRow.get(lvl.rowId) ?? [];
      list.push(lvl);
      levelsByRow.set(lvl.rowId, list);
    }

    return hierarchy.doors
      .filter((d) => d.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.doorCode.localeCompare(b.doorCode))
      .map((door) => {
        const doorRows = rowsByDoor.get(door.id) ?? [];
        let emptySlots = 0;
        let totalSlots = 0;
        for (const r of doorRows) {
          for (const lvl of levelsByRow.get(r.id) ?? []) {
            emptySlots += lvl.stats.empty;
            totalSlots += lvl.stats.total;
          }
        }
        const zone = zoneById.get(door.zoneId);
        return {
          door,
          zoneName: zone?.name ?? '',
          rowCount: doorRows.length,
          emptySlots,
          totalSlots,
        };
      });
  }, [hierarchy]);

  // Compute Row cards for the selected Building (Door)
  const rowCards = useMemo(() => {
    if (!hierarchy || !selectedDoorId) return [];
    const levelsByRow = new Map<number, typeof hierarchy.levels>();
    for (const lvl of hierarchy.levels) {
      if (!lvl.isActive) continue;
      const list = levelsByRow.get(lvl.rowId) ?? [];
      list.push(lvl);
      levelsByRow.set(lvl.rowId, list);
    }

    return hierarchy.rows
      .filter((r) => r.isActive && r.doorId === selectedDoorId)
      .sort((a, b) => a.rowNumber - b.rowNumber)
      .map((row) => {
        const rowLevels = levelsByRow.get(row.id) ?? [];
        let emptySlots = 0;
        let occupiedSlots = 0;
        let reservedSlots = 0;
        let totalSlots = 0;
        for (const lvl of rowLevels) {
          emptySlots += lvl.stats.empty;
          occupiedSlots += lvl.stats.occupied;
          reservedSlots += lvl.stats.reserved;
          totalSlots += lvl.stats.total;
        }
        return {
          row,
          levelCount: rowLevels.length,
          emptySlots,
          occupiedSlots,
          reservedSlots,
          totalSlots,
        };
      });
  }, [hierarchy, selectedDoorId]);

  const pickedList = useMemo(() => Object.values(pickedAssignments), [pickedAssignments]);

  // Map locationId -> assignment (to prevent picking the same slot for 2 different coils)
  const pickedByLocationId = useMemo(() => {
    const map = new Map<number, PickedLocationAssignment>();
    for (const item of pickedList) {
      map.set(item.locationId, item);
    }
    return map;
  }, [pickedList]);

  const handleSelectBuilding = (doorId: number) => {
    if (selectedDoorId === doorId) return;
    setSelectedDoorId(doorId);
    setSelectedRowId(null);
    setSelectedPreSapSlot(null);
    setRowSlotsData(null);
    setRowSlotsError(null);
  };

  const handleSelectRow = (rowId: number) => {
    setSelectedRowId(rowId);
    setSelectedPreSapSlot(null);
  };

  const handlePickSlot = (slot: RowSlotEvaluationItem) => {
    if (!canWrite || !slot.placeable) return;

    if (isPreSapMode) {
      setWorkflowNotice(null);
      setSelectedPreSapSlot(slot);
      directPlaceIdempotencyKeyRef.current = createIdempotencyKey();
      return;
    }

    if (!activeCoil) return;

    const existingOwner = pickedByLocationId.get(slot.locationId);
    if (existingOwner && existingOwner.coilDbId !== activeCoil.coilDbId) {
      setWorkflowNotice({
        type: 'error',
        message: `ช่อง ${slot.locationCode} ถูกเลือกไว้ให้คอยล์ ${existingOwner.coilId} แล้ว (1 ช่องวางได้ 1 ม้วน)`,
      });
      return;
    }

    setWorkflowNotice(null);
    const assignment: PickedLocationAssignment = {
      coilDbId: activeCoil.coilDbId,
      coilId: activeCoil.coilId,
      effectiveWeightKg: activeCoil.effectiveWeightKg,
      locationId: slot.locationId,
      locationCode: slot.locationCode,
      doorCode: slot.doorCode,
      rowNumber: slot.rowNumber,
      levelNumber: slot.levelNumber,
      slotNumber: slot.slotNumber,
      maxWeightKg: slot.maxWeightKg,
    };

    const nextMap: Record<number, PickedLocationAssignment> = {
      ...pickedAssignments,
      [activeCoil.coilDbId]: assignment,
    };
    setPickedAssignments(nextMap);
    directPlaceIdempotencyKeyRef.current = createIdempotencyKey();

    // If multi-coil batch, automatically advance to next unassigned pending coil
    const nextUnassigned = allocatablePendingCoils.find(
      (c) => c.coilDbId !== activeCoil.coilDbId && !nextMap[c.coilDbId]
    );
    if (nextUnassigned) {
      setActiveCoilDbId(nextUnassigned.coilDbId);
    }
  };

  const handleRemovePickedAssignment = (coilDbId: number) => {
    setPickedAssignments((prev) => {
      const next = { ...prev };
      delete next[coilDbId];
      return next;
    });
    setActiveCoilDbId(coilDbId);
  };

  const handlePickTopRecommendedInRow = () => {
    if (!rowSlotsData) return;
    for (const lvl of [...rowSlotsData.levels].sort((a, b) => a.levelNumber - b.levelNumber)) {
      for (const slot of lvl.slots) {
        if (!slot.placeable) continue;
        if (!isPreSapMode && activeCoil) {
          const takenByOther = pickedByLocationId.get(slot.locationId);
          if (takenByOther && takenByOther.coilDbId !== activeCoil.coilDbId) continue;
        }
        handlePickSlot(slot);
        return;
      }
    }
  };

  const handleDirectPlaceTo3D = async () => {
    if (!batchData || !canWrite) return;

    setPlacingDirect(true);
    setWorkflowNotice(null);
    try {
      let lastRes: InboundDirectPlaceResponse | null = null;
      const placedCodes: string[] = [];

      if (isPreSapMode) {
        if (!selectedPreSapSlot) return;
        const res = await apiFetch<InboundDirectPlaceResponse>('/api/inbound/direct-place', {
          method: 'POST',
          body: {
            batchNo: batchData.batchNo,
            locationId: selectedPreSapSlot.locationId,
            coilDbId: null,
            idempotencyKey: directPlaceIdempotencyKeyRef.current,
          },
        });
        lastRes = res;
        placedCodes.push(res.locationCode);
        setSelectedPreSapSlot(null);
      } else {
        if (pickedList.length === 0) return;
        for (const item of pickedList) {
          const res = await apiFetch<InboundDirectPlaceResponse>('/api/inbound/direct-place', {
            method: 'POST',
            body: {
              batchNo: batchData.batchNo,
              coilDbId: item.coilDbId,
              locationId: item.locationId,
              idempotencyKey: createIdempotencyKey(),
            },
          });
          lastRes = res;
          placedCodes.push(res.locationCode);
        }
        setPickedAssignments({});
      }

      directPlaceIdempotencyKeyRef.current = createIdempotencyKey();

      if (lastRes) {
        setLastDirectPlacement(lastRes);
        setWorkflowNotice({
          type: 'success',
          message: lastRes.isPendingSapSync
            ? `วางม้วนเหล็ก Batch ${lastRes.batchNo} ลงผังคลัง 3D ตำแหน่ง ${placedCodes.join(', ')} สำเร็จแล้ว! (รอเชื่อมข้อมูล SAP อัตโนมัติเมื่ออัปโหลด Excel)`
            : `วางม้วนเหล็กลงผังคลัง 3D ตำแหน่ง ${placedCodes.join(', ')} สำเร็จแล้ว (${placedCodes.length} ม้วน)`,
        });
      }

      await Promise.all([
        executeBatchScan(batchData.batchNo, true),
        loadPendingBatches(),
        loadHierarchy(),
        selectedRowId
          ? fetchRowSlots(selectedRowId, isPreSapMode ? null : activeCoilDbId)
          : Promise.resolve(),
      ]);
    } catch (err) {
      setWorkflowNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'ไม่สามารถวางสินค้าลงคลัง 3D ได้',
      });
    } finally {
      setPlacingDirect(false);
    }
  };

  const handleReservePickedSlots = async () => {
    if (!batchData?.found || !canWrite || pickedList.length === 0) return;

    setReserving(true);
    setWorkflowNotice(null);
    try {
      const res = await apiFetch<{
        receiptNo: string;
        reservations: Array<{ coilId: string; locationCode: string }>;
      }>('/api/inbound/reserve', {
        method: 'POST',
        body: {
          batchNo: batchData.batchNo,
          allocations: pickedList.map((p) => ({
            coilDbId: p.coilDbId,
            locationId: p.locationId,
          })),
          ttlMinutes,
        },
      });

      setPickedAssignments({});
      setWorkflowNotice({
        type: 'success',
        message: `จองพื้นที่ที่เลือกสำเร็จ ${res.reservations.length} รายการ (Receipt ${res.receiptNo}) — สถานะช่องเป็น RESERVED กรุณายืนยันเมื่อวางเหล็กม้วนจริงลงแท่น`,
      });

      // Pre-fill first reserved coil for fast physical placement confirmation
      if (res.reservations.length > 0) {
        setScannedCoilId(res.reservations[0].coilId);
        setScannedLocationCode(res.reservations[0].locationCode);
        pendingIdempotencyKeyRef.current = createIdempotencyKey();
      }

      await Promise.all([
        executeBatchScan(batchData.batchNo, false),
        loadPendingBatches(),
        loadHierarchy(),
        selectedRowId ? fetchRowSlots(selectedRowId, null) : Promise.resolve(),
      ]);
      setTimeout(() => locationScanInputRef.current?.focus(), 120);
    } catch (err) {
      setWorkflowNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'ไม่สามารถจองพื้นที่ที่เลือกได้',
      });
    } finally {
      setReserving(false);
    }
  };

  const handleReleaseReservation = async (reservationId: number, locationCode: string) => {
    if (!canWrite) return;
    setReleasingId(reservationId);
    setWorkflowNotice(null);
    try {
      await apiFetch(`/api/inbound/reservations/${reservationId}`, { method: 'DELETE' });
      setWorkflowNotice({
        type: 'success',
        message: `ยกเลิกการจองตำแหน่ง ${locationCode} สำเร็จ — สถานะพื้นที่กลับเป็น EMPTY แล้ว`,
      });
      if (batchData?.found) {
        await Promise.all([
          executeBatchScan(batchData.batchNo, false),
          loadPendingBatches(),
          loadHierarchy(),
          selectedRowId ? fetchRowSlots(selectedRowId, activeCoilDbId) : Promise.resolve(),
        ]);
      }
    } catch (err) {
      setWorkflowNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'ไม่สามารถยกเลิกการจองตำแหน่งได้',
      });
    } finally {
      setReleasingId(null);
    }
  };

  const handleSelectCoilForPhysicalScan = (coilId: string, locationCode: string) => {
    setScannedCoilId(coilId);
    setScannedLocationCode(locationCode);
    setConfirmError(null);
    pendingIdempotencyKeyRef.current = createIdempotencyKey();
    locationScanInputRef.current?.focus();
  };

  const handleConfirmPlacement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchData?.found || !canWrite) return;

    const cleanCoil = scannedCoilId.trim();
    const cleanLoc = scannedLocationCode.trim().toUpperCase();
    if (!cleanCoil || !cleanLoc) {
      setConfirmError('กรุณาสแกนทั้ง Coil ID และตำแหน่งวางจริง (Actual Location Code)');
      return;
    }

    setConfirming(true);
    setConfirmError(null);
    try {
      const res = await apiFetch<InboundConfirmPlacementResponse>('/api/inbound/confirm-placement', {
        method: 'POST',
        body: {
          batchNo: batchData.batchNo,
          scannedCoilId: cleanCoil,
          scannedLocationCode: cleanLoc,
          idempotencyKey: pendingIdempotencyKeyRef.current,
          overrideReason:
            canOverride && showOverrideField && overrideReason.trim().length > 0
              ? overrideReason.trim()
              : undefined,
        },
      });

      setLastConfirmation(res);
      setScannedCoilId('');
      setScannedLocationCode('');
      setOverrideReason('');
      setShowOverrideField(false);
      pendingIdempotencyKeyRef.current = createIdempotencyKey();

      await Promise.all([
        executeBatchScan(batchData.batchNo, false),
        loadPendingBatches(),
        loadHierarchy(),
        selectedRowId ? fetchRowSlots(selectedRowId, activeCoilDbId) : Promise.resolve(),
      ]);
      setTimeout(() => coilScanInputRef.current?.focus(), 100);
    } catch (err) {
      setConfirmError(
        err instanceof Error ? err.message : 'การยืนยันวางสินค้าเข้าคลังไม่สำเร็จ'
      );
    } finally {
      setConfirming(false);
    }
  };

  // Visual 5-step progress computation
  const currentStepNumber = useMemo(() => {
    if (!batchData) return 1;
    if (!isPreSapMode && reservedCoils.length > 0 && allocatablePendingCoils.length === 0) return 6;
    if (!selectedDoorId) return 2;
    if (!selectedRowId) return 3;
    const hasSelection = isPreSapMode ? selectedPreSapSlot !== null : pickedList.length > 0;
    if (!hasSelection) return 4;
    return 5;
  }, [
    batchData,
    isPreSapMode,
    reservedCoils.length,
    allocatablePendingCoils.length,
    selectedDoorId,
    selectedRowId,
    selectedPreSapSlot,
    pickedList.length,
  ]);

  const progressSteps = [
    { num: 1, label: 'สแกน BATCH' },
    { num: 2, label: 'เลือกอาคาร' },
    { num: 3, label: 'เลือกแถว' },
    { num: 4, label: 'ดูพื้นที่วางได้' },
    { num: 5, label: 'วางลงคลัง 3D' },
  ];

  // For Placeable-Only view, sort levels bottom-up (Level 1 Floor Saddle first) for easiest scanning/tapping;
  // For Pyramid All-Slots view, sort top-down (Level 4 -> Level 1 Floor Saddle at bottom).
  const displayLevels = useMemo(() => {
    if (!rowSlotsData) return [];
    if (slotViewMode === 'placeable') {
      return [...rowSlotsData.levels]
        .sort((a, b) => a.levelNumber - b.levelNumber)
        .map((lvl) => ({
          ...lvl,
          slots: lvl.slots.filter((s) => s.placeable),
        }))
        .filter((lvl) => lvl.slots.length > 0);
    }
    return [...rowSlotsData.levels].sort((a, b) => b.levelNumber - a.levelNumber);
  }, [rowSlotsData, slotViewMode]);

  return (
    <div className="space-y-5">
      {/* Guided 5-Step Progress Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-3.5 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs text-slate-700">
            <Lock className="w-4 h-4 text-[#1D4ED8] shrink-0" aria-hidden="true" />
            <span>
              <strong className="text-slate-900">ขั้นตอนรับสินค้าเข้าคลัง:</strong> สแกน Batch →
              เลือกอาคาร → เลือกแถว → ดูพื้นที่ที่วางได้ → กดเลือกพื้นที่และยืนยันวางจริง
            </span>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('warehouse-3d')}
            className="min-h-[36px] px-3 py-1.5 rounded-md border border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto cursor-pointer"
          >
            <Box className="w-3.5 h-3.5" aria-hidden="true" />
            <span>เปิดคลังสินค้า 3D</span>
          </button>
        </div>

        <ol className="grid grid-cols-5 gap-1.5 sm:gap-2">
          {progressSteps.map((st) => {
            const done = currentStepNumber > st.num;
            const active = currentStepNumber === st.num;
            return (
              <li
                key={st.num}
                className={`rounded-md border px-2 py-2 text-center transition-colors ${
                  done
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : active
                      ? 'bg-[#1D4ED8] border-[#1D4ED8] text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
              >
                <div className="text-[10px] font-mono font-bold">STEP {st.num}</div>
                <div className="text-[11px] sm:text-xs font-semibold truncate mt-0.5">
                  {st.label}
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ================================================================= */}
      {/* STEP 1: SCAN BATCH                                                */}
      {/* ================================================================= */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-mono font-semibold text-[#1D4ED8] uppercase tracking-wider">
              Step 1 · สแกน BATCH
            </div>
            <h2 className="text-base font-bold text-slate-900 mt-0.5">
              สแกนหมายเลข Batch Number เพื่อรับเข้าคลังและจัดวางลงผัง 3D ทันที
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              รองรับทั้ง Batch ที่มีข้อมูล SAP แล้ว และ Batch ที่ยังรออัปโหลดไฟล์ SAP Excel (Pre-SAP) — ระบบจะจับคู่ข้อมูล SAP ให้อัตโนมัติภายหลัง
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadPendingBatches()}
            className="min-h-[38px] px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>รีเฟรชรายการ Batch</span>
          </button>
        </div>

        <form onSubmit={handleBatchSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <label htmlFor="inbound-batch-scan-input" className="sr-only">
              สแกนหมายเลข Batch Number
            </label>
            <ScanBarcode
              className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={batchInputRef}
              id="inbound-batch-scan-input"
              type="text"
              autoFocus
              value={batchInput}
              onChange={(e) => setBatchInput(e.target.value)}
              placeholder="สแกนหรือกรอก Batch Number เช่น 011P066118 (รักษาเลข 0 นำหน้าอัตโนมัติ)"
              className="w-full min-h-[46px] pl-11 pr-4 py-2.5 rounded-md border border-slate-300 bg-slate-50 focus:bg-white focus:border-[#1D4ED8] focus:ring-2 focus:ring-blue-100 outline-none font-mono text-sm sm:text-base text-slate-900"
            />
          </div>
          <button
            type="submit"
            disabled={scanningBatch}
            className="min-h-[46px] px-5 py-2.5 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] disabled:opacity-60 text-white text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap cursor-pointer"
          >
            <Search className="w-4 h-4" aria-hidden="true" />
            <span>{scanningBatch ? 'กำลังค้นหา...' : 'ค้นหา Batch'}</span>
          </button>
        </form>

        {scanError && (
          <div
            role="alert"
            className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2"
          >
            <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{scanError}</span>
          </div>
        )}

        {/* Quick-select Pending SAP Batches */}
        <div className="pt-2 border-t border-slate-100">
          <div className="text-xs font-semibold text-slate-600 mb-2">
            รายการ Batch จาก SAP Reference ที่พร้อมรับเข้า ({pendingBatches.length} Batches)
          </div>
          {loadingPending ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-14 rounded-md bg-slate-100 animate-pulse" />
              ))}
            </div>
          ) : pendingBatches.length === 0 ? (
            <div className="p-4 rounded-md bg-slate-50 border border-dashed border-slate-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600">
              <span>
                ยังไม่มี Batch ในระบบ — สามารถพิมพ์หรือสแกนหมายเลข Batch ด้านบนเพื่อวางลงคลัง 3D ก่อนได้ทันที หรือไปนำเข้าไฟล์ SAP Excel (Phase 4)
              </span>
              <button
                type="button"
                onClick={() => onNavigate('sap-import')}
                className="min-h-[38px] px-3.5 py-1.5 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white font-semibold flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto cursor-pointer"
              >
                <span>ไปที่ SAP Excel Import</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {pendingBatches.slice(0, 8).map((b) => {
                const badge = formatBatchStatusLabel(b.batchStatus);
                const active = batchData && batchData.batchNo === b.batchNo;
                return (
                  <button
                    key={b.batchNo}
                    type="button"
                    onClick={() => void executeBatchScan(b.batchNo, false)}
                    className={`min-h-[56px] p-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-[#1D4ED8] bg-blue-50/70 ring-1 ring-[#1D4ED8]'
                        : 'border-slate-200 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-bold text-xs text-slate-900 truncate">
                        {b.batchNo}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {(b.pendingSapCoils ?? 0) > 0 && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900">
                            รอ SAP
                          </span>
                        )}
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${badge.tone}`}>
                          {b.receivedCoils}/{b.totalCoils}
                        </span>
                      </div>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500 truncate">
                      {(b.pendingSapCoils ?? 0) > 0 && b.totalWeightKg === 0
                        ? 'วางใน 3D แล้ว · รออัปโหลด SAP Excel'
                        : `${b.grade || '-'} · ${formatNumber(b.totalWeightKg)} kg`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* ACTIVE BATCH WORKSPACE (Supports BOTH Pre-SAP & SAP-Referenced Batches!) */}
      {batchData && (
        <>
          {/* PRE-SAP INFORMATIONAL BANNER (Non-blocking — lets operator place into 3D immediately!) */}
          {isPreSapMode && (
            <div
              role="status"
              className="bg-amber-50 border border-amber-300 rounded-lg p-4 text-amber-950 space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                  <span>
                    โหมดรับสินค้าก่อนมีข้อมูล SAP (Pre-SAP Inbound) · Batch{' '}
                    <span className="font-mono">{batchData.batchNo}</span>
                  </span>
                </div>
                <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded bg-[#F59E0B] text-slate-950">
                  รอข้อมูล SAP
                </span>
              </div>
              <p className="text-xs text-amber-900 leading-relaxed">
                ไม่พบข้อมูล Batch นี้ใน SAP Reference — คุณสามารถ<strong>เลือกอาคาร เลือกแถว และวางลงผังคลัง 3D ได้ทันที</strong>{' '}
                โดยม้วนเหล็กจะแสดงเป็นสีพิเศษ (Amber) พร้อมป้าย <strong>&ldquo;รอข้อมูล SAP&rdquo;</strong>{' '}
                และเมื่ออัปโหลดไฟล์ SAP Excel ในภายหลัง ระบบจะจับคู่ Batch อัตโนมัติและเติมข้อมูลสเปก/น้ำหนักลงม้วนเดิมโดยไม่ย้ายตำแหน่ง
              </p>
            </div>
          )}

          {/* Direct-to-3D Placement Success Card */}
          {lastDirectPlacement && (
            <div className="p-4 rounded-lg bg-emerald-50 border-2 border-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1 text-xs text-emerald-950">
                <div className="font-bold text-sm flex flex-wrap items-center gap-2 text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                  <span>
                    วางลงคลัง 3D สำเร็จ! Batch {lastDirectPlacement.batchNo} →{' '}
                    <span className="font-mono underline">{lastDirectPlacement.locationCode}</span>
                  </span>
                  {lastDirectPlacement.isPendingSapSync && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-[#F59E0B] text-slate-950">
                      รอข้อมูล SAP
                    </span>
                  )}
                </div>
                <div className="font-mono text-[11px] text-emerald-900">
                  Coil: {lastDirectPlacement.coilId} · TX: {lastDirectPlacement.transactionNo} ·
                  Receipt: {lastDirectPlacement.receiptNo}
                  {lastDirectPlacement.weightKg !== null
                    ? ` · น้ำหนัก ${formatNumber(lastDirectPlacement.weightKg)} kg`
                    : ' · น้ำหนัก: รอข้อมูล SAP'}
                </div>
                {lastDirectPlacement.pendingSapWeightWarning && (
                  <div className="text-[11px] text-amber-800 font-medium">
                    หมายเหตุชั้นซ้อน: วางบนชั้นที่รองรับแล้ว ระบบจะตรวจสอบสมดุลน้ำหนักซ้อนชั้นอีกครั้งเมื่ออัปโหลดไฟล์ SAP Excel
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => openLocationIn3D(lastDirectPlacement.locationCode)}
                className="min-h-[42px] px-4 py-2 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-2 whitespace-nowrap self-start sm:self-auto cursor-pointer"
              >
                <Box className="w-4 h-4 text-amber-400" aria-hidden="true" />
                <span>เปิดดูตำแหน่งนี้ในคลัง 3D ทันที</span>
              </button>
            </div>
          )}
          {/* Workflow Feedback Banner */}
          {workflowNotice && (
            <div
              role="status"
              className={`rounded-lg p-3.5 border text-xs font-medium flex items-start gap-2.5 ${
                workflowNotice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              {workflowNotice.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" aria-hidden="true" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-red-600 mt-0.5 shrink-0" aria-hidden="true" />
              )}
              <span>{workflowNotice.message}</span>
            </div>
          )}

          {/* BATCH SUMMARY & COIL TABLE (Shown when batch already has SAP or Pre-SAP coil rows) */}
          {batchData.found && (
          <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-200 space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-slate-500">BATCH NO.</span>
                    <span className="font-mono text-lg font-bold text-slate-900">
                      {batchData.batchNo}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                        formatBatchStatusLabel(batchData.summary.batchStatus).tone
                      }`}
                    >
                      {formatBatchStatusLabel(batchData.summary.batchStatus).text}
                    </span>
                    {batchData.receiptNo && (
                      <span className="text-xs font-mono text-slate-500">
                        Receipt: {batchData.receiptNo}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      Material: <strong className="font-mono text-slate-900">{batchData.materialCode || '-'}</strong>
                    </span>
                    <span>
                      Description: <strong className="text-slate-800">{batchData.materialDescription || '-'}</strong>
                    </span>
                    <span>
                      Grade: <strong className="font-mono text-slate-900">{batchData.grade || '-'}</strong>
                    </span>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  {isPreSapMode ? 'Pre-SAP Provisional' : 'SAP Reference Read-Only'} · รวม{' '}
                  {batchData.summary.totalCoils} ม้วน ·{' '}
                  {batchData.summary.totalWeightKg > 0
                    ? `${formatNumber(batchData.summary.totalWeightKg)} kg`
                    : 'รอน้ำหนัก SAP'}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div className="px-3 py-2 rounded-md bg-slate-50 border border-slate-200">
                  <div className="text-[11px] text-slate-500">ทั้งหมดใน Batch</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                    {batchData.summary.totalCoils} <span className="text-xs font-normal text-slate-500">ม้วน</span>
                  </div>
                </div>
                <div className="px-3 py-2 rounded-md bg-emerald-50/70 border border-emerald-200">
                  <div className="text-[11px] text-emerald-800">รับเข้าคลังแล้ว</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-[#16A34A]">
                    {batchData.summary.receivedCoils}
                  </div>
                </div>
                <div className="px-3 py-2 rounded-md bg-orange-50/70 border border-orange-200">
                  <div className="text-[11px] text-orange-800">จองพื้นที่แล้ว (รอวาง)</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-[#EA580C]">
                    {batchData.summary.reservedCoils}
                  </div>
                </div>
                <div className="px-3 py-2 rounded-md bg-slate-50 border border-slate-200">
                  <div className="text-[11px] text-slate-500">ยังไม่เลือกพื้นที่</div>
                  <div className="text-lg font-bold font-mono tabular-nums text-slate-900">
                    {Math.max(0, batchData.summary.pendingCoils - batchData.summary.reservedCoils)}
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                    <th className="py-2.5 px-3">Coil ID</th>
                    <th className="py-2.5 px-3 text-right">หนา (mm)</th>
                    <th className="py-2.5 px-3 text-right">กว้าง (mm)</th>
                    <th className="py-2.5 px-3">Grade</th>
                    <th className="py-2.5 px-3 text-right">น้ำหนัก (kg)</th>
                    <th className="py-2.5 px-3">สถานะ / พื้นที่จัดเก็บ</th>
                    <th className="py-2.5 px-3 text-right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batchData.coils.map((coil) => {
                    const picked = pickedAssignments[coil.coilDbId];
                    const isFocused = activeCoil?.coilDbId === coil.coilDbId;
                    const canPick =
                      canWrite &&
                      !isPreSapMode &&
                      coil.inboundStatus !== 'RECEIVED' &&
                      !coil.activeReservation &&
                      coil.canAutoAllocate;

                    return (
                      <tr
                        key={coil.coilDbId}
                        className={
                          isFocused
                            ? 'bg-blue-50/60'
                            : 'hover:bg-slate-50/70'
                        }
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold text-slate-900">{coil.coilId}</span>
                            {coil.isPendingSapSync && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900">
                                รอข้อมูล SAP
                              </span>
                            )}
                            {isFocused && canPick && (
                              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#1D4ED8] text-white">
                                กำลังเลือกพื้นที่
                              </span>
                            )}
                          </div>
                          {coil.hasMissingData && !coil.isPendingSapSync && (
                            <div className="mt-0.5 text-[11px] text-amber-700 font-medium">
                              Missing Data: {coil.missingFields.join(', ')}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                          {formatNumber(coil.thicknessMm, 2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800">
                          {formatNumber(coil.widthMm, 0)}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-slate-800">{coil.grade || '-'}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                          {coil.effectiveWeightKg != null ? (
                            formatNumber(coil.effectiveWeightKg, 0)
                          ) : coil.isPendingSapSync ? (
                            <span className="text-amber-700 font-medium">รอข้อมูล SAP</span>
                          ) : (
                            <span className="text-red-600">- (Missing)</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3">
                          {coil.inboundStatus === 'RECEIVED' ? (
                            <span
                              className={`inline-block px-2 py-0.5 rounded border font-mono font-semibold ${
                                coil.isPendingSapSync
                                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                                  : 'bg-blue-50 border-blue-200 text-[#2563EB]'
                              }`}
                            >
                              OCCUPIED · {coil.confirmedLocationCode || '-'}
                            </span>
                          ) : coil.activeReservation ? (
                            <div>
                              <span className="inline-block px-2 py-0.5 rounded bg-orange-50 border border-orange-200 text-[#EA580C] font-mono font-semibold">
                                RESERVED · {coil.activeReservation.locationCode}
                              </span>
                              <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1 font-mono tabular-nums">
                                <Clock className="w-3 h-3" aria-hidden="true" />
                                <span>
                                  เหลือ {formatRemainingTtl(coil.activeReservation.expiresAt, nowMs)}
                                </span>
                              </div>
                            </div>
                          ) : picked ? (
                            <span className="inline-block px-2 py-0.5 rounded bg-emerald-50 border border-emerald-300 text-emerald-800 font-mono font-semibold">
                              เลือกพื้นที่แล้ว · {picked.locationCode}
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 font-medium">
                              รอเลือกพื้นที่วาง
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          {coil.inboundStatus === 'RECEIVED' && coil.confirmedLocationCode && (
                            <button
                              type="button"
                              onClick={() => openLocationIn3D(coil.confirmedLocationCode!)}
                              className="min-h-[32px] px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Box className="w-3.5 h-3.5 text-[#1D4ED8]" aria-hidden="true" />
                              <span>ดูใน 3D</span>
                            </button>
                          )}
                          {canPick && (
                            <button
                              type="button"
                              onClick={() => setActiveCoilDbId(coil.coilDbId)}
                              className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-semibold cursor-pointer ${
                                isFocused
                                  ? 'bg-[#1D4ED8] text-white'
                                  : 'border border-slate-300 bg-white hover:bg-slate-50 text-slate-800'
                              }`}
                            >
                              {picked ? 'เปลี่ยนพื้นที่' : 'เลือกพื้นที่ให้ม้วนนี้'}
                            </button>
                          )}
                          {coil.activeReservation && canWrite && (
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  handleSelectCoilForPhysicalScan(
                                    coil.coilId,
                                    coil.activeReservation!.locationCode
                                  )
                                }
                                className="min-h-[34px] px-2.5 py-1 rounded bg-[#16A34A] hover:bg-emerald-700 text-white font-semibold cursor-pointer"
                              >
                                ยืนยันวางจริง
                              </button>
                              <button
                                type="button"
                                disabled={releasingId === coil.activeReservation.reservationId}
                                onClick={() =>
                                  void handleReleaseReservation(
                                    coil.activeReservation!.reservationId,
                                    coil.activeReservation!.locationCode
                                  )
                                }
                                aria-label={`ยกเลิกการจอง ${coil.activeReservation.locationCode}`}
                                className="min-h-[34px] px-2.5 py-1 rounded border border-red-200 text-red-700 hover:bg-red-50 font-medium inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                <span>ปล่อยจอง</span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
          )}

          {/* ================================================================= */}
          {/* STEPS 2 -> 3 -> 4 -> 5: BUILDING -> ROW -> PLACEABLE SLOTS -> 3D  */}
          {/* ================================================================= */}
          {canWrite && (isPreSapMode || (allocatablePendingCoils.length > 0 && activeCoil)) && (
            <div className="space-y-4">
              {/* Active Coil / Pre-SAP Context Strip */}
              <div className="bg-[#0F172A] text-white rounded-lg px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                {isPreSapMode ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-slate-400">กำลังเลือกพื้นที่วางลงคลัง 3D สำหรับ Batch:</span>
                    <span className="font-mono font-bold text-sm text-amber-300">
                      {batchData.batchNo}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-[#F59E0B] text-slate-950 font-semibold text-[11px]">
                      โหมด Pre-SAP (รอข้อมูล SAP)
                    </span>
                    <span className="text-slate-300">
                      · วางได้ทุกชั้นที่รองรับ (ชั้น 2+ แสดงป้ายแจ้งเตือนรอน้ำหนัก SAP)
                    </span>
                  </div>
                ) : activeCoil ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-slate-400">กำลังเลือกพื้นที่วางให้เหล็กม้วน:</span>
                      <span className="font-mono font-bold text-sm text-sky-300">{activeCoil.coilId}</span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono">
                        น้ำหนัก {formatNumber(activeCoil.effectiveWeightKg)} kg
                      </span>
                      <span className="text-slate-400">·</span>
                      <span>กว้าง {formatNumber(activeCoil.widthMm)} mm</span>
                      <span className="text-slate-400">·</span>
                      <span>Grade {activeCoil.grade || '-'}</span>
                    </div>
                    {allocatablePendingCoils.length > 1 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {allocatablePendingCoils.map((c) => {
                          const isCurrent = c.coilDbId === activeCoil.coilDbId;
                          const assigned = pickedAssignments[c.coilDbId];
                          return (
                            <button
                              key={c.coilDbId}
                              type="button"
                              onClick={() => setActiveCoilDbId(c.coilDbId)}
                              className={`px-2.5 py-1 rounded text-[11px] font-mono font-semibold cursor-pointer ${
                                isCurrent
                                  ? 'bg-[#1D4ED8] text-white'
                                  : assigned
                                    ? 'bg-emerald-700/80 text-emerald-100'
                                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              {c.coilId}
                              {assigned ? ` ✓ ${assigned.locationCode}` : ''}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : null}
              </div>

              {/* STEP 2: SELECT BUILDING (อาคาร / ประตูคลัง) */}
              <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-3">
                <div>
                  <div className="text-[11px] font-mono font-semibold text-[#1D4ED8] uppercase tracking-wider">
                    Step 2 · เลือกอาคาร (Select Building)
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                    เลือกอาคาร / ประตูคลังที่ต้องการนำเหล็กม้วนเข้าจัดเก็บ
                  </h3>
                </div>

                {buildingCards.length === 0 ? (
                  <div className="p-4 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600">
                    ไม่พบข้อมูลอาคาร/ประตูคลังที่เปิดใช้งานในระบบ Warehouse Master
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {buildingCards.map(({ door, zoneName, rowCount, emptySlots, totalSlots }) => {
                      const selected = selectedDoorId === door.id;
                      return (
                        <button
                          key={door.id}
                          type="button"
                          onClick={() => handleSelectBuilding(door.id)}
                          aria-pressed={selected}
                          className={`min-h-[76px] p-3.5 rounded-lg border-2 text-left transition-all cursor-pointer flex items-start justify-between gap-3 ${
                            selected
                              ? 'border-[#1D4ED8] bg-blue-50/70 shadow-sm'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <Building2
                                className={`w-4 h-4 shrink-0 ${
                                  selected ? 'text-[#1D4ED8]' : 'text-slate-500'
                                }`}
                                aria-hidden="true"
                              />
                              <span className="font-mono font-bold text-base text-slate-900">
                                อาคาร {door.doorCode}
                              </span>
                            </div>
                            <div className="text-xs text-slate-700 font-medium mt-0.5 truncate">
                              {door.name}
                            </div>
                            {zoneName && (
                              <div className="text-[11px] text-slate-500 truncate mt-0.5">
                                {zoneName} · {rowCount} แถว
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            <div
                              className={`text-sm font-mono font-bold tabular-nums ${
                                emptySlots > 0 ? 'text-[#16A34A]' : 'text-red-600'
                              }`}
                            >
                              ว่าง {emptySlots}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono">
                              / {totalSlots} ช่อง
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* STEP 3: SELECT ROW (เลือกแถว) */}
              {selectedDoorId && (
                <section className="bg-white border border-slate-200 rounded-lg p-4 sm:p-5 space-y-3">
                  <div>
                    <div className="text-[11px] font-mono font-semibold text-[#1D4ED8] uppercase tracking-wider">
                      Step 3 · เลือกแถว (Select Row)
                    </div>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                      เลือกแถวจัดเก็บภายในอาคาร{' '}
                      <span className="font-mono text-[#1D4ED8]">
                        {buildingCards.find((b) => b.door.id === selectedDoorId)?.door.doorCode}
                      </span>
                    </h3>
                  </div>

                  {rowCards.length === 0 ? (
                    <div className="p-4 rounded-md bg-slate-50 border border-slate-200 text-xs text-slate-600">
                      อาคารนี้ยังไม่มีแถวจัดเก็บที่เปิดใช้งาน
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                      {rowCards.map(({ row, levelCount, emptySlots, occupiedSlots, reservedSlots, totalSlots }) => {
                        const selected = selectedRowId === row.id;
                        return (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => handleSelectRow(row.id)}
                            aria-pressed={selected}
                            className={`min-h-[76px] p-3 rounded-lg border-2 text-left transition-all cursor-pointer ${
                              selected
                                ? 'border-[#1D4ED8] bg-blue-50/70 shadow-sm'
                                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono font-bold text-sm text-slate-900">
                                แถวที่ {row.rowNumber}
                              </span>
                              <span
                                className={`text-[11px] font-mono font-bold px-1.5 py-0.5 rounded ${
                                  emptySlots > 0
                                    ? 'bg-emerald-50 text-[#16A34A] border border-emerald-200'
                                    : 'bg-red-50 text-red-700 border border-red-200'
                                }`}
                              >
                                ว่าง {emptySlots}/{totalSlots}
                              </span>
                            </div>
                            <div className="text-xs text-slate-600 mt-1 truncate">{row.label}</div>
                            <div className="text-[11px] text-slate-500 mt-1 font-mono">
                              {levelCount} ชั้น · วางแล้ว {occupiedSlots} · จอง {reservedSlots}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {/* STEP 4 & 5: PLACEABLE SLOTS IN SELECTED ROW + OPERATOR PICK */}
              {selectedRowId && (
                <section className="bg-white border-2 border-emerald-300/80 rounded-lg p-4 sm:p-5 space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-mono font-semibold text-[#16A34A] uppercase tracking-wider">
                        Step 4–5 · พื้นที่ที่สามารถวางได้ → กดเลือกพื้นที่ที่ต้องการวาง
                      </div>
                      <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-0.5">
                        {rowSlotsData
                          ? `อาคาร ${rowSlotsData.building.doorCode} · แถวที่ ${rowSlotsData.row.rowNumber} (${rowSlotsData.row.label})`
                          : 'กำลังตรวจสอบพื้นที่ที่สามารถวางได้...'}
                      </h3>
                      {rowSlotsData && (
                        <p className="text-xs text-slate-600 mt-0.5">
                          {isPreSapMode ? (
                            <>
                              ตรวจสอบโครงสร้างแท่นวางและฐานรองรับ Pyramid แล้ว (โหมด Pre-SAP รอข้อมูลน้ำหนักจาก SAP) — พบพื้นที่วางได้{' '}
                            </>
                          ) : (
                            <>
                              ตรวจสอบน้ำหนัก ({formatNumber(activeCoil?.effectiveWeightKg)} kg), ขนาดช่อง, และกฎความปลอดภัย Pyramid Stacking แล้ว — พบพื้นที่วางได้{' '}
                            </>
                          )}
                          <strong className="font-mono text-[#16A34A]">
                            {rowSlotsData.summary.placeableCount}
                          </strong>{' '}
                          จาก {rowSlotsData.summary.totalSlots} ช่อง
                        </p>
                      )}
                    </div>

                    {rowSlotsData && (
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setSlotViewMode('placeable')}
                            className={`px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 cursor-pointer ${
                              slotViewMode === 'placeable'
                                ? 'bg-white text-[#16A34A] shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>เฉพาะพื้นที่วางได้ ({rowSlotsData.summary.placeableCount})</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSlotViewMode('all')}
                            className={`px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 cursor-pointer ${
                              slotViewMode === 'all'
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <Layers className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>ผังทั้งแถว ({rowSlotsData.summary.totalSlots})</span>
                          </button>
                        </div>

                        {canOverride && hierarchy && selectedRowId && (
                          <button
                            type="button"
                            onClick={() => setShowExpandRowModal(true)}
                            className="min-h-[36px] px-3 py-1.5 rounded-md border border-blue-300 bg-blue-50 hover:bg-blue-100 text-[#1D4ED8] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>เพิ่มช่องวางแถวนี้</span>
                          </button>
                        )}

                        {rowSlotsData.summary.placeableCount > 0 && (
                          <button
                            type="button"
                            onClick={handlePickTopRecommendedInRow}
                            className="min-h-[36px] px-3 py-1.5 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                          >
                            <Sparkles className="w-3.5 h-3.5 text-amber-300" aria-hidden="true" />
                            <span>เลือกช่องแนะนำอันดับ 1</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {loadingRowSlots ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-2.5">
                      {[1, 2, 3, 4, 5].map((i) => (
                        <div key={i} className="h-20 rounded-md bg-slate-100 animate-pulse" />
                      ))}
                    </div>
                  ) : rowSlotsError ? (
                    <div
                      role="alert"
                      className="p-3.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 flex items-center gap-2"
                    >
                      <ShieldAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{rowSlotsError}</span>
                    </div>
                  ) : rowSlotsData && rowSlotsData.summary.placeableCount === 0 && slotViewMode === 'placeable' ? (
                    <div className="p-5 rounded-md bg-amber-50 border border-amber-200 text-xs text-amber-950 space-y-2">
                      <div className="font-bold flex items-center gap-2 text-sm">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                        <span>ไม่พบพื้นที่ที่สามารถวางเหล็กม้วนนี้ได้ในแถวที่ {rowSlotsData.row.rowNumber}</span>
                      </div>
                      <p className="text-amber-900">
                        กรุณาเลือกแถวอื่น หรือกดสลับไปดู <strong>&ldquo;ผังทั้งแถว&rdquo;</strong> เพื่อตรวจสอบสาเหตุของแต่ละช่อง (เต็ม / จองอยู่ / น้ำหนักเกิน / ยังไม่มีม้วนรองรับชั้นล่างตามกฎ Pyramid)
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {displayLevels.map((lvl) => (
                        <div
                          key={lvl.levelId}
                          className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-slate-900">
                                ชั้น {lvl.levelNumber} ({lvl.label})
                              </span>
                              <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-mono text-[11px] text-slate-600">
                                {lvl.stackingRule === 'FLOOR_SADDLE'
                                  ? 'Floor Saddle (วางพื้น)'
                                  : lvl.stackingRule === 'PYRAMID_STACK'
                                    ? 'Pyramid Stack (ซ้อนบนม้วนล่าง 2 ลูก)'
                                    : lvl.stackingRule}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-600">
                              รับน้ำหนักสูงสุด {formatNumber(lvl.maxWeightKg)} kg · วางได้{' '}
                              <strong className="text-[#16A34A]">{lvl.placeableCount}</strong>/{lvl.totalCount} ช่อง
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                            {lvl.slots.map((slot) => {
                              const pickedBy = isPreSapMode
                                ? undefined
                                : pickedByLocationId.get(slot.locationId);
                              const isSelectedForActiveCoil = isPreSapMode
                                ? selectedPreSapSlot?.locationId === slot.locationId
                                : Boolean(activeCoil && pickedBy?.coilDbId === activeCoil.coilDbId);
                              const isPickedByOtherCoil =
                                !isPreSapMode && Boolean(pickedBy) && !isSelectedForActiveCoil;
                              const clickable = slot.placeable && !isPickedByOtherCoil;

                              let cardStyle =
                                'border-slate-200 bg-slate-100/90 text-slate-400 cursor-not-allowed';
                              if (isSelectedForActiveCoil) {
                                cardStyle =
                                  'border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-sm ring-2 ring-blue-200 cursor-pointer';
                              } else if (isPickedByOtherCoil) {
                                cardStyle =
                                  'border-indigo-300 bg-indigo-50 text-indigo-900 cursor-not-allowed';
                              } else if (slot.placeable) {
                                cardStyle = slot.isTopRecommended
                                  ? 'border-[#16A34A] bg-emerald-50 hover:bg-emerald-100 text-emerald-950 cursor-pointer ring-1 ring-emerald-300'
                                  : 'border-emerald-300 bg-white hover:bg-emerald-50 hover:border-[#16A34A] text-slate-900 cursor-pointer';
                              } else if (slot.status === 'OCCUPIED') {
                                cardStyle =
                                  'border-blue-200 bg-blue-50/60 text-blue-900 cursor-not-allowed';
                              } else if (slot.status === 'RESERVED') {
                                cardStyle =
                                  'border-orange-200 bg-orange-50/70 text-orange-900 cursor-not-allowed';
                              }

                              return (
                                <button
                                  key={slot.locationId}
                                  type="button"
                                  disabled={!clickable}
                                  onClick={() => clickable && handlePickSlot(slot)}
                                  title={slot.reason ?? `เลือกพื้นที่ ${slot.locationCode}`}
                                  className={`min-h-[82px] p-2.5 rounded-md border-2 text-left transition-all flex flex-col justify-between ${cardStyle}`}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <span className="font-mono font-bold text-xs sm:text-sm leading-tight">
                                      {slot.locationCode}
                                    </span>
                                    {isSelectedForActiveCoil ? (
                                      <CheckCircle2 className="w-4 h-4 shrink-0 text-white" aria-hidden="true" />
                                    ) : slot.placeable && slot.isTopRecommended && !isPickedByOtherCoil ? (
                                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[#16A34A] text-white whitespace-nowrap">
                                        แนะนำ #1
                                      </span>
                                    ) : null}
                                  </div>

                                  <div className="mt-1.5 text-[11px] leading-snug space-y-1">
                                    {slot.placeable && slot.pendingSapWeightWarning && (
                                      <div
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                          isSelectedForActiveCoil
                                            ? 'bg-amber-400 text-slate-950'
                                            : 'bg-amber-100 border border-amber-300 text-amber-900'
                                        }`}
                                      >
                                        <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
                                        <span>รอน้ำหนัก SAP</span>
                                      </div>
                                    )}
                                    {isSelectedForActiveCoil ? (
                                      <span className="font-semibold text-blue-100 block">
                                        {isPreSapMode
                                          ? `พร้อมวาง Batch ${batchData.batchNo} ลง 3D`
                                          : `เลือกแล้วสำหรับ ${activeCoil?.coilId}`}
                                      </span>
                                    ) : isPickedByOtherCoil ? (
                                      <span className="font-mono text-indigo-800 truncate block">
                                        เลือกให้ {pickedBy?.coilId}
                                      </span>
                                    ) : slot.placeable ? (
                                      <div className="flex items-center justify-between text-emerald-700 font-medium">
                                        <span>วางได้</span>
                                        <span className="font-mono text-[10px] text-slate-500">
                                          Max {formatNumber(slot.maxWeightKg)}kg
                                        </span>
                                      </div>
                                    ) : slot.status === 'OCCUPIED' ? (
                                      <span className="font-mono text-[10px] text-blue-800 truncate block">
                                        มีม้วน: {slot.occupantCoilId || 'OCCUPIED'}
                                      </span>
                                    ) : slot.status === 'RESERVED' ? (
                                      <span className="font-mono text-[10px] text-orange-800 truncate block">
                                        จองแล้ว: {slot.reservedCoilId || 'RESERVED'}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-slate-500 line-clamp-2">
                                        {slot.reason || 'วางไม่ได้'}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}

                      {/* Legend when showing All Slots */}
                      {slotViewMode === 'all' && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-slate-600">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded border-2 border-[#16A34A] bg-emerald-50 inline-block" />
                            วางได้ (กดเลือกได้)
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded bg-[#1D4ED8] inline-block" />
                            พื้นที่ที่คุณเลือกไว้
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded border border-orange-300 bg-orange-50 inline-block" />
                            จองแล้ว (RESERVED)
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded border border-blue-300 bg-blue-50 inline-block" />
                            มีเหล็กม้วนวางอยู่ (OCCUPIED)
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded border border-slate-300 bg-slate-100 inline-block" />
                            ไม่ผ่านเงื่อนไขน้ำหนัก/Pyramid
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* STEP 5 SUMMARY & DIRECT-TO-3D CONFIRMATION BAR (Pre-SAP Mode) */}
                  {isPreSapMode && selectedPreSapSlot && (
                    <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                      <div className="p-3.5 rounded-lg border-2 border-amber-300 bg-amber-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1 text-xs">
                          <div className="font-bold text-slate-900 flex flex-wrap items-center gap-2">
                            <MapPin className="w-4 h-4 text-[#1D4ED8]" aria-hidden="true" />
                            <span>
                              พร้อมวาง Batch{' '}
                              <span className="font-mono text-slate-900">{batchData.batchNo}</span>{' '}
                              →{' '}
                              <span className="font-mono text-[#1D4ED8] text-sm">
                                {selectedPreSapSlot.locationCode}
                              </span>
                            </span>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F59E0B] text-slate-950">
                              แสดงในคลัง 3D ทันที · รอข้อมูล SAP
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-700 font-mono">
                            อาคาร {selectedPreSapSlot.doorCode} · แถว {selectedPreSapSlot.rowNumber} ·
                            ชั้น {selectedPreSapSlot.levelNumber} · ช่อง {selectedPreSapSlot.slotNumber} ·
                            รับน้ำหนักสูงสุด {formatNumber(selectedPreSapSlot.maxWeightKg)} kg
                          </div>
                          {selectedPreSapSlot.pendingSapWeightWarning && (
                            <div className="text-[11px] text-amber-900 font-medium flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                              <span>
                                วางซ้อนชั้น {selectedPreSapSlot.levelNumber} (รอน้ำหนัก SAP) —
                                ระบบจะตรวจสอบความสมดุลน้ำหนักกับม้วนชั้นล่างอัตโนมัติเมื่ออัปโหลด SAP Excel
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => setSelectedPreSapSlot(null)}
                            className="min-h-[44px] px-3 py-2 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
                          >
                            ยกเลิก
                          </button>
                          <button
                            type="button"
                            disabled={placingDirect}
                            onClick={() => void handleDirectPlaceTo3D()}
                            className="min-h-[46px] px-5 py-2.5 rounded-md bg-[#16A34A] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                            <span>
                              {placingDirect
                                ? 'กำลังวางลงคลัง 3D...'
                                : 'ยืนยันวางสินค้าลงคลัง 3D ทันที'}
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* STEP 5 SUMMARY & DIRECT-TO-3D / RESERVE BAR (SAP-Referenced Mode) */}
                  {!isPreSapMode && pickedList.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-200 space-y-3">
                      <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <MapPin className="w-4 h-4 text-[#1D4ED8]" aria-hidden="true" />
                        <span>พื้นที่ที่พนักงานเลือกไว้ ({pickedList.length} รายการ)</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                        {pickedList.map((item) => (
                          <div
                            key={item.coilDbId}
                            className="p-2.5 rounded-md border border-blue-200 bg-blue-50/60 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="min-w-0">
                              <div className="font-mono font-bold text-slate-900 truncate">
                                {item.coilId} →{' '}
                                <span className="text-[#1D4ED8]">{item.locationCode}</span>
                              </div>
                              <div className="text-[11px] text-slate-600 font-mono">
                                อาคาร {item.doorCode} · แถว {item.rowNumber} · ชั้น {item.levelNumber} · ช่อง {item.slotNumber}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemovePickedAssignment(item.coilDbId)}
                              aria-label={`ลบการเลือกตำแหน่ง ${item.locationCode}`}
                              className="p-1.5 rounded hover:bg-blue-100 text-slate-500 hover:text-red-600 cursor-pointer"
                            >
                              <X className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <label htmlFor="inbound-ttl-minutes" className="text-slate-600 font-medium">
                            กรณีจองไว้ก่อน (TTL):
                          </label>
                          <select
                            id="inbound-ttl-minutes"
                            value={ttlMinutes}
                            onChange={(e) => setTtlMinutes(Number(e.target.value))}
                            className="min-h-[38px] px-3 py-1 rounded-md border border-slate-300 bg-white font-mono text-xs text-slate-900"
                          >
                            <option value={15}>15 นาที</option>
                            <option value={30}>30 นาที</option>
                            <option value={60}>60 นาที</option>
                          </select>
                          <button
                            type="button"
                            disabled={reserving || placingDirect}
                            onClick={() => void handleReservePickedSlots()}
                            className="min-h-[38px] px-3.5 py-1.5 rounded-md border border-orange-300 bg-orange-50 hover:bg-orange-100 disabled:opacity-60 text-[#EA580C] text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>
                              {reserving ? 'กำลังจอง...' : `จองพื้นที่ไว้ก่อน (${pickedList.length})`}
                            </span>
                          </button>
                        </div>

                        <button
                          type="button"
                          disabled={placingDirect || reserving}
                          onClick={() => void handleDirectPlaceTo3D()}
                          className="min-h-[46px] px-5 py-2.5 rounded-md bg-[#16A34A] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          <span>
                            {placingDirect
                              ? 'กำลังวางลงคลัง 3D...'
                              : `ยืนยันวางสินค้าลงคลัง 3D ทันที (${pickedList.length} ม้วน)`}
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              )}
            </div>
          )}

          {/* ================================================================= */}
          {/* STEP 6: PHYSICAL PLACEMENT CONFIRMATION (ATOMIC INVENTORY COMMIT) */}
          {/* ================================================================= */}
          {canWrite && (reservedCoils.length > 0 || lastConfirmation || (canOverride && batchData.summary.pendingCoils > 0)) && (
            <section className="bg-white border-2 border-[#1D4ED8]/30 rounded-lg p-4 sm:p-5 space-y-4">
              <div>
                <div className="text-[11px] font-mono font-semibold text-[#16A34A] uppercase">
                  Step 6 · Physical Placement Confirmation (Atomic Inventory Commit)
                </div>
                <h3 className="text-base font-bold text-slate-900 mt-0.5">
                  สแกนยืนยันการวางเหล็กม้วนจริงลงพื้นที่ที่เลือก
                </h3>
                <p className="text-xs text-slate-600 mt-1">
                  เมื่อเครนยกเหล็กม้วนวางลงพื้นที่เรียบร้อยแล้ว ให้สแกน <strong>Coil ID</strong> และ{' '}
                  <strong>Location Code</strong> จริง เพื่อบันทึก Inventory + เปลี่ยนสถานะเป็น OCCUPIED + อัปเดต 3D Warehouse แบบ Atomic
                </p>
              </div>

              {reservedCoils.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500 font-medium">รายการที่จองพื้นที่แล้ว:</span>
                  {reservedCoils.map((c) => (
                    <button
                      key={c.coilDbId}
                      type="button"
                      onClick={() =>
                        handleSelectCoilForPhysicalScan(
                          c.coilId,
                          c.activeReservation!.locationCode
                        )
                      }
                      className="min-h-[36px] px-3 py-1 rounded border border-orange-300 bg-orange-50 hover:bg-orange-100 text-orange-950 font-mono font-semibold cursor-pointer"
                    >
                      {c.coilId} → {c.activeReservation!.locationCode}
                    </button>
                  ))}
                </div>
              )}

              <form onSubmit={handleConfirmPlacement} className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="inbound-confirm-coil-id"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      1. สแกน Coil ID ที่วางจริง (Scan Coil ID)
                    </label>
                    <input
                      ref={coilScanInputRef}
                      id="inbound-confirm-coil-id"
                      type="text"
                      value={scannedCoilId}
                      onChange={(e) => {
                        setScannedCoilId(e.target.value);
                        pendingIdempotencyKeyRef.current = createIdempotencyKey();
                      }}
                      placeholder="เช่น HB02189481"
                      className="w-full min-h-[46px] px-3.5 py-2.5 rounded-md border border-slate-300 bg-slate-50 focus:bg-white focus:border-[#1D4ED8] focus:ring-2 focus:ring-blue-100 outline-none font-mono text-sm text-slate-900"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="inbound-confirm-location-code"
                      className="block text-xs font-semibold text-slate-700 mb-1"
                    >
                      2. สแกนพื้นที่จัดเก็บจริง (Scan Actual Location)
                    </label>
                    <input
                      ref={locationScanInputRef}
                      id="inbound-confirm-location-code"
                      type="text"
                      value={scannedLocationCode}
                      onChange={(e) => {
                        setScannedLocationCode(e.target.value.toUpperCase());
                        pendingIdempotencyKeyRef.current = createIdempotencyKey();
                      }}
                      placeholder="เช่น E7/1/1/1"
                      className="w-full min-h-[46px] px-3.5 py-2.5 rounded-md border border-slate-300 bg-slate-50 focus:bg-white focus:border-[#1D4ED8] focus:ring-2 focus:ring-blue-100 outline-none font-mono text-sm uppercase text-slate-900"
                    />
                  </div>
                </div>

                {canOverride && (
                  <div className="pt-1">
                    <label className="inline-flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showOverrideField}
                        onChange={(e) => setShowOverrideField(e.target.checked)}
                        className="w-4 h-4 accent-[#1D4ED8]"
                      />
                      <span>ใช้สิทธิ์ Supervisor/Admin Override กรณีวางต่างจากตำแหน่งที่จอง</span>
                    </label>
                    {showOverrideField && (
                      <div className="mt-2">
                        <label
                          htmlFor="inbound-override-reason"
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          เหตุผล Override (บันทึกใน Audit Log)
                        </label>
                        <input
                          id="inbound-override-reason"
                          type="text"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                          placeholder="ระบุสาเหตุที่เปลี่ยนตำแหน่งวางจริง..."
                          className="w-full min-h-[40px] px-3 py-2 rounded-md border border-amber-300 bg-amber-50/40 text-xs text-slate-900"
                        />
                      </div>
                    )}
                  </div>
                )}

                {confirmError && (
                  <div
                    role="alert"
                    className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-800 flex items-start gap-2"
                  >
                    <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
                    <span>{confirmError}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <span className="text-[11px] text-slate-500">
                    Backend จะตรวจสอบทั้ง Batch, Coil, Location, Reservation TTL, Capacity และ Pyramid Support ก่อน Commit
                  </span>
                  <button
                    type="submit"
                    disabled={confirming}
                    className="min-h-[46px] px-6 py-2.5 rounded-md bg-[#16A34A] hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-bold flex items-center gap-2 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {confirming ? 'กำลังบันทึก Atomic Commit...' : 'ยืนยันวางสินค้าเข้าคลัง (Confirm Placement)'}
                    </span>
                  </button>
                </div>
              </form>

              {lastConfirmation && (
                <div className="p-4 rounded-md bg-emerald-50 border border-emerald-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1 text-xs text-emerald-950">
                    <div className="font-bold text-sm flex items-center gap-1.5 text-emerald-800">
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      <span>
                        รับเหล็กม้วนเข้าคลังสำเร็จ! ({lastConfirmation.coilId} → {lastConfirmation.locationCode})
                      </span>
                    </div>
                    <div className="font-mono text-[11px] text-emerald-900">
                      TX: {lastConfirmation.transactionNo} · Receipt: {lastConfirmation.receiptNo} ·
                      น้ำหนัก {formatNumber(lastConfirmation.weightKg)} kg · Batch Status:{' '}
                      {lastConfirmation.batchStatus}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openLocationIn3D(lastConfirmation.locationCode)}
                    className="min-h-[40px] px-4 py-2 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap self-start sm:self-auto cursor-pointer"
                  >
                    <Box className="w-4 h-4" aria-hidden="true" />
                    <span>เปิดดูตำแหน่งนี้ในคลัง 3D ทันที</span>
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {showExpandRowModal && hierarchy && selectedRowId && (
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
          initialDoorId={selectedDoorId}
          initialRowId={selectedRowId}
          onClose={() => setShowExpandRowModal(false)}
          onExpanded={(result: ExpandRowSlotsResponse) => {
            setShowExpandRowModal(false);
            setWorkflowNotice({
              type: 'success',
              message: `ขยายแถว ${result.doorCode}/แถว ${result.rowNumber} เป็นชั้น 1 จำนวน ${result.newBaseSlots} ม้วนแล้ว (+${result.createdCount} ช่องใหม่พร้อมวางทันที)`,
            });
            void loadHierarchy();
            if (selectedRowId) {
              void fetchRowSlots(selectedRowId, isPreSapMode ? null : (activeCoil?.coilDbId ?? null));
            }
          }}
        />
      )}
    </div>
  );
}
