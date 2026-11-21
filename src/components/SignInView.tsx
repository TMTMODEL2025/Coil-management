import { ShieldCheck, Layers, Database, MapPin, LogIn, AlertCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export function SignInView() {
  const { signInWithGoogle, authError, loading } = useAuth();

  return (
    <div className="min-h-screen bg-[#0F172A] text-slate-100 flex flex-col-reverse lg:flex-row">
      {/* Left Structural Industrial Overview */}
      <section className="flex-1 flex flex-col justify-between p-6 sm:p-10 lg:p-16 border-t lg:border-t-0 lg:border-r border-slate-800">
        <div>
          <div className="text-sm font-semibold text-blue-400">
            TMT Steel Coil Warehouse Management System
          </div>
          <h1
            className="mt-3 text-2xl sm:text-4xl lg:text-[42px] font-bold leading-[1.3] text-white max-w-2xl"
            style={{ textWrap: 'balance' }}
          >
            ระบบบริหารจัดการคลังสินค้าเหล็กม้วน และแผนผังคลังสินค้า 3D
          </h1>
          <p className="mt-4 text-slate-200 text-sm sm:text-base max-w-xl leading-relaxed">
            ควบคุมตำแหน่งเหล็กม้วนรายลูกด้วย Coil ID เชื่อมต่อฐานข้อมูล PostgreSQL แบบ Atomic
            Transaction รองรับการทำงานทั้งพนักงานหน้างานบนมือถือและผู้ดูแลระบบบนเดสก์ท็อป
          </p>
        </div>

        <div className="mt-8 lg:mt-10 grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-2xl">
          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <MapPin className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
              <span>โครงสร้างตำแหน่ง Door / Row / Level / Slot</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">
              รหัสตำแหน่งมาตรฐานเช่น <span className="font-mono text-white">E7/1/3/9</span>{' '}
              รองรับ Floor Saddle และ Pyramid Stacking พร้อมพิกัด 3D X, Y, Z จากฐานข้อมูลจริง
            </p>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Database className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
              <span>PostgreSQL Source of Truth (23 ตาราง)</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">
              บังคับกฎ 1 Location ต่อ 1 Coil และ 1 Active Location ต่อ 1 Coil ระดับ Database
              Constraint พร้อมบันทึก Audit Trail ทุกขั้นตอน
            </p>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Layers className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
              <span>SAP Excel Import Reference Only</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">
              นำเข้าข้อมูลอ้างอิงจากไฟล์ SAP S/4HANA Excel โดยรักษา Leading Zeros และไม่เพิ่ม
              Inventory อัตโนมัติจนกว่าจะยืนยันรับเข้าจริง
            </p>
          </div>

          <div className="border-t border-slate-800 pt-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
              <span>Role-Based Access Control</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-300 leading-relaxed">
              ยืนยันตัวตนผ่าน Google Sign-In แยกสิทธิ์ Admin, Supervisor, Floor Operator และ Viewer
              ทุกคำสั่ง Mutation ตรวจสอบสิทธิ์บน Server
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-800/80 text-xs text-slate-300 flex flex-wrap gap-x-3 gap-y-1">
          <span>Phase 1: Foundation &amp; PostgreSQL 23 Tables</span>
          <span aria-hidden="true">·</span>
          <span>Phase 2: Warehouse Master &amp; Location Structure</span>
          <span aria-hidden="true">·</span>
          <span>Estimated Layout: Door E7 / E8</span>
        </div>
      </section>

      {/* Right Sign-In Panel (Top above-the-fold on mobile) */}
      <aside className="w-full lg:w-[440px] xl:w-[480px] bg-[#F4F6F9] text-slate-900 flex flex-col justify-center p-6 sm:p-10 lg:p-12">
        <div className="max-w-sm mx-auto w-full">
          <div className="text-xs font-semibold text-[#1D4ED8]">
            Enterprise WMS Access
          </div>
          <h2 className="mt-1.5 text-2xl font-bold text-slate-900 leading-snug">
            เข้าสู่ระบบ TMT Steel Coil WMS
          </h2>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            ใช้บัญชี Google ที่ได้รับสิทธิ์เพื่อเข้าใช้งานระบบจัดการคลังสินค้าเหล็กม้วนและฐานข้อมูล
            PostgreSQL
          </p>

          {authError && (
            <div
              role="alert"
              className="mt-5 p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm flex items-start gap-2.5"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-red-600" aria-hidden="true" />
              <span>{authError}</span>
            </div>
          )}

          <button
            type="button"
            disabled={loading}
            onClick={() => void signInWithGoogle()}
            className="mt-6 w-full min-h-[48px] px-5 py-3 rounded-lg bg-[#1D4ED8] hover:bg-[#1E40AF] active:bg-[#1E3A8A] disabled:opacity-60 text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
          >
            <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{loading ? 'กำลังตรวจสอบสิทธิ์...' : 'เข้าสู่ระบบด้วย Google (Sign in with Google)'}</span>
          </button>

          <div className="mt-6 pt-5 border-t border-slate-200 space-y-1.5 text-xs text-slate-600">
            <p className="font-semibold text-slate-800">ความปลอดภัยและการจัดเก็บข้อมูล</p>
            <p className="leading-relaxed">
              โทเค็นยืนยันตัวตนถูกจัดเก็บในหน่วยความจำเท่านั้น และคำสั่งแก้ไข Location หรือ Inventory
              ทุกคำสั่งจะถูกตรวจสอบสิทธิ์บน Backend พร้อมบันทึก Audit Log
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}
