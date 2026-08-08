"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Card from "./Card";

export default function RequestLogger() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const cursorRef = useRef(null);
  const etagRef = useRef(null);
  const inFlightRef = useRef(false);
  const abortRef = useRef(null);
  const mountedRef = useRef(true);
  const visibleRef = useRef(true);

  const fetchLogs = useCallback(async (showLoading = true, forceFull = false) => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (showLoading && mountedRef.current) setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let fullRefresh = forceFull;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const cursor = fullRefresh ? null : cursorRef.current;
        const params = cursor === null ? "" : `?afterId=${encodeURIComponent(cursor)}`;
        const headers = etagRef.current ? { "If-None-Match": etagRef.current } : undefined;
        const res = await fetch(`/api/usage/request-logs${params}`, {
          headers,
          signal: controller.signal,
          cache: "no-store",
        });

        if (res.status === 304) break;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        const incremental = cursor !== null;
        if (incremental && data?.reset) {
          fullRefresh = true;
          cursorRef.current = null;
          etagRef.current = null;
          continue;
        }

        const nextLogs = Array.isArray(data) ? data : (Array.isArray(data?.logs) ? data.logs : []);
        const nextCursor = res.headers.get("x-usage-cursor-id");
        if (nextCursor !== null) cursorRef.current = nextCursor;
        etagRef.current = res.headers.get("etag") || etagRef.current;

        if (mountedRef.current) {
          if (incremental) {
            const freshLogs = [...nextLogs].reverse();
            if (freshLogs.length) setLogs((previous) => [...freshLogs, ...previous].slice(0, 200));
          } else {
            setLogs(nextLogs.slice(0, 200));
          }
        }
        break;
      }
    } catch (error) {
      if (error?.name !== "AbortError") console.error("Failed to fetch logs:", error);
    } finally {
      inFlightRef.current = false;
      if (abortRef.current === controller) abortRef.current = null;
      if (showLoading && mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchLogs(true, true);
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, [fetchLogs]);

  useEffect(() => {
    let interval;
    if (autoRefresh) {
      interval = setInterval(() => {
        if (!document.hidden) void fetchLogs(false);
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [autoRefresh, fetchLogs]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      visibleRef.current = !document.hidden;
      if (visibleRef.current && autoRefresh) void fetchLogs(false);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [autoRefresh, fetchLogs]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Request Logs</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-text-muted flex items-center gap-2 cursor-pointer">
            <span>Auto Refresh (3s)</span>
            <div
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${autoRefresh ? "bg-primary" : "bg-bg-subtle border border-border"
                }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoRefresh ? "translate-x-5" : "translate-x-1"
                  }`}
              />
            </div>
          </label>
        </div>
      </div>

      <Card className="overflow-hidden bg-black/5 dark:bg-black/20">
        <div className="p-0 overflow-x-auto max-h-[600px] overflow-y-auto font-mono text-xs">
          {loading && logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">Loading logs...</div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center text-text-muted">No logs recorded yet.</div>
          ) : (
            <table className="w-full text-left border-collapse whitespace-nowrap">
              <thead className="sticky top-0 bg-bg-subtle border-b border-border z-10">
                <tr>
                  <th className="px-3 py-2 border-r border-border">DateTime</th>
                  <th className="px-3 py-2 border-r border-border">Model</th>
                  <th className="px-3 py-2 border-r border-border">Provider</th>
                  <th className="px-3 py-2 border-r border-border">Account</th>
                  <th className="px-3 py-2 border-r border-border">In</th>
                  <th className="px-3 py-2 border-r border-border">Out</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {logs.map((log, i) => {
                  const parts = log.split(" | ");
                  if (parts.length < 7) return null;

                  const status = parts[6];
                  const isPending = status.includes("PENDING");
                  const isFailed = status.includes("FAILED");
                  const isSuccess = status.includes("OK");

                  return (
                    <tr key={i} className={`hover:bg-primary/5 transition-colors ${isPending ? 'bg-primary/5' : ''}`}>
                      <td className="px-3 py-1.5 border-r border-border text-text-muted">{parts[0]}</td>
                      <td className="px-3 py-1.5 border-r border-border font-medium">{parts[1]}</td>
                      <td className="px-3 py-1.5 border-r border-border">
                        <span className="px-1.5 py-0.5 rounded bg-bg-subtle border border-border text-xs uppercase font-bold">
                          {parts[2]}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-border truncate max-w-[150px]" title={parts[3]}>{parts[3]}</td>
                      <td className="px-3 py-1.5 border-r border-border text-right text-primary">{parts[4]}</td>
                      <td className="px-3 py-1.5 border-r border-border text-right text-success">{parts[5]}</td>
                      <td className={`px-3 py-1.5 font-bold ${isSuccess ? 'text-success' :
                          isFailed ? 'text-error' :
                            'text-primary animate-pulse'
                        }`}>
                        {status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      <div className="text-xs text-text-muted italic">
        Logs are loaded from the request history database.
      </div>
    </div>
  );
}
