import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import type { WarehouseHierarchyData } from '../types/wms';

export function SystemSettingsView() {
  const [hierarchy, setHierarchy] = useState<WarehouseHierarchyData | null>(null);

  useEffect(() => {
    void apiFetch<WarehouseHierarchyData>('/api/warehouse/hierarchy')
      .then(setHierarchy)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          ขอบเขตการเชื่อมต่อ SAP S/4HANA (SAP Integration Governance)
        </h2>
        <p className="mt-1.5 text-sm text-slate-600 leading-relaxed">
          ระบบ TMT Steel Coil WMS รองรับการนำเข้าข้อมูลอ้างอิงจาก SAP S/4HANA ผ่านการ Export ไฟล์
          Excel ด้วยมือเท่านั้น (Manual Upload → Validate → Confirm Import) ไม่มีการเชื่อมต่อ SAP API,
          OData, BAPI หรือส่งข้อมูล Outbound กลับไปยัง SAP
        </p>
        <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <div className="text-slate-500">Inbound Reference</div>
            <div className="mt-1 font-semibold text-slate-900">SAP Excel Upload Only</div>
          </div>
          <div>
            <div className="text-slate-500">Leading Zero Protection</div>
            <div className="mt-1 font-semibold text-slate-900">TEXT Enforced (Coil / Batch / Doc)</div>
          </div>
          <div>
            <div className="text-slate-500">Outbound Execution</div>
            <div className="mt-1 font-semibold text-slate-900">WMS Internal Only</div>
          </div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="text-sm font-semibold text-slate-900">
          ข้อมูลพื้นที่โกดังและสถานะ Estimated Layout (Warehouse Zones)
        </h2>
        <div className="mt-3 divide-y divide-slate-100 text-xs">
          {(hierarchy?.zones ?? []).map((z) => (
            <div key={z.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900">
                  <span className="font-mono text-[#1D4ED8]">{z.code}</span> · {z.name}
                </div>
                <div className="text-slate-500 mt-0.5">{z.description}</div>
              </div>
              <div className="font-mono tabular-nums text-slate-700 whitespace-nowrap">
                {z.widthM}m × {z.depthM}m × {z.heightM}m ·{' '}
                {z.isEstimatedLayout ? 'Estimated' : 'Measured'}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
