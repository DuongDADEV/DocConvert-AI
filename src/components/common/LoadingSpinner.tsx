import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  message?: string;
  fullScreen?: boolean;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Đang tải dữ liệu...',
  fullScreen = false,
}) => {
  if (fullScreen) {
    return (
      <div id="loading-fullscreen" className="min-h-screen flex flex-col items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center p-8 bg-white rounded-2xl shadow-sm border border-slate-200">
          <Loader2 className="w-10 h-10 text-slate-800 animate-spin mb-4" />
          <p className="text-slate-700 font-medium text-base">{message}</p>
          <span className="text-xs text-slate-400 mt-1">DocConvert AI Secure Platform</span>
        </div>
      </div>
    );
  }

  return (
    <div id="loading-inline" className="flex items-center justify-center p-8 text-slate-600 gap-3">
      <Loader2 className="w-6 h-6 animate-spin text-slate-700" />
      <span className="text-sm font-medium">{message}</span>
    </div>
  );
};
