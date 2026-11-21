import { useState } from 'react';
import { ArrowDownToLine, Eye, History } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import type { NavSectionId } from '../../types/wms';
import { InboundBatchWorkflowTab } from './InboundBatchWorkflowTab';
import { InboundHistoryTab } from './InboundHistoryTab';

interface InboundReceivingViewProps {
  onNavigate: (section: NavSectionId) => void;
  onOpenLocationIn3D?: (locationCode: string) => void;
}

type InboundTabId = 'workflow' | 'history';

export function InboundReceivingView({
  onNavigate,
  onOpenLocationIn3D,
}: InboundReceivingViewProps) {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<InboundTabId>('workflow');

  const roleCode = profile?.roleCode ?? 'VIEWER';
  const canWrite = roleCode === 'ADMIN' || roleCode === 'SUPERVISOR' || roleCode === 'OPERATOR';
  const canOverride = roleCode === 'ADMIN' || roleCode === 'SUPERVISOR';

  return (
    <div className="space-y-5">
      {/* Header + Sub-tabs */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-[11px] font-mono font-semibold text-[#1D4ED8] uppercase tracking-wider">
            Phase 5 · Batch-First Inbound Receiving &amp; Auto Location Allocation
          </div>
          <h2 className="text-lg font-bold text-slate-900 mt-0.5">
            รับสินค้าเหล็กม้วนเข้าคลัง (Batch-First Workflow)
          </h2>
        </div>

        <div role="tablist" aria-label="Inbound Receiving Sections" className="flex items-center gap-2">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'workflow'}
            onClick={() => setActiveTab('workflow')}
            className={`min-h-[40px] px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${
              activeTab === 'workflow'
                ? 'bg-[#1D4ED8] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <ArrowDownToLine className="w-4 h-4" aria-hidden="true" />
            <span>รับสินค้าเข้าคลัง (Scan Batch)</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'history'}
            onClick={() => setActiveTab('history')}
            className={`min-h-[40px] px-4 py-2 rounded-md text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${
              activeTab === 'history'
                ? 'bg-[#1D4ED8] text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            <History className="w-4 h-4" aria-hidden="true" />
            <span>ประวัติการรับเข้า</span>
          </button>
        </div>
      </div>

      {/* Read-only notice for VIEWER role */}
      {!canWrite && (
        <div
          role="status"
          className="bg-slate-100 border border-slate-300 rounded-lg px-4 py-3 text-xs text-slate-700 flex items-center gap-2"
        >
          <Eye className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          <span>
            บัญชีของคุณมีสิทธิ์ <strong>VIEWER (อ่านอย่างเดียว)</strong> — สามารถค้นหา Batch และดูประวัติการรับเข้าได้
            แต่ไม่สามารถจองตำแหน่งหรือยืนยันรับเข้าคลังได้
          </span>
        </div>
      )}

      {activeTab === 'workflow' ? (
        <InboundBatchWorkflowTab
          onNavigate={onNavigate}
          onOpenLocationIn3D={onOpenLocationIn3D}
          canWrite={canWrite}
          canOverride={canOverride}
        />
      ) : (
        <InboundHistoryTab />
      )}
    </div>
  );
}
