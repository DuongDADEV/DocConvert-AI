import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Edit2,
  Check,
  Search,
  Filter,
  ShieldCheck,
  Calculator,
  Download,
  FileSpreadsheet,
  FileText,
  Sparkles,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Layers,
  CheckSquare,
  AlertCircle,
  GripVertical,
} from 'lucide-react';
import { DocumentItem, DocumentOCRData, ExtractedTable, ExtractedRow, ExtractedCell, OCRMetadataItem } from '../../types';
import { api } from '../../services/api';
import { StatusBadge } from '../common/StatusBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';

export interface DocumentMetadataItem {
  label: string;
  value: string;
  rawValue?: string;
  confidence?: number;
  sourcePage?: number;
  boundingPolygon?: number[];
}

// Friendly Vietnamese labels for recognized banking semantic types
const SEMANTIC_VI_LABELS: Record<string, string> = {
  ACCOUNT_HOLDER: 'Chủ tài khoản',
  ACCOUNT_NUMBER: 'Số tài khoản',
  CUSTOMER_ID: 'Mã khách hàng',
  TAX_CODE: 'Mã số thuế / CIF',
  CURRENCY: 'Loại tiền',
  ACCOUNT_TYPE: 'Loại tài khoản',
  BRANCH: 'Chi nhánh',
  ADDRESS: 'Địa chỉ',
  STATEMENT_DATE: 'Ngày sao kê',
  STATEMENT_FROM: 'Từ ngày',
  STATEMENT_TO: 'Đến ngày',
};

// Display priority order for CORE metadata
const CORE_PRIORITY_ORDER: Record<string, number> = {
  ACCOUNT_HOLDER: 1,
  ACCOUNT_NUMBER: 2,
  CUSTOMER_ID: 3,
  TAX_CODE: 4,
  STATEMENT_PERIOD: 5,
  STATEMENT_FROM: 5,
  STATEMENT_TO: 5,
  CURRENCY: 6,
  ACCOUNT_TYPE: 7,
  BRANCH: 8,
  ADDRESS: 9,
  STATEMENT_DATE: 10,
};

// 3-tier dark-mode compatible confidence styling
const getConfidenceColor = (confidence: number) => {
  if (confidence >= 0.9) {
    return {
      badge: 'bg-emerald-950/70 text-emerald-300 border border-emerald-800/60',
      dot: 'bg-emerald-400',
      border: 'border-emerald-900/40 hover:border-emerald-700/60',
      text: 'text-emerald-400',
    };
  }
  if (confidence >= 0.7) {
    return {
      badge: 'bg-amber-950/70 text-amber-300 border border-amber-800/60',
      dot: 'bg-amber-400',
      border: 'border-amber-900/40 hover:border-amber-700/60',
      text: 'text-amber-400',
    };
  }
  return {
    badge: 'bg-rose-950/70 text-rose-300 border border-rose-800/60',
    dot: 'bg-rose-500',
    border: 'border-rose-900/40 hover:border-rose-700/60',
    text: 'text-rose-400',
  };
};

interface OcrReviewWorkspaceProps {
  documentId: string;
  onClose: () => void;
  onDocumentUpdated?: (doc: DocumentItem) => void;
  metadata?: OCRMetadataItem[] | DocumentMetadataItem[];
}

