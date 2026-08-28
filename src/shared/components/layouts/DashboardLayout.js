"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useNotificationStore } from "@/store/notificationStore";
import Sidebar from "../Sidebar";
import Header from "../Header";

function getToastStyle(type) {
  if (type === "success") {
    return {
      wrapper: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400",
      icon: "check_circle",
    };
  }
  if (type === "error") {
    return {
      wrapper: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
      icon: "error",
    };
  }
  if (type === "warning") {
    return {
      wrapper: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      icon: "warning",
    };
  }
  return {
    wrapper: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    icon: "info",
  };
}

export default function DashboardLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();
  const notifications = useNotificationStore((state) => state.notifications);
  const removeNotification = useNotificationStore((state) => state.removeNotification);

  return (
    // h-dvh thay vì h-screen: 100vh tính cả thanh URL bar trên mobile -> nội dung bị cắt.
    <div className="flex h-dvh w-full overflow-hidden bg-bg">
      {/* Skip-to-content: người dùng bàn phím không phải Tab qua toàn bộ sidebar */}
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {/* Toast: aria-live để screen reader đọc được thông báo.
          Đặt bottom-4 thay vì top-4 để không đè lên cụm nút bên phải header.
          pointer-events-none trên vùng chứa để khoảng trống giữa các toast
          không chặn click vào nội dung bên dưới. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="false"
        aria-label="Notifications"
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex max-h-[calc(100dvh-2rem)] w-[min(92vw,380px)] flex-col gap-2 overflow-y-auto"
      >
        {notifications.map((n) => {
          const style = getToastStyle(n.type);
          return (
            <div
              key={n.id}
              role={n.type === "error" ? "alert" : "status"}
              className={`pointer-events-auto rounded-lg border px-3 py-2 shadow-lg backdrop-blur-sm ${style.wrapper}`}
            >
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-lg leading-5">{style.icon}</span>
                <div className="min-w-0 flex-1">
                  {n.title ? <p className="text-xs font-semibold mb-0.5">{n.title}</p> : null}
                  <p className="text-xs whitespace-pre-wrap break-words">{n.message}</p>
                </div>
                {n.dismissible ? (
                  <button
                    type="button"
                    onClick={() => removeNotification(n.id)}
                    className="text-current/70 hover:text-current"
                    aria-label="Dismiss notification"
                  >
                    <span className="material-symbols-outlined text-base">close</span>
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 md:hidden"
          onClick={() => setSidebarOpen(false)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
              setSidebarOpen(false);
            }
          }}
          aria-label="Close sidebar"
        />
      )}

      {/* Sidebar - Desktop */}
      <div className="hidden lg:flex">
        <Sidebar />
      </div>
      
      {/* Sidebar - Mini (Tablet) */}
      <div className="hidden md:flex lg:hidden">
        <Sidebar isMini={true} />
      </div>

      {/* Sidebar - Mobile
          inert + aria-hidden khi đóng: chỉ translate-x-full thì vẫn render, vẫn
          focusable và vẫn nằm trong accessibility tree -> Tab bị rơi ra ngoài màn hình.
          React 19 hỗ trợ inert dạng boolean (render đúng, không ra inert="false"). */}
      <div
        inert={!sidebarOpen}
        aria-hidden={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-50 transform md:hidden transition-transform duration-300 ease-in-out ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-col flex-1 h-full min-w-0 relative transition-colors duration-300 isolate focus:outline-none"
      >
        {/* Faint grid background */}
        <div className="landing-grid absolute inset-0 pointer-events-none -z-10" aria-hidden="true" />
        <Header key={pathname} onMenuClick={() => setSidebarOpen(true)} />
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-10">
          <div className="max-w-7xl mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}
