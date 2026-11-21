import React, { useMemo, useState } from 'react';
import { Layers, Plus, ShieldCheck, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type { ExpandRowSlotsResponse, StackingRule } from '../../types/wms';

export interface ExpandableDoorOption {
  id: number;
  doorCode: string;
  name: string;
}

export interface ExpandableRowOption {
  id: number;
  doorId: number;
  rowNumber: number;
  label: string;
}

export interface ExpandableLevelOption {
  id: number;
  rowId: number;
  levelNumber: number;
  label: string;
  maxSlots: number;
  stackingRule: StackingRule;
  currentSlotCount?: number;
}

interface ExpandRowSlotsModalProps {
  doors: ExpandableDoorOption[];
  rows: ExpandableRowOption[];
  levels: ExpandableLevelOption[];
  initialDoorId?: number | null;
  initialRowId?: number | null;
  onClose: () => void;
  onExpanded: (result: ExpandRowSlotsResponse) => void;
}

const QUICK_ADD_OPTIONS = [1, 4, 8, 12] as const;

export function ExpandRowSlotsModal({
  doors,
  rows,
  levels,
  initialDoorId,
  initialRowId,
  onClose,
  onExpanded,
}: ExpandRowSlotsModalProps) {
  const initialRow = useMemo(() => {
    if (initialRowId) {
      const exact = rows.find((r) => r.id === initialRowId);
      if (exact) return exact;
    }
    if (initialDoorId) {
      const firstInDoor = rows.find((r) => r.doorId === initialDoorId);
      if (firstInDoor) return firstInDoor;
    }
    return rows[0] ?? null;
  }, [rows, initialDoorId, initialRowId]);

  const [selectedDoorId, setSelectedDoorId] = useState<number>(
    initialRow?.doorId ?? initialDoorId ?? doors[0]?.id ?? 0
  );
  const [selectedRowId, setSelectedRowId] = useState<number>(initialRow?.id ?? 0);
  const [syncUpperPyramidLevels, setSyncUpperPyramidLevels] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const rowsInDoor = useMemo(
    () => rows.filter((r) => r.doorId === selectedDoorId),
    [rows, selectedDoorId]
  );

  const activeRow = useMemo(
    () => rowsInDoor.find((r) => r.id === selectedRowId) ?? rowsInDoor[0] ?? null,
    [rowsInDoor, selectedRowId]
  );

  const levelsInRow = useMemo(() => {
    if (!activeRow) return [];
    return levels
      .filter((l) => l.rowId === activeRow.id)
      .sort((a, b) => a.levelNumber - b.levelNumber);
  }, [levels, activeRow]);

  const currentBaseSlots = useMemo(() => {
    const baseLevel = levelsInRow.find((l) => l.levelNumber === 1) ?? levelsInRow[0];
    if (!baseLevel) return 12;
    return Math.max(baseLevel.currentSlotCount ?? 0, baseLevel.maxSlots);
  }, [levelsInRow]);

  const [targetBaseSlotsInput, setTargetBaseSlotsInput] = useState<string>(() =>
    String(Math.min(100, currentBaseSlots + 4))
  );

  // Sync default target whenever row selection changes
  const handleSelectDoor = (nextDoorId: number) => {
    setSelectedDoorId(nextDoorId);
    const nextRow = rows.find((r) => r.doorId === nextDoorId) ?? null;
    if (nextRow) {
      setSelectedRowId(nextRow.id);
      const nextBase = levels.find((l) => l.rowId === nextRow.id && l.levelNumber === 1);
      const baseCount = Math.max(nextBase?.currentSlotCount ?? 0, nextBase?.maxSlots ?? 12);
      setTargetBaseSlotsInput(String(Math.min(100, baseCount + 4)));
    }
    setErrorMsg(null);
  };

  const handleSelectRow = (nextRowId: number) => {
    setSelectedRowId(nextRowId);
    const nextBase = levels.find((l) => l.rowId === nextRowId && l.levelNumber === 1);
    const baseCount = Math.max(nextBase?.currentSlotCount ?? 0, nextBase?.maxSlots ?? 12);
    setTargetBaseSlotsInput(String(Math.min(100, baseCount + 4)));
    setErrorMsg(null);
  };

  const parsedTarget = Number(targetBaseSlotsInput);
  const isValidTarget =
    Number.isInteger(parsedTarget) && parsedTarget > currentBaseSlots && parsedTarget <= 100;

  const previewLevels = useMemo(() => {
    const target = isValidTarget ? parsedTarget : currentBaseSlots;
    return levelsInRow.map((lvl) => {
      const current = Math.max(lvl.currentSlotCount ?? 0, lvl.maxSlots);
      const isBase = lvl.levelNumber === 1;
      const nextSlots =
        !isBase && !syncUpperPyramidLevels
          ? current
          : isBase
            ? target
            : lvl.stackingRule === 'PYRAMID_STACK'
              ? Math.max(current, target - (lvl.levelNumber - 1))
              : Math.max(current, target);
      return {
        levelNumber: lvl.levelNumber,
        label: lvl.label,
        current,
        nextSlots,
        added: Math.max(0, nextSlots - current),
      };
    });
  }, [levelsInRow, isValidTarget, parsedTarget, currentBaseSlots, syncUpperPyramidLevels]);

  const totalAddedPreview = useMemo(
    () => previewLevels.reduce((acc, l) => acc + l.added, 0),
    [previewLevels]
  );

  const activeDoor = doors.find((d) => d.id === selectedDoorId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeRow) return;
    if (!isValidTarget) {
      setErrorMsg(
        `กรุณาระบุจำนวนช่องชั้น 1 เป้าหมายมากกว่าปัจจุบัน (${currentBaseSlots + 1} – 100 ม้วน)`
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const result = await apiFetch<ExpandRowSlotsResponse>(
        `/api/warehouse/rows/${activeRow.id}/expand-slots`,
        {
          method: 'POST',
          body: {
            targetBaseSlots: parsedTarget,
            syncUpperPyramidLevels,
          },
        }
      );
      onExpanded(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'ไม่สามารถขยายช่องวางในแถวได้');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ขยายจำนวนช่องวางเหล็กม้วนในแถว"
      className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
    >
      <div className="bg-white rounded-lg border border-slate-200 max-w-lg w-full overflow-hidden shadow-xl">
        <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-mono text-blue-300 uppercase tracking-wider">
              EXPAND ROW CAPACITY · ขยายพื้นที่วางในคลัง 3D
            </div>
            <h3 className="text-base font-bold mt-0.5">
              เพิ่มจำนวนช่องวางเหล็กม้วนต่อแถว (ขยายเกิน 12 ม้วน)
            </h3>
          </div>
          <button
            type="button"
            aria-label="ปิดหน้าต่าง"
            onClick={onClose}
            className="text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-sm">
          {/* Building & Row Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">อาคาร / ประตูคลัง (Door)</span>
              <select
                value={selectedDoorId}
                onChange={(e) => handleSelectDoor(Number(e.target.value))}
                className="mt-1 w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-xs font-medium"
              >
                {doors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.doorCode} — {d.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-700">แถวจัดเก็บ (Row)</span>
              <select
                value={activeRow?.id ?? ''}
                onChange={(e) => handleSelectRow(Number(e.target.value))}
                className="mt-1 w-full h-10 px-3 rounded-md border border-slate-300 bg-white text-xs font-medium"
              >
                {rowsInDoor.map((r) => (
                  <option key={r.id} value={r.id}>
                    แถวที่ {r.rowNumber} ({r.label})
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Current Capacity & Quick Add Presets */}
          <div className="p-3.5 rounded-md bg-slate-50 border border-slate-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-slate-600">
                ความจุชั้น 1 ปัจจุบัน ({activeDoor?.doorCode}/R{activeRow?.rowNumber ?? '-'}):
              </span>
              <span className="font-mono font-bold text-slate-900">
                {currentBaseSlots} ม้วน (Slot 1 – {currentBaseSlots})
              </span>
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-slate-700">
                เลือกจำนวนช่องชั้น 1 ที่ต้องการเพิ่มแบบเร็ว
              </span>
              <div className="grid grid-cols-4 gap-2">
                {QUICK_ADD_OPTIONS.map((inc) => {
                  const nextVal = Math.min(100, currentBaseSlots + inc);
                  const active = parsedTarget === nextVal;
                  return (
                    <button
                      key={inc}
                      type="button"
                      disabled={currentBaseSlots >= 100}
                      onClick={() => {
                        setTargetBaseSlotsInput(String(nextVal));
                        setErrorMsg(null);
                      }}
                      className={`h-9 rounded-md border text-xs font-mono font-semibold transition-colors cursor-pointer disabled:opacity-40 ${
                        active
                          ? 'bg-[#1D4ED8] border-[#1D4ED8] text-white'
                          : 'bg-white border-slate-300 text-slate-800 hover:bg-blue-50 hover:border-blue-400'
                      }`}
                    >
                      +{inc} ({nextVal})
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="block">
              <span className="text-xs font-semibold text-slate-700">
                หรือระบุจำนวนช่องวางชั้น 1 เป้าหมายรวม (สูงสุด 100 ม้วน/แถว)
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={currentBaseSlots + 1}
                  max={100}
                  required
                  value={targetBaseSlotsInput}
                  onChange={(e) => {
                    setTargetBaseSlotsInput(e.target.value);
                    setErrorMsg(null);
                  }}
                  className="w-32 h-10 px-3 rounded-md border border-slate-300 bg-white font-mono font-bold text-sm text-slate-900"
                />
                <span className="text-xs text-slate-600">
                  ม้วนในชั้น 1{' '}
                  {isValidTarget && (
                    <strong className="font-mono text-[#16A34A]">
                      (เพิ่มช่อง {currentBaseSlots + 1} – {parsedTarget})
                    </strong>
                  )}
                </span>
              </div>
            </label>
          </div>

          {/* Pyramid Auto-Sync Checkbox */}
          <label className="flex items-start gap-2.5 p-3 rounded-md border border-blue-200 bg-blue-50/60 cursor-pointer">
            <input
              type="checkbox"
              checked={syncUpperPyramidLevels}
              onChange={(e) => setSyncUpperPyramidLevels(e.target.checked)}
              className="mt-0.5"
            />
            <div className="text-xs">
              <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#1D4ED8]" aria-hidden="true" />
                <span>ขยายชั้นวางซ้อนด้านบน (ชั้น 2–4 Pyramid) ให้อัตโนมัติตามสัดส่วน</span>
              </div>
              <p className="text-slate-600 mt-0.5">
                เมื่อเพิ่มชั้น 1 เป็น N ม้วน ระบบจะคำนวณช่องวางซ้อนชั้น 2 (N-1), ชั้น 3 (N-2), ชั้น 4 (N-3)
                พร้อมพิกัด 3D ให้อัตโนมัติและขยายพื้นคอนกรีต/รางเครน 3D รองรับทันที
              </p>
            </div>
          </label>

          {/* Live Breakdown Preview */}
          {previewLevels.length > 0 && (
            <div className="border border-slate-200 rounded-md overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-semibold text-slate-700">
                <span>สรุปช่องวางที่จะสร้างเพิ่มในฐานข้อมูลและผัง 3D</span>
                <span className="font-mono text-[#1D4ED8]">
                  +{totalAddedPreview} ช่องใหม่
                </span>
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {previewLevels.map((lvl) => (
                  <div
                    key={lvl.levelNumber}
                    className="px-3 py-2 flex items-center justify-between gap-2"
                  >
                    <span className="font-mono text-slate-800">
                      ชั้น {lvl.levelNumber} · {lvl.label}
                    </span>
                    <span className="font-mono tabular-nums text-slate-700">
                      {lvl.current} → <strong>{lvl.nextSlots}</strong>{' '}
                      {lvl.added > 0 ? (
                        <span className="text-[#16A34A] font-bold">(+{lvl.added})</span>
                      ) : (
                        <span className="text-slate-400">(คงเดิม)</span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Safety Reassurance */}
          <div className="flex items-start gap-2 text-[11px] text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              ปลอดภัย 100%: ระบบจะเพิ่มเฉพาะช่องวางใหม่ต่อท้ายเท่านั้น ไม่ลบ ไม่ย้าย
              และไม่กระทบเหล็กม้วนเดิมที่มีอยู่ในคลัง
            </span>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-2.5 rounded-md bg-red-50 border border-red-200 text-xs text-red-800"
            >
              {errorMsg}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[40px] px-4 rounded-md border border-slate-300 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              ยกเลิก
            </button>
            <button
              type="submit"
              disabled={submitting || !activeRow || !isValidTarget}
              className="min-h-[40px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>
                {submitting
                  ? 'กำลังสร้างช่องวางเพิ่ม...'
                  : `ยืนยันขยายเป็น ${isValidTarget ? parsedTarget : currentBaseSlots} ม้วน (+${totalAddedPreview} ช่อง)`}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
