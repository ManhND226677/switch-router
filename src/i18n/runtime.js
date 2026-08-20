"use client";

import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale } from "./config";

let translationMap = {};
let currentLocale = DEFAULT_LOCALE;
let reloadCallbacks = [];

// Read locale from cookie
function getLocaleFromCookie() {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : DEFAULT_LOCALE;
  return normalizeLocale(value);
}

// Load translation map (cached per locale — route changes used to refetch)
const translationsByLocale = new Map();
async function loadTranslations(locale) {
  if (locale === "en") {
    translationMap = {};
    return;
  }

  if (translationsByLocale.has(locale)) {
    translationMap = translationsByLocale.get(locale);
    return;
  }

  try {
    const response = await fetch(`/i18n/literals/${locale}.json`);
    const map = await response.json();
    translationsByLocale.set(locale, map);
    translationMap = map;
  } catch (err) {
    console.error("Failed to load translations:", err);
    translationMap = {};
  }
}

// Translate text - exported for use in components
export function translate(text) {
  if (!text || typeof text !== "string") return text;
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (currentLocale === "en") return text;
  return translationMap[trimmed] || text;
}

// Get current locale - exported for use in components
export function getCurrentLocale() {
  return currentLocale;
}

// Register callback for locale changes
export function onLocaleChange(callback) {
  reloadCallbacks.push(callback);
  return () => {
    reloadCallbacks = reloadCallbacks.filter(cb => cb !== callback);
  };
}

// Process text node
function processTextNode(node) {
  if (!node.nodeValue || !node.nodeValue.trim()) return;
  
  // Skip if parent is script, style, code, or structural elements
  const parent = node.parentElement;
  if (!parent) return;
  
  // Skip if parent or any ancestor has data-i18n-skip attribute, or lives
  // inside an SVG (chart libraries re-render SVG text on every update and
  // axis labels/numbers are never translatable content).
  let element = parent;
  while (element) {
    if (element.hasAttribute && element.hasAttribute('data-i18n-skip')) {
      return;
    }
    if (element.tagName && element.tagName.toLowerCase() === 'svg') {
      return;
    }
    element = element.parentElement;
  }
  
  const tagName = parent.tagName?.toLowerCase();
  
  // Skip elements that don't allow text nodes
  const skipTags = [
    "script", "style", "code", "pre",
    "colgroup", "table", "thead", "tbody", "tfoot", "tr",
    "select", "datalist", "optgroup"
  ];
  
  if (skipTags.includes(tagName)) return;
  
  // Store original text if not already stored
  if (!node._originalText) {
    node._originalText = node.nodeValue;
  }
  
  // Use original text for translation
  const original = node._originalText;
  const translated = translate(original);
  
  // Only update if different to avoid unnecessary DOM mutations
  if (translated !== node.nodeValue) {
    node.nodeValue = translated;
  }
}

// Process all text nodes in element
function processElement(element) {
  if (!element) return;
  
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  let node;
  const nodesToProcess = [];
  
  // Collect all nodes first to avoid live collection issues
  while ((node = walker.nextNode())) {
    nodesToProcess.push(node);
  }
  
  // Process collected nodes
  nodesToProcess.forEach(processTextNode);
}

// Initialize runtime i18n
export async function initRuntimeI18n() {
  if (typeof window === "undefined") return;
  
  currentLocale = getLocaleFromCookie();
  await loadTranslations(currentLocale);
  
  // Process existing DOM
  processElement(document.body);

  // Watch for new nodes — batched. Chart/table re-renders produce bursts of
  // mutation records; walking every added subtree per record wastes main-thread
  // time. One idle-time walk per burst achieves the same translations.
  const pendingRoots = new Set();
  let flushScheduled = false;
  const flushPendingRoots = () => {
    flushScheduled = false;
    const roots = Array.from(pendingRoots);
    pendingRoots.clear();
    for (const root of roots) {
      if (!root.isConnected) continue;
      processElement(root);
    }
  };
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(flushPendingRoots, { timeout: 200 });
    } else {
      setTimeout(flushPendingRoots, 120);
    }
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          pendingRoots.add(node);
        } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
          pendingRoots.add(node.parentElement);
        }
      }
    }
    if (pendingRoots.size > 0) scheduleFlush();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Reload translations when locale changes
export async function reloadTranslations() {
  currentLocale = getLocaleFromCookie();
  await loadTranslations(currentLocale);
  
  // Notify all registered callbacks
  reloadCallbacks.forEach(callback => callback());
  
  // Re-process entire DOM (will use stored original text)
  processElement(document.body);
}
