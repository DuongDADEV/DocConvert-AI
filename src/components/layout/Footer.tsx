import React from 'react';
import { ShieldCheck, Lock, CheckCircle2, FileSpreadsheet } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer id="main-footer" className="bg-slate-950 text-slate-400 border-t border-slate-900 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Brand Col */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <span className="font-bold text-lg text-white">DocConvert AI</span>
            </div>
            <p className="text-sm text-slate-400 max-w-sm mb-4 leading-relaxed">
              Nền tảng SaaS chuyên biệt chuyển đổi PDF Scan và sao kê ngân hàng thành Excel và Word với độ chính xác cao
              và giao diện đối soát số liệu an toàn.
            </p>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <div className="flex items-center gap-1">
                <Lock className="w-3.5 h-3.5 text-blue-400" />
                Lưu trữ cô lập riêng tư
              </div>
              <div className="flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Bảo mật mã hóa đầu-cuối
              </div>
            </div>
          </div>

          {/* Feature List */}
          <div>
            <h4 className="text-xs font-bold text-slate-300 tracking-wider uppercase mb-3">Dịch vụ</h4>
            <ul className="space-y-2 text-sm">
              <li className="flex items-center gap-1.5 text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> Chuyển sao kê ngân hàng
              </li>
              <li className="flex items-center gap-1.5 text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> Phục hồi cấu trúc bảng
              </li>
              <li className="flex items-center gap-1.5 text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> Đối soát số dư & giao dịch
              </li>
              <li className="flex items-center gap-1.5 text-slate-400">
                <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" /> Xuất Excel & Word chuẩn
              </li>
            </ul>
          </div>

          {/* Security & Tech */}
          <div>
            <h4 className="text-xs font-bold text-slate-300 tracking-wider uppercase mb-3">Công nghệ & Bảo mật</h4>
            <p className="text-xs text-slate-400 leading-relaxed mb-2">
              Tích hợp công nghệ phân tích bố cục tài liệu từ Azure AI Document Intelligence với mô hình prebuilt-layout.
            </p>
            <div className="text-[11px] text-slate-400 border-t border-slate-900 pt-2">
              Bảo mật phân quyền Row Level Security (RLS) bảo vệ độc lập 100% dữ liệu từng người dùng.
            </div>
          </div>
        </div>

        <div className="border-t border-slate-900 pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>© {new Date().getFullYear()} DocConvert AI Platform. Bảo lưu mọi quyền.</p>
          <p className="flex items-center gap-4">
            <span>Tiêu chuẩn bảo mật tài chính & kế toán</span>
            <span>•</span>
            <span>Chính sách bảo mật dữ liệu riêng tư</span>
          </p>
        </div>
      </div>
    </footer>
  );
};
