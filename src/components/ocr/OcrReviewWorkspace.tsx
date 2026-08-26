import React, { useState, useEffect, useMemo } from 'react';
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
  Eye,
  FileSpreadsheet,
  FileText,
  Sparkles,
  Info,
  Maximize2,
  ArrowRight,
} from 'lucide-react';
import { DocumentItem, DocumentOCRData, ExtractedTable, ExtractedRow, ExtractedCell } from '../../types';
import { api } from '../../services/api';
import { StatusBadge } from '../common/StatusBadge';
import { LoadingSpinner } from '../common/LoadingSpinner';

interface OcrReviewWorkspaceProps {
  documentId: string;
  onClose: () => void;
  onDocumentUpdated?: (doc: DocumentItem) => void;
}

export const OcrReviewWorkspace: React.FC<OcrReviewWorkspaceProps> = ({
  documentId,
  onClose,
  onDocumentUpdated,
}) => {
  const [ocrData, setOcrData] = useState<DocumentOCRData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Document Blob Preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Table & Editing State
  const [selectedTableIndex, setSelectedTableIndex] = useState(0);
  const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editType, setEditType] = useState<'TEXT' | 'MONEY' | 'DATE' | 'NUMBER'>('TEXT');
  const [isSavingCell, setIsSavingCell] = useState(false);

  // Filter & Search
  const [filterLowConfidenceOnly, setFilterLowConfidenceOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Add Row State
  const [isAddingRow, setIsAddingRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState<string[]>([]);

  // Action states
  const [isRetryingOcr, setIsRetryingOcr] = useState(false);
  const [isCompletingReview, setIsCompletingReview] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [exportMode, setExportMode] = useState<'NORMALIZED' | 'ORIGINAL'>('NORMALIZED');
  const [showExportModal, setShowExportModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch OCR Data
  const loadOcrData = async () => {
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
  };

  useEffect(() => {
    loadOcrData();
  }, [documentId]);

  // Load Secure Document File Blob for Left Panel
  useEffect(() => {
    let active = true;
    let url: string | null = null;

    if (documentId) {
      setIsPreviewLoading(true);
      api
        .getDocumentBlob(documentId)
        .then((blob) => {
          if (active) {
            url = URL.createObjectURL(blob);
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
      if (url) URL.revokeObjectURL(url);
    };
  }, [documentId]);

  // Handle Cell Editing
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
      await api.updateExtractedCell(documentId, editingCellId, {
        rawValue: editValue,
        cellType: editType,
      });

      // Update local state optimistically
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
                    rawValue: editValue,
                    normalizedValue: editValue,
                    cellType: editType,
                    isReviewed: true,
                    confidence: 1.0, // Marked accurate by human reviewer
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

  // Add Row
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

  // Delete Row
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

  // Trigger Re-run OCR
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

  // Complete Review
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

  // Export Document to Excel (.XLSX)
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
        setSuccessMessage(`Đã tạo tệp Excel thành công (${selectedMode === 'ORIGINAL' ? 'Dữ liệu gốc' : 'Chuẩn hóa'}). Đang tải xuống...`);
        // Download generated file
        await api.downloadExportedFile(documentId, res.export.exportId, res.export.fileName);
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    } catch (err: any) {
      alert(err.message || 'Lỗi khi xuất tệp Excel.');
    } finally {
      setIsExportingExcel(false);
    }
  };

  // Current active table
  const activeTable = ocrData?.tables?.[selectedTableIndex];

  // Banking Reconciler Calculation (Vietnamese Banking Statement logic)
  const reconciliation = useMemo(() => {
    if (!activeTable) return null;

    let totalDebit = 0;
    let totalCredit = 0;
    let debitColIdx = -1;
    let creditColIdx = -1;

    // Detect column indexes for Nợ (Debit) and Có (Credit)
    activeTable.headers.forEach((h, idx) => {
      const lower = h.toLowerCase();
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

    activeTable.rows.forEach((r) => {
      if (r.isHeader) return;
      if (debitColIdx !== -1) {
        const cell = r.cells.find((c) => c.columnIndex === debitColIdx);
        if (cell) {
          const val = Number(cell.normalizedValue || cell.rawValue.replace(/[^\d]/g, '')) || 0;
          totalDebit += val;
        }
      }
      if (creditColIdx !== -1) {
        const cell = r.cells.find((c) => c.columnIndex === creditColIdx);
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
  }, [activeTable]);

  // Selected cell bounding polygon info
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

  return (
    <div
      id="ocr-review-workspace-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/80 backdrop-blur-xs animate-fade-in"
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-[96vw] h-[94vh] flex flex-col overflow-hidden animate-scale-up">
        {/* TOP WORKSPACE TOOLBAR */}
        <header className="px-6 py-3.5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600/30 border border-blue-500/40 text-blue-400 flex items-center justify-center font-bold text-xs">
              <Sparkles className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100 truncate max-w-sm">
                  {ocrData?.document?.original_filename || 'Tài liệu OCR'}
                </h2>
                {ocrData?.document && <StatusBadge status={ocrData.document.status} size="sm" />}
              </div>
              <p className="text-[11px] text-slate-400 flex items-center gap-2">
                <span>Azure AI Document Intelligence (prebuilt-layout)</span>
                <span>•</span>
                <span>Bảo mật RLS User Isolation</span>
              </p>
            </div>
          </div>

          {/* Quick Metrics & Actions */}
          <div className="flex items-center gap-3">
            {ocrData?.stats && (
              <div className="hidden lg:flex items-center gap-2 bg-slate-800/80 px-3 py-1.5 rounded-xl border border-slate-700 text-xs">
                <span className="text-slate-400">Độ tin cậy TB:</span>
                <span className="font-bold text-emerald-400">
                  {((ocrData.tables[0]?.confidence || 0.95) * 100).toFixed(1)}%
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-slate-400">Ô cần soát:</span>
                <span
                  className={`font-bold ${
                    ocrData.stats.lowConfidenceCount > 0 ? 'text-amber-400' : 'text-slate-300'
                  }`}
                >
                  {ocrData.stats.lowConfidenceCount}
                </span>
              </div>
            )}

            {/* Re-run OCR */}
            <button
              id="btn-rerun-ocr"
              onClick={handleRerunOcr}
              disabled={isRetryingOcr}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50"
              title="Kích hoạt lại tiến trình nhận dạng Azure AI"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRetryingOcr ? 'animate-spin' : ''}`} />
              <span>Chạy lại OCR</span>
            </button>

            {/* Mark Reviewed Button */}
            <button
              id="btn-complete-review"
              onClick={handleCompleteReview}
              disabled={isCompletingReview}
              className="px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center gap-1.5 transition disabled:opacity-50"
              title="Đánh dấu toàn bộ ô dữ liệu đã được đối soát"
            >
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{isCompletingReview ? 'Đang lưu...' : 'Hoàn tất đối soát'}</span>
            </button>

            {/* Export Excel (.XLSX) Button */}
            <button
              id="btn-export-excel-dropdown"
              onClick={() => setShowExportModal(true)}
              disabled={isExportingExcel}
              className="px-4 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/30 flex items-center gap-1.5 transition disabled:opacity-50"
              title="Xuất bảng trích xuất sang định dạng Excel (.xlsx)"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>{isExportingExcel ? 'Đang xuất Excel...' : 'Xuất Excel (.xlsx)'}</span>
            </button>

            {/* Close */}
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
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full p-6 animate-scale-up">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Xuất Excel (.xlsx)</h3>
                    <p className="text-xs text-slate-500">Tùy chọn chế độ giá trị ô tính toán</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowExportModal(false)}
                  className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 mb-6">
                {/* Option 1: NORMALIZED */}
                <label
                  onClick={() => setExportMode('NORMALIZED')}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    exportMode === 'NORMALIZED'
                      ? 'border-emerald-500 bg-emerald-50/50 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50'
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
                      <span className="font-bold text-sm text-slate-900">Mode B — Normalized (Chuẩn hóa)</span>
                      <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">Khuyên dùng</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Chuyển đổi số tiền, ngày tháng thành kiểu dữ liệu Excel chuyên dụng (dễ tính SUM, hàm công thức và lọc cột).
                    </p>
                  </div>
                </label>

                {/* Option 2: ORIGINAL */}
                <label
                  onClick={() => setExportMode('ORIGINAL')}
                  className={`flex items-start gap-3 p-3.5 rounded-xl border cursor-pointer transition ${
                    exportMode === 'ORIGINAL'
                      ? 'border-emerald-500 bg-emerald-50/50 shadow-xs'
                      : 'border-slate-200 hover:bg-slate-50'
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
                    <span className="font-bold text-sm text-slate-900">Mode A — Original (Dữ liệu gốc OCR)</span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Giữ nguyên 100% văn bản chuỗi nhận dạng gốc từ Azure AI (phù hợp đối chiếu nguyên bản sao kê).
                    </p>
                  </div>
                </label>
              </div>

              {/* Information Features */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 mb-6 text-xs text-slate-600 space-y-1.5">
                <div className="flex items-center gap-1.5 font-medium text-slate-700">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Kèm theo bảng phân tích <strong>Review_Log</strong> đối soát chi tiết</span>
                </div>
                <div className="flex items-center gap-1.5 font-medium text-slate-700">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Kèm theo bảng <strong>Validation</strong> kiểm tra tổng Nợ / Có ngân hàng</span>
                </div>
                <div className="flex items-center gap-1.5 font-medium text-slate-700">
                  <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Đánh dấu cảnh báo màu vàng cho các ô nghi vấn độ tin cậy thấp</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition"
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
          <div className="bg-emerald-500/10 border-b border-emerald-500/20 px-6 py-2 text-emerald-700 text-xs font-semibold flex items-center gap-2 animate-fade-in">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
        )}

        {/* WORKSPACE BODY (SPLIT-SCREEN) */}
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-medium text-slate-600">Đang tải và phân tích dữ liệu OCR Azure AI...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mb-3">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">Không thể tải dữ liệu OCR</h3>
            <p className="text-xs text-slate-500 max-w-md mb-4">{error}</p>
            <button
              onClick={loadOcrData}
              className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold hover:bg-blue-700 transition"
            >
              Thử lại
            </button>
          </div>
        ) : (
          <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
            {/* LEFT PANEL: DOCUMENT PREVIEW WITH BOUNDING BOX OVERLAY */}
            <div className="lg:w-5/12 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden relative">
              <div className="px-4 py-2.5 bg-slate-950/60 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-300">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-400" />
                  <span className="font-semibold text-slate-200">Bản xem trước tệp gốc (Private)</span>
                </div>
                {selectedCell && (
                  <span className="text-[11px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                    Đang chọn ô: Hàng {selectedCell.rowIndex + 1}, Cột {selectedCell.columnIndex + 1}
                  </span>
                )}
              </div>

              <div className="flex-1 p-3 overflow-auto flex items-center justify-center relative bg-slate-950">
                {isPreviewLoading ? (
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <LoadingSpinner size="md" />
                    <span className="text-xs">Đang tải luồng tệp an toàn...</span>
                  </div>
                ) : previewUrl ? (
                  <div className="relative w-full h-full flex items-center justify-center">
                    {ocrData?.document.file_type === 'PDF' ? (
                      <iframe
                        src={previewUrl}
                        title="PDF Viewer"
                        className="w-full h-full rounded-lg border border-slate-800 bg-white"
                      />
                    ) : (
                      <div className="relative max-w-full max-h-full">
                        <img
                          src={previewUrl}
                          alt="Document Preview"
                          className="max-w-full max-h-[75vh] object-contain rounded-lg border border-slate-800"
                        />
                        {/* Selected bounding polygon highlight */}
                        {selectedCell?.boundingPolygon && (
                          <div
                            className="absolute border-2 border-blue-500 bg-blue-500/20 rounded pointer-events-none transition-all duration-300 animate-pulse"
                            style={{
                              left: `${selectedCell.boundingPolygon[0] * 100}%`,
                              top: `${selectedCell.boundingPolygon[1] * 100}%`,
                              width: `${(selectedCell.boundingPolygon[2] - selectedCell.boundingPolygon[0]) * 100}%`,
                              height: `${(selectedCell.boundingPolygon[5] - selectedCell.boundingPolygon[1]) * 100}%`,
                            }}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">Không có bản xem trước tệp.</p>
                )}
              </div>

              {/* Selected Cell Region Info Bar */}
              {selectedCell && (
                <div className="p-3 bg-slate-950 border-t border-slate-800 text-xs text-slate-300 flex items-center justify-between">
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-slate-400">Giá trị OCR:</span>
                    <span className="font-semibold text-white truncate max-w-xs">{selectedCell.rawValue}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-slate-400">Độ tin cậy:</span>
                    <span
                      className={`font-bold ${
                        selectedCell.confidence >= 0.9
                          ? 'text-emerald-400'
                          : selectedCell.confidence >= 0.7
                          ? 'text-amber-400'
                          : 'text-rose-400'
                      }`}
                    >
                      {(selectedCell.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* RIGHT PANEL: STRUCTURED DATA & LIVE TABLE EDITOR */}
            <div className="lg:w-7/12 flex flex-col bg-slate-50 overflow-hidden">
              {/* TABLE CONTROLS & FILTER BAR */}
              <div className="p-4 bg-white border-b border-slate-200 space-y-3 shrink-0">
                {/* Table Tabs if multiple tables */}
                {ocrData?.tables && ocrData.tables.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {ocrData.tables.map((t, idx) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setSelectedTableIndex(idx);
                          setSelectedCellId(null);
                        }}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition shrink-0 ${
                          selectedTableIndex === idx
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        Bảng #{idx + 1} (Trang {t.pageNumber} • {t.rowCount} dòng)
                      </button>
                    ))}
                  </div>
                )}

                {/* Search & Quick Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-1 min-w-[220px]">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Tìm kiếm nội dung trong bảng..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600 text-slate-900"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery('')}
                          className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      onClick={() => setFilterLowConfidenceOnly(!filterLowConfidenceOnly)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border flex items-center gap-1.5 transition ${
                        filterLowConfidenceOnly
                          ? 'bg-amber-500 text-white border-amber-600 shadow-xs'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Chỉ ô cần kiểm tra</span>
                    </button>
                  </div>

                  {/* Add Row Toggle */}
                  {activeTable && (
                    <button
                      onClick={() => {
                        setIsAddingRow(!isAddingRow);
                        setNewRowValues(new Array(activeTable.columnCount).fill(''));
                      }}
                      className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 flex items-center gap-1.5 transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>{isAddingRow ? 'Đóng thêm dòng' : 'Thêm dòng mới'}</span>
                    </button>
                  )}
                </div>

                {/* BANKING RECONCILIATION SUMMARY BAR */}
                {reconciliation && (
                  <div className="p-3 bg-blue-50/70 border border-blue-200/80 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2">
                      <Calculator className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="font-bold text-slate-800">Đối soát số dư & phát sinh:</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <div>
                        <span className="text-slate-500 mr-1">Tổng Nợ:</span>
                        <span className="font-bold text-rose-600">{formatVnd(reconciliation.totalDebit)}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 mr-1">Tổng Có:</span>
                        <span className="font-bold text-emerald-600">{formatVnd(reconciliation.totalCredit)}</span>
                      </div>
                      <div className="border-l border-blue-200 pl-3">
                        <span className="text-slate-500 mr-1">Chênh lệch:</span>
                        <span className="font-bold text-blue-700">{formatVnd(reconciliation.netChange)}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ADD ROW INLINE FORM */}
                {isAddingRow && activeTable && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2 animate-fade-in">
                    <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                      <span>Nhập thông tin dòng mới:</span>
                      <button
                        onClick={() => setIsAddingRow(false)}
                        className="text-slate-400 hover:text-slate-600"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {activeTable.headers.map((h, hIdx) => (
                        <div key={hIdx}>
                          <label className="text-[10px] font-semibold text-slate-500 block truncate">{h}</label>
                          <input
                            type="text"
                            placeholder={`Giá trị ${h}`}
                            value={newRowValues[hIdx] || ''}
                            onChange={(e) => {
                              const updated = [...newRowValues];
                              updated[hIdx] = e.target.value;
                              setNewRowValues(updated);
                            }}
                            className="w-full px-2.5 py-1 text-xs bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-1 focus:ring-blue-600"
                          />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        onClick={() => setIsAddingRow(false)}
                        className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded-lg transition"
                      >
                        Hủy
                      </button>
                      <button
                        onClick={() => handleAddRow(activeTable)}
                        className="px-3 py-1 text-xs font-bold bg-emerald-600 text-white hover:bg-emerald-500 rounded-lg transition"
                      >
                        Xác nhận thêm
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* TABLE CONTAINER */}
              <div className="flex-1 overflow-auto p-4">
                {!activeTable || activeTable.rows.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 py-12">
                    <FileSpreadsheet className="w-10 h-10 mb-2 opacity-50" />
                    <p className="text-xs font-medium">Không tìm thấy dữ liệu bảng trong tài liệu này.</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      {/* TABLE HEADERS */}
                      <thead>
                        <tr className="bg-slate-900 text-slate-100 border-b border-slate-800">
                          <th className="py-3 px-3 w-10 text-center font-bold text-slate-400">#</th>
                          {activeTable.headers.map((head, hIdx) => (
                            <th
                              key={hIdx}
                              className="py-3 px-3.5 font-bold uppercase tracking-wider text-[11px] text-slate-200 border-r border-slate-800 last:border-r-0"
                            >
                              {head}
                            </th>
                          ))}
                          <th className="py-3 px-3 w-16 text-center font-bold text-slate-400">Thao tác</th>
                        </tr>
                      </thead>

                      {/* TABLE BODY */}
                      <tbody className="divide-y divide-slate-200">
                        {activeTable.rows
                          .filter((row) => {
                            if (row.isHeader) return false;
                            if (filterLowConfidenceOnly) {
                              return row.cells.some((c) => c.confidence < 0.85);
                            }
                            if (searchQuery) {
                              return row.cells.some((c) =>
                                c.rawValue.toLowerCase().includes(searchQuery.toLowerCase())
                              );
                            }
                            return true;
                          })
                          .map((row) => (
                            <tr
                              key={row.id}
                              className="hover:bg-blue-50/40 transition group"
                            >
                              {/* Row Index */}
                              <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px] bg-slate-50/50">
                                {row.rowIndex + 1}
                              </td>

                              {/* Cells */}
                              {row.cells.map((cell) => {
                                const isEditing = editingCellId === cell.id;
                                const isSelected = selectedCellId === cell.id;
                                const isLowConf = cell.confidence < 0.7;
                                const isMedConf = cell.confidence >= 0.7 && cell.confidence < 0.9;

                                return (
                                  <td
                                    key={cell.id}
                                    onClick={() => setSelectedCellId(cell.id)}
                                    onDoubleClick={() => startEditCell(cell)}
                                    className={`py-2 px-3 border-r border-slate-100 last:border-r-0 relative transition cursor-pointer ${
                                      isSelected
                                        ? 'bg-blue-50 ring-1 ring-blue-500 z-10'
                                        : isLowConf
                                        ? 'bg-amber-50/60'
                                        : ''
                                    }`}
                                  >
                                    {isEditing ? (
                                      <div className="flex items-center gap-1.5 min-w-[160px] animate-fade-in">
                                        <input
                                          type="text"
                                          value={editValue}
                                          onChange={(e) => setEditValue(e.target.value)}
                                          autoFocus
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') saveCellEdit();
                                            if (e.key === 'Escape') cancelEditCell();
                                          }}
                                          className="flex-1 px-2 py-1 text-xs border border-blue-600 rounded bg-white text-slate-900 focus:outline-none ring-1 ring-blue-600"
                                        />
                                        <select
                                          value={editType}
                                          onChange={(e: any) => setEditType(e.target.value)}
                                          className="text-[10px] bg-slate-100 border border-slate-200 rounded px-1 py-1 text-slate-700"
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
                                          className="p-1 bg-slate-200 text-slate-600 rounded hover:bg-slate-300 transition"
                                          title="Hủy (Esc)"
                                        >
                                          <X className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <div className="flex items-center justify-between gap-1.5 group/cell">
                                        <span
                                          className={`font-medium truncate ${
                                            cell.cellType === 'MONEY'
                                              ? 'font-mono text-slate-900 font-bold'
                                              : cell.cellType === 'DATE'
                                              ? 'font-mono text-slate-700'
                                              : 'text-slate-800'
                                          }`}
                                          title={`Raw: ${cell.rawValue}\nConfidence: ${(
                                            cell.confidence * 100
                                          ).toFixed(1)}%\nLoại: ${cell.cellType}`}
                                        >
                                          {cell.rawValue || <span className="text-slate-300 italic">—</span>}
                                        </span>

                                        {/* Confidence / Review Indicator */}
                                        <div className="flex items-center gap-1 shrink-0">
                                          {cell.isReviewed ? (
                                            <span title="Đã đối soát bởi người dùng">
                                              <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                            </span>
                                          ) : isLowConf ? (
                                            <span
                                              className="flex items-center text-[10px] text-amber-700 font-bold bg-amber-100 px-1 py-0.5 rounded"
                                              title={`Cần kiểm tra: độ tin cậy ${(cell.confidence * 100).toFixed(
                                                0
                                              )}%`}
                                            >
                                              <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                                              {(cell.confidence * 100).toFixed(0)}%
                                            </span>
                                          ) : isMedConf ? (
                                            <span
                                              className="w-1.5 h-1.5 rounded-full bg-amber-400"
                                              title={`Độ tin cậy: ${(cell.confidence * 100).toFixed(0)}%`}
                                            />
                                          ) : null}

                                          {/* Hover Edit Icon */}
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              startEditCell(cell);
                                            }}
                                            className="opacity-0 group-hover/cell:opacity-100 p-0.5 text-slate-400 hover:text-blue-600 transition"
                                            title="Chỉnh sửa ô này"
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
                              <td className="py-2 px-3 text-center">
                                <button
                                  onClick={() => handleDeleteRow(activeTable, row.rowIndex)}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition"
                                  title="Xóa dòng này"
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

              {/* FOOTER HELPER BAR */}
              <div className="px-6 py-2.5 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-500">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
                    Độ tin cậy cao ({'>'}90%)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
                    Độ tin cậy vừa (70–89%)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
                    Ô nghi vấn ({'<'}70%)
                  </span>
                </div>
                <div>
                  <span>Nhấp đúp chuột vào ô bất kỳ để chỉnh sửa trực tiếp số liệu.</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
