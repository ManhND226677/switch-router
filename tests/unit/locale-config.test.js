import { describe, expect, it } from "vitest";
import {
  LOCALES,
  LOCALE_NAMES,
  normalizeLocale,
  isSupportedLocale,
} from "../../src/i18n/config.js";

describe("application locale configuration", () => {
  it("keeps only US English and Vietnamese", () => {
    expect(LOCALES).toEqual(["en", "vi"]);
    expect(Object.keys(LOCALE_NAMES)).toEqual(["en", "vi"]);
  });

  it("normalizes common regional aliases", () => {
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("vi-VN")).toBe("vi");
    expect(isSupportedLocale("en-US")).toBe(true);
    expect(isSupportedLocale("vi-VN")).toBe(true);
  });

  it("falls back unsupported locales to English", () => {
    expect(normalizeLocale("zh-CN")).toBe("en");
    expect(normalizeLocale("ja")).toBe("en");
    expect(isSupportedLocale("en")).toBe(true);
    expect(isSupportedLocale("vi")).toBe(true);
    expect(isSupportedLocale("zh-CN")).toBe(false);
  });
});
