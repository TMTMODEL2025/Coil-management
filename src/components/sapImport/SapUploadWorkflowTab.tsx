import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  Save,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  XCircle,
} from 'lucide-react';
import { apiDownloadBlob, apiFetch, apiUpload } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import type {
  SapColumnMappingProfile,
  SapDateFormat,
  SapImportBatchSummary,
  SapImportMode,
  SapTargetFieldDef,
  SapValidationErrorItem,
  SapWorksheetInspectResponse,
} from '../../types/sapImport';
import {
  formatFileSize,
  generateIdempotencyKey,
  getSeverityBadgeClass,
} from './sapImportFormatters';
import { SapBatchPreviewPanel } from './SapBatchPreviewPanel';

interface SapUploadWorkflowTabProps {
  targetFields: SapTargetFieldDef[];
  maxFileSizeMb: number;
  initialBatch?: SapImportBatchSummary | null;
  onImportCompleted: () => void;
  onGoToReferenceCoils: () => void;
}

const STEPS = [
  { num: 1, titleTh: 'อัปโหลดไฟล์', titleEn: 'Upload' },
  { num: 2, titleTh: 'เลือก Sheet / Header', titleEn: 'Worksheet' },
  { num: 3, titleTh: 'จับคู่คอลัมน์', titleEn: 'Column Mapping' },
  { num: 4, titleTh: 'ผลตรวจสอบ', titleEn: 'Validation' },
  { num: 5, titleTh: 'Preview & ยืนยัน', titleEn: 'Confirm Import' },
] as const;

