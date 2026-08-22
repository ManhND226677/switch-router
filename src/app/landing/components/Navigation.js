"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  return (
    <nav className="fixed top-0 z-50 w-full bg-[#1a1a1a]/80 backdrop-blur-md border-b border-[#333333]">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <button
          type="button"
          className="flex items-center gap-3 cursor-pointer bg-transparent border-none p-0"
          onClick={() => router.push("/")}
          aria-label="Navigate to home"
        >
          <div className="size-8 rounded bg-linear-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white">
            <span className="material-symbols-outlined text-xl">hub</span>
          </div>
          <h2 className="text-white text-xl font-bold tracking-tight">Switch-Router</h2>
        </button>

        <div className="hidden md:flex items-center gap-8">
          <a className="text-gray-300 hover:text-white text-sm font-medium transition-colors" href="#features">Tính năng</a>
          <a className="text-gray-300 hover:text-white text-sm font-medium transition-colors" href="#how-it-works">Cách hoạt động</a>
          <a className="text-gray-300 hover:text-white text-sm font-medium transition-colors flex items-center gap-1" href="/dashboard/endpoint">
            Điểm cuối <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </a>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push("/dashboard")}
            className="hidden sm:flex h-9 items-center justify-center rounded-lg px-4 bg-brand-500 hover:bg-brand-600 transition-all text-white text-sm font-bold shadow-[0_0_15px_rgba(229,106,74,0.4)] hover:shadow-[0_0_20px_rgba(229,106,74,0.6)]"
          >
            Bắt đầu
          </button>
          <button
            className="md:hidden text-white"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <span className="material-symbols-outlined">{mobileMenuOpen ? "close" : "menu"}</span>
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[#333333] bg-[#1a1a1a]/95 backdrop-blur-md">
          <div className="flex flex-col gap-4 p-6">
            <a className="text-gray-300 hover:text-white text-sm font-medium transition-colors" href="#features" onClick={() => setMobileMenuOpen(false)}>Tính năng</a>
            <a className="text-gray-300 hover:text-white text-sm font-medium transition-colors" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>Cách hoạt động</a>
            <a className="text-gray-300 hover:text-white text-sm font-medium transition-colors" href="/dashboard/endpoint">Điểm cuối</a>
            <button
              onClick={() => router.push("/dashboard")}
              className="h-9 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-sm font-bold"
            >
              Bắt đầu
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
