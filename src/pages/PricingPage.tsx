import React, { useState, useEffect } from 'react';
import { Check, Sparkles, Zap, Shield, ArrowRight, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Plan } from '../types';
import { api } from '../services/api';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { ErrorAlert } from '../components/common/ErrorAlert';

interface PricingPageProps {
  onNavigate: (tab: string) => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({ onNavigate }) => {
  const { user, quota, updateQuota, refreshProfile, isAuthenticated } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [upgradingPlanId, setUpgradingPlanId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchPlans = async () => {
      try {
        const res = await api.getPlans();
        if (res.success) {
          setPlans(res.plans);
        }
      } catch (err: any) {
        setError(err.message || 'Không thể tải bảng giá gói dịch vụ.');
      } finally {
        setIsLoading(false);
      }
    };
    fetchPlans();
  }, []);

  const handleUpgrade = async (planId: string) => {
    if (!isAuthenticated) {
      onNavigate('register');
      return;
    }

    setUpgradingPlanId(planId);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await api.upgradePlan(planId);
      if (res.success) {
        setSuccessMessage(res.message);
        if (res.quota) {
          updateQuota(res.quota);
        }
        await refreshProfile();
      }
    } catch (err: any) {
      setError(err.message || 'Có lỗi xảy ra khi nâng cấp gói.');
    } finally {
      setUpgradingPlanId(null);
    }
  };

  const formatPrice = (price: number) => {
    if (price === 0) return '0đ';
    return new Intl.NumberFormat('vi-VN').format(price) + 'đ';
  };

  return (
    <div id="pricing-page" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12 animate-fade-in">
      {/* Title Header */}
      <div className="text-center max-w-3xl mx-auto space-y-4">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-50 border border-blue-200 text-blue-700 text-xs font-bold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          Bảng giá dịch vụ minh bạch
        </div>
        <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
          Chọn gói phù hợp với tần suất xử lý của bạn
        </h1>
        <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
          Tối ưu chi phí cho cá nhân kế toán và nhân viên ngân hàng. Không ràng buộc tự động gia hạn định kỳ.
        </p>
      </div>

      {successMessage && (
        <div className="max-w-xl mx-auto p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between">
          <span>{successMessage}</span>
          <button onClick={() => onNavigate('dashboard')} className="text-emerald-900 underline ml-2">
            Về Dashboard
          </button>
        </div>
      )}

      {error && <ErrorAlert message={error} onClose={() => setError(null)} />}

      {/* Pricing Cards Grid */}
      {isLoading ? (
        <LoadingSpinner message="Đang tải dữ liệu gói cước..." />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto items-stretch">
          {plans.map((plan) => {
            const isCurrent = user?.currentPlanId === plan.id;
            const isPopular = plan.id === '7_DAYS_FULL';

            return (
              <div
                key={plan.id}
                id={`pricing-card-${plan.id}`}
                className={`p-8 rounded-3xl flex flex-col justify-between transition relative ${
                  isPopular
                    ? 'bg-gradient-to-b from-blue-900 via-slate-900 to-slate-900 text-white border-2 border-blue-500 shadow-xl'
                    : 'bg-white border border-slate-200 shadow-xs hover:border-slate-300'
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3.5 right-6 px-3.5 py-1 bg-blue-600 text-white text-[11px] font-extrabold rounded-full tracking-wider uppercase shadow-md">
                    Phổ biến nhất
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className={`text-xs font-bold uppercase tracking-wider ${
                        isPopular ? 'text-blue-400' : 'text-slate-500'
                      }`}
                    >
                      {plan.name}
                    </span>
                    {isCurrent && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Đang sử dụng
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-1 my-4">
                    <span className={`text-4xl font-black ${isPopular ? 'text-white' : 'text-slate-900'}`}>
                      {formatPrice(plan.price_vnd)}
                    </span>
                    <span className={`text-xs ${isPopular ? 'text-slate-400' : 'text-slate-500'}`}>
                      / {plan.duration_days >= 365 ? 'vĩnh viễn' : `${plan.duration_days} ngày`}
                    </span>
                  </div>

                  <p className={`text-xs mb-6 ${isPopular ? 'text-slate-300' : 'text-slate-500'}`}>
                    Hạn mức xử lý:{' '}
                    <strong className={isPopular ? 'text-white' : 'text-slate-900'}>
                      {plan.document_quota} tài liệu
                    </strong>
                  </p>

                  <ul className="space-y-3 text-xs mb-8">
                    {plan.features.map((feat, idx) => (
                      <li
                        key={idx}
                        className={`flex items-center gap-2.5 ${isPopular ? 'text-slate-200' : 'text-slate-600'}`}
                      >
                        <Check className={`w-4 h-4 shrink-0 ${isPopular ? 'text-blue-400' : 'text-emerald-600'}`} />
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <button
                    id={`btn-select-plan-${plan.id}`}
                    onClick={() => handleUpgrade(plan.id)}
                    disabled={isCurrent || !!upgradingPlanId}
                    className={`w-full py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
                      isCurrent
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : isPopular
                        ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-md shadow-blue-600/30 active:scale-98'
                        : 'bg-slate-900 hover:bg-slate-800 text-white active:scale-98'
                    }`}
                  >
                    {upgradingPlanId === plan.id ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Đang xử lý...</span>
                      </>
                    ) : isCurrent ? (
                      <span>Gói đang kích hoạt</span>
                    ) : (
                      <>
                        <span>Nâng cấp ngay</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                  <p className="text-[10px] text-center text-slate-400 mt-2">
                    {isCurrent ? 'Bạn đang sử dụng gói này' : 'Kích hoạt ngay lập tức'}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Security Note */}
      <div className="max-w-2xl mx-auto p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
        <Shield className="w-4 h-4 text-emerald-600 inline-block mr-1.5 -mt-0.5" />
        Mọi thanh toán đều được mã hóa an toàn và áp dụng chính sách hoàn trả linh hoạt nếu phát sinh sự cố kỹ thuật.
      </div>
    </div>
  );
};
