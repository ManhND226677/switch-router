"use client";
import { useRouter } from "next/navigation";

export default function HeroSection() {
  const router = useRouter();
  return (
    <section className="relative pt-32 pb-20 px-6 min-h-[90vh] flex flex-col items-center justify-center overflow-hidden">
      <div className="relative z-10 max-w-4xl w-full text-center flex flex-col items-center gap-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#333333] bg-[#262626]/50 px-3 py-1 text-xs font-medium text-brand-500">
          <span className="flex h-2 w-2 rounded-full bg-brand-500 animate-pulse"></span>
          SẴN SÀNG DÙNG
        </div>

        <h1 className="text-5xl md:text-7xl font-black leading-[1.1] tracking-tight">
          Một đầu vào, <br/>
          <span className="text-brand-500">mọi nhà cung cấp AI</span>
        </h1>

        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto font-light">
          Gateway AI chạy cục bộ, có dashboard để chuyển nhà cung cấp, áp dụng quy tắc định tuyến và giữ toàn bộ credential trên máy bạn.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-4 w-full">
          <button onClick={() => router.push("/dashboard")} className="h-12 px-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-base font-bold transition-all shadow-[0_0_15px_rgba(229,106,74,0.4)] flex items-center gap-2">
            <span className="material-symbols-outlined">rocket_launch</span>
            Mở bảng điều khiển
          </button>
        </div>
      </div>
    </section>
  );
}
