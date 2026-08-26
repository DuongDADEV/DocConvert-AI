import React from 'react';
import {
  FileSpreadsheet,
  FileText,
  CheckCircle2,
  ShieldCheck,
  Zap,
  Lock,
  ArrowRight,
  Sparkles,
  Building2,
  Table,
  Check,
  HelpCircle,
  Clock,
  Layers,
  ChevronRight,
} from 'lucide-react';

interface LandingPageProps {
  onNavigate: (tab: string) => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onNavigate }) => {
  return (
    <div id="landing-page" className="min-h-screen bg-slate-50 text-slate-900">
      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden pt-12 pb-20 lg:pt-20 lg:pb-28 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="max-w-3xl mx-auto text-center">
            {/* Tag badge */}
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              Công nghệ Azure AI Document Intelligence
            </div>

            {/* Main Headline */}
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white leading-tight mb-6">
              Chuyển PDF Scan thành Excel/Word{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-sky-300">
                nhanh hơn, chính xác hơn.
              </span>
            </h1>

            {/* Subheading */}
            <p className="text-lg sm:text-xl text-slate-300 mb-8 leading-relaxed font-normal">
              Đặc biệt dành cho sao kê ngân hàng, tài liệu scan và bảng dữ liệu cần nhập lại thủ công. Giữ nguyên cấu trúc
              bảng, tự động kiểm tra số dư và hỗ trợ đối soát số liệu trước khi xuất file.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
              <button
                id="hero-btn-try-free"
                type="button"
                onClick={() => onNavigate('register')}
                className="w-full sm:w-auto px-8 py-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-base font-bold shadow-lg shadow-blue-600/30 transition transform hover:-translate-y-0.5 active:translate-y-0 flex items-center justify-center gap-2"
              >
                <span>Thử miễn phí 3 tài liệu</span>
                <ArrowRight className="w-4 h-4" />
              </button>
              <button
                id="hero-btn-login"
                type="button"
                onClick={() => onNavigate('login')}
                className="w-full sm:w-auto px-8 py-4 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-200 hover:text-white text-base font-semibold border border-slate-700 transition"
              >
                Đăng nhập tài khoản
              </button>
            </div>

            {/* Trust Badges */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-left border-t border-slate-800/80 pt-8 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Bảo mật dữ liệu ngân hàng</span>
              </div>
              <div className="flex items-center gap-2">
                <Table className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Phục hồi bảng đa trang</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Cảnh báo ô tự tin thấp</span>
              </div>
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-blue-400 shrink-0" />
                <span>Lưu trữ cô lập 100%</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. PROBLEM STATEMENT */}
      <section className="py-16 lg:py-24 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-2">Vấn đề cốt lõi</h2>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Tại sao các công cụ chuyển PDF thông thường thường xuyên gây lỗi?
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 flex items-center justify-center font-bold mb-4">
                1
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">PDF thực chất là ảnh scan</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Nhiều sao kê ngân hàng và tài liệu lưu trữ là file scan, không chứa text có thể bôi đen. Các công cụ miễn
                phí thường bỏ sót dòng hoặc chuyển thành các ký tự vô nghĩa.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 font-bold flex items-center justify-center mb-4">
                2
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">Vỡ cấu trúc bảng & gộp ô sai</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Số dư, ngày tháng và nội dung giao dịch bị dồn chung vào một ô, làm nhân viên kế toán phải mất hàng giờ
                tách cột và nhập lại bằng tay.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-600 font-bold flex items-center justify-center mb-4">
                3
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-2">Âm thầm sửa sai số tiền tài chính</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Nhầm lẫn giữa số 0 và chữ O, dấu chấm và dấu phẩy hàng nghìn dẫn đến sai lệch số dư báo cáo tài chính mà
                không có cơ chế cảnh báo.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 3. HOW IT WORKS */}
      <section className="py-16 lg:py-24 bg-slate-100/70 border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-2">Quy trình xử lý</h2>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              4 bước chuyển đổi tài liệu chuẩn xác
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs relative">
              <div className="text-3xl font-black text-blue-600/20 mb-2">01</div>
              <h4 className="font-bold text-slate-800 text-base mb-1.5">Tải lên tệp an toàn</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Tải tệp PDF, JPG, PNG vào kho lưu trữ riêng tư cô lập theo tài khoản người dùng.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs relative">
              <div className="text-3xl font-black text-blue-600/20 mb-2">02</div>
              <h4 className="font-bold text-slate-800 text-base mb-1.5">Phân tích bố cục Azure AI</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Trích xuất bảng biểu, nhận dạng hàng cột và đánh giá điểm tự tin (Confidence Score) từng ô.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs relative">
              <div className="text-3xl font-black text-blue-600/20 mb-2">03</div>
              <h4 className="font-bold text-slate-800 text-base mb-1.5">Đối soát & Kiểm tra</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Xem đối sánh hai màn hình song song giữa tài liệu gốc và bảng trích xuất, chỉnh sửa ô nếu cần.
              </p>
            </div>

            <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs relative">
              <div className="text-3xl font-black text-blue-600/20 mb-2">04</div>
              <h4 className="font-bold text-slate-800 text-base mb-1.5">Xuất file Excel / Word</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Tải về tệp .xlsx hoặc .docx định dạng chuẩn với tiêu đề in đậm, đường viền và format số chuẩn.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. SUPPORTED DOCUMENT TYPES */}
      <section className="py-16 lg:py-24 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-2">Phạm vi ứng dụng</h2>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Tối ưu cho tài liệu ngân hàng & văn phòng Việt Nam
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="p-6 rounded-2xl border border-slate-200 bg-slate-50/50">
              <Building2 className="w-8 h-8 text-blue-600 mb-3" />
              <h3 className="font-bold text-slate-900 text-base mb-1">Sao kê tài khoản ngân hàng</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Vietcombank, Techcombank, BIDV, Agribank, VPBank, MBBank, ACB... với cấu trúc Ngày | Diễn giải | Ghi nợ |
                Ghi có | Số dư.
              </p>
            </div>

            <div className="p-6 rounded-2xl border border-slate-200 bg-slate-50/50">
              <FileText className="w-8 h-8 text-blue-600 mb-3" />
              <h3 className="font-bold text-slate-900 text-base mb-1">Hóa đơn & Báo cáo tài chính</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Bảng cân đối kế toán, báo cáo lưu chuyển tiền tệ, bảng kê hàng hóa dịch vụ mua vào/bán ra.
              </p>
            </div>

            <div className="p-6 rounded-2xl border border-slate-200 bg-slate-50/50">
              <Table className="w-8 h-8 text-blue-600 mb-3" />
              <h3 className="font-bold text-slate-900 text-base mb-1">Bảng tổng hợp chấm công & Lương</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Danh sách nhân viên, ngày công, các khoản phụ cấp và khấu trừ được chuyển sang bảng tính nguyên vẹn.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. PRICING PLANS */}
      <section className="py-16 lg:py-24 bg-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <h2 className="text-xs font-bold uppercase tracking-widest text-blue-400 mb-2">Bảng giá minh bạch</h2>
            <p className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Bắt đầu miễn phí, nâng cấp khi có nhu cầu cao hơn
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {/* FREE PLAN */}
            <div className="p-8 rounded-3xl bg-slate-800/80 border border-slate-700 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase mb-2">Miễn Phí</div>
                <h3 className="text-2xl font-black text-white mb-2">Gói FREE</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-extrabold text-white">0đ</span>
                  <span className="text-xs text-slate-400">/ dùng thử</span>
                </div>
                <ul className="space-y-3 text-xs text-slate-300 mb-8">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <strong>3 tài liệu miễn phí</strong>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    Trích xuất bảng OCR cơ bản
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    Giao diện đối soát số liệu
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    Xuất file Excel (.xlsx) & Word (.docx)
                  </li>
                </ul>
              </div>
              <button
                onClick={() => onNavigate('register')}
                className="w-full py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition"
              >
                Đăng ký ngay
              </button>
            </div>

            {/* 7 DAYS FULL */}
            <div className="p-8 rounded-3xl bg-blue-900/40 border-2 border-blue-500 flex flex-col justify-between relative shadow-xl">
              <div className="absolute -top-3.5 right-6 px-3 py-1 bg-blue-500 text-white text-[11px] font-extrabold rounded-full tracking-wider uppercase">
                Phổ biến nhất
              </div>
              <div>
                <div className="text-xs font-bold text-blue-400 uppercase mb-2">7 Ngày Đầy Đủ</div>
                <h3 className="text-2xl font-black text-white mb-2">Gói Tuần</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-extrabold text-white">29.000đ</span>
                  <span className="text-xs text-slate-400">/ 7 ngày</span>
                </div>
                <ul className="space-y-3 text-xs text-slate-200 mb-8">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-blue-400 shrink-0" />
                    <strong>50 tài liệu / 7 ngày</strong>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-blue-400 shrink-0" />
                    Ưu tiên xử lý Azure AI tốc độ cao
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-blue-400 shrink-0" />
                    Đối soát số dư & sao kê ngân hàng
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-blue-400 shrink-0" />
                    Xuất Excel/Word không giới hạn số dòng
                  </li>
                </ul>
              </div>
              <button
                onClick={() => onNavigate('register')}
                className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition shadow-md shadow-blue-600/30"
              >
                Chọn Gói 7 Ngày
              </button>
            </div>

            {/* 30 DAYS FULL */}
            <div className="p-8 rounded-3xl bg-slate-800/80 border border-slate-700 flex flex-col justify-between">
              <div>
                <div className="text-xs font-bold text-slate-400 uppercase mb-2">30 Ngày Toàn Diện</div>
                <h3 className="text-2xl font-black text-white mb-2">Gói Tháng</h3>
                <div className="flex items-baseline gap-1 mb-6">
                  <span className="text-4xl font-extrabold text-white">79.000đ</span>
                  <span className="text-xs text-slate-400">/ 30 ngày</span>
                </div>
                <ul className="space-y-3 text-xs text-slate-300 mb-8">
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <strong>250 tài liệu / 30 ngày</strong>
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    Hỗ trợ tài liệu ngân hàng đa trang
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    Bộ lọc và chuẩn hóa dữ liệu tài chính
                  </li>
                  <li className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    Hỗ trợ kỹ thuật ưu tiên 24/7
                  </li>
                </ul>
              </div>
              <button
                onClick={() => onNavigate('register')}
                className="w-full py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-semibold text-sm transition"
              >
                Chọn Gói 30 Ngày
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 6. CALL TO ACTION */}
      <section className="py-16 bg-blue-600 text-white text-center">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl sm:text-4xl font-extrabold mb-4">
            Bắt đầu chuyển đổi sao kê ngân hàng & PDF Scan ngay hôm nay
          </h2>
          <p className="text-blue-100 text-sm sm:text-base max-w-xl mx-auto mb-8 leading-relaxed">
            Đăng ký tài khoản miễn phí trong 30 giây và trải nghiệm độ chính xác vượt trội.
          </p>
          <button
            id="cta-bottom-register"
            onClick={() => onNavigate('register')}
            className="px-8 py-4 rounded-xl bg-white text-blue-700 font-bold text-base hover:bg-blue-50 shadow-lg transition active:scale-95"
          >
            Tạo tài khoản miễn phí
          </button>
        </div>
      </section>
    </div>
  );
};
