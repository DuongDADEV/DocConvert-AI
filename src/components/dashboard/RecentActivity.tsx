import React from 'react';
import { Activity, UploadCloud, Trash2, LogIn, Key, Sparkles, Clock } from 'lucide-react';
import { AuditLog } from '../../types';

interface RecentActivityProps {
  logs: AuditLog[];
}

export const RecentActivity: React.FC<RecentActivityProps> = ({ logs }) => {
  const getActionInfo = (action: string) => {
    switch (action) {
      case 'UPLOAD_DOCUMENT':
        return {
          icon: <UploadCloud className="w-4 h-4 text-blue-600" />,
          bg: 'bg-blue-50',
          title: 'Tải lên tài liệu mới',
        };
      case 'DELETE_DOCUMENT':
        return {
          icon: <Trash2 className="w-4 h-4 text-rose-600" />,
          bg: 'bg-rose-50',
          title: 'Xóa tài liệu khỏi lưu trữ riêng tư',
        };
      case 'LOGIN':
        return {
          icon: <LogIn className="w-4 h-4 text-emerald-600" />,
          bg: 'bg-emerald-50',
          title: 'Đăng nhập vào hệ thống',
        };
      case 'REGISTER':
        return {
          icon: <Sparkles className="w-4 h-4 text-amber-600" />,
          bg: 'bg-amber-50',
          title: 'Đăng ký tài khoản thành công',
        };
      case 'UPDATE_PASSWORD':
        return {
          icon: <Key className="w-4 h-4 text-indigo-600" />,
          bg: 'bg-indigo-50',
          title: 'Thay đổi mật khẩu tài khoản',
        };
      case 'UPGRADE_PLAN':
        return {
          icon: <Sparkles className="w-4 h-4 text-purple-600" />,
          bg: 'bg-purple-50',
          title: 'Nâng cấp gói dịch vụ',
        };
      default:
        return {
          icon: <Activity className="w-4 h-4 text-slate-600" />,
          bg: 'bg-slate-50',
          title: action,
        };
    }
  };

  const formatDate = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div id="recent-activity-panel" className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-slate-700" />
          <h3 className="font-bold text-slate-800 text-sm">Nhật ký bảo mật & Hoạt động</h3>
        </div>
        <span className="text-xs text-slate-400">Ghi nhận minh bạch</span>
      </div>

      {logs.length === 0 ? (
        <p className="text-xs text-slate-400 py-4 text-center">Chưa có hoạt động nào được ghi nhận.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {logs.slice(0, 6).map((log) => {
            const info = getActionInfo(log.action);
            return (
              <div key={log.id} className="py-3 flex items-start justify-between gap-3 text-xs">
                <div className="flex items-start gap-3 min-w-0">
                  <div className={`w-8 h-8 rounded-lg ${info.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                    {info.icon}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">{info.title}</p>
                    {log.metadata?.filename && (
                      <p className="text-slate-500 text-[11px] truncate">{log.metadata.filename}</p>
                    )}
                    {log.metadata?.planName && (
                      <p className="text-purple-600 text-[11px] font-medium">{log.metadata.planName}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 text-slate-400 text-[11px] shrink-0">
                  <Clock className="w-3 h-3" />
                  <span>{formatDate(log.created_at)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
