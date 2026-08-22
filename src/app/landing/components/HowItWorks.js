"use client";

export default function HowItWorks() {
  return (
    <section className="py-24 border-y border-[#333333] bg-[#262626]/30" id="how-it-works">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Switch-Router hoạt động như thế nào</h2>
          <p className="text-gray-400 max-w-xl text-lg">
            Dữ liệu đi từ ứng dụng của bạn qua lớp định tuyến thông minh rồi tới nhà cung cấp phù hợp nhất.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-[2px] bg-linear-to-r from-gray-700 via-brand-500 to-gray-700 -z-10"></div>
          
          <div className="flex flex-col gap-6 relative group">
            <div className="w-24 h-24 rounded-2xl bg-[#1a1a1a] border border-[#333333] flex items-center justify-center shadow-xl group-hover:border-gray-500 transition-colors z-10 mx-auto md:mx-0">
              <span className="material-symbols-outlined text-4xl text-gray-300">terminal</span>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">1. CLI &amp; SDK</h3>
              <p className="text-sm text-gray-400">
                Yêu cầu bắt đầu từ công cụ hoặc SDK thống nhất. Chỉ cần đổi base URL.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6 relative group md:items-center md:text-center">
            <div className="w-24 h-24 rounded-2xl bg-[#1a1a1a] border-2 border-brand-500 flex items-center justify-center shadow-[0_0_30px_rgba(229,106,74,0.2)] z-10 mx-auto">
              <span className="material-symbols-outlined text-4xl text-brand-500 animate-pulse">hub</span>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2 text-brand-500">2. Hub Switch-Router</h3>
              <p className="text-sm text-gray-400">
                Hệ thống phân tích prompt, kiểm tra health nhà cung cấp và định tuyến theo độ trễ hoặc chi phí thấp nhất.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6 relative group md:items-end md:text-right">
            <div className="w-24 h-24 rounded-2xl bg-[#1a1a1a] border border-[#333333] flex items-center justify-center shadow-xl group-hover:border-gray-500 transition-colors z-10 mx-auto md:mx-0">
              <div className="grid grid-cols-2 gap-2">
                <div className="w-6 h-6 rounded bg-white/10"></div>
                <div className="w-6 h-6 rounded bg-white/10"></div>
                <div className="w-6 h-6 rounded bg-white/10"></div>
                <div className="w-6 h-6 rounded bg-white/10"></div>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-bold mb-2">3. Nhà cung cấp AI</h3>
              <p className="text-sm text-gray-400">
                Yêu cầu được xử lý bởi OpenAI, Anthropic, Gemini hoặc các nhà cung cấp khác ngay lập tức.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
