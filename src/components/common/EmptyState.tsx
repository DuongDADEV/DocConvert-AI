import React from 'react';
import { FileUp, Plus } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  description?: string;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title = 'Bạn chưa có tài liệu nào.',
  description = 'Thả file PDF scan hoặc hình ảnh vào đây để bắt đầu chuyển đổi sang Excel/Word.',
  actionText = '+ Tải tài liệu mới',
  onAction,
}) => {
  return (
    <div
      id="empty-state-card"
      className="p-12 text-center rounded-2xl bg-white border border-dashed border-slate-300 flex flex-col items-center justify-center my-4 animate-fade-in"
    >
      <div className="w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
        <FileUp className="w-7 h-7" />
      </div>
      <h3 className="text-base font-bold text-slate-800 mb-1">{title}</h3>
      <p className="text-sm text-slate-500 max-w-sm mb-6 leading-relaxed">{description}</p>
      {onAction && (
        <button
          id="btn-empty-state-action"
          type="button"
          onClick={onAction}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-sm transition active:scale-95"
        >
          <Plus className="w-4 h-4" />
          {actionText}
        </button>
      )}
    </div>
  );
};
