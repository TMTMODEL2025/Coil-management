import { ArrowRight } from 'lucide-react';
import type { NavSectionId } from '../types/wms';

const PHASE_DETAILS: Record<
  Exclude<NavSectionId, 'dashboard' | 'locations' | 'users' | 'settings'>,
  {
    phase: string;
    title: string;
    description: string;
    readyDbTables: string[];
  }
> = {
  'warehouse-3d': {
    phase: 'Phase 3',
    title: 'Interactive 3D Warehouse (Floor Saddle & Pyramid Stacking)',
    description:
      'แสดงโครงสร้างโกดัง ประตู E7 / E8, Overhead Crane, Floor Saddle, Pyramid Stacking 4 ชั้น และ Steel Coil 3D ที่เชื่อมต่อกับพิกัดและสถานะจริงจาก PostgreSQL พร้อมระบบค้นหา E7/1/3/9 และ Real-time Sync',
    readyDbTables: ['zones', 'building_doors', 'warehouse_rows', 'warehouse_levels', 'storage_locations', 'warehouse_layout_objects'],
  },
  'sap-import': {
    phase: 'Phase 4',
    title: 'SAP Excel Import Center (Manual Upload Only)',
    description:
      'อัปโหลดไฟล์ Excel จาก SAP S/4HANA เลือก Worksheet ตรวจจับ Header ตั้งค่า Column Mapping รักษา Leading Zeros ตรวจสอบข้อมูลซ้ำ และดาวน์โหลด Error Report โดยไม่เพิ่ม Inventory อัตโนมัติ',
    readyDbTables: ['excel_column_mappings', 'excel_import_batches', 'excel_import_staging', 'excel_import_errors', 'sap_document_headers', 'sap_document_items', 'coils'],
  },
  inbound: {
    phase: 'Phase 5',
    title: 'Inbound Receiving & Auto Location Allocation',
    description:
      'Workflow หน้างาน Mobile-First: สแกน Batch → สแกน Coil ID ทีละลูก → แนะนำและจอง Location อัตโนมัติพร้อม Expiration → นำทางด้วย 3D → สแกน Location + Coil ยืนยันแบบ Atomic Transaction',
    readyDbTables: ['inbound_receipts', 'inbound_receipt_items', 'location_reservations', 'inventory', 'stock_transactions', 'audit_logs'],
  },
  inventory: {
    phase: 'Phase 6',
    title: 'Inventory Console',
    description:
      'ตารางสินค้าคงคลังเหล็กม้วนแบบ SAP แสดงตำแหน่งปัจจุบัน น้ำหนัก ขนาด Batch และสถานะจริงจาก PostgreSQL (บังคับ 1 Location ต่อ 1 Coil)',
    readyDbTables: ['inventory', 'coils', 'storage_locations'],
  },
  'coil-tracking': {
    phase: 'Phase 6',
    title: 'Coil Tracking & Immutable History',
    description:
      'ค้นหา Coil ID เพื่อตรวจสอบตำแหน่งจัดเก็บปัจจุบันบน 3D และประวัติการเคลื่อนย้าย Inbound / Transfer / Outbound ย้อนหลังครบทุกรายการ',
    readyDbTables: ['coils', 'inventory', 'stock_transactions', 'audit_logs'],
  },
  outbound: {
    phase: 'Phase 7',
    title: 'Outbound Workflow (WMS Internal Only)',
    description:
      'สร้าง Outbound Request ค้นหาและชี้ตำแหน่ง Coil บน 3D สแกน Location + Coil เพื่อยืนยันจ่ายออก ปล่อย Location เป็น EMPTY และบันทึกประวัติผู้ดำเนินการโดยไม่มีการส่งข้อมูลกลับ SAP',
    readyDbTables: ['outbound_orders', 'outbound_order_items', 'inventory', 'stock_transactions'],
  },
  transfer: {
    phase: 'Phase 8',
    title: 'Internal Transfer Workflow (Atomic Swap)',
    description:
      'ย้ายตำแหน่งเหล็กม้วนภายในคลัง จองปลายทาง ตรวจสอบ Capacity และ Safety สแกนยืนยันปลายทางแล้วสลับ Source → EMPTY และ Destination → OCCUPIED แบบ Atomic',
    readyDbTables: ['location_reservations', 'inventory', 'storage_locations', 'stock_transactions'],
  },
  reports: {
    phase: 'Phase 9',
    title: 'Executive Reports & Utilization Analytics',
    description:
      'รายงานสรุปการใช้งานพื้นที่จัดเก็บตาม Door / Row / Level, ประวัติการรับเข้า-จ่ายออก และ Audit Report จากฐานข้อมูลจริง',
    readyDbTables: ['inventory', 'stock_transactions', 'storage_locations', 'audit_logs'],
  },
};

interface PhaseRoadmapViewProps {
  section: Exclude<NavSectionId, 'dashboard' | 'locations' | 'users' | 'settings'>;
  onNavigate: (section: NavSectionId) => void;
}

export function PhaseRoadmapView({ section, onNavigate }: PhaseRoadmapViewProps) {
  const info = PHASE_DETAILS[section];

  return (
    <div className="max-w-3xl bg-white border border-slate-200 rounded-lg p-6 space-y-5">
      <div>
        <div className="text-xs font-mono font-semibold text-[#1D4ED8]">
          SEQUENTIAL DELIVERY · {info.phase.toUpperCase()}
        </div>
        <h2 className="mt-1.5 text-xl font-bold text-slate-900">{info.title}</h2>
        <p className="mt-2 text-sm text-slate-600 leading-relaxed">{info.description}</p>
      </div>

      <div className="pt-4 border-t border-slate-200">
        <div className="text-xs font-semibold text-slate-700">
          ตาราง PostgreSQL ที่สร้างและตรวจสอบ Constraint พร้อมใช้งานแล้วใน Phase 1:
        </div>
        <div className="mt-2 text-xs font-mono text-slate-600 leading-relaxed">
          {info.readyDbTables.join(' · ')}
        </div>
      </div>

      <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          ระบบกำลังพัฒนาตามลำดับ Phase — ขณะนี้ Phase 1–5 พร้อมใช้งานเต็มรูปแบบแล้ว
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('inbound')}
            className="min-h-[40px] px-4 py-2 rounded-md bg-[#16A34A] hover:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <span>รับสินค้าเข้าคลัง (Phase 5)</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('warehouse-3d')}
            className="min-h-[40px] px-4 py-2 rounded-md bg-[#0F172A] hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <span>เปิดคลังสินค้า 3D (Phase 3)</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('locations')}
            className="min-h-[40px] px-4 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <span>ไปที่ Location Management (Phase 2)</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
}