export const OcrReviewWorkspace: React.FC<OcrReviewWorkspaceProps> = ({
  documentId,
  onClose,
  onDocumentUpdated,
  metadata,
}) => {
  // Core OCR Data State
  const [ocrData, setOcrData] = useState<DocumentOCRData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Document Blob Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Draggable Split Pane State (Desktop-first: default 40% PDF, 60% Data)
  const [splitPercent, setSplitPercent] = useState<number>(40);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Table & Editing State
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);
  const [selectedPageNumber, setSelectedPageNumber] = useState<number | 'ALL'>('ALL');
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editType, setEditType] = useState<'TEXT' | 'MONEY' | 'DATE' | 'NUMBER'>('TEXT');
  const [isSavingCell, setIsSavingCell] = useState(false);

  // Filter & Search State
  const [filterLowConfidenceOnly, setFilterLowConfidenceOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Add Row State
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<string[]>([]);

  // Action States
  const [isRetryingOcr, setIsRetryingOcr] = useState(false);
  const [isCompletingReview, setIsCompletingReview] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportMode, setExportMode] = useState<'NORMALIZED' | 'ORIGINAL'>('NORMALIZED');
  const [showExportModal, setShowExportModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showAdditionalMetadata, setShowAdditionalMetadata] = useState(false);

  // --- 1. LOAD OCR DATA ---
  const loadOcrData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.getDocumentOcrResult(documentId);
      if (res.success) {
        setOcrData(res as DocumentOCRData);
      } else {
        setError('Không thể tải dữ liệu trích xuất OCR.');
      }
    } catch (err: any) {
      setError(err.message || 'Lỗi khi tải dữ liệu đối soát.');
    } finally {
      setIsLoading(false);
    }
  }, [documentId]);

  useEffect(() => {
    loadOcrData();
  }, [loadOcrData]);

  // Polling when document status is QUEUED or PROCESSING
  useEffect(() => {
    let timer: any = null;
    if (ocrData?.document && (ocrData.document.status === 'QUEUED' || ocrData.document.status === 'PROCESSING')) {
      timer = setInterval(async () => {
        try {
          const res = await api.getDocumentOcrResult(documentId);
          if (res.success) {
            setOcrData(res as DocumentOCRData);
            if (res.document.status !== 'QUEUED' && res.document.status !== 'PROCESSING') {
              clearInterval(timer);
            }
          }
        } catch {
          // ignore transient poll errors
        }
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [documentId, ocrData?.document?.status]);

  // --- 2. LOAD SECURE PDF BLOB FOR PREVIEW ---
  useEffect(() => {
    let active = true;
    let url: string | null = null;

    if (documentId) {
      setIsPreviewLoading(true);
      api
        .getDocumentBlob(documentId)
        .then((blob) => {
          if (active) {
            url = URL.URL ? URL.createObjectURL(blob) : window.URL.createObjectURL(blob);
            setPreviewUrl(url);
          }
        })
        .catch((err) => {
          console.error('Failed to load document preview blob:', err);
        })
        .finally(() => {
          if (active) setIsPreviewLoading(false);
        });
    }

    return () => {
      active = false;
      if (url) window.URL.revokeObjectURL(url);
    };
  }, [documentId]);

  // --- 3. DRAGGABLE SPLIT PANE HANDLERS ---
  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const container = document.getElementById('ocr-workspace-split-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newPercent = ((e.clientX - rect.left) / rect.width) * 100;
      // Clamp between 20% and 75%
      if (newPercent >= 20 && newPercent <= 75) {
        setSplitPercent(newPercent);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // --- 4. CELL EDITING HANDLERS ---
  const startEditCell = (cell: ExtractedCell) => {
    setSelectedCellId(cell.id);
    setEditingCellId(cell.id);
    setEditValue(cell.rawValue);
    setEditType(cell.cellType || 'TEXT');
  };

  const cancelEditCell = () => {
    setEditingCellId(null);
    setEditValue('');
  };

  const saveCellEdit = async () => {
    if (!editingCellId || !ocrData) return;
    setIsSavingCell(true);
    try {
      const res = await api.updateExtractedCell(documentId, editingCellId, {
        rawValue: editValue,
        cellType: editType,
      });

      const updatedCellData = res.cell;

      // Update local state with normalized values returned from backend
      setOcrData((prev) => {
        if (!prev) return prev;
        const updatedTables = prev.tables.map((t) => ({
          ...t,
          rows: t.rows.map((r) => ({
            ...r,
            cells: r.cells.map((c) =>
              c.id === editingCellId
                ? {
                    ...c,
                    rawValue: updatedCellData?.raw_value ?? editValue,
                    normalizedValue: updatedCellData?.normalized_value ?? editValue,
                    cellType: (updatedCellData?.cell_type as any) ?? editType,
                    isReviewed: true,
                    confidence: 1.0, // Human reviewer confirmed
                  }
                : c
            ),
          })),
        }));
        return { ...prev, tables: updatedTables };
      });

      setEditingCellId(null);
      setSuccessMessage('Đã lưu chỉnh sửa ô.');
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err: any) {
      alert(err.message || 'Lỗi khi lưu ô.');
    } finally {
      setIsSavingCell(false);
    }
  };

  // --- 5. ROW OPERATIONS ---
  const handleAddRow = async (table: ExtractedTable) => {
    if (newRowValues.length === 0) return;
    try {
      const cellsPayload = newRowValues.map((val, idx) => ({
        rawValue: val,
        columnIndex: idx,
        cellType: 'TEXT' as const,
      }));

      await api.addExtractedRow(documentId, table.id, cellsPayload);
      setIsAddingRow(false);
      setNewRowValues([]);
      await loadOcrData();
      setSuccessMessage('Đã thêm dòng mới vào bảng.');
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err: any) {
      alert(err.message || 'Lỗi khi thêm dòng.');
    }
  };

  const handleDeleteRow = async (table: ExtractedTable, rowIndex: number) => {
    if (!confirm(`Bạn có chắc chắn muốn xóa dòng số ${rowIndex + 1}?`)) return;
    try {
      await api.deleteExtractedRow(documentId, table.id, rowIndex);
      await loadOcrData();
      setSuccessMessage('Đã xóa dòng khỏi bảng.');
      setTimeout(() => setSuccessMessage(null), 2500);
    } catch (err: any) {
      alert(err.message || 'Lỗi khi xóa dòng.');
    }
  };

  // --- 6. ACTION WORKFLOWS ---
  const handleRerunOcr = async () => {
    setIsRetryingOcr(true);
    try {
      await api.triggerDocumentOcr(documentId);
      setSuccessMessage('Đã gửi tài liệu vào hàng đợi xử lý Azure AI.');
      setTimeout(() => {
        loadOcrData();
        setIsRetryingOcr(false);
      }, 1500);
    } catch (err: any) {
      alert(err.message || 'Lỗi khi kích hoạt lại OCR.');
      setIsRetryingOcr(false);
    }
  };

  const handleCompleteReview = async () => {
    setIsCompletingReview(true);
    try {
      const res = await api.completeDocumentReview(documentId);
      if (res.success && onDocumentUpdated) {
        onDocumentUpdated(res.document);
      }
      setSuccessMessage('Đã hoàn tất đối soát! Tài liệu đã sẵn sàng xuất dữ liệu.');
      await loadOcrData();
    } catch (err: any) {
      alert(err.message || 'Lỗi khi hoàn tất đối soát.');
    } finally {
      setIsCompletingReview(false);
    }
  };

  const handleExportExcel = async (selectedMode: 'NORMALIZED' | 'ORIGINAL' = exportMode) => {
    setIsExportingExcel(true);
    setShowExportModal(false);
    try {
      const res = await api.exportDocumentToExcel(documentId, {
        mode: selectedMode,
        includeReviewLog: true,
        includeValidationSheet: true,
        highlightLowConfidence: true,
      });

      if (res.success && res.export) {
        setSuccessMessage(
          `Đã tạo tệp Excel thành công (${selectedMode === 'ORIGINAL' ? 'Dữ liệu gốc' : 'Chuẩn hóa'}). Đang tải xuống...`
        );
        await api.downloadExportedFile(documentId, res.export.exportId, res.export.fileName);
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    } catch (err: any) {
      alert(err.message || 'Lỗi khi xuất tệp Excel.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  // --- MEMOIZED COMPUTATIONS ---
  const activeTable = ocrData?.tables?.[selectedTableIndex];

  // Structural column count calculation
  const columnCount = useMemo(() => {
    if (!activeTable) return 0;
    let maxCol = activeTable.columnCount || 0;
    if (activeTable.headers && activeTable.headers.length > maxCol) {
      maxCol = activeTable.headers.length;
    }
    activeTable.rows?.forEach((r) => {
      r.cells?.forEach((c) => {
        if (typeof c.columnIndex === 'number' && c.columnIndex + 1 > maxCol) {
          maxCol = c.columnIndex + 1;
        }
      });
    });
    return maxCol;
  }, [activeTable]);

  // Effective dynamic header labels
  const effectiveHeaders = useMemo(() => {
    if (!activeTable || columnCount === 0) return [];
    const result: string[] = [];
    for (let i = 0; i < columnCount; i++) {
      const rawHead = activeTable.headers?.[i];
      if (rawHead && rawHead.trim().length > 0) {
        result.push(rawHead.trim());
      } else {
        result.push(`Cột ${i + 1}`);
      }
    }
    return result;
  }, [activeTable, columnCount]);

  // Exclude header row cleanly from body data rows
  const dataRows = useMemo(() => {
    if (!activeTable || !activeTable.rows) return [];
    return activeTable.rows.filter((row) => {
      if (row.isHeader) return false;
      // If row 0 is identical to headers, omit it from body rows
      if (row.rowIndex === 0 && activeTable.headers && activeTable.headers.length > 0) {
        const matchesHeaders = row.cells?.every(
          (c) => activeTable.headers[c.columnIndex] === c.rawValue
        );
        if (matchesHeaders) return false;
      }
      return true;
    });
  }, [activeTable]);

  // Reviewed count & metrics calculation
  const metrics = useMemo(() => {
    if (!ocrData || !ocrData.tables) {
      return { totalCells: 0, lowConfCount: 0, reviewedCount: 0, avgConfidence: 0.95 };
    }

    let total = 0;
    let lowConf = 0;
    let reviewed = 0;
    let confSum = 0;

    ocrData.tables.forEach((t) => {
      t.rows.forEach((r) => {
        r.cells.forEach((c) => {
          total++;
          confSum += c.confidence;
          if (c.confidence < 0.7) lowConf++;
          if (c.isReviewed) reviewed++;
        });
      });
    });

    const avgConfidence = total > 0 ? confSum / total : (ocrData.tables[0]?.confidence || 0.95);

    return {
      totalCells: total,
      lowConfCount: lowConf,
      reviewedCount: reviewed,
      avgConfidence,
    };
  }, [ocrData]);

  // Banking Reconciler Calculation
  const reconciliation = useMemo(() => {
    if (!activeTable || !activeTable.headers) return null;

    let totalDebit = 0;
    let totalCredit = 0;
    let debitColIdx = -1;
    let creditColIdx = -1;

    activeTable.headers.forEach((h, idx) => {
      const lower = (h || '').toLowerCase();
      if (lower.includes('nợ') || lower.includes('debit') || lower.includes('ghi nợ') || lower.includes('rút ra')) {
        debitColIdx = idx;
      }
      if (lower.includes('có') || lower.includes('credit') || lower.includes('ghi có') || lower.includes('nạp vào')) {
        creditColIdx = idx;
      }
    });

    if (debitColIdx === -1 && creditColIdx === -1) {
      return null;
    }

    dataRows.forEach((r) => {
      if (debitColIdx !== -1) {
        const cell = r.cells.find((c) => Number(c.columnIndex) === debitColIdx);
        if (cell) {
          const val = Number(cell.normalizedValue || cell.rawValue.replace(/[^\d]/g, '')) || 0;
          totalDebit += val;
        }
      }
      if (creditColIdx !== -1) {
        const cell = r.cells.find((c) => Number(c.columnIndex) === creditColIdx);
        if (cell) {
          const val = Number(cell.normalizedValue || cell.rawValue.replace(/[^\d]/g, '')) || 0;
          totalCredit += val;
        }
      }
    });

    return {
      hasColumns: true,
      totalDebit,
      totalCredit,
      netChange: totalCredit - totalDebit,
    };
  }, [activeTable, dataRows]);

  // Selected cell object (preserved for future highlight compatibility)
  const selectedCell = useMemo(() => {
    if (!selectedCellId || !activeTable) return null;
    for (const r of activeTable.rows) {
      for (const c of r.cells) {
        if (c.id === selectedCellId) return c;
      }
    }
    return null;
  }, [selectedCellId, activeTable]);

  const formatVnd = (num: number) => {
    return new Intl.NumberFormat('vi-VN').format(num) + ' VND';
  };

  // --- METADATA SELECTION & DYNAMIC PRESENTATION ---
  const metadataItems: OCRMetadataItem[] = useMemo(() => {
    if (ocrData?.documentMetadata && ocrData.documentMetadata.length > 0) {
      return ocrData.documentMetadata;
    }
    if (metadata && metadata.length > 0) {
      return metadata as OCRMetadataItem[];
    }
    return [];
  }, [ocrData?.documentMetadata, metadata]);

  // Process CORE & ADDITIONAL items with display priority and period combination
  const { coreDisplayItems, additionalItems } = useMemo(() => {
    const rawCore = metadataItems.filter((m) => m.visibilityClass === 'CORE');
    const additional = metadataItems.filter((m) => m.visibilityClass === 'ADDITIONAL');

    // Check for STATEMENT_FROM and STATEMENT_TO combination
    const stmtFrom = rawCore.find((m) => m.semanticType === 'STATEMENT_FROM');
    const stmtTo = rawCore.find((m) => m.semanticType === 'STATEMENT_TO');

    const combinedList: Array<{
      id?: string;
      label: string;
      value: string;
      confidence: number;
      qualityScore?: number;
      semanticType?: string;
      sourcePage?: number;
      isCombined?: boolean;
      status?: string;
    }> = [];

    if (stmtFrom && stmtTo) {
      // Visually combine them into one item "Kỳ sao kê"
      const combinedPeriodItem = {
        id: `combined-period-${stmtFrom.id || 'from'}-${stmtTo.id || 'to'}`,
        label: 'Kỳ sao kê',
        value: `${stmtFrom.value} → ${stmtTo.value}`,
        confidence: Math.min(stmtFrom.confidence, stmtTo.confidence),
        qualityScore: Math.min(stmtFrom.qualityScore ?? 1, stmtTo.qualityScore ?? 1),
        semanticType: 'STATEMENT_PERIOD',
        sourcePage: stmtFrom.sourcePage,
        isCombined: true,
        status: stmtFrom.status === 'CONFLICT' || stmtTo.status === 'CONFLICT' ? 'CONFLICT' : 'AUTO',
      };

      for (const item of rawCore) {
        if (item.semanticType === 'STATEMENT_FROM' || item.semanticType === 'STATEMENT_TO') {
          continue;
        }
        combinedList.push({
          id: item.id,
          label: item.semanticType ? SEMANTIC_VI_LABELS[item.semanticType] || item.label : item.label,
          value: item.value,
          confidence: item.confidence,
          qualityScore: item.qualityScore,
          semanticType: item.semanticType,
          sourcePage: item.sourcePage,
          status: item.status,
        });
      }
      combinedList.push(combinedPeriodItem);
    } else {
      // Only one or neither exists
      for (const item of rawCore) {
        combinedList.push({
          id: item.id,
          label: item.semanticType ? SEMANTIC_VI_LABELS[item.semanticType] || item.label : item.label,
          value: item.value,
          confidence: item.confidence,
          qualityScore: item.qualityScore,
          semanticType: item.semanticType,
          sourcePage: item.sourcePage,
          status: item.status,
        });
      }
    }

    // Sort according to preferred display priority
    combinedList.sort((a, b) => {
      const pA = a.semanticType ? CORE_PRIORITY_ORDER[a.semanticType] || 99 : 99;
      const pB = b.semanticType ? CORE_PRIORITY_ORDER[b.semanticType] || 99 : 99;
      return pA - pB;
    });

    return {
      coreDisplayItems: combinedList,
      additionalItems: additional,
    };
  }, [metadataItems]);

  return (
    <div
      id="ocr-review-workspace-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-3 bg-slate-950/85 backdrop-blur-xs select-none"
    >
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-[98vw] h-[95vh] flex flex-col overflow-hidden text-slate-100 font-sans">
        {/* ========================================================= */}
        {/* TOP TOOLBAR */}
        {/* ========================================================= */}
        <header className="px-5 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          {/* File Title & Status */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/30 text-blue-400 flex items-center justify-center shrink-0 font-bold">
              <Sparkles className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-xs sm:text-sm font-bold text-slate-100 truncate max-w-xs sm:max-w-md">
                  {ocrData?.document?.original_filename || 'Tài liệu Đối Soát OCR'}
                </h2>
                {ocrData?.document && <StatusBadge status={ocrData.document.status} size="sm" />}
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                <span>Trạng thái đối soát dữ liệu bảng</span>
              </p>
            </div>
          </div>

          {/* Metrics & Actions Hierarchy */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Quick Metrics Badges */}
            {ocrData?.tables && (
              <div className="hidden md:flex items-center gap-3 bg-slate-900/90 px-3 py-1.5 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Độ tin cậy TB:</span>
                  <span className="font-bold text-emerald-400">
                    {(metrics.avgConfidence * 100).toFixed(1)}%
                  </span>
                </div>
                <span className="text-slate-700">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Cần kiểm tra:</span>
                  <span
                    className={`font-bold ${
                      metrics.lowConfCount > 0 ? 'text-amber-400' : 'text-slate-300'
                    }`}
                  >
                    {metrics.lowConfCount}
                  </span>
                </div>
                <span className="text-slate-700">|</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">Đã đối soát:</span>
                  <span className="font-bold text-blue-400">{metrics.reviewedCount}</span>
                </div>
              </div>
            )}

            {/* Secondary Action: Re-run OCR */}
            <button
              id="btn-rerun-ocr"
              onClick={handleRerunOcr}
              disabled={isRetryingOcr}
              className="px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 flex items-center gap-1.5 transition disabled:opacity-50"
              title="Kích hoạt lại tiến trình nhận dạng Azure AI"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetryingOcr ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Chạy lại OCR</span>
            </button>

            {/* Primary Action 1: Complete Review */}
            <button
              id="btn-complete-review"
              onClick={handleCompleteReview}
              disabled={isCompletingReview}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-800/80 flex items-center gap-1.5 transition disabled:opacity-50"
              title="Đánh dấu tài liệu đã hoàn tất đối soát"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isCompletingReview ? 'Đang lưu...' : 'Hoàn tất đối soát'}</span>
            </button>

            {/* Primary Action 2: Export Excel (.XLSX) */}
            <button
              id="btn-export-excel-dropdown"
              onClick={() => setShowExportModal(true)}
              disabled={isExportingExcel}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/30 flex items-center gap-1.5 transition disabled:opacity-50"
              title="Xuất bảng trích xuất sang định dạng Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{isExportingExcel ? 'Đang xuất Excel...' : 'Xuất Excel (.xlsx)'}</span>
            </button>

            {/* Close Modal Button */}
            <button
              id="btn-close-ocr-workspace"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
              title="Đóng không gian làm việc"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* EXPORT OPTIONS MODAL */}
        {showExportModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 text-slate-100">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center font-bold">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-100">Xuất Excel (.xlsx)</h3>
                    <p className="text-xs text-slate-400">Tùy chọn chế độ giá trị ô tính toán</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 mb-6">
                <label
                  onClick={() => setExportMode('NORMALIZED')}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    exportMode === 'NORMALIZED'
                      ? 'border-emerald-500 bg-emerald-950/40'
                      : 'border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="exportMode"
                    value="NORMALIZED"
                    checked={exportMode === 'NORMALIZED'}
                    onChange={() => setExportMode('NORMALIZED')}
                    className="mt-1 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-slate-100">Mode B — Normalized (Chuẩn hóa)</span>
                      <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 rounded">Khuyên dùng</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Chuyển đổi số tiền, ngày tháng thành kiểu dữ liệu Excel chuyên dụng (dễ tính SUM, hàm công thức và lọc cột).
                    </p>
                  </div>
                </label>

                <label
                  onClick={() => setExportMode('ORIGINAL')}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    exportMode === 'ORIGINAL'
                      ? 'border-emerald-500 bg-emerald-950/40'
                      : 'border-slate-800 hover:bg-slate-800/50'
                  }`}
                >
                  <input
                    type="radio"
                    name="exportMode"
                    value="ORIGINAL"
                    checked={exportMode === 'ORIGINAL'}
                    onChange={() => setExportMode('ORIGINAL')}
                    className="mt-1 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <span className="font-bold text-sm text-slate-100">Mode A — Original (Dữ liệu gốc OCR)</span>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Giữ nguyên 100% văn bản chuỗi nhận dạng gốc từ Azure AI (phù hợp đối chiếu nguyên bản sao kê).
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-xl transition"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  id="btn-confirm-export-excel"
                  onClick={() => handleExportExcel(exportMode)}
                  disabled={isExportingExcel}
                  className="px-5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl shadow-sm shadow-emerald-600/30 flex items-center gap-2 transition disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isExportingExcel ? 'Đang tạo Excel...' : 'Tải tệp .xlsx'}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* NOTIFICATION BANNER */}
        {successMessage && (
          <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-6 py-2 text-emerald-400 text-xs font-semibold flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-400" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* ========================================================= */}
        {/* WORKSPACE BODY WITH DRAGGABLE SPLIT PANE */}
        {/* ========================================================= */}
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-medium text-slate-400">Đang tải và phân tích dữ liệu OCR Azure AI...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-100 mb-1">Không thể tải dữ liệu OCR</h3>
            <p className="text-xs text-slate-400 max-w-md mb-4">{error}</p>
            <button
              onClick={loadOcrData}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-500 transition"
            >
              Thử lại
            </button>
          </div>
        ) : (
          <div
            id="ocr-workspace-split-container"
            className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden relative"
          >
            {/* ========================================================= */}
            {/* LEFT PANEL: PDF VIEWER */}
            {/* ========================================================= */}
            <div
              style={{ width: `${splitPercent}%` }}
              className="bg-slate-950 border-r border-slate-800 flex flex-col overflow-hidden relative shrink-0 min-w-[200px]"
            >
              {/* PDF Top Bar & Page Navigation */}
              <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="font-semibold text-slate-200 truncate">Văn bản gốc</span>
                </div>

                {/* Page Navigation Selector */}
                {ocrData && (
                  <div className="flex items-center gap-1 overflow-x-auto">
                    <button
                      onClick={() => setSelectedPageNumber('ALL')}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold transition shrink-0 ${
                        selectedPageNumber === 'ALL'
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Tất cả
                    </button>
                    {Array.from(
                      { length: ocrData.document?.page_count || ocrData.pages?.length || 1 },
                      (_, i) => i + 1
                    ).map((pNum) => (
                      <button
                        key={pNum}
                        onClick={() => setSelectedPageNumber(pNum)}
                        className={`px-2 py-0.5 rounded text-[11px] font-semibold transition shrink-0 ${
                          selectedPageNumber === pNum
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        P{pNum}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* PDF View Container */}
              <div className="flex-1 p-2 overflow-hidden flex items-center justify-center bg-slate-950 relative">
                {isPreviewLoading ? (
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <LoadingSpinner size="md" />
                    <span className="text-xs">Đang tải tệp an toàn...</span>
                  </div>
                ) : previewUrl ? (
                  <div className="w-full h-full relative flex items-center justify-center">
                    <iframe
                      src={selectedPageNumber !== 'ALL' ? `${previewUrl}#page=${selectedPageNumber}` : previewUrl}
                      title="PDF Viewer"
                      className="w-full h-full rounded-lg border border-slate-800 bg-white"
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Không có bản xem trước tệp.</p>
                )}
              </div>
            </div>

            {/* ========================================================= */}
            {/* DRAGGABLE DIVIDER */}
            {/* ========================================================= */}
            <div
              onMouseDown={handleSplitMouseDown}
              className={`hidden lg:flex w-2.5 bg-slate-900 border-x border-slate-800 hover:bg-blue-600/30 cursor-col-resize shrink-0 items-center justify-center transition-colors group ${
                isDragging ? 'bg-blue-600/50' : ''
              }`}
              title="Kéo sang trái/phải để thay đổi kích thước khung"
            >
              <div className="w-1 h-8 rounded-full bg-slate-700 group-hover:bg-blue-400 transition-colors" />
            </div>

            {/* ========================================================= */}
            {/* RIGHT PANEL: DATA & EDITING WORKSPACE */}
            {/* ========================================================= */}
            <div
              style={{ width: `calc(${100 - splitPercent}% - 0.625rem)` }}
              className="flex-1 flex flex-col bg-slate-900 overflow-hidden min-w-[300px]"
            >
              {/* ========================================================= */}
              {/* THÔNG TIN SAO KÊ (DYNAMIC DATA-DRIVEN METADATA PANEL)     */}
              {/* ========================================================= */}
              {metadataItems.length > 0 && (
                <section
                  id="ocr-statement-metadata-panel"
                  className="px-4 py-2.5 bg-slate-950/95 border-b border-slate-800 text-xs shrink-0 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-5 h-5 rounded-md bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">
                        <Info className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-bold text-xs uppercase tracking-wider text-slate-300">
                        Thông tin sao kê
                      </span>
                      {coreDisplayItems.length > 0 && (
                        <span className="text-[10px] text-slate-500 font-mono">
                          ({coreDisplayItems.length} trường chính)
                        </span>
                      )}
                    </div>

                    {additionalItems.length > 0 && (
                      <button
                        type="button"
                        id="btn-toggle-additional-metadata"
                        onClick={() => setShowAdditionalMetadata(!showAdditionalMetadata)}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-900 border border-slate-800 hover:bg-slate-800 transition"
                        title="Xem thông tin bổ sung trích xuất từ tài liệu"
                      >
                        <span>Thông tin khác ({additionalItems.length})</span>
                        {showAdditionalMetadata ? (
                          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                        ) : (
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Responsive Core Grid */}
                  {coreDisplayItems.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                      {coreDisplayItems.map((item, idx) => {
                        const confStyle = getConfidenceColor(item.confidence);
                        return (
                          <div
                            key={item.id || idx}
                            className={`bg-slate-900/90 p-2 rounded-lg border ${confStyle.border} transition flex flex-col justify-between min-h-[50px] group`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-0.5">
                              <span
                                className="text-[10px] font-medium text-slate-400 uppercase tracking-wider truncate"
                                title={item.label}
                              >
                                {item.label}
                              </span>
                              <span
                                className={`text-[9px] font-mono px-1 py-0.2 rounded shrink-0 flex items-center gap-1 ${confStyle.badge}`}
                                title={`Độ tin cậy: ${(item.confidence * 100).toFixed(1)}% (P${item.sourcePage || 1})`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${confStyle.dot}`} />
                                {(item.confidence * 100).toFixed(0)}%
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-1">
                              <span
                                className="font-bold text-slate-100 text-xs truncate select-all"
                                title={item.value}
                              >
                                {item.value}
                              </span>
                              {item.status === 'CONFLICT' && (
                                <span
                                  className="text-[9px] font-semibold text-amber-300 bg-amber-950/80 border border-amber-800/80 px-1 py-0.2 rounded shrink-0"
                                  title="Phát hiện sự khác nhau về giá trị giữa các trang"
                                >
                                  Xung đột
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Collapsible Additional Metadata Area */}
                  {showAdditionalMetadata && additionalItems.length > 0 && (
                    <div className="mt-2.5 pt-2 border-t border-slate-800/80">
                      <div className="text-[11px] font-bold text-slate-400 mb-1.5 flex items-center gap-1.5">
                        <span>Chi tiết mở rộng:</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
                        {additionalItems.map((item, idx) => {
                          const confStyle = getConfidenceColor(item.confidence);
                          const isConflict = item.status === 'CONFLICT';
                          return (
                            <div
                              key={item.id || idx}
                              className={`bg-slate-900/60 p-2 rounded-lg border ${
                                isConflict ? 'border-amber-700/60 bg-amber-950/20' : 'border-slate-800/80'
                              } transition`}
                            >
                              <div className="flex items-center justify-between gap-1 mb-0.5">
                                <span
                                  className="text-[10px] text-slate-400 truncate"
                                  title={item.label || item.rawLabel}
                                >
                                  {item.label || item.rawLabel}
                                </span>
                                <span
                                  className={`text-[9px] font-mono px-1 py-0.2 rounded shrink-0 flex items-center gap-1 ${confStyle.badge}`}
                                  title={`Độ tin cậy: ${(item.confidence * 100).toFixed(1)}%`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${confStyle.dot}`} />
                                  {(item.confidence * 100).toFixed(0)}%
                                </span>
                              </div>
                              <div className="flex items-baseline justify-between gap-1">
                                <span className="font-semibold text-slate-300 text-xs truncate" title={item.value}>
                                  {item.value}
                                </span>
                                {isConflict && (
                                  <span
                                    className="text-[9px] text-amber-300 font-semibold bg-amber-950/80 border border-amber-800/80 px-1 py-0.2 rounded shrink-0 flex items-center gap-0.5"
                                    title={
                                      item.alternatives?.length
                                        ? `Các biến thể khác: ${item.alternatives.map((a) => a.rawValue).join(', ')}`
                                        : 'Xung đột giữa các trang'
                                    }
                                  >
                                    <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                                    Xung đột
                                  </span>
                                )}
                              </div>
                              {item.alternatives && item.alternatives.length > 0 && (
                                <div className="mt-1 pt-1 border-t border-slate-800/60 text-[10px] text-slate-400 space-y-0.5">
                                  <span className="text-[9px] text-slate-500 block">Biến thể khác:</span>
                                  {item.alternatives.map((alt, aIdx) => (
                                    <div key={aIdx} className="truncate text-slate-300">
                                      • {alt.rawValue} <span className="text-slate-500 font-mono">(P{alt.sourcePage})</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* TABLE SWITCHER & CONTROL BAR */}
              <div className="p-3 bg-slate-900 border-b border-slate-800 space-y-2.5 shrink-0">
                {/* Scalable Table Selector Navigator */}
                {ocrData?.tables && ocrData.tables.length > 0 && (
                  <div className="flex items-center gap-2 bg-slate-950 p-2 rounded-xl border border-slate-800 text-xs">
                    <span className="font-bold text-slate-400 flex items-center gap-1.5 shrink-0 pl-1">
                      <Layers className="w-3.5 h-3.5 text-blue-400" />
                      <span className="hidden sm:inline">Bảng:</span>
                    </span>

                    {/* Previous Table Button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedTableIndex > 0) {
                          setSelectedTableIndex(selectedTableIndex - 1);
                          setSelectedCellId(null);
                        }
                      }}
                      disabled={selectedTableIndex === 0}
                      className="p-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0 flex items-center gap-1 px-2"
                      title="Bảng trước"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span className="hidden sm:inline text-[11px] font-semibold">Bảng trước</span>
                    </button>

                    {/* Scalable Select Dropdown */}
                    <div className="relative flex-1 min-w-0">
                      <select
                        value={selectedTableIndex}
                        onChange={(e) => {
                          setSelectedTableIndex(Number(e.target.value));
                          setSelectedCellId(null);
                        }}
                        className="w-full appearance-none bg-slate-900 border border-slate-800 rounded-lg pl-3 pr-8 py-1.5 text-xs font-semibold text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer truncate"
                      >
                        {ocrData.tables.map((t, idx) => (
                          <option key={t.id || idx} value={idx} className="bg-slate-900 text-slate-100">
                            Bảng #{t.tableIndex + 1} · Trang {t.pageNumber} · {t.rowCount} dòng · {t.columnCount} cột
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                    </div>

                    {/* Next Table Button */}
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedTableIndex < ocrData.tables.length - 1) {
                          setSelectedTableIndex(selectedTableIndex + 1);
                          setSelectedCellId(null);
                        }
                      }}
                      disabled={selectedTableIndex >= ocrData.tables.length - 1}
                      className="p-1 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition shrink-0 flex items-center gap-1 px-2"
                      title="Bảng sau"
                    >
                      <span className="hidden sm:inline text-[11px] font-semibold">Bảng sau</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Filter & Search Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                      <input
                        type="text"
                        placeholder="Tìm nội dung ô..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2 top-2 text-slate-400 hover:text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => setFilterLowConfidenceOnly(!filterLowConfidenceOnly)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition shrink-0 ${
                        filterLowConfidenceOnly
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                          : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span>Ô cần kiểm tra</span>
                    </button>
                  </div>

                  {/* Add Row Action */}
                  {activeTable && (
                    <button
                      onClick={() => {
                        setIsAddingRow(!isAddingRow);
                        setNewRowValues(new Array(columnCount).fill(''));
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60 border border-emerald-800/80 flex items-center gap-1.5 transition shrink-0"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isAddingRow ? 'Đóng form' : 'Thêm dòng mới'}</span>
                    </button>
                  )}
                </div>

                {/* Banking Reconciliation Bar if Available */}
                {reconciliation && (
                  <div className="p-2.5 bg-blue-950/30 border border-blue-800/50 rounded-xl flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-blue-400 shrink-0" />
                      <span className="font-bold text-slate-200">Đối soát phát sinh:</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div>
                        <span className="text-slate-400 mr-1">Nợ:</span>
                        <span className="font-bold text-rose-400">{formatVnd(reconciliation.totalDebit)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 mr-1">Có:</span>
                        <span className="font-bold text-emerald-400">{formatVnd(reconciliation.totalCredit)}</span>
                      </div>
                      <div className="border-l border-slate-800 pl-3">
                        <span className="text-slate-400 mr-1">Chênh lệch:</span>
                        <span className="font-bold text-blue-400">{formatVnd(reconciliation.netChange)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Add Row Form */}
                {isAddingRow && activeTable && (
                  <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-200">
                      <span>Nhập dữ liệu cho dòng mới:</span>
                      <button onClick={() => setIsAddingRow(false)} className="text-slate-400 hover:text-white">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {effectiveHeaders.map((h, hIdx) => (
                        <div key={hIdx}>
                          <label className="text-[10px] font-semibold text-slate-400 block truncate">{h}</label>
                          <input
                            type="text"
                            placeholder={`Giá trị ${h}`}
                            value={newRowValues[hIdx] || ''}
                            onChange={(e) => {
                              const updated = [...newRowValues];
                              updated[hIdx] = e.target.value;
                              setNewRowValues(updated);
                            }}
                            className="w-full px-2.5 py-1 text-xs bg-slate-900 border border-slate-800 rounded text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setIsAddingRow(false)}
                        className="px-3 py-1 text-xs text-slate-400 hover:text-white rounded transition"
                      >
                        Hủy
                      </button>
                      <button
                        onClick={() => handleAddRow(activeTable)}
                        className="px-3 py-1 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 rounded transition"
                      >
                        Xác nhận thêm
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* --------------------------------------------------------- */}
              {/* ADVANCED STICKY DATA GRID & TABLE */}
              {/* --------------------------------------------------------- */}
              <div className="flex-1 min-h-0 min-w-0 overflow-auto relative p-3 bg-slate-950">
                {!activeTable || activeTable.rows.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
                    <FileSpreadsheet className="w-10 h-10 mb-2 opacity-40" />
                    <p className="text-xs font-medium">Không tìm thấy dữ liệu bảng trong tài liệu này.</p>
                  </div>
                ) : (
                  <div className="relative border border-slate-800 rounded-xl overflow-x-auto shadow-xs">
                    <table className="min-w-full w-max text-left border-collapse text-xs">
                      {/* STICKY HEADER */}
                      <thead>
                        <tr className="bg-slate-900 text-slate-200">
                          {/* Top-left Sticky Index Header (#) */}
                          <th className="sticky top-0 left-0 z-30 bg-slate-900 border-b border-r border-slate-800 py-2.5 px-3 w-12 text-center font-bold text-slate-400 shadow-xs">
                            #
                          </th>

                          {/* Dynamic Column Headers */}
                          {effectiveHeaders.map((head, hIdx) => (
                            <th
                              key={hIdx}
                              className="sticky top-0 z-20 bg-slate-900 border-b border-r border-slate-800 py-2.5 px-3.5 font-bold uppercase tracking-wider text-[11px] text-slate-200 min-w-[150px] last:border-r-0 shadow-xs"
                            >
                              {head}
                            </th>
                          ))}

                          {/* Sticky Actions Header */}
                          <th className="sticky top-0 right-0 z-20 bg-slate-900 border-b border-slate-800 py-2.5 px-2 w-14 text-center font-bold text-slate-400 shadow-xs">
                            Thao tác
                          </th>
                        </tr>
                      </thead>

                      {/* TABLE BODY */}
                      <tbody className="divide-y divide-slate-800/60 bg-slate-900/60">
                        {dataRows
                          .filter((row) => {
                            if (filterLowConfidenceOnly) {
                              return row.cells?.some((c) => c.confidence < 0.85);
                            }
                            if (searchQuery) {
                              return row.cells?.some((c) =>
                                c.rawValue.toLowerCase().includes(searchQuery.toLowerCase())
                              );
                            }
                            return true;
                          })
                          .map((row) => (
                            <tr key={row.id} className="hover:bg-blue-950/30 transition group">
                              {/* STICKY INDEX COLUMN */}
                              <td className="sticky left-0 z-10 bg-slate-900 py-2 px-3 text-center text-slate-400 font-mono text-[11px] border-r border-slate-800/80">
                                {row.rowIndex + 1}
                              </td>

                              {/* DYNAMIC CELL RENDERING BY STRUCTURAL COLUMN INDEX */}
                              {Array.from({ length: columnCount }, (_, colIdx) => {
                                const cell = row.cells?.find(
                                  (c) => Number(c.columnIndex) === colIdx
                                );

                                if (!cell) {
                                  return (
                                    <td
                                      key={colIdx}
                                      className="py-2 px-3 border-r border-slate-800/60 last:border-r-0 min-w-[150px]"
                                    >
                                      <span className="text-slate-600 italic">—</span>
                                    </td>
                                  );
                                }

                                const isEditing = editingCellId === cell.id;
                                const isSelected = selectedCellId === cell.id;
                                const isLowConf = cell.confidence < 0.7;
                                const isMedConf = cell.confidence >= 0.7 && cell.confidence < 0.9;
                                const isHighConf = cell.confidence >= 0.9;

                                return (
                                  <td
                                    key={cell.id}
                                    onClick={() => setSelectedCellId(cell.id)}
                                    onDoubleClick={() => startEditCell(cell)}
                                    className={`py-2 px-3 border-r border-slate-800/60 last:border-r-0 relative transition cursor-pointer min-w-[150px] ${
                                      isSelected
                                        ? 'bg-blue-950/80 ring-1 ring-blue-500 z-5'
                                        : isLowConf
                                        ? 'bg-rose-950/30'
                                        : isMedConf
                                        ? 'bg-amber-950/20'
                                        : ''
                                    }`}
                                  >
                                    {isEditing ? (
                                      <div className="flex items-center gap-1.5 min-w-[180px]">
                                        <input
                                          type="text"
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          autoFocus
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit();
                                            if (e.key === 'Escape') cancelEditCell();
                                          }}
                                          className="flex-1 px-2 py-1 text-xs border border-blue-500 rounded bg-slate-950 text-slate-100 focus:outline-none ring-1 ring-blue-500"
                                        />
                                        <select
                                          value={editType}
                                          onChange={(e: any) => setEditType(e.target.value)}
                                          className="text-[10px] bg-slate-800 border border-slate-700 rounded px-1 py-1 text-slate-200"
                                        >
                                          <option value="TEXT">Chữ</option>
                                          <option value="MONEY">Tiền VND</option>
                                          <option value="DATE">Ngày</option>
                                          <option value="NUMBER">Số</option>
                                        </select>
                                        <button
                                          onClick={saveCellEdit}
                                          disabled={isSavingCell}
                                          className="p-1 bg-emerald-600 text-white rounded hover:bg-emerald-500 transition"
                                          title="Lưu (Enter)"
                                        >
                                          <Check className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={cancelEditCell}
                                          className="p-1 bg-slate-800 text-slate-400 rounded hover:text-white transition"
                                          title="Hủy (Esc)"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between gap-1.5 group/cell">
                                        <span
                                          className={`font-medium whitespace-nowrap ${
                                            cell.cellType === 'MONEY'
                                              ? 'font-mono text-slate-200 font-semibold'
                                              : cell.cellType === 'DATE'
                                              ? 'font-mono text-slate-300'
                                              : 'text-slate-200'
                                          }`}
                                          title={`Gốc: ${cell.rawValue}\nChuẩn hóa: ${
                                            cell.normalizedValue
                                          }\nĐộ tin cậy: ${(cell.confidence * 100).toFixed(1)}%`}
                                        >
                                          {cell.rawValue ?? cell.normalizedValue ?? (
                                            <span className="text-slate-600 italic">—</span>
                                          )}
                                        </span>

                                        {/* Confidence Indicators */}
                                        <div className="flex items-center gap-1 shrink-0 ml-1">
                                          {cell.isReviewed ? (
                                            <span title="Đã đối soát bởi người dùng">
                                              <ShieldCheck className="w-3 h-3 text-emerald-400" />
                                            </span>
                                          ) : isLowConf ? (
                                            <span
                                              className="flex items-center text-[10px] text-rose-300 font-bold bg-rose-950/80 px-1 py-0.5 rounded border border-rose-800/60"
                                              title={`Cần đối soát: độ tin cậy ${(cell.confidence * 100).toFixed(0)}%`}
                                            >
                                              <AlertTriangle className="w-2.5 h-2.5 mr-0.5 text-rose-400" />
                                              {(cell.confidence * 100).toFixed(0)}%
                                            </span>
                                          ) : isMedConf ? (
                                            <span
                                              className="w-1.5 h-1.5 rounded-full bg-amber-400"
                                              title={`Độ tin cậy vừa: ${(cell.confidence * 100).toFixed(0)}%`}
                                            />
                                          ) : (
                                            <span
                                              className="w-1.5 h-1.5 rounded-full bg-emerald-400/80"
                                              title={`Tin cậy cao: ${(cell.confidence * 100).toFixed(0)}%`}
                                            />
                                          )}

                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startEditCell(cell);
                                            }}
                                            className="opacity-0 group-hover/cell:opacity-100 p-0.5 text-slate-400 hover:text-blue-400 transition"
                                            title="Sửa ô này"
                                          >
                                            <Edit2 className="w-3 h-3" />
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                );
                              })}

                              {/* Row Actions */}
                              <td className="py-2 px-2 text-center">
                                <button
                                  onClick={() => handleDeleteRow(activeTable, row.rowIndex)}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/50 rounded transition"
                                  title="Xóa dòng"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* FOOTER CAPTION */}
              <div className="px-4 py-2 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between text-xs text-slate-400 shrink-0">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    Tin cậy cao (≥90%)
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-amber-300">
                    <span className="w-2 h-2 rounded-full bg-amber-400"></span>
                    Vừa (70–89%)
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-rose-400">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    Cần đối soát ({'<'}70%)
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Nhấp đúp chuột để chỉnh sửa trực tiếp.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