export function SapUploadWorkflowTab({
  targetFields,
  maxFileSizeMb,
  initialBatch,
  onImportCompleted,
  onGoToReferenceCoils,
}: SapUploadWorkflowTabProps) {
  const { lastRealtimeEvent } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [dragging, setDragging] = useState(false);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [infoNotice, setInfoNotice] = useState<string | null>(null);

  const [inspectData, setInspectData] = useState<SapWorksheetInspectResponse | null>(null);
  const [activeBatch, setActiveBatch] = useState<SapImportBatchSummary | null>(null);

  // Step 2 state
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headerRowIndex, setHeaderRowIndex] = useState(1);

  // Step 3 state
  const [templates, setTemplates] = useState<SapColumnMappingProfile[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dateFormat, setDateFormat] = useState<SapDateFormat>('AUTO');
  const [decimalSeparator, setDecimalSeparator] = useState<'.' | ','>('.');

  // Save template inline modal
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateDesc, setNewTemplateDesc] = useState('');
  const [newTemplateDefault, setNewTemplateDefault] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Step 4 state
  const [validationErrors, setValidationErrors] = useState<SapValidationErrorItem[]>([]);
  const [errorSeverityFilter, setErrorSeverityFilter] = useState<string>('ALL');

  // Step 5 state
  const [importMode, setImportMode] = useState<SapImportMode>('STRICT');
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [liveProgress, setLiveProgress] = useState<number>(0);
  const [confirmOutcome, setConfirmOutcome] = useState<{
    importedCount: number;
    reconciledCount: number;
    skippedCount: number;
    idempotentReplay: boolean;
    safetySnapshot: {
      activeInventoryCount: number;
      occupiedLocationCount: number;
      activeReservationCount: number;
      stockTransactionCount: number;
    };
  } | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  const loadTemplates = useCallback(async () => {
    try {
      const res = await apiFetch<{ mappings: SapColumnMappingProfile[] }>('/api/sap-import/mappings');
      setTemplates(res.mappings);
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  // Listen for live SSE progress events for this batch
  useEffect(() => {
    if (!lastRealtimeEvent || !activeBatch) return;
    if (
      lastRealtimeEvent.type === 'SAP_IMPORT_PROGRESS' &&
      lastRealtimeEvent.payload.batchId === activeBatch.id &&
      typeof lastRealtimeEvent.payload.percent === 'number'
    ) {
      setLiveProgress(lastRealtimeEvent.payload.percent);
    }
  }, [lastRealtimeEvent, activeBatch]);

  // Resume an existing unconfirmed batch when clicked from Dashboard / History
  useEffect(() => {
    if (!initialBatch) return;
    let active = true;
    const resume = async () => {
      setError(null);
      setConfirmOutcome(null);
      setBusyMessage(`กำลังโหลด Batch ${initialBatch.batchCode}...`);
      try {
        const res = await apiFetch<SapWorksheetInspectResponse>(
          `/api/sap-import/batches/${initialBatch.id}/inspect`
        );
        if (!active) return;
        setInspectData(res);
        setActiveBatch(res.batch);
        setSelectedSheet(res.selectedSheet);
        setHeaderRowIndex(res.headerRowIndex);
        setMapping(
          Object.keys(res.batch.appliedMapping || {}).length > 0
            ? res.batch.appliedMapping
            : res.suggestedMapping
        );
        setDateFormat(res.batch.dateFormat || 'AUTO');
        setIdempotencyKey(generateIdempotencyKey(res.batch.id));
        if (res.batch.status === 'READY_TO_IMPORT') {
          const errRes = await apiFetch<{ errors: SapValidationErrorItem[] }>(
            `/api/sap-import/batches/${res.batch.id}/errors`
          );
          if (!active) return;
          setValidationErrors(errRes.errors);
          setStep(5);
        } else {
          setStep(2);
        }
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'ไม่สามารถโหลด Batch ต่อได้');
      } finally {
        if (active) setBusyMessage(null);
      }
    };
    void resume();
    return () => {
      active = false;
    };
  }, [initialBatch]);

  const handleFileUpload = async (file: File) => {
    setError(null);
    setInfoNotice(null);
    setConfirmOutcome(null);

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      setError('รองรับเฉพาะไฟล์ .xlsx, .xls และ .csv เท่านั้น');
      return;
    }
    if (file.size > maxFileSizeMb * 1024 * 1024) {
      setError(`ขนาดไฟล์เกินกำหนดสูงสุด (${maxFileSizeMb} MB)`);
      return;
    }

    setBusyMessage(`กำลังอัปโหลดและตรวจสอบความปลอดภัยไฟล์ "${file.name}"...`);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiUpload<SapWorksheetInspectResponse>('/api/sap-import/upload', formData);
      setInspectData(res);
      setActiveBatch(res.batch);
      setSelectedSheet(res.selectedSheet);
      setHeaderRowIndex(res.headerRowIndex);
      setMapping(res.suggestedMapping);
      setDateFormat(res.batch.dateFormat || 'AUTO');
      setSelectedTemplateId(res.batch.mappingId ? String(res.batch.mappingId) : '');
      setIdempotencyKey(generateIdempotencyKey(res.batch.id));
      setValidationErrors([]);
      setLiveProgress(0);
      setStep(2);
      onImportCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'การอัปโหลดไฟล์ไม่สำเร็จ');
    } finally {
      setBusyMessage(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePreviewWorksheetChange = async (nextSheet: string, nextHeaderRow: number) => {
    if (!activeBatch) return;
    setSelectedSheet(nextSheet);
    setHeaderRowIndex(nextHeaderRow);
    setBusyMessage('กำลังอ่านโครงสร้าง Worksheet และ Header Row...');
    setError(null);
    try {
      const qs = new URLSearchParams({
        sheetName: nextSheet,
        headerRowIndex: String(nextHeaderRow),
      });
      const res = await apiFetch<SapWorksheetInspectResponse>(
        `/api/sap-import/batches/${activeBatch.id}/inspect?${qs.toString()}`
      );
      setInspectData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถอ่าน Worksheet ได้');
    } finally {
      setBusyMessage(null);
    }
  };

  const handleConfirmWorksheet = async () => {
    if (!activeBatch) return;
    setBusyMessage('กำลังบันทึก Worksheet & Header Row และทำ Auto-Mapping...');
    setError(null);
    try {
      const res = await apiFetch<SapWorksheetInspectResponse>(
        `/api/sap-import/batches/${activeBatch.id}/worksheet`,
        {
          method: 'PATCH',
          body: { sheetName: selectedSheet, headerRowIndex },
        }
      );
      setInspectData(res);
      setActiveBatch(res.batch);
      setMapping(res.suggestedMapping);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถบันทึกการเลือก Worksheet ได้');
    } finally {
      setBusyMessage(null);
    }
  };

  const handleApplyTemplate = async (templateIdStr: string) => {
    setSelectedTemplateId(templateIdStr);
    if (!templateIdStr || !activeBatch) return;
    const tpl = templates.find((t) => String(t.id) === templateIdStr);
    if (!tpl) return;

    setDateFormat(tpl.dateFormat || 'AUTO');
    setDecimalSeparator(tpl.decimalSeparator === ',' ? ',' : '.');
    setBusyMessage(`กำลังใช้ Template "${tpl.profileName}"...`);
    try {
      const qs = new URLSearchParams({
        sheetName: selectedSheet,
        headerRowIndex: String(headerRowIndex),
        mappingId: String(tpl.id),
      });
      const res = await apiFetch<SapWorksheetInspectResponse>(
        `/api/sap-import/batches/${activeBatch.id}/inspect?${qs.toString()}`
      );
      setInspectData(res);
      setMapping(res.suggestedMapping);
      setInfoNotice(`โหลด Mapping Template "${tpl.profileName}" เรียบร้อยแล้ว`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถโหลด Template ได้');
    } finally {
      setBusyMessage(null);
    }
  };

  const handleSaveAsTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim()) return;
    setSavingTemplate(true);
    setError(null);
    try {
      const res = await apiFetch<{ mapping: SapColumnMappingProfile }>('/api/sap-import/mappings', {
        method: 'POST',
        body: {
          profileName: newTemplateName.trim(),
          description: newTemplateDesc.trim() || null,
          sheetNameHint: selectedSheet || null,
          headerRowIndex,
          mappingJson: mapping,
          dateFormat,
          decimalSeparator,
          isActive: true,
          isDefault: newTemplateDefault,
        },
      });
      setShowSaveTemplate(false);
      setNewTemplateName('');
      setNewTemplateDesc('');
      setNewTemplateDefault(false);
      setSelectedTemplateId(String(res.mapping.id));
      setInfoNotice(`บันทึก Mapping Template "${res.mapping.profileName}" สำเร็จ`);
      await loadTemplates();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถบันทึก Mapping Template ได้');
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleRunValidation = async () => {
    if (!activeBatch) return;
    if (!mapping.coil_id || !mapping.batch_number) {
      setError('กรุณาจับคู่คอลัมน์บังคับ หมายเลขคอยล์ (Coil ID) และ เลขที่ Batch (Batch No.) ก่อนตรวจสอบ');
      return;
    }

    setBusyMessage('กำลังตรวจสอบข้อมูล, Leading Zeros, และตรวจจับข้อมูลซ้ำ 3 ระดับกับฐานข้อมูล...');
    setError(null);
    setInfoNotice(null);
    try {
      const res = await apiFetch<{ batch: SapImportBatchSummary }>(
        `/api/sap-import/batches/${activeBatch.id}/validate`,
        {
          method: 'POST',
          body: {
            mapping,
            mappingId: selectedTemplateId ? Number(selectedTemplateId) : null,
            dateFormat,
            decimalSeparator,
          },
        }
      );
      setActiveBatch(res.batch);
      setIdempotencyKey(generateIdempotencyKey(res.batch.id));
      const errRes = await apiFetch<{ errors: SapValidationErrorItem[] }>(
        `/api/sap-import/batches/${activeBatch.id}/errors`
      );
      setValidationErrors(errRes.errors);
      setPreviewRefreshKey((k) => k + 1);
      setStep(4);
      onImportCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'การตรวจสอบข้อมูล (Validation) ไม่สำเร็จ');
    } finally {
      setBusyMessage(null);
    }
  };

  const handleConfirmImport = async () => {
    if (!activeBatch) return;
    setShowConfirmModal(false);
    setBusyMessage('กำลังยืนยันนำเข้า SAP Reference Coils (Atomic Transaction — Zero Inventory Impact)...');
    setError(null);
    setLiveProgress(15);
    try {
      const res = await apiFetch<{
        batch: SapImportBatchSummary;
        idempotentReplay: boolean;
        importedCount: number;
        reconciledCount?: number;
        skippedCount: number;
        safetySnapshot: {
          activeInventoryCount: number;
          occupiedLocationCount: number;
          activeReservationCount: number;
          stockTransactionCount: number;
        };
      }>(`/api/sap-import/batches/${activeBatch.id}/confirm`, {
        method: 'POST',
        body: {
          importMode,
          idempotencyKey: idempotencyKey || generateIdempotencyKey(activeBatch.id),
        },
      });
      setActiveBatch(res.batch);
      setLiveProgress(100);
      setConfirmOutcome({
        importedCount: res.importedCount,
        reconciledCount: res.reconciledCount ?? 0,
        skippedCount: res.skippedCount,
        idempotentReplay: res.idempotentReplay,
        safetySnapshot: res.safetySnapshot,
      });
      setPreviewRefreshKey((k) => k + 1);
      onImportCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'การยืนยันนำเข้าไม่สำเร็จ');
    } finally {
      setBusyMessage(null);
    }
  };

  const handleCancelBatch = async () => {
    if (!activeBatch) return;
    setBusyMessage('กำลังยกเลิก Batch และล้างไฟล์ชั่วคราว...');
    setError(null);
    try {
      await apiFetch(`/api/sap-import/batches/${activeBatch.id}/cancel`, { method: 'POST' });
      setActiveBatch(null);
      setInspectData(null);
      setValidationErrors([]);
      setConfirmOutcome(null);
      setStep(1);
      setInfoNotice('ยกเลิก Import Batch และลบไฟล์ชั่วคราวเรียบร้อยแล้ว');
      onImportCompleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถยกเลิก Batch ได้');
    } finally {
      setBusyMessage(null);
    }
  };

  const handleExportErrorReport = async (format: 'csv' | 'xlsx') => {
    if (!activeBatch) return;
    try {
      await apiDownloadBlob(
        `/api/sap-import/batches/${activeBatch.id}/error-report?format=${format}`,
        `${activeBatch.batchCode}_error_report.${format}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ไม่สามารถดาวน์โหลด Error Report ได้');
    }
  };

  const filteredErrors = validationErrors.filter(
    (e) => errorSeverityFilter === 'ALL' || e.severity === errorSeverityFilter
  );

  const isCompletedBatch =
    activeBatch && ['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(activeBatch.status);

  const strictBlocked =
    Boolean(activeBatch) && importMode === 'STRICT' && (activeBatch?.errorRows ?? 0) > 0;

  return (
    <div className="space-y-5">
      {/* 5-Step Progress Stepper */}
      <nav aria-label="SAP Excel Import Steps" className="bg-white border border-slate-200 rounded-lg p-3.5">
        <ol className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {STEPS.map((s) => {
            const isCurrent = step === s.num;
            const isDone = step > s.num || (s.num === 5 && Boolean(isCompletedBatch));
            const clickable =
              (s.num === 1 && !busyMessage) ||
              (s.num === 2 && Boolean(inspectData) && !isCompletedBatch) ||
              (s.num === 3 && Boolean(inspectData) && !isCompletedBatch) ||
              (s.num === 4 &&
                Boolean(activeBatch) &&
                ['READY_TO_IMPORT', 'COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(
                  activeBatch!.status
                )) ||
              (s.num === 5 &&
                Boolean(activeBatch) &&
                ['READY_TO_IMPORT', 'COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(
                  activeBatch!.status
                ));

            return (
              <li key={s.num}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && setStep(s.num as 1 | 2 | 3 | 4 | 5)}
                  className={`w-full text-left px-3 py-2 rounded-md border transition-colors flex items-center gap-2.5 ${
                    isCurrent
                      ? 'bg-[#0F172A] text-white border-[#0F172A]'
                      : isDone
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-200 hover:bg-emerald-100/70'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                  } ${clickable ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'}`}
                >
                  <span
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-mono font-bold shrink-0 ${
                      isCurrent
                        ? 'bg-[#1D4ED8] text-white'
                        : isDone
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {isDone ? '✓' : s.num}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold truncate">{s.titleTh}</div>
                    <div
                      className={`text-[10px] truncate ${
                        isCurrent ? 'text-slate-300' : 'text-slate-500'
                      }`}
                    >
                      {s.titleEn}
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* Active Batch Context Bar */}
      {activeBatch && (
        <div className="bg-slate-900 text-slate-100 rounded-lg px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-mono font-semibold text-blue-300">{activeBatch.batchCode}</span>
            <span className="text-slate-500">|</span>
            <span className="font-medium truncate max-w-[260px]">{activeBatch.fileName}</span>
            <span className="text-slate-500">|</span>
            <span className="font-mono text-slate-300">
              Sheet: {activeBatch.sheetName} (Header Row {activeBatch.headerRowIndex})
            </span>
            <span className="text-slate-500">|</span>
            <span className="font-mono text-slate-300">
              {formatFileSize(activeBatch.fileSizeBytes)}
            </span>
          </div>
          {!isCompletedBatch && (
            <button
              type="button"
              disabled={Boolean(busyMessage)}
              onClick={() => void handleCancelBatch()}
              className="px-2.5 py-1 rounded border border-red-400/50 text-red-200 hover:bg-red-950/60 text-[11px] font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>ยกเลิก Batch นี้</span>
            </button>
          )}
        </div>
      )}

      {/* Busy / Error / Info Feedback */}
      {busyMessage && (
        <div
          role="status"
          className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center gap-3 text-xs text-blue-900"
        >
          <Loader2 className="w-4 h-4 animate-spin text-blue-700 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <div className="font-medium">{busyMessage}</div>
            {liveProgress > 0 && liveProgress < 100 && (
              <div className="mt-2 h-1.5 w-full bg-blue-200 rounded overflow-hidden">
                <div
                  className="h-full bg-[#1D4ED8] transition-all"
                  style={{ width: `${liveProgress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-xs text-red-900 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {infoNotice && (
        <div role="status" className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 text-xs text-emerald-900 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
          <span>{infoNotice}</span>
        </div>
      )}

      {/* =================================================================== */}
      {/* STEP 1: FILE UPLOAD ZONE */}
      {/* =================================================================== */}
      {step === 1 && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              ขั้นตอนที่ 1: อัปโหลดไฟล์ SAP Excel (.xlsx, .xls, .csv)
            </h2>
            <p className="text-xs text-slate-600 mt-1">
              ส่งออกไฟล์จาก SAP S/4HANA ด้วยตนเอง แล้วนำเข้าผ่านหน้าจอนี้ ระบบตรวจสอบลายเซ็นไฟล์
              (Magic Bytes), ป้องกัน ZIP Bomb / Macro และรักษาเลขศูนย์นำหน้า (Leading Zeros) ทุกฟิลด์รหัส
            </p>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void handleFileUpload(f);
            }}
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
              dragging
                ? 'border-[#1D4ED8] bg-blue-50/70'
                : 'border-slate-300 bg-slate-50/70 hover:border-slate-400'
            }`}
          >
            <UploadCloud className="w-10 h-10 text-[#1D4ED8] mx-auto" aria-hidden="true" />
            <div className="mt-3 text-sm font-semibold text-slate-900">
              ลากไฟล์ SAP Excel มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์
            </div>
            <div className="mt-1 text-xs text-slate-500">
              รองรับ <span className="font-mono font-medium">.xlsx</span>,{' '}
              <span className="font-mono font-medium">.xls</span> และ{' '}
              <span className="font-mono font-medium">.csv</span> · ขนาดสูงสุด{' '}
              <span className="font-mono font-medium">{maxFileSizeMb} MB</span> · ไม่อนุญาตไฟล์ที่มี Macro (.xlsm)
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFileUpload(f);
              }}
            />
            <button
              type="button"
              disabled={Boolean(busyMessage)}
              onClick={() => fileInputRef.current?.click()}
              className="mt-5 min-h-[42px] px-5 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <FileSpreadsheet className="w-4 h-4" aria-hidden="true" />
              <span>เลือกไฟล์จากเครื่อง (Browse File)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-md border border-slate-200 bg-slate-50">
              <div className="font-semibold text-slate-900">รองรับคอลัมน์ SAP ของ TMT อัตโนมัติ</div>
              <p className="mt-1 text-slate-600">
                รองรับทั้งหัวคอลัมน์ภาษาไทย/อังกฤษ เช่น{' '}
                <span className="font-mono">หมายเลขคอยล์</span>,{' '}
                <span className="font-mono">Batch No.</span>,{' '}
                <span className="font-mono">Material No.</span>,{' '}
                <span className="font-mono">น้ำหนัก (Unrestr.)</span>,{' '}
                <span className="font-mono">นน. ชั่งจริง</span>,{' '}
                <span className="font-mono">HEAT NO.</span>
              </p>
            </div>
            <div className="p-3.5 rounded-md border border-slate-200 bg-slate-50">
              <div className="font-semibold text-slate-900">รักษาเลขศูนย์นำหน้า (Leading Zeros)</div>
              <p className="mt-1 text-slate-600">
                รหัส Batch เช่น <span className="font-mono">011P066118</span>,{' '}
                <span className="font-mono">031D140772</span>, Coil ID และ Material No.
                ถูกจัดเก็บเป็น TEXT เสมอ ไม่ตัดเลข 0 ออก
              </p>
            </div>
            <div className="p-3.5 rounded-md border border-emerald-200 bg-emerald-50/60">
              <div className="font-semibold text-emerald-950">ความปลอดภัยต่อสต็อกจริง 100%</div>
              <p className="mt-1 text-emerald-900">
                ข้อมูลที่นำเข้าจะถูกบันทึกเป็น SAP Reference (PENDING_INBOUND) เท่านั้น
                ไม่สร้าง Active Inventory และไม่เปลี่ยนสถานะ Storage Location ใดๆ
              </p>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STEP 2: WORKSHEET & HEADER ROW SELECTION */}
      {/* =================================================================== */}
      {step === 2 && inspectData && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                ขั้นตอนที่ 2: เลือก Worksheet และแถวหัวตาราง (Header Row)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                รองรับไฟล์ที่มีหลาย Worksheet หรือไฟล์ที่มีหัวรายงาน (Banner Rows) อยู่เหนือหัวตาราง
              </p>
            </div>
            <button
              type="button"
              disabled={Boolean(busyMessage)}
              onClick={() => void handleConfirmWorksheet()}
              className="min-h-[40px] px-4 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <span>ใช้ Sheet &amp; Header นี้ ไปจับคู่คอลัมน์</span>
              <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="sap-worksheet-select"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                เลือก Worksheet ({inspectData.worksheets.length} ชีตที่พบ)
              </label>
              <select
                id="sap-worksheet-select"
                value={selectedSheet}
                onChange={(e) => {
                  const chosen = inspectData.worksheets.find((w) => w.name === e.target.value);
                  void handlePreviewWorksheetChange(
                    e.target.value,
                    chosen?.detectedHeaderRow ?? 1
                  );
                }}
                className="w-full min-h-[40px] px-3 rounded-md border border-slate-300 text-xs bg-white font-mono"
              >
                {inspectData.worksheets.map((ws) => (
                  <option key={ws.name} value={ws.name}>
                    {ws.name}
                    {ws.isHidden ? ' [ชีตซ่อนใน Excel]' : ''} ({ws.dataRowCount ?? ws.rowCount} รายการข้อมูล · Header Row{' '}
                    {ws.detectedHeaderRow})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="sap-header-row-input"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                หมายเลขแถวหัวตาราง (Header Row Index — นับจากแถวที่ 1)
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="sap-header-row-input"
                  type="number"
                  min={1}
                  max={50}
                  value={headerRowIndex}
                  onChange={(e) => {
                    const num = Math.max(1, Number(e.target.value) || 1);
                    setHeaderRowIndex(num);
                  }}
                  className="w-28 min-h-[40px] px-3 rounded-md border border-slate-300 text-xs font-mono"
                />
                <button
                  type="button"
                  onClick={() => void handlePreviewWorksheetChange(selectedSheet, headerRowIndex)}
                  className="min-h-[40px] px-3.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer"
                >
                  อัปเดตตัวอย่าง
                </button>
              </div>
            </div>
          </div>

          {/* Raw Top-15 Rows Preview */}
          <div>
            <div className="text-xs font-semibold text-slate-800 mb-2">
              ตัวอย่าง 15 แถวแรกของ Worksheet "{selectedSheet}" (คลิกที่แถวเพื่อกำหนดเป็น Header Row)
            </div>
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <tbody className="divide-y divide-slate-100">
                  {inspectData.rawPreviewRows.map((row) => {
                    const isHeader = row.rowNumber === headerRowIndex;
                    return (
                      <tr
                        key={row.rowNumber}
                        onClick={() => void handlePreviewWorksheetChange(selectedSheet, row.rowNumber)}
                        className={`cursor-pointer ${
                          isHeader
                            ? 'bg-blue-50 font-semibold text-blue-950'
                            : row.rowNumber < headerRowIndex
                              ? 'bg-slate-50 text-slate-400'
                              : 'hover:bg-slate-50 text-slate-800'
                        }`}
                      >
                        <td className="py-2 px-3 font-mono tabular-nums border-r border-slate-200 whitespace-nowrap w-24">
                          Row {row.rowNumber} {isHeader && <span className="text-blue-700">★ Header</span>}
                        </td>
                        {row.values.slice(0, 12).map((val, idx) => (
                          <td
                            key={idx}
                            className="py-2 px-2.5 border-r border-slate-100 max-w-[180px] truncate font-mono"
                            title={val}
                          >
                            {val || <span className="text-slate-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STEP 3: COLUMN MAPPING ENGINE */}
      {/* =================================================================== */}
      {step === 3 && inspectData && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                ขั้นตอนที่ 3: จับคู่คอลัมน์ SAP Excel กับฟิลด์ระบบ WMS (Column Mapping)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                ตรวจสอบการจับคู่คอลัมน์อัตโนมัติ (Auto-Map), โหลดหรือบันทึก Template
                และกำหนดรูปแบบวันที่ก่อนกด Validate
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ย้อนกลับ</span>
              </button>
              <button
                type="button"
                onClick={() => setShowSaveTemplate((v) => !v)}
                className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" aria-hidden="true" />
                <span>บันทึกเป็น Template</span>
              </button>
              <button
                type="button"
                disabled={Boolean(busyMessage)}
                onClick={() => void handleRunValidation()}
                className="min-h-[38px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>ตรวจสอบข้อมูล (Run Validation)</span>
              </button>
            </div>
          </div>

          {/* Template Loader & Date/Decimal Options */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
            <div>
              <label
                htmlFor="sap-template-select"
                className="block text-[11px] font-semibold text-slate-700 mb-1"
              >
                โหลด Mapping Template ที่บันทึกไว้
              </label>
              <select
                id="sap-template-select"
                value={selectedTemplateId}
                onChange={(e) => void handleApplyTemplate(e.target.value)}
                className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white text-xs"
              >
                <option value="">-- Auto-Mapped (ค่าแนะนำอัตโนมัติ) --</option>
                {templates
                  .filter((t) => t.isActive)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.profileName} {t.isDefault ? '(Default)' : ''}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="sap-date-format-select"
                className="block text-[11px] font-semibold text-slate-700 mb-1"
              >
                รูปแบบวันที่ในไฟล์ SAP (Date Format)
              </label>
              <select
                id="sap-date-format-select"
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value as SapDateFormat)}
                className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white text-xs font-mono"
              >
                <option value="AUTO">AUTO (แจ้งเตือนเมื่อวันที่กำกวม ไม่เดาเอง)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (รูปแบบ SAP ไทย/ยุโรป)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (รูปแบบ US)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (ISO Standard)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="sap-decimal-sep-select"
                className="block text-[11px] font-semibold text-slate-700 mb-1"
              >
                ตัวคั่นทศนิยม (Decimal Separator)
              </label>
              <select
                id="sap-decimal-sep-select"
                value={decimalSeparator}
                onChange={(e) => setDecimalSeparator(e.target.value as '.' | ',')}
                className="w-full min-h-[38px] px-2.5 rounded-md border border-slate-300 bg-white text-xs font-mono"
              >
                <option value=".">จุด (.) — เช่น 24,740.50</option>
                <option value=",">จุลภาค (,) — เช่น 24.740,50</option>
              </select>
            </div>
          </div>

          {/* Inline Save Template Form */}
          {showSaveTemplate && (
            <form
              onSubmit={(e) => void handleSaveAsTemplate(e)}
              className="bg-blue-50/70 border border-blue-200 rounded-lg p-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end"
            >
              <div>
                <label className="block text-[11px] font-semibold text-slate-800 mb-1">
                  ชื่อ Template ใหม่ *
                </label>
                <input
                  type="text"
                  required
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  placeholder="เช่น TMT MB52 Coil Export"
                  className="w-full min-h-[38px] px-3 rounded-md border border-slate-300 bg-white text-xs"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-800 mb-1">
                  คำอธิบายเพิ่มเติม
                </label>
                <input
                  type="text"
                  value={newTemplateDesc}
                  onChange={(e) => setNewTemplateDesc(e.target.value)}
                  placeholder="ระบุ T-Code หรือรูปแบบไฟล์"
                  className="w-full min-h-[38px] px-3 rounded-md border border-slate-300 bg-white text-xs"
                />
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-800 min-h-[38px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={newTemplateDefault}
                  onChange={(e) => setNewTemplateDefault(e.target.checked)}
                />
                <span>ตั้งเป็น Default Template</span>
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={savingTemplate}
                  className="min-h-[38px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold cursor-pointer"
                >
                  {savingTemplate ? 'กำลังบันทึก...' : 'บันทึก Template'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowSaveTemplate(false)}
                  className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white text-xs cursor-pointer"
                >
                  ยกเลิก
                </button>
              </div>
            </form>
          )}

          {/* Leading-Zero Numeric Cell Advisory */}
          {inspectData.detectedLeadingZeroWarnings.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-md px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <span className="font-semibold">ตรวจพบคอลัมน์ตัวเลข (Numeric Cell) ใน Excel ต้นทาง:</span>{' '}
                <span className="font-mono">{inspectData.detectedLeadingZeroWarnings.join(', ')}</span>{' '}
                — หากคอลัมน์เหล่านี้เป็นรหัสที่มีเลข 0 ด้านหน้า ระบบจะไม่เดาเติมเลข 0 อัตโนมัติและจะแสดง
                Warning ให้ตรวจสอบในขั้นตอน Validation
              </div>
            </div>
          )}

          {/* Mapping Table */}
          <div className="border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold">
                  <th className="py-2.5 px-3.5">ฟิลด์เป้าหมายใน WMS (Target Field)</th>
                  <th className="py-2.5 px-3.5">ประเภท</th>
                  <th className="py-2.5 px-3.5">คอลัมน์ในไฟล์ Excel (Source Column)</th>
                  <th className="py-2.5 px-3.5">ตัวอย่างข้อมูลจริงจากไฟล์ (Sample Data)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {targetFields.map((field) => {
                  const selectedCol = mapping[field.key] ?? '';
                  const samples = selectedCol ? inspectData.sampleByColumn[selectedCol] ?? [] : [];
                  return (
                    <tr
                      key={field.key}
                      className={field.required ? 'bg-blue-50/25' : 'hover:bg-slate-50/70'}
                    >
                      <td className="py-2.5 px-3.5">
                        <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <span>{field.labelTh}</span>
                          {field.required && (
                            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-mono text-[10px]">
                              REQUIRED
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          <span className="font-mono">{field.key}</span> · {field.descriptionTh}
                        </div>
                      </td>
                      <td className="py-2.5 px-3.5 whitespace-nowrap font-mono text-[11px] text-slate-600">
                        {field.dataType === 'string_leading_zero'
                          ? 'TEXT (0-Safe)'
                          : field.dataType.toUpperCase()}
                      </td>
                      <td className="py-2.5 px-3.5 min-w-[230px]">
                        <select
                          aria-label={`เลือกคอลัมน์สำหรับ ${field.labelEn}`}
                          value={selectedCol}
                          onChange={(e) => {
                            const val = e.target.value;
                            setMapping((prev) => {
                              const next = { ...prev };
                              if (!val) delete next[field.key];
                              else next[field.key] = val;
                              return next;
                            });
                          }}
                          className={`w-full min-h-[36px] px-2.5 rounded-md border text-xs bg-white font-mono ${
                            field.required && !selectedCol
                              ? 'border-red-400 bg-red-50/40'
                              : 'border-slate-300'
                          }`}
                        >
                          <option value="">-- ไม่นำเข้าฟิลด์นี้ (Unmapped) --</option>
                          {inspectData.headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2.5 px-3.5 font-mono text-slate-700 max-w-[280px]">
                        {samples.length > 0 ? (
                          <div className="truncate" title={samples.join(' | ')}>
                            {samples.slice(0, 3).join(' · ')}
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STEP 4: VALIDATION SUMMARY & ERROR REPORT */}
      {/* =================================================================== */}
      {step === 4 && activeBatch && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                ขั้นตอนที่ 4: สรุปผลการตรวจสอบข้อมูล (Validation &amp; Duplicate Report)
              </h2>
              <p className="text-xs text-slate-600 mt-0.5">
                ตรวจสอบข้อผิดพลาด, คำเตือน, และสถานะข้อมูลซ้ำ 3 ระดับ ก่อนยืนยันนำเข้าในขั้นตอนที่ 5
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {!isCompletedBatch && (
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>แก้ไข Mapping</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleExportErrorReport('xlsx')}
                className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Error Report (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={() => void handleExportErrorReport('csv')}
                className="min-h-[38px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Error Report (.csv)</span>
              </button>
              <button
                type="button"
                onClick={() => setStep(5)}
                className="min-h-[38px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>ไปที่ Preview &amp; Confirm Import</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3.5 rounded-md border border-slate-200 bg-slate-50">
              <div className="text-[11px] text-slate-500">Total Rows</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-slate-900">
                {activeBatch.totalRows}
              </div>
            </div>
            <div className="p-3.5 rounded-md border border-emerald-200 bg-emerald-50/70">
              <div className="text-[11px] text-emerald-700">Valid New Records</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-emerald-800">
                {activeBatch.validRows}
              </div>
            </div>
            <div className="p-3.5 rounded-md border border-amber-200 bg-amber-50/70">
              <div className="text-[11px] text-amber-800">Warnings</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-amber-900">
                {activeBatch.warningRows}
              </div>
            </div>
            <div className="p-3.5 rounded-md border border-sky-200 bg-sky-50/70">
              <div className="text-[11px] text-sky-800">Duplicates Detected</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-sky-900">
                {activeBatch.duplicateRows}
              </div>
            </div>
            <div className="p-3.5 rounded-md border border-red-200 bg-red-50/70">
              <div className="text-[11px] text-red-700">Errors (Blocking Strict)</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-red-800">
                {activeBatch.errorRows}
              </div>
            </div>
          </div>

          {/* Error & Warning Issues Table */}
          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-slate-900">
                รายการข้อผิดพลาดและคำเตือน ({filteredErrors.length} รายการ)
              </div>
              <select
                aria-label="กรองตามระดับความรุนแรง"
                value={errorSeverityFilter}
                onChange={(e) => setErrorSeverityFilter(e.target.value)}
                className="min-h-[34px] px-2.5 rounded-md border border-slate-300 text-xs bg-white"
              >
                <option value="ALL">ทั้งหมด (ERROR / WARNING / INFO)</option>
                <option value="ERROR">ERROR เท่านั้น</option>
                <option value="WARNING">WARNING เท่านั้น</option>
                <option value="INFO">INFO เท่านั้น</option>
              </select>
            </div>

            {filteredErrors.length === 0 ? (
              <div className="p-6 rounded-lg border border-emerald-200 bg-emerald-50/60 text-xs text-emerald-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>ไม่พบข้อผิดพลาดหรือคำเตือน ข้อมูลทั้งหมดผ่านการตรวจสอบและพร้อมยืนยันนำเข้า</span>
              </div>
            ) : (
              <div className="border border-slate-200 rounded-lg overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold whitespace-nowrap">
                      <th className="py-2 px-3">Row</th>
                      <th className="py-2 px-3">Severity</th>
                      <th className="py-2 px-3">Coil ID</th>
                      <th className="py-2 px-3">Batch</th>
                      <th className="py-2 px-3">Column / Field</th>
                      <th className="py-2 px-3">Code</th>
                      <th className="py-2 px-3">รายละเอียด</th>
                      <th className="py-2 px-3">แนวทางแก้ไข</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredErrors.slice(0, 100).map((err) => (
                      <tr key={err.id} className="hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono tabular-nums">{err.rowIndex}</td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span
                            className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-semibold ${getSeverityBadgeClass(
                              err.severity
                            )}`}
                          >
                            {err.severity}
                          </span>
                        </td>
                        <td className="py-2 px-3 font-mono">{err.coilIdText || '-'}</td>
                        <td className="py-2 px-3 font-mono">{err.batchNoText || '-'}</td>
                        <td className="py-2 px-3 font-mono text-slate-600">
                          {err.columnName || err.targetField || '-'}
                        </td>
                        <td className="py-2 px-3 font-mono text-slate-800">{err.errorCode}</td>
                        <td className="py-2 px-3 text-slate-900 max-w-[280px]">{err.errorMessage}</td>
                        <td className="py-2 px-3 text-slate-600 max-w-[240px]">
                          {err.suggestedResolution || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* STEP 5: PREVIEW TABLE & ATOMIC CONFIRM IMPORT */}
      {/* =================================================================== */}
      {step === 5 && activeBatch && (
        <div className="space-y-5">
          {/* Post-Confirm Success Card */}
          {confirmOutcome && (
            <div className="bg-emerald-50 border border-emerald-300 rounded-lg p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" aria-hidden="true" />
                  <div>
                    <h3 className="text-sm font-bold text-emerald-950">
                      ยืนยันนำเข้า SAP Reference Coils สำเร็จ ({activeBatch.batchCode})
                      {confirmOutcome.idempotentReplay && ' [Idempotent Replay]'}
                    </h3>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      บันทึกสำเร็จ{' '}
                      <strong className="font-mono">{confirmOutcome.importedCount}</strong> คอยล์
                      {confirmOutcome.reconciledCount > 0 && (
                        <>
                          {' '}
                          (จับคู่เติมข้อมูล Pre-SAP ในคลัง 3D อัตโนมัติ{' '}
                          <strong className="font-mono text-amber-800">
                            {confirmOutcome.reconciledCount}
                          </strong>{' '}
                          คอยล์)
                        </>
                      )}{' '}
                      · ข้ามซ้ำ/ข้อผิดพลาด{' '}
                      <strong className="font-mono">{confirmOutcome.skippedCount}</strong> แถว
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={onGoToReferenceCoils}
                    className="min-h-[38px] px-4 rounded-md bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold cursor-pointer"
                  >
                    ดูรายการ SAP Reference Coils
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveBatch(null);
                      setInspectData(null);
                      setConfirmOutcome(null);
                      setStep(1);
                    }}
                    className="min-h-[38px] px-3.5 rounded-md border border-emerald-300 bg-white hover:bg-emerald-100/50 text-emerald-900 text-xs font-semibold cursor-pointer"
                  >
                    อัปโหลดไฟล์ถัดไป
                  </button>
                </div>
              </div>
              <div className="pt-2.5 border-t border-emerald-200 flex flex-wrap items-center gap-4 text-[11px] font-mono text-emerald-900">
                <span className="font-sans font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" aria-hidden="true" />
                  Inventory Safety Verified:
                </span>
                <span>Active Inventory = {confirmOutcome.safetySnapshot.activeInventoryCount}</span>
                <span>Occupied Locations = {confirmOutcome.safetySnapshot.occupiedLocationCount}</span>
                <span>Active Reservations = {confirmOutcome.safetySnapshot.activeReservationCount}</span>
                <span>Stock Transactions = {confirmOutcome.safetySnapshot.stockTransactionCount}</span>
              </div>
            </div>
          )}

          {/* Confirm Import Governance Panel (Only when READY_TO_IMPORT) */}
          {activeBatch.status === 'READY_TO_IMPORT' && (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    ขั้นตอนที่ 5: ตรวจสอบ Preview และยืนยันนำเข้าข้อมูล (Confirm SAP Reference Import)
                  </h2>
                  <p className="text-xs text-slate-600 mt-0.5">
                    เลือกโหมดการนำเข้า (Strict / Partial) และกดยืนยันเพื่อบันทึก SAP Reference Coils
                    เข้าสู่ฐานข้อมูล PostgreSQL แบบ Atomic Transaction
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="min-h-[36px] px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>ดูสรุป Validation</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label
                  className={`p-3.5 rounded-lg border cursor-pointer flex items-start gap-3 ${
                    importMode === 'STRICT'
                      ? 'border-[#1D4ED8] bg-blue-50/50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="sapImportMode"
                    value="STRICT"
                    checked={importMode === 'STRICT'}
                    onChange={() => setImportMode('STRICT')}
                    className="mt-1"
                  />
                  <div className="text-xs">
                    <div className="font-semibold text-slate-900">
                      Strict Mode (แนะนำ — ปลอดภัยสูงสุด)
                    </div>
                    <p className="text-slate-600 mt-0.5">
                      อนุญาตให้นำเข้าเฉพาะเมื่อไม่มีแถว ERROR เลย (Error Rows = 0)
                      หากมีข้อผิดพลาดระบบจะปฏิเสธทั้ง Batch เพื่อรักษาความสมบูรณ์ของข้อมูล
                    </p>
                  </div>
                </label>

                <label
                  className={`p-3.5 rounded-lg border cursor-pointer flex items-start gap-3 ${
                    importMode === 'PARTIAL'
                      ? 'border-[#1D4ED8] bg-blue-50/50'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="sapImportMode"
                    value="PARTIAL"
                    checked={importMode === 'PARTIAL'}
                    onChange={() => setImportMode('PARTIAL')}
                    className="mt-1"
                  />
                  <div className="text-xs">
                    <div className="font-semibold text-slate-900">
                      Partial Mode (นำเข้าเฉพาะแถวที่ถูกต้อง)
                    </div>
                    <p className="text-slate-600 mt-0.5">
                      นำเข้าเฉพาะแถว VALID / WARNING ที่เป็นข้อมูลใหม่ และข้ามแถว ERROR หรือ
                      DUPLICATE โดยบันทึกสถานะการข้ามรายแถวไว้อย่างชัดเจน
                    </p>
                  </div>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-slate-600 space-y-0.5">
                  <div className="font-medium text-emerald-800 flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                    <span>
                      ยืนยันความปลอดภัย: ไม่สร้าง Active Inventory และไม่เปลี่ยนสถานะ Storage Location ใดๆ
                    </span>
                  </div>
                  <div className="font-mono text-[11px] text-slate-500">
                    Idempotency Key: {idempotencyKey}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {strictBlocked && (
                    <span className="text-xs text-red-700 font-medium">
                      Strict Mode บล็อกเนื่องจากมี {activeBatch.errorRows} ERROR
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={Boolean(busyMessage) || strictBlocked}
                    onClick={() => setShowConfirmModal(true)}
                    className="min-h-[42px] px-5 py-2 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>ยืนยันนำเข้า SAP Reference ({activeBatch.validRows} รายการใหม่)</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Full Interactive Preview Table */}
          <SapBatchPreviewPanel
            batchId={activeBatch.id}
            refreshKey={previewRefreshKey}
            onBatchLoaded={setActiveBatch}
          />
        </div>
      )}

      {/* Confirmation Guard Modal */}
      {showConfirmModal && activeBatch && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="ยืนยันการนำเข้า SAP Reference Coils"
          className="fixed inset-0 z-50 bg-slate-950/60 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-lg shadow-xl max-w-md w-full p-5 space-y-4">
            <h3 className="text-base font-bold text-slate-900">
              ยืนยันนำเข้าข้อมูล SAP Reference Coils?
            </h3>
            <div className="text-xs text-slate-700 space-y-2">
              <p>
                Batch: <strong className="font-mono">{activeBatch.batchCode}</strong> ({activeBatch.fileName})
              </p>
              <p>
                โหมดการนำเข้า: <strong className="font-mono">{importMode}</strong> · รายการใหม่พร้อมนำเข้า{' '}
                <strong className="font-mono text-emerald-700">{activeBatch.validRows}</strong> คอยล์ ·
                ข้ามซ้ำ/ข้อผิดพลาด{' '}
                <strong className="font-mono">
                  {activeBatch.totalRows - activeBatch.validRows}
                </strong>{' '}
                แถว
              </p>
              <div className="p-3 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-900">
                ข้อมูลจะถูกบันทึกในตาราง <span className="font-mono font-semibold">coils</span>{' '}
                ด้วยสถานะ <span className="font-mono font-semibold">PENDING_INBOUND</span> เท่านั้น
                จะไม่มีการสร้าง Inventory หรือเปลี่ยนสถานะ Location ใดๆ
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                className="min-h-[38px] px-4 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmImport()}
                className="min-h-[38px] px-4 rounded-md bg-[#1D4ED8] hover:bg-[#1E40AF] text-white text-xs font-semibold cursor-pointer"
              >
                ยืนยันนำเข้า (Confirm)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
