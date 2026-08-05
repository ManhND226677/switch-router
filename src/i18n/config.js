export const LOCALES = [
  "en",
  "vi"
];
export const DEFAULT_LOCALE = "en";
export const LOCALE_COOKIE = "locale";

export const LOCALE_NAMES = {
  en: "English (US)",
  vi: "Tiếng Việt",
};

export function normalizeLocale(locale) {
  const value = String(locale || "").trim().toLowerCase();
  if (value === "en" || value === "en-us") return "en";
  if (value === "vi" || value === "vi-vn") return "vi";
  return DEFAULT_LOCALE;
}

export function isSupportedLocale(locale) {
  const value = String(locale || "").trim().toLowerCase();
  return value === "en" || value === "en-us" || value === "vi" || value === "vi-vn";
}
