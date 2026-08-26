import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  X,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Sparkles,
  ShieldCheck,
  FileType,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { api } from '../../services/api';
import { ErrorAlert } from '../common/ErrorAlert';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (documentId: string) => void;
}

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { quota, updateQuota } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const validateFile = (selectedFile: File): boolean => {
    setError(null);
    const validExtensions = ['.pdf', '.jpg', '.jpeg', '.png'];
    const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();

    if (!validExtensions.includes(ext)) {
      setError('Định dạng tệp không được hỗ trợ. Vui lòng chỉ chọn tệp PDF, JPG, JPEG hoặc PNG.');
      return false;
    }

    const maxSize = 20 * 1024 * 1024; // 20 MB
    if (selectedFile.size > maxSize) {
      setError('Kích thước tệp vượt quá giới hạn cho phép (tối đa 20MB).');
      return false;
    }

    return true;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selected = e.target.files[0];
      if (validateFile(selected)) {
        setFile(selected);
      }
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const dropped = e.dataTransfer.files[0];
      if (validateFile(dropped)) {
        setFile(dropped);
      }
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Vui lòng chọn một tệp để tải lên.');
      return;
    }

    if (quota && !quota.allowed) {
      setError(quota.message || 'Bạn đã sử dụng hết số tài liệu của gói hiện tại. Vui lòng nâng cấp gói.');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const result = await api.uploadDocument(file);
      if (result.success && result.document) {
        if (result.quota) {
          updateQuota(result.quota);
        }
        onSuccess(result.document.id);
        onClose();
      } else {
        setError(result.message || 'Có lỗi xảy ra khi tải tài liệu');
      }
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra khi tải tài liệu. Vui lòng thử lại.');
    } finally {
      setIsUploading(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div
      id="upload-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in"
    >
      <div
        id="upload-modal-container"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden animate-scale-up"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">Tải tài liệu cần chuyển đổi</h3>
              <p className="text-xs text-slate-500">Sao kê ngân hàng, hóa đơn scan hoặc bảng biểu hình ảnh</p>
            </div>
          </div>
          <button
            id="btn-close-upload-modal"
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {error && <ErrorAlert message={error} onClose={() => setError(null)} />}

          {/* Quota Check Alert */}
          {quota && !quota.allowed && (
            <div
              id="quota-exceeded-alert"
              className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-sm flex items-start gap-3"
            >
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">{quota.message}</p>
                <p className="text-xs text-amber-700 mt-1">
                  Hãy nâng cấp gói để tiếp tục chuyển đổi các tập tin tiếp theo.
                </p>
              </div>
            </div>
          )}

          {/* Drag & Drop Zone */}
          <div
            id="dropzone-area"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => !isUploading && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center ${
              isDragging
                ? 'border-blue-500 bg-blue-50/50'
                : 'border-slate-300 hover:border-blue-400 bg-slate-50/40 hover:bg-blue-50/20'
            }`}
          >
            <input
              ref={fileInputRef}
              id="file-input-upload"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              className="hidden"
              onChange={handleFileChange}
              disabled={isUploading}
            />

            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3 shadow-xs">
              <UploadCloud className="w-6 h-6" />
            </div>

            <p className="text-sm font-semibold text-slate-800 mb-1">
              Kéo và thả tệp vào đây, hoặc <span className="text-blue-600 underline">chọn từ thiết bị</span>
            </p>
            <p className="text-xs text-slate-400">Hỗ trợ: PDF Scan, JPG, JPEG, PNG (Tối đa 20MB / tệp)</p>
          </div>

          {/* Selected File Card */}
          {file && (
            <div
              id="selected-file-card"
              className="p-3.5 rounded-xl bg-blue-50/60 border border-blue-200 flex items-center justify-between"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                  <FileType className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{file.name}</p>
                  <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                </div>
              </div>
              <button
                id="btn-remove-selected-file"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setFile(null);
                }}
                disabled={isUploading}
                className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Security & Azure AI Disclosure */}
          <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>Phân tích OCR bằng Azure AI Document Intelligence</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Tài liệu của bạn sẽ được lưu trữ an toàn trong vùng lưu trữ cách ly riêng tư và trích xuất cấu trúc bảng với độ chính xác cao.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-200/50">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>Dữ liệu của bạn được cô lập 100% và không bao giờ chia sẻ công khai.</span>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <button
            id="btn-cancel-upload"
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 transition"
          >
            Hủy
          </button>
          <button
            id="btn-confirm-upload"
            type="button"
            onClick={handleUpload}
            disabled={!file || isUploading || (quota ? !quota.allowed : false)}
            className={`inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-semibold text-white shadow-sm transition ${
              !file || isUploading || (quota ? !quota.allowed : false)
                ? 'bg-slate-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 active:scale-95'
            }`}
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Đang tải lên & chuẩn bị...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                <span>Bắt đầu xử lý</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
