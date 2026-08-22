"use client";

export default function Footer() {
  return (
    <footer className="border-t border-[#333333] bg-[#1a1a1a] pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-16">
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="size-6 rounded bg-brand-500 flex items-center justify-center text-white">
                <span className="material-symbols-outlined text-base">hub</span>
              </div>
              <h3 className="text-white text-lg font-bold">Switch-Router</h3>
            </div>
            <p className="text-gray-500 text-sm max-w-xs mb-6">
              Điểm cuối cục bộ để kết nối và quản lý các nhà cung cấp AI của bạn.
            </p>
          </div>
          
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Sản phẩm</h4>
            <a className="text-gray-400 hover:text-brand-500 text-sm transition-colors" href="#features">Tính năng</a>
            <a className="text-gray-400 hover:text-brand-500 text-sm transition-colors" href="/dashboard">Bảng điều khiển</a>
            <a className="text-gray-400 hover:text-brand-500 text-sm transition-colors" href="/dashboard/combos">Kết hợp</a>
          </div>
          
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Tài nguyên</h4>
            <a className="text-gray-400 hover:text-brand-500 text-sm transition-colors" href="/dashboard/endpoint">Điểm cuối</a>
          </div>
          
          <div className="flex flex-col gap-4">
            <h4 className="font-bold text-white">Thông tin</h4>
            <span className="text-gray-400 text-sm">Chạy hoàn toàn cục bộ</span>
          </div>
        </div>
        
        <div className="border-t border-[#333333] pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-gray-600 text-sm">Switch-Router · Phiên bản cục bộ</p>
          <div className="flex gap-6">
            <a className="text-gray-600 hover:text-white text-sm transition-colors" href="/dashboard">Bảng điều khiển</a>
            <a className="text-gray-600 hover:text-white text-sm transition-colors" href="/dashboard/profile">Cài đặt</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
