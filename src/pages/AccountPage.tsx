import React, { useState } from 'react';
import { User, Shield, Key, Sparkles, CheckCircle2, Lock, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { ErrorAlert } from '../components/common/ErrorAlert';

interface AccountPageProps {
  onNavigate: (tab: string) => void;
}

export const AccountPage: React.FC<AccountPageProps> = ({ onNavigate }) => {
  const { user, quota } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!currentPassword || !newPassword) {
      setError('Vui lòng nhập mật khẩu hiện tại và mật khẩu mới.');
      return;
    }

    if (newPassword.length < 6) {
      setError('Mật khẩu mới phải có ít nhất 6 ký tự.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.changePassword({ currentPassword, newPassword });
      if (res.success) {
        setSuccessMessage('Đổi mật khẩu thành công!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
      }
    } catch (err: any) {
      setError(err.message || 'Không thể thay đổi mật khẩu.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'Chưa có thông tin';
    try {
      return new Date(isoString).toLocaleDateString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <div id="account-page" className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8 animate-fade-in">
      {/* Header */}
      <div className="border-b border-slate-200 pb-6">
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Thông tin tài khoản</h1>
        <p className="text-xs text-slate-500 mt-1">
          Quản lý thông tin định danh, gói dịch vụ và cài đặt bảo mật của bạn
        </p>
      </div>

      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && <ErrorAlert message={error} onClose={() => setError(null)} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Left Column: Profile & Subscription info */}
        <div className="md:col-span-1 space-y-6">
          {/* User Profile Card */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 text-white font-black text-xl flex items-center justify-center shadow-sm">
              {user?.fullName ? user.fullName[0].toUpperCase() : 'U'}
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900">{user?.fullName}</h3>
              <p className="text-xs text-slate-500">{user?.email}</p>
            </div>

            <div className="pt-3 border-t border-slate-100 text-xs text-slate-500 space-y-1">
              <p>
                Ngày tham gia: <strong className="text-slate-700">{formatDate(user?.createdAt)}</strong>
              </p>
              <p>
                Mã định danh: <span className="font-mono text-[10px] text-slate-400">{user?.id}</span>
              </p>
            </div>
          </div>

          {/* Current Subscription Card */}
          <div className="p-6 rounded-2xl bg-slate-900 text-white shadow-xs space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-400 uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              Gói dịch vụ
            </div>
            <h4 className="text-xl font-extrabold text-white">{quota?.planName || 'Gói Miễn Phí'}</h4>
            <p className="text-xs text-slate-300">
              Đã sử dụng: <strong className="text-white">{quota?.used}</strong> / {quota?.total} tài liệu
            </p>
            <button
              onClick={() => onNavigate('pricing')}
              className="w-full mt-2 py-2 px-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-xs font-bold text-white transition"
            >
              Nâng cấp gói cước
            </button>
          </div>
        </div>

        {/* Right Column: Security & Password Change */}
        <div className="md:col-span-2 space-y-6">
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-6">
            <div className="flex items-center gap-2.5 pb-4 border-b border-slate-100">
              <Key className="w-5 h-5 text-blue-600" />
              <div>
                <h3 className="font-bold text-sm text-slate-900">Đổi mật khẩu tài khoản</h3>
                <p className="text-xs text-slate-500">Cập nhật mật khẩu định kỳ để bảo vệ tài liệu tài chính</p>
              </div>
            </div>

            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Mật khẩu hiện tại
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="••••••••"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Mật khẩu mới
                  </label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="••••••••"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Xác nhận mật khẩu mới
                  </label>
                  <input
                    type="password"
                    required
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    placeholder="••••••••"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-sm transition disabled:opacity-60 flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang lưu...</span>
                    </>
                  ) : (
                    <span>Cập nhật mật khẩu</span>
                  )}
                </button>
              </div>
            </form>
          </div>

          {/* Data Privacy & RLS notice */}
          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-2">
            <div className="flex items-center gap-2 font-bold text-slate-800">
              <Shield className="w-4 h-4 text-emerald-600" />
              <span>Chính sách Cách ly Dữ liệu (Row Level Security)</span>
            </div>
            <p className="text-slate-500 leading-relaxed text-[11px]">
              Tài khoản của bạn được cấp quyền truy cập hoàn toàn riêng biệt. Không có bất kỳ người dùng nào khác có thể
              truy cập, xem hoặc xóa tài liệu của bạn trong kho lưu trữ riêng.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
