import React from 'react';
import { Sparkles, ArrowRight, Zap, Shield } from 'lucide-react';
import { QuotaInfo } from '../../types';

interface QuotaCardProps {
  quota: QuotaInfo | null;
  onUpgradeClick: () => void;
}

export const QuotaCard: React.FC<QuotaCardProps> = ({ quota, onUpgradeClick }) => {
  if (!quota) return null;

  const percentage = Math.min(100, Math.round((quota.used / Math.max(1, quota.total)) * 100));
  const isNearLimit = percentage >= 80;
  const isExhausted = !quota.allowed;

  return (
    <div
      id="dashboard-quota-card"
      className="p-6 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-850 to-slate-900 text-white shadow-sm border border-slate-800 relative overflow-hidden"
    >
      {/* Background soft glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/10 rounded-full blur-3xl -mr-16 -mt-16 pointer-events-none" />

      <div className="relative z-10 flex flex-col justify-between h-full space-y-5">
        <div>
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-500/20 text-blue-300 border border-blue-500/30 uppercase tracking-wide">
                {quota.planName}
              </span>
              <span className="text-xs text-slate-400">Hạn mức tài liệu</span>
            </div>
            <button
              id="btn-quota-upgrade"
              onClick={onUpgradeClick}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 flex items-center gap-1 transition"
            >
              Nâng cấp gói <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-baseline gap-2 mb-1.5">
            <span className="text-3xl font-extrabold text-white tracking-tight">{quota.used}</span>
            <span className="text-slate-400 font-medium">/ {quota.total} tài liệu</span>
          </div>

          <p className="text-xs text-slate-300">
            {isExhausted ? (
              <span className="text-amber-400 font-medium">
                Bạn đã sử dụng hết {quota.total}/{quota.total} tài liệu của gói này.
              </span>
            ) : (
              <span>
                Còn lại <strong className="text-white">{quota.remaining} tài liệu</strong> có thể xử lý.
              </span>
            )}
          </p>
        </div>

        {/* Progress Bar */}
        <div>
          <div className="w-full h-2.5 rounded-full bg-slate-800 overflow-hidden mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isExhausted ? 'bg-amber-500' : isNearLimit ? 'bg-amber-400' : 'bg-blue-500'
              }`}
              style={{ width: `${percentage}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-400 font-medium">
            <span>0 tài liệu</span>
            <span>{percentage}% đã sử dụng</span>
            <span>{quota.total} tài liệu</span>
          </div>
        </div>

        {/* Upgrade Banner in Free Tier */}
        {quota.planId === 'FREE' && (
          <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-slate-300">
              <Zap className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Gói 7 Ngày chỉ từ 29.000đ với 50 tài liệu</span>
            </div>
            <button
              onClick={onUpgradeClick}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-xs shrink-0 transition"
            >
              Xem các gói
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
