import React from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ErrorAlertProps {
  message: string;
  onClose?: () => void;
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({ message, onClose }) => {
  if (!message) return null;

  return (
    <div
      id="error-alert-banner"
      className="p-4 mb-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start justify-between gap-3 animate-fade-in"
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
        <div className="text-sm font-medium leading-relaxed">{message}</div>
      </div>
      {onClose && (
        <button
          id="btn-close-error-alert"
          type="button"
          onClick={onClose}
          className="text-rose-500 hover:text-rose-700 transition p-1"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};
