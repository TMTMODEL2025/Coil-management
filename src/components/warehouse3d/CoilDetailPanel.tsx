import { X, Crosshair, Package, Layers, AlertTriangle, Clock, MapPin } from 'lucide-react';
import type { SceneLocationNode } from '../../types/wms';
import { getStatusVisualStyle, resolveVisualStatus } from '../../three/warehouse3dLogic';

interface CoilDetailPanelProps {
  location: SceneLocationNode;
  isHighlighted: boolean;
  onFocusCamera: (location: SceneLocationNode) => void;
  onClose: () => void;
}

/**
 * Module 9: CoilDetailPanel
 * Responsive read-only inspection drawer (right side panel on Desktop,
 * bottom sheet on Mobile/Tablet) showing real PostgreSQL Location & Coil details.
 */
export function CoilDetailPanel({
  location,
  isHighlighted,
  onFocusCamera,
  onClose,
}: CoilDetailPanelProps) {
  const dbStyle = getStatusVisualStyle(location.status);
  const visualStyle = getStatusVisualStyle(resolveVisualStatus(location.status, isHighlighted));

  return (
    <aside
      aria-label="รายละเอียดตำแหน่งจัดเก็บและเหล็กม้วน"
      className="absolute z-20 inset-x-2 bottom-2 lg:inset-x-auto lg:top-3 lg:right-3 lg:bottom-3 lg:w-[350px] max-h-[62%] lg:max-h-none bg-[#0F172A] border border-slate-700 rounded-lg shadow-2xl text-slate-100 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-3 shrink-0 bg-[#111C33]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
            <h2 className="font-mono font-bold text-base text-white tracking-tight truncate">
              {location.locationCode}
            </h2>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold text-white"
              style={{ backgroundColor: dbStyle.hex }}
            >
              <span className="font-mono">{dbStyle.labelEn}</span>
              <span>·</span>
              <span>{dbStyle.labelTh}</span>
            </span>
            {location.coil?.isPendingSapSync && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-[#F59E0B] text-slate-950">
                รอข้อมูล SAP
              </span>
            )}
            {isHighlighted && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold text-white"
                style={{ backgroundColor: visualStyle.hex }}
              >
                FOCUS / RECOMMENDED
              </span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิดหน้าต่างรายละเอียด"
          className="min-h-[36px] min-w-[36px] rounded-md border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white flex items-center justify-center shrink-0 cursor-pointer"
        >
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>

      {/* Scrollable Content Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
        {/* Location Master Attributes */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              ข้อมูลตำแหน่งจัดเก็บ (Location)
            </span>
            {location.isEstimatedCoord && (
              <span className="text-[11px] text-amber-300 font-medium">Estimated Coord</span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2 bg-slate-900/90 border border-slate-800 rounded-md p-2.5">
            <div>
              <div className="text-slate-400">ประตูอาคาร (Door)</div>
              <div className="font-mono font-semibold text-white mt-0.5">{location.doorCode}</div>
            </div>
            <div>
              <div className="text-slate-400">แถว / ชั้น / ช่อง</div>
              <div className="font-mono font-semibold text-white mt-0.5">
                R{location.rowNumber} / L{location.levelNumber} / S{location.slotNumber}
              </div>
            </div>
            <div>
              <div className="text-slate-400">โครงสร้างจัดเก็บ</div>
              <div className="font-mono text-slate-200 mt-0.5">{location.stackingRule}</div>
            </div>
            <div>
              <div className="text-slate-400">กลุ่มจัดวาง / Priority</div>
              <div className="font-mono text-slate-200 mt-0.5">
                {location.stackingGroup} · P{location.allocationPriority}
              </div>
            </div>
          </div>

          {/* Weight Capacity Breakdown */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-md p-2.5 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">รับน้ำหนักสูงสุด (Max Capacity)</span>
              <span className="font-mono tabular-nums font-semibold text-white">
                {location.maxWeightKg.toLocaleString('en-US')} kg
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">น้ำหนักปัจจุบัน (Current Weight)</span>
              <span className="font-mono tabular-nums font-semibold text-blue-300">
                {location.coil?.isPendingSapSync && location.currentWeightKg === 0 ? (
                  <span className="text-amber-300">รอข้อมูล SAP</span>
                ) : (
                  `${location.currentWeightKg.toLocaleString('en-US')} kg`
                )}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-800">
              <span className="text-slate-400">คงเหลือรองรับได้ (Available)</span>
              <span className="font-mono tabular-nums font-semibold text-emerald-400">
                {location.availableCapacityKg.toLocaleString('en-US')} kg
              </span>
            </div>
          </div>

          {/* 3D Coordinates */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-md px-2.5 py-2 flex items-center justify-between">
            <span className="text-slate-400">พิกัด 3D (X, Y, Z)</span>
            <span className="font-mono tabular-nums text-slate-200">
              {location.posX.toFixed(2)}, {location.posY.toFixed(2)}, {location.posZ.toFixed(2)} m
            </span>
          </div>
        </section>

        {/* Active Reservation Section (only if non-expired active reservation exists) */}
        {location.reservation && (
          <section className="bg-orange-950/60 border border-orange-700/70 rounded-md p-3 space-y-1.5">
            <div className="font-semibold text-orange-300 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>กำลังจองตำแหน่ง (Active Reservation)</span>
            </div>
            <div className="flex justify-between text-slate-200">
              <span className="text-slate-400">Coil ID ที่จอง:</span>
              <span className="font-mono font-semibold">{location.reservation.coilId}</span>
            </div>
            <div className="flex justify-between text-slate-200">
              <span className="text-slate-400">ประเภท:</span>
              <span className="font-mono">{location.reservation.reservationType}</span>
            </div>
            <div className="flex justify-between text-slate-200">
              <span className="text-slate-400">หมดอายุจอง:</span>
              <span className="font-mono tabular-nums">
                {new Date(location.reservation.expiresAt).toLocaleString('th-TH')}
              </span>
            </div>
          </section>
        )}

        {/* Active Steel Coil Details Section */}
        <section className="space-y-2">
          <div className="font-semibold text-slate-300 flex items-center gap-1.5">
            <Package className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            <span>ข้อมูลเหล็กม้วนในตำแหน่ง (Steel Coil)</span>
          </div>

          {location.coil ? (
            <div
              className={`bg-slate-900/90 border rounded-md p-3 space-y-2 ${
                location.coil.isPendingSapSync ? 'border-amber-600/80' : 'border-blue-800/70'
              }`}
            >
              {location.coil.isPendingSapSync && (
                <div className="flex items-start gap-2 bg-amber-950/80 border border-amber-500/70 rounded p-2.5 text-[11px] text-amber-200 leading-relaxed">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
                  <div>
                    <div className="font-semibold text-amber-300">
                      รอเชื่อมข้อมูล SAP (Pre-SAP Inbound)
                    </div>
                    <div className="mt-0.5">
                      ม้วนเหล็กนี้ถูกวางลงผังคลัง 3D แล้ว เมื่ออัปโหลดไฟล์ SAP Excel ในภายหลัง
                      ระบบจะจับคู่ Batch และเติมข้อมูล Coil ID / น้ำหนัก / เกรดให้อัตโนมัติโดยไม่ย้ายตำแหน่ง
                    </div>
                  </div>
                </div>
              )}

              {location.coil.isEstimatedModel && !location.coil.isPendingSapSync && (
                <div className="flex items-start gap-2 bg-amber-950/60 border border-amber-700/60 rounded p-2 text-[11px] text-amber-200">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" aria-hidden="true" />
                  <span>
                    Estimated Model — ไม่มีข้อมูลขนาดจริงครบถ้วนจาก SAP จึงแสดงโมเดลขนาดประมาณการ
                    (OD {location.coil.renderOuterDiameterMm} mm / W {location.coil.renderWidthMm} mm)
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <div className="text-slate-400">
                    {location.coil.isPendingSapSync ? 'รหัสชั่วคราว (Provisional Coil ID)' : 'Coil ID'}
                  </div>
                  <div
                    className={`font-mono font-bold text-sm mt-0.5 break-all ${
                      location.coil.isPendingSapSync ? 'text-amber-300' : 'text-blue-300'
                    }`}
                  >
                    {location.coil.coilId}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Batch</div>
                  <div className="font-mono text-white font-semibold mt-0.5">
                    {location.coil.batchNo}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Material Code</div>
                  <div className="font-mono text-white mt-0.5">
                    {location.coil.materialCode || (location.coil.isPendingSapSync ? 'รอข้อมูล SAP' : '-')}
                  </div>
                </div>
                {location.coil.materialDescription && (
                  <div className="col-span-2">
                    <div className="text-slate-400">Material Description</div>
                    <div className="text-slate-200 mt-0.5">{location.coil.materialDescription}</div>
                  </div>
                )}
                <div>
                  <div className="text-slate-400">น้ำหนัก (Weight)</div>
                  <div className="font-mono tabular-nums font-semibold text-white mt-0.5">
                    {location.coil.isPendingSapSync && location.coil.weightKg === 0 ? (
                      <span className="text-amber-300">รอข้อมูล SAP</span>
                    ) : (
                      `${location.coil.weightKg.toLocaleString('en-US')} kg`
                    )}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">สถานะสต็อก</div>
                  <div className="font-mono text-emerald-300 mt-0.5">
                    {location.coil.inventoryStatus}
                  </div>
                </div>
                {(location.coil.grade || location.coil.heatNo) && (
                  <>
                    <div>
                      <div className="text-slate-400">Grade</div>
                      <div className="font-mono text-slate-200 mt-0.5">
                        {location.coil.grade ?? '-'}
                      </div>
                    </div>
                    <div>
                      <div className="text-slate-400">HEAT NO.</div>
                      <div className="font-mono text-slate-200 mt-0.5">
                        {location.coil.heatNo ?? '-'}
                      </div>
                    </div>
                  </>
                )}
                <div>
                  <div className="text-slate-400">Thickness / Width</div>
                  <div className="font-mono tabular-nums text-slate-200 mt-0.5">
                    {location.coil.thicknessMm ?? '-'} / {location.coil.widthMm ?? '-'} mm
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">OD / ID</div>
                  <div className="font-mono tabular-nums text-slate-200 mt-0.5">
                    {location.coil.outerDiameterMm ?? '-'} / {location.coil.innerDiameterMm ?? '-'} mm
                  </div>
                </div>
                <div className="col-span-2 pt-1 border-t border-slate-800 flex justify-between">
                  <span className="text-slate-400">วันที่รับเข้า (Inbound Date)</span>
                  <span className="font-mono tabular-nums text-slate-200">
                    {new Date(location.coil.inboundDate).toLocaleString('th-TH')}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-slate-900/70 border border-slate-800 rounded-md p-3 text-slate-400 leading-relaxed">
              ไม่มีเหล็กม้วนจัดเก็บอยู่ในตำแหน่งนี้ในฐานข้อมูล PostgreSQL
              <div className="mt-1 text-[11px] text-slate-500">
                การรับเหล็กม้วนเข้าจัดเก็บจริงจะเปิดใช้งานใน Phase 4–5 (SAP Excel Import &amp; Inbound)
              </div>
            </div>
          )}
        </section>

        {location.notes && (
          <div className="bg-slate-900/70 border border-slate-800 rounded-md p-2.5 text-slate-300">
            <span className="text-slate-400 block mb-0.5">หมายเหตุ (Notes)</span>
            {location.notes}
          </div>
        )}
      </div>

      {/* Footer Action (Read-Only Focus — No Stock Mutation in Phase 3) */}
      <div className="px-4 py-3 border-t border-slate-800 bg-[#111C33] shrink-0 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onFocusCamera(location)}
          className="flex-1 min-h-[40px] px-3 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#2563EB] text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
          <span>โฟกัสกล้องตำแหน่งนี้</span>
        </button>
      </div>
    </aside>
  );
}
