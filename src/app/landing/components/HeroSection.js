"use client";
import { useRouter } from "next/navigation";

export default function HeroSection() {
  const router = useRouter();
  return (
    <section className="relative pt-32 pb-20 px-6 min-h-[90vh] flex flex-col items-center justify-center overflow-hidden">
      {/* Glow effect */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[500px] bg-brand-500/10 rounded-full blur-[120px] pointer-events-none"></div>
      
      <div className="relative z-10 max-w-4xl w-full text-center flex flex-col items-center gap-8">
        {/* Version badge */}
        <div className="inline-flex items-center gap-2 rounded-full border border-[#333333] bg-[#262626]/50 px-3 py-1 text-xs font-medium text-brand-500">
          <span className="flex h-2 w-2 rounded-full bg-brand-500 animate-pulse"></span>
          v1.0 is now live
        </div>

        {/* Main heading */}
        <h1 className="text-5xl md:text-7xl font-black leading-[1.1] tracking-tight">
          One Endpoint for <br/>
          <span className="text-brand-500">All AI Providers</span>
        </h1>

        {/* Description */}
        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto font-light">
          A local AI gateway with a web dashboard for switching providers, applying routing rules, and keeping credentials on your machine.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-wrap items-center justify-center gap-4 w-full">
          <button onClick={() => router.push("/dashboard")} className="h-12 px-8 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-base font-bold transition-all shadow-[0_0_15px_rgba(229,106,74,0.4)] flex items-center gap-2">
            <span className="material-symbols-outlined">rocket_launch</span>
            Open Dashboard
          </button>
          <a 
            href="/dashboard/skills"
            className="h-12 px-8 rounded-lg border border-[#333333] bg-[#262626] hover:bg-[#333333] text-white text-base font-bold transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined">code</span>
            View Skills
          </a>
        </div>
      </div>
    </section>
  );
}
