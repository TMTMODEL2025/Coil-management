import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Edit3, Plus, Star, Trash2, X } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import type {
  SapColumnMappingProfile,
  SapDateFormat,
  SapTargetFieldDef,
} from '../../types/sapImport';
import { formatBangkokDateTime } from './sapImportFormatters';

interface SapMappingTemplatesTabProps {
  isAdmin: boolean;
  targetFields: SapTargetFieldDef[];
}

export function SapMappingTemplatesTab({ isAdmin, targetFields }: SapMappingTemplatesTabProps) {
  const [mappings, setMappings] = useState<SapColumnMappingProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState<SapColumnMappingProfile | null>(null);
  const [creating, setCreating] = useState(false);

  // Form state
  const [profileName, setProfileName] = useState('');
  const [description, setDescription] = useState('');
  const [sheetNameHint, setSheetNameHint] = useState('');
  const [headerRowIndex, setHeaderRowIndex] = useState(1);
  const [dateFormat, setDateFormat] = useState<SapDateFormat>('AUTO');
  const [decimalSeparator, setDecimalSeparator] = useState<'.' | ','>('.');
  const [isDefault, setIsDefault] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [mappingJson, setMappingJson] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const loadMappings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ mappings: SapColumnMappingProfile[] }>('/api/sap-import/mappings');
      setMappings(res.mappings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลด Mapping Templates ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMappings();
  }, [loadMappings]);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setProfileName('');
    setDescription('');
    setSheetNameHint('');
    setHeaderRowIndex(1);
    setDateFormat('AUTO');
    setDecimalSeparator('.');
    setIsDefault(false);
    setIsActive(true);
    setMappingJson({
      coil_id: 'หมายเลขคอยล์',
      batch_number: 'Batch No.',
      material_code: 'Material No.',
      material_description: 'Description',
    });
  };

  const openEdit = (tpl: SapColumnMappingProfile) => {
    setCreating(false);
    setEditing(tpl);
    setProfileName(tpl.profileName);
    setDescription(tpl.description ?? '');
    setSheetNameHint(tpl.sheetNameHint ?? '');
    setHeaderRowIndex(tpl.headerRowIndex);
    setDateFormat(tpl.dateFormat);
    setDecimalSeparator(tpl.decimalSeparator === ',' ? ',' : '.');
    setIsDefault(tpl.isDefault);
    setIsActive(tpl.isActive);
    setMappingJson({ ...tpl.mappingJson });
  };

  const closeModal = () => {
    setCreating(false);
    setEditing(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);

    const cleanedMapping: Record<string, string> = {};
    for (const [k, v] of Object.entries(mappingJson)) {
      if (v.trim()) cleanedMapping[k] = v.trim();
    }

    try {
      if (editing) {
        await apiFetch(`/api/sap-import/mappings/${editing.id}`, {
          method: 'PATCH',
          body: {
            profileName,
            description: description.trim() || null,
            sheetNameHint: sheetNameHint.trim() || null,
            headerRowIndex,
            dateFormat,
            decimalSeparator,
            isDefault,
            isActive,
            mappingJson: cleanedMapping,
          },
        });
        setNotice(`อัปเดต Template "${profileName}" เรียบร้อยแล้ว`);
      } else {
        await apiFetch('/api/sap-import/mappings', {
          method: 'POST',
          body: {
            profileName,
            description: description.trim() || null,
            sheetNameHint: sheetNameHint.trim() || null,
            headerRowIndex,
            dateFormat,
            decimalSeparator,
            isDefault,
            isActive,
            mappingJson: cleanedMapping,
          },
        });
        setNotice(`สร้าง Template "${profileName}" เรียบร้อยแล้ว`);
      }
      closeModal();
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถบันทึก Template ได้');
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (tpl: SapColumnMappingProfile) => {
    setError(null);
    try {
      await apiFetch(`/api/sap-import/mappings/${tpl.id}`, {
        method: 'PATCH',
        body: { isDefault: true, isActive: true },
      });
      setNotice(`ตั้งค่า "${tpl.profileName}" เป็น Default Template แล้ว`);
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถตั้งค่า Default ได้');
    }
  };

  const handleDelete = async (tpl: SapColumnMappingProfile) => {
    setError(null);
    try {
      await apiFetch(`/api/sap-import/mappings/${tpl.id}`, { method: 'DELETE' });
      setNotice(`ลบ Template "${tpl.profileName}" เรียบร้อยแล้ว`);
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถลบ Template ได้');
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            แม่แบบการจับคู่คอลัมน์ SAP Excel (Column Mapping Templates)
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            จัดการโปรไฟล์การจับคู่หัวคอลัมน์จากรายงาน SAP เพื่อนำกลับมาใช้ซ้ำได้อย่างแม่นยำ (รองรับทั้งภาษาไทยและ SAP S/4HANA)
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={openCreate}
            className="min-h-[38px] px-4 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>สร้าง Template ใหม่</span>
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-md px-4 py-3 text-xs text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 rounded-md px-4 py-3 text-xs text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-lg p-10 text-center text-xs text-slate-500">
          กำลังโหลดรายการ Mapping Templates...
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {mappings.map((tpl) => {
            const entries = Object.entries(tpl.mappingJson || {});
            return (
              <div
                key={tpl.id}
                className={`bg-white border rounded-lg p-4 space-y-3 ${
                  tpl.isDefault ? 'border-blue-300 ring-1 ring-blue-100' : 'border-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-slate-900">{tpl.profileName}</h3>
                      {tpl.isDefault && (
                        <span className="px-2 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 font-mono text-[10px] font-semibold">
                          DEFAULT
                        </span>
                      )}
                      {!tpl.isActive && (
                        <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-600 font-mono text-[10px]">
                          INACTIVE
                        </span>
                      )}
                    </div>
                    {tpl.description && (
                      <p className="text-xs text-slate-600 mt-1">{tpl.description}</p>
                    )}
                  </div>

                  {isAdmin && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {!tpl.isDefault && (
                        <button
                          type="button"
                          onClick={() => void handleSetDefault(tpl)}
                          title="ตั้งเป็น Default"
                          className="min-h-[32px] px-2 py-1 rounded border border-slate-200 hover:bg-amber-50 text-slate-600 hover:text-amber-700 cursor-pointer"
                        >
                          <Star className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => openEdit(tpl)}
                        title="แก้ไข Template"
                        className="min-h-[32px] px-2.5 py-1 rounded border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs inline-flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>แก้ไข</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(tpl)}
                        title="ลบ Template"
                        className="min-h-[32px] px-2 py-1 rounded border border-red-200 hover:bg-red-50 text-red-700 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-500">
                  <span>Header Row: {tpl.headerRowIndex}</span>
                  <span>·</span>
                  <span>Date: {tpl.dateFormat}</span>
                  <span>·</span>
                  <span>Decimal: "{tpl.decimalSeparator}"</span>
                  <span>·</span>
                  <span>{entries.length} Mapped Fields</span>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-md p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px]">
                  {entries.map(([target, src]) => (
                    <div key={target} className="flex items-center justify-between gap-2 px-1.5 py-0.5">
                      <span className="font-mono text-slate-500 truncate">{target}</span>
                      <span className="font-mono font-medium text-slate-900 truncate">→ {src}</span>
                    </div>
                  ))}
                </div>

                <div className="text-[11px] text-slate-400 font-mono">
                  อัปเดตล่าสุด: {formatBangkokDateTime(tpl.updatedAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      {(creating || editing) && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={editing ? 'แก้ไข Mapping Template' : 'สร้าง Mapping Template ใหม่'}
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="bg-white border border-slate-200 rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-3.5 bg-[#0F172A] text-white flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                {editing ? `แก้ไข Template: ${editing.profileName}` : 'สร้าง Mapping Template ใหม่'}
              </h3>
              <button
                type="button"
                aria-label="ปิดหน้าต่าง"
                onClick={closeModal}
                className="min-h-[34px] min-w-[34px] rounded hover:bg-slate-800 flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">ชื่อ Template *</label>
                  <input
                    type="text"
                    required
                    value={profileName}
                    onChange={(e) => setProfileName(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-md border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">คำอธิบาย</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full min-h-[38px] px-3 rounded-md border border-slate-300"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Header Row Index</label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={headerRowIndex}
                    onChange={(e) => setHeaderRowIndex(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full min-h-[38px] px-3 rounded-md border border-slate-300 font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Date Format</label>
                  <select
                    value={dateFormat}
                    onChange={(e) => setDateFormat(e.target.value as SapDateFormat)}
                    className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white font-mono"
                  >
                    <option value="AUTO">AUTO</option>
                    <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                    <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                    <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isDefault}
                    onChange={(e) => setIsDefault(e.target.checked)}
                  />
                  <span className="font-medium text-slate-800">ตั้งเป็น Default Template</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                  />
                  <span className="font-medium text-slate-800">เปิดใช้งาน (Active)</span>
                </label>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="font-semibold text-slate-900 mb-2">
                  ระบุชื่อหัวคอลัมน์ในไฟล์ Excel สำหรับแต่ละฟิลด์ WMS
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {targetFields.map((f) => (
                    <div key={f.key}>
                      <label className="block text-[11px] font-medium text-slate-700 mb-1">
                        {f.labelTh}{' '}
                        <span className="font-mono text-slate-400">({f.key})</span>
                        {f.required && <span className="text-red-600 ml-1">*</span>}
                      </label>
                      <input
                        type="text"
                        value={mappingJson[f.key] ?? ''}
                        onChange={(e) =>
                          setMappingJson((prev) => ({ ...prev, [f.key]: e.target.value }))
                        }
                        placeholder="ชื่อหัวคอลัมน์ในไฟล์ Excel"
                        className="w-full min-h-[34px] px-2.5 rounded border border-slate-300 font-mono text-xs"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={closeModal}
                className="min-h-[38px] px-4 rounded-md border border-slate-300 bg-white text-xs font-medium cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[38px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {saving ? 'กำลังบันทึก...' : 'บันทึก Template'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
