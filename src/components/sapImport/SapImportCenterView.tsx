import { useEffect, useState } from 'react';
import {
  Database,
  FileSpreadsheet,
  History,
  LayoutDashboard,
  Lock,
  Settings2,
  UploadCloud,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { apiFetch } from '../../lib/api';
import type {
  SapImportBatchSummary,
  SapImportDashboardResponse,
  SapTargetFieldDef,
} from '../../types/sapImport';
import { SapImportDashboardTab } from './SapImportDashboardTab';
import { SapUploadWorkflowTab } from './SapUploadWorkflowTab';
import { SapMappingTemplatesTab } from './SapMappingTemplatesTab';
import { SapReferenceCoilsTab } from './SapReferenceCoilsTab';

type SapCenterTab = 'dashboard' | 'upload' | 'mappings' | 'history' | 'reference-coils';

export function SapImportCenterView() {
  const { profile, realtimeRevision } = useAuth();
  const isAdmin = profile?.roleCode === 'ADMIN';
  const isSupervisor = profile?.roleCode === 'SUPERVISOR';
  const hasAccess = isAdmin || isSupervisor;

  const [activeTab, setActiveTab] = useState<SapCenterTab>('dashboard');
  const [targetFields, setTargetFields] = useState<SapTargetFieldDef[]>([]);
  const [maxFileSizeMb, setMaxFileSizeMb] = useState<number>(15);
  const [resumedBatch, setResumedBatch] = useState<SapImportBatchSummary | null>(null);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  const combinedRefreshKey = realtimeRevision + localRefreshKey;

  useEffect(() => {
    if (!hasAccess) return;
    let active = true;
    const loadMeta = async () => {
      try {
        const res = await apiFetch<
          SapImportDashboardResponse & { targetFields?: SapTargetFieldDef[] }
        >('/api/sap-import/dashboard?page=1&pageSize=1');
        if (!active) return;
        if (Array.isArray(res.targetFields)) {
          setTargetFields(res.targetFields);
        }
        if (typeof res.maxFileSizeMb === 'number') {
          setMaxFileSizeMb(res.maxFileSizeMb);
        }
      } catch {
        // Handled inside tabs
      }
    };
    void loadMeta();
    return () => {
      active = false;
    };
  }, [hasAccess]);

  if (!hasAccess) {
    return (
      <div className="max-w-xl bg-white border border-slate-200 rounded-lg p-6 space-y-3">
        <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
          <Lock className="w-4 h-4" aria-hidden="true" />
          <span>สิทธิ์การเข้าถึงถูกจำกัด (RBAC Access Restricted)</span>
        </div>
        <p className="text-xs text-slate-600 leading-relaxed">
          โมดูล SAP Excel Import Center อนุญาตเฉพาะผู้ใช้งานระดับ{' '}
          <strong className="font-mono">ADMIN</strong> (อัปโหลด/ตั้งค่า/ยืนยันนำเข้า) และ{' '}
          <strong className="font-mono">SUPERVISOR</strong> (ตรวจสอบประวัติ/Preview/Export Error Report)
          สิทธิ์ปัจจุบันของคุณคือ <strong className="font-mono">{profile?.roleCode}</strong>
        </p>
      </div>
    );
  }

  const tabs: Array<{
    id: SapCenterTab;
    labelTh: string;
    labelEn: string;
    icon: React.ComponentType<{ className?: string }>;
    adminOnly?: boolean;
  }> = [
    { id: 'dashboard', labelTh: 'ภาพรวมการนำเข้า', labelEn: 'Dashboard', icon: LayoutDashboard },
    {
      id: 'upload',
      labelTh: 'อัปโหลด SAP Excel',
      labelEn: 'Upload Center',
      icon: UploadCloud,
      adminOnly: true,
    },
    { id: 'mappings', labelTh: 'Mapping Templates', labelEn: 'Templates', icon: Settings2 },
    { id: 'history', labelTh: 'ประวัติการนำเข้า', labelEn: 'Import History', icon: History },
    {
      id: 'reference-coils',
      labelTh: 'SAP Reference Coils',
      labelEn: 'Pending Inbound',
      icon: Database,
    },
  ];

  const visibleTabs = tabs.filter((t) => !t.adminOnly || isAdmin);

  return (
    <div className="space-y-5">
      {/* Header & Role Strip */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-md bg-[#0F172A] text-white flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              SAP Excel Import Center (Phase 4)
            </h2>
            <p className="text-xs text-slate-500 truncate">
              Manual Excel Export Upload Only · Leading-Zero Safe · Atomic SAP Reference Registration
            </p>
          </div>
        </div>
        {isSupervisor && (
          <div className="text-xs px-3 py-1.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-medium shrink-0">
            โหมดผู้จัดการคลัง (Read-Only / Audit View)
          </div>
        )}
      </div>

      {/* Workspace Sub-Navigation Tabs */}
      <div
        role="tablist"
        aria-label="SAP Excel Import Center Views"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200"
      >
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => {
                if (tab.id === 'upload') setResumedBatch(null);
                setActiveTab(tab.id);
              }}
              className={`min-h-[40px] px-3.5 py-2 rounded-t-md text-xs font-semibold flex items-center gap-2 whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                active
                  ? 'border-[#1D4ED8] text-[#1D4ED8] bg-white'
                  : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{tab.labelTh}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'dashboard' && (
          <SapImportDashboardTab
            mode="dashboard"
            isAdmin={isAdmin}
            refreshKey={combinedRefreshKey}
            onStartNewUpload={() => {
              setResumedBatch(null);
              setActiveTab('upload');
            }}
            onResumeBatch={(b) => {
              setResumedBatch(b);
              setActiveTab('upload');
            }}
            onRefreshRequested={() => setLocalRefreshKey((k) => k + 1)}
          />
        )}

        {activeTab === 'upload' && isAdmin && (
          <SapUploadWorkflowTab
            targetFields={targetFields}
            maxFileSizeMb={maxFileSizeMb}
            initialBatch={resumedBatch}
            onImportCompleted={() => setLocalRefreshKey((k) => k + 1)}
            onGoToReferenceCoils={() => setActiveTab('reference-coils')}
          />
        )}

        {activeTab === 'mappings' && (
          <SapMappingTemplatesTab isAdmin={isAdmin} targetFields={targetFields} />
        )}

        {activeTab === 'history' && (
          <SapImportDashboardTab
            mode="history"
            isAdmin={isAdmin}
            refreshKey={combinedRefreshKey}
            onStartNewUpload={() => {
              setResumedBatch(null);
              setActiveTab('upload');
            }}
            onResumeBatch={(b) => {
              setResumedBatch(b);
              setActiveTab('upload');
            }}
            onRefreshRequested={() => setLocalRefreshKey((k) => k + 1)}
          />
        )}

        {activeTab === 'reference-coils' && (
          <SapReferenceCoilsTab refreshKey={combinedRefreshKey} />
        )}
      </div>
    </div>
  );
}
