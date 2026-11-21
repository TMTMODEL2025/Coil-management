import React, { useState } from 'react';
import {
  LayoutDashboard,
  Box,
  ArrowDownToLine,
  Package,
  SearchCode,
  ArrowUpFromLine,
  ArrowLeftRight,
  FileSpreadsheet,
  MapPinned,
  BarChart3,
  Users,
  Settings,
  LogOut,
  RefreshCw,
  Menu,
  X,
  WifiOff,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { NavSectionId } from '../types/wms';

export interface NavItemConfig {
  id: NavSectionId;
  labelTh: string;
  labelEn: string;
  phase: string;
  availableNow: boolean;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  allowedRoles?: string[];
}

export const WMS_NAV_ITEMS: NavItemConfig[] = [
  {
    id: 'dashboard',
    labelTh: 'แดชบอร์ด',
    labelEn: 'Dashboard',
    phase: 'Phase 1–2',
    availableNow: true,
    icon: LayoutDashboard,
  },
  {
    id: 'warehouse-3d',
    labelTh: 'คลังสินค้า 3D',
    labelEn: '3D Warehouse',
    phase: 'Phase 3',
    availableNow: true,
    icon: Box,
  },
  {
    id: 'inbound',
    labelTh: 'รับสินค้าเข้าคลัง',
    labelEn: 'Inbound Receiving',
    phase: 'Phase 5',
    availableNow: true,
    icon: ArrowDownToLine,
  },
  {
    id: 'inventory',
    labelTh: 'สินค้าคงคลัง',
    labelEn: 'Inventory',
    phase: 'Phase 6',
    availableNow: false,
    icon: Package,
  },
  {
    id: 'coil-tracking',
    labelTh: 'ติดตามเหล็กม้วน',
    labelEn: 'Coil Tracking',
    phase: 'Phase 6',
    availableNow: false,
    icon: SearchCode,
  },
  {
    id: 'outbound',
    labelTh: 'จ่ายสินค้าออก',
    labelEn: 'Outbound',
    phase: 'Phase 7',
    availableNow: false,
    icon: ArrowUpFromLine,
  },
  {
    id: 'transfer',
    labelTh: 'ย้ายตำแหน่ง',
    labelEn: 'Transfer',
    phase: 'Phase 8',
    availableNow: false,
    icon: ArrowLeftRight,
  },
  {
    id: 'sap-import',
    labelTh: 'นำเข้า SAP Excel',
    labelEn: 'SAP Excel Import',
    phase: 'Phase 4',
    availableNow: true,
    icon: FileSpreadsheet,
    allowedRoles: ['ADMIN', 'SUPERVISOR'],
  },
  {
    id: 'locations',
    labelTh: 'จัดการตำแหน่งจัดเก็บ',
    labelEn: 'Location Management',
    phase: 'Phase 2',
    availableNow: true,
    icon: MapPinned,
  },
  {
    id: 'reports',
    labelTh: 'รายงาน',
    labelEn: 'Reports',
    phase: 'Phase 9',
    availableNow: false,
    icon: BarChart3,
  },
  {
    id: 'users',
    labelTh: 'จัดการผู้ใช้งาน',
    labelEn: 'User Management',
    phase: 'Phase 1–2',
    availableNow: true,
    icon: Users,
    adminOnly: true,
  },
  {
    id: 'settings',
    labelTh: 'ตั้งค่าระบบ',
    labelEn: 'System Settings',
    phase: 'Phase 1–2',
    availableNow: true,
    icon: Settings,
  },
];

interface AppShellProps {
  activeSection: NavSectionId;
  onSelectSection: (section: NavSectionId) => void;
  children: React.ReactNode;
}

export function AppShell({ activeSection, onSelectSection, children }: AppShellProps) {
  const { profile, logout, realtimeConnected, lastSyncedAt, triggerManualSync } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const visibleNavItems = WMS_NAV_ITEMS.filter((item) => {
    if (item.adminOnly && profile?.roleCode !== 'ADMIN') return false;
    if (item.allowedRoles && !item.allowedRoles.includes(profile?.roleCode ?? '')) return false;
    return true;
  });

  const activeNav =
    visibleNavItems.find((i) => i.id === activeSection) ?? WMS_NAV_ITEMS[0];

  const handleSelect = (id: NavSectionId) => {
    onSelectSection(id);
    setMobileMenuOpen(false);
  };

  const formattedLastSync = lastSyncedAt
    ? new Date(lastSyncedAt).toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '-';

  return (
    <div className="min-h-screen bg-[#F4F6F9] text-slate-900 flex">
      {/* Desktop Sidebar Navigation (256px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 bg-[#0F172A] text-slate-200 border-r border-slate-800 shrink-0 sticky top-0 h-screen">
        <div className="h-14 px-5 flex items-center border-b border-slate-800 shrink-0">
          <span className="font-bold text-base tracking-tight text-white whitespace-nowrap">
            TMT Steel Coil WMS
          </span>
        </div>

        <nav aria-label="Main WMS Navigation" className="flex-1 overflow-y-auto py-3 px-3 space-y-0.5">
          {visibleNavItems.map((item) => {
            const Icon = item.icon;
            const isActive = item.id === activeSection;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className={`w-full min-h-[40px] px-3 py-2 rounded-md text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-[#1D4ED8] text-white font-semibold'
                    : 'text-slate-300 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate text-sm">{item.labelTh}</span>
                </span>
                {!item.availableNow && (
                  <span className="text-[11px] font-mono text-slate-400 shrink-0">
                    {item.phase.replace('Phase ', 'P')}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800 shrink-0">
          <div className="text-xs font-medium text-white truncate">
            {profile?.displayName || profile?.email}
          </div>
          <div className="mt-0.5 text-xs text-slate-400 flex items-center gap-1.5">
            <span className="font-mono text-blue-300">{profile?.roleCode}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{profile?.email}</span>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            className="mt-3 w-full min-h-[38px] px-3 py-1.5 rounded-md border border-slate-700 text-xs font-medium text-slate-200 hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>ออกจากระบบ (Sign Out)</span>
          </button>
        </div>
      </aside>

      {/* Main Workspace Column */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen">
        {/* Top Header Bar (Strict compact height for <=15% mobile sticky budget) */}
        <header className="sticky top-0 z-30 h-14 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="lg:hidden font-bold text-sm text-[#0F172A] whitespace-nowrap shrink-0">
              TMT WMS
            </span>
            <span className="lg:hidden text-slate-300" aria-hidden="true">
              /
            </span>
            <div className="min-w-0 flex items-baseline gap-2">
              <h1 className="text-sm sm:text-base font-semibold text-slate-900 truncate">
                {activeNav.labelTh}
              </h1>
              <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap">
                {activeNav.labelEn}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <span className="hidden md:inline text-xs text-slate-500 font-mono tabular-nums whitespace-nowrap">
              อัปเดตล่าสุด {formattedLastSync}
            </span>
            <button
              type="button"
              onClick={triggerManualSync}
              aria-label="รีเฟรชข้อมูลจากฐานข้อมูล"
              className="min-h-[38px] min-w-[38px] px-3 py-1.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="เปิดเมนูทั้งหมด"
              className="lg:hidden min-h-[40px] min-w-[40px] rounded-md border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Realtime Disconnection Warning Banner (Required by Part 6.7 — never pretend stale data is live) */}
        {!realtimeConnected && (
          <div
            role="status"
            className="bg-amber-50 border-b border-amber-200 px-4 lg:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-amber-900"
          >
            <div className="flex items-center gap-2">
              <WifiOff className="w-4 h-4 text-amber-700 shrink-0" aria-hidden="true" />
              <span>
                การเชื่อมต่อ Real-time ถูกตัดชั่วคราว — ข้อมูลที่แสดงอัปเดตล่าสุดเวลา{' '}
                <strong className="font-mono tabular-nums">{formattedLastSync}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={triggerManualSync}
              className="px-2.5 py-1 rounded bg-amber-700 hover:bg-amber-800 text-white font-medium cursor-pointer"
            >
              เชื่อมต่อใหม่ / Refresh
            </button>
          </div>
        )}

        {/* Main Content Viewport */}
        <main
          className={`flex-1 w-full mx-auto ${
            activeSection === 'warehouse-3d'
              ? 'p-2.5 lg:p-4 pb-20 lg:pb-4 max-w-none flex flex-col'
              : 'p-4 lg:p-6 pb-20 lg:pb-8 max-w-[1600px]'
          }`}
        >
          {children}
        </main>
      </div>

      {/* Mobile Compact Bottom Navigation (Height 60px + Header 56px = 116px <= 15% of 844px) */}
      <nav
        aria-label="Mobile Quick Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-[60px] bg-[#0F172A] border-t border-slate-800 grid grid-cols-4"
      >
        {(
          [
            { id: 'dashboard', label: 'แดชบอร์ด', icon: LayoutDashboard },
            { id: 'locations', label: 'Location', icon: MapPinned },
            { id: 'warehouse-3d', label: '3D Map', icon: Box },
            { id: 'inbound', label: 'Inbound', icon: ArrowDownToLine },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleSelect(tab.id)}
              className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium cursor-pointer ${
                active ? 'text-blue-400' : 'text-slate-400'
              }`}
            >
              <Icon className="w-5 h-5" aria-hidden="true" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Mobile Full 12-Menu Slide Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <button
            type="button"
            aria-label="ปิดเมนู"
            onClick={() => setMobileMenuOpen(false)}
            className="flex-1 bg-slate-950/60 cursor-pointer"
          />
          <div className="w-72 max-w-[82vw] bg-[#0F172A] text-slate-100 h-full flex flex-col border-l border-slate-800">
            <div className="h-14 px-4 flex items-center justify-between border-b border-slate-800">
              <span className="font-bold text-sm">เมนูคลังสินค้า (12 โมดูล)</span>
              <button
                type="button"
                aria-label="ปิดหน้าต่างเมนู"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === activeSection;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    className={`w-full min-h-[44px] px-3 py-2 rounded-md flex items-center justify-between gap-2 text-sm cursor-pointer ${
                      isActive ? 'bg-[#1D4ED8] text-white font-semibold' : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.labelTh}</span>
                    </span>
                    {!item.availableNow && (
                      <span className="text-[11px] font-mono text-slate-400">
                        {item.phase.replace('Phase ', 'P')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="p-4 border-t border-slate-800">
              <div className="text-xs text-slate-300 truncate">{profile?.email}</div>
              <div className="text-xs font-mono text-blue-300 mt-0.5">{profile?.roleCode}</div>
              <button
                type="button"
                onClick={() => void logout()}
                className="mt-3 w-full min-h-[44px] rounded-md border border-slate-700 text-xs font-medium text-white hover:bg-slate-800 flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogOut className="w-4 h-4" aria-hidden="true" />
                <span>ออกจากระบบ</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
