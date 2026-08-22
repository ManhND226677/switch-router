"use client";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function GetStarted() {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = (text) => {
    copy(text, "landing");
  };

  return (
    <section className="py-24 px-6 bg-[#1a1a1a]">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-16 items-start">
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-bold mb-6">Bắt đầu chỉ trong vài bước</h2>
            <p className="text-gray-400 text-lg mb-8">
              Chạy Web app cục bộ, cấu hình nhà cung cấp trong dashboard, rồi định tuyến yêu cầu AI.
            </p>
            
            <div className="flex flex-col gap-6">
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-brand-500/20 text-brand-500 flex items-center justify-center font-bold">1</div>
                <div>
                  <h4 className="font-bold text-lg">Cài đặt phụ thuộc</h4>
                  <p className="text-sm text-gray-500 mt-1">Chạy npm install từ thư mục gốc của repo</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-brand-500/20 text-brand-500 flex items-center justify-center font-bold">2</div>
                <div>
                  <h4 className="font-bold text-lg">Mở dashboard</h4>
                  <p className="text-sm text-gray-500 mt-1">Cấu hình nhà cung cấp và khóa API qua giao diện web</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-brand-500/20 text-brand-500 flex items-center justify-center font-bold">3</div>
                <div>
                  <h4 className="font-bold text-lg">Định tuyến yêu cầu</h4>
                  <p className="text-sm text-gray-500 mt-1">Trỏ công cụ cục bộ tới http://127.0.0.1:28701/v1</p>
                </div>
              </div>
            </div>
          </div>

          <div className="flex-1 w-full">
            <div className="rounded-xl overflow-hidden bg-[#262626] border border-[#333333] shadow-2xl">
              <div className="flex items-center gap-2 px-4 py-3 bg-[#252526] border-b border-gray-700">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <div className="ml-2 text-xs text-gray-500 font-mono">terminal</div>
              </div>
              
              <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
                <div 
                  className="flex items-center gap-2 mb-4 group cursor-pointer"
                  onClick={() => handleCopy("npm install && npm run dev")}
                >
                  <span className="text-green-400">$</span>
                  <span className="text-white">npm install &amp;&amp; npm run dev</span>
                  <span className="ml-auto text-gray-500 text-xs opacity-0 group-hover:opacity-100">
                    {copied === "landing" ? "✓ Đã sao chép" : "Sao chép"}
                  </span>
                </div>
                
                <div className="text-gray-400 mb-6">
                  <span className="text-brand-500">&gt;</span> Đang khởi động máy chủ cục bộ...<br/>
                  <span className="text-brand-500">&gt;</span> Máy chủ chạy tại <span className="text-blue-400">http://127.0.0.1:28701</span><br/>
                  <span className="text-brand-500">&gt;</span> Dashboard: <span className="text-blue-400">http://127.0.0.1:28701/dashboard</span><br/>
                  <span className="text-green-400">&gt;</span> Sẵn sàng định tuyến! ✓
                </div>
                
                <div className="text-xs text-gray-500 mb-2 border-t border-gray-700 pt-4">
                  📝 Cấu hình nhà cung cấp trong dashboard hoặc dùng biến môi trường
                </div>
                
                <div className="text-gray-400 text-xs">
                  <span className="text-purple-400">Vị trí dữ liệu:</span><br/>
                  <span className="text-gray-500">  Tất cả nền tảng:</span> DATA_DIR/db/data.sqlite
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
