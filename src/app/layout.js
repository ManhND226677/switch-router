import { cookies } from "next/headers";
import { Inter } from "next/font/google";
import "./material-symbols.css";
import "./globals.css";
import { ThemeProvider } from "@/shared/components/ThemeProvider";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  normalizeLocale,
} from "@/i18n/config";
import "@/lib/network/initOutboundProxy"; // Auto-initialize outbound proxy env
import "@/shared/services/bootstrap"; // Auto-run local optional infrastructure
import { initConsoleLogCapture } from "@/lib/consoleLogBuffer";
import { RuntimeI18nProvider } from "@/i18n/RuntimeI18nProvider";
import ClientConsoleGate from "@/shared/components/ClientConsoleGate";

// Hook console immediately at module load time (server-side only, runs once)
initConsoleLogCapture();

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: "Switch-Router - Personal AI Gateway",
  description: "One local endpoint for switching between personal AI providers.",
  icons: {
    icon: "/favicon.svg",
  },
};

export const viewport = {
  themeColor: "#0a0a0a",
};

export default async function RootLayout({ children }) {
  // Locale được lưu trong cookie -> đọc được ở server, không cần chờ JS client.
  // Screen reader nhờ vậy phát âm đúng ngôn ngữ ngay từ lần paint đầu tiên (WCAG 3.1.1).
  const locale = normalizeLocale(
    (await cookies()).get(LOCALE_COOKIE)?.value || DEFAULT_LOCALE
  );

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        {/* Chống flash sai theme (FOUC): gắn class .dark TRƯỚC lần paint đầu tiên.
            Phải khớp themeStore: persist key "theme", shape {state:{theme}}, default "system". */}
        <script
          dangerouslySetInnerHTML={{
            __html: "(function(){try{var raw=localStorage.getItem('theme');var t=raw?(JSON.parse(raw).state||{}).theme:'system';if(t!=='light'&&t!=='dark')t='system';var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var el=document.documentElement;el.classList.toggle('dark',dark);el.dataset.theme=dark?'dark':'light';}catch(e){}})();",
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `if(document.fonts&&document.fonts.ready){document.fonts.ready.then(function(){document.documentElement.classList.add('fonts-loaded')})}else{document.documentElement.classList.add('fonts-loaded')}`,
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <ClientConsoleGate />
        <ThemeProvider>
          <RuntimeI18nProvider>
            {children}
          </RuntimeI18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
