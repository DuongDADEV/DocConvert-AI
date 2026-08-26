import React from 'react';
import { Clock, CheckCircle2, AlertTriangle, XCircle, FileText, Loader2 } from 'lucide-react';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const isSm = size === 'sm';
  const sizeClasses = isSm ? 'text-xs px-2.5 py-0.5' : 'text-sm px-3 py-1';

  switch (status) {
    case 'READY':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 ${sizeClasses}`}
        >
          <CheckCircle2 className={isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          Đã hoàn tất
        </span>
      );

    case 'REVIEW_REQUIRED':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-amber-50 text-amber-700 border border-amber-200 ${sizeClasses}`}
        >
          <AlertTriangle className={isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          Cần kiểm tra
        </span>
      );

    case 'PROCESSING':
    case 'PARSING':
    case 'VALIDATING':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-blue-50 text-blue-700 border border-blue-200 ${sizeClasses}`}
        >
          <Loader2 className={`${isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} animate-spin`} />
          Đang xử lý OCR
        </span>
      );

    case 'QUEUED':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-100 text-slate-700 border border-slate-200 ${sizeClasses}`}
        >
          <Clock className={isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          Đang chờ xử lý
        </span>
      );

    case 'FAILED':
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-rose-50 text-rose-700 border border-rose-200 ${sizeClasses}`}
        >
          <XCircle className={isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          Lỗi xử lý
        </span>
      );

    case 'UPLOADED':
    default:
      return (
        <span
          id={`status-badge-${status}`}
          className={`inline-flex items-center gap-1.5 font-medium rounded-full bg-slate-50 text-slate-600 border border-slate-200 ${sizeClasses}`}
        >
          <FileText className={isSm ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          Đã tải lên
        </span>
      );
  }
};
