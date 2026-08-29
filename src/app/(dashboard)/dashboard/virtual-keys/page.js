"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Toggle, ConfirmModal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import ClientSetupSection from "../endpoint/components/ClientSetupSection";

// ─── Helpers ────────────────────────────────────────────────────────────────

// Giữ 4 ký tự cuối trùng quy ước fingerprint (helpers/apiKeyPrivacy.js) để
// dạng hiển thị khớp với dữ liệu usage đã lưu.
function maskKey(key) {
  if (!key || typeof key !== "string") return "—";
  const suffix = key.length > 4 ? key.slice(-4) : key;
  return `${key.slice(0, 5)}…${suffix}`;
}

function fmtDateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("vi-VN");
}

function isExpired(keyRow) {
  if (!keyRow?.expiresAt) return false;
  const t = Date.parse(keyRow.expiresAt);
  return Number.isFinite(t) && t <= Date.now();
}

function statusOf(keyRow) {
  if (!keyRow.isActive) return { label: "Disabled", variant: "default" };
  if (isExpired(keyRow)) return { label: "Expired", variant: "error" };
  return { label: "Active", variant: "success" };
}

function normalizeForm(data = {}) {
  return {
    name: data.name || "",
    allowedModels: Array.isArray(data.allowedModels) ? [...data.allowedModels] : [],
    monthlyBudgetUsd: data.monthlyBudgetUsd ?? "",
    rateLimitRpm: data.rateLimitRpm ?? "",
    expiresAt: data.expiresAt ? data.expiresAt.slice(0, 16) : "", // datetime-local
  };
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VirtualKeysPage() {
  const [keys, setKeys] = useState([]);
  const [modelOptions, setModelOptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [showFormModal, setShowFormModal] = useState(false);
  const [editingKey, setEditingKey] = useState(null);
  const [formData, setFormData] = useState(normalizeForm());
  const [saving, setSaving] = useState(false);

  // M365 allowlist count (the gateway-wide requireApiKey toggle is hidden from the UI;
  // the setting itself stays in /api/settings and stays enforced server-side)
  const [officeAllowlistCount, setOfficeAllowlistCount] = useState(0);

  // Key đầy đủ chỉ hiện đúng 1 lần ngay sau khi tạo
  const [createdFullKey, setCreatedFullKey] = useState(null);
  const [revealedIds, setRevealedIds] = useState(new Set());
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [modelSearch, setModelSearch] = useState("");

  const notifySuccess = useNotificationStore((s) => s.success);
  const notifyError = useNotificationStore((s) => s.error);

  const fetchKeys = useCallback(async () => {
    try {
      const response = await fetch("/api/keys", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) {
        setKeys(data.keys || []);
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch (error) {
      console.error("Error fetching keys:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- initial keys fetch; loading starts true so no flash (same pattern as the /v1/models effect below). */
  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load M365 allowlist count for the Base URLs card.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setOfficeAllowlistCount(Number(data.officeModelAllowlistCount) || 0);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Danh sách model/combo public để chọn allowlist (cùng nguồn client gọi thật)
  useEffect(() => {
    let cancelled = false;
    fetch("/v1/models")
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const ids = (data.data || []).map((m) => m.id).filter(Boolean).sort();
        setModelOptions(ids);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const kpi = useMemo(() => ({
    total: keys.length,
    active: keys.filter((k) => k.isActive && !isExpired(k)).length,
    limited: keys.filter((k) => k.rateLimitRpm || k.monthlyBudgetUsd).length,
    spend: keys.reduce((acc, k) => acc + (Number(k.spentUsd) || 0), 0),
  }), [keys]);

  const filteredModelOptions = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return modelOptions;
    return modelOptions.filter((m) => m.toLowerCase().includes(q));
  }, [modelOptions, modelSearch]);

  const openCreate = () => {
    setEditingKey(null);
    setFormData(normalizeForm());
    setModelSearch("");
    setShowFormModal(true);
  };

  const openEdit = (keyRow) => {
    setEditingKey(keyRow);
    setFormData(normalizeForm(keyRow));
    setModelSearch("");
    setShowFormModal(true);
  };

  const submitForm = async () => {
    if (!formData.name.trim()) {
      notifyError("Key name is required");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: formData.name.trim(),
        allowedModels: formData.allowedModels,
        monthlyBudgetUsd: formData.monthlyBudgetUsd === "" ? null : Number(formData.monthlyBudgetUsd),
        rateLimitRpm: formData.rateLimitRpm === "" ? null : Number(formData.rateLimitRpm),
        expiresAt: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : null,
      };
      const url = editingKey ? `/api/keys/${editingKey.id}` : "/api/keys";
      const response = await fetch(url, {
        method: editingKey ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        notifyError(data.error || "Failed to save key");
        return;
      }
      if (!editingKey && data.key) setCreatedFullKey({ key: data.key, name: data.name });
      notifySuccess(editingKey ? "Key updated" : "Key created");
      setShowFormModal(false);
      await fetchKeys();
    } catch (error) {
      console.error("Error saving key:", error);
      notifyError("Failed to save key");
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (keyRow) => {
    try {
      const response = await fetch(`/api/keys/${keyRow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !keyRow.isActive }),
      });
      if (!response.ok) throw new Error();
      await fetchKeys();
    } catch {
      notifyError("Failed to update key");
    }
  };

  const deleteKey = async (keyRow) => {
    try {
      const response = await fetch(`/api/keys/${keyRow.id}`, { method: "DELETE" });
      if (!response.ok) throw new Error();
      notifySuccess("Key deleted");
      setConfirmDelete(null);
      await fetchKeys();
    } catch {
      notifyError("Failed to delete key");
    }
  };

  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess("Copied to clipboard");
    } catch {
      notifyError("Copy failed");
    }
  };

  const toggleReveal = (id) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-text-main">Virtual Keys</h2>
          <p className="text-sm text-text-muted">Quản lý khóa API con: phân model, chặn ngân sách, giới hạn tốc độ</p>
        </div>
        <Button onClick={openCreate}>
          <span className="material-symbols-outlined text-base">add</span>
          Tạo khóa
        </Button>
      </div>

      {/* KPI strip — kiểu workbench: ô kẻ vách, số tabular lớn */}
      <div className="grid grid-cols-2 md:grid-cols-4 border border-border-subtle divide-x divide-y md:divide-y-0 divide-border-subtle rounded-lg overflow-hidden bg-surface">
        {[
          { label: "Tổng khóa", value: String(kpi.total) },
          { label: "Đang hoạt động", value: String(kpi.active) },
          { label: "Có giới hạn", value: String(kpi.limited) },
          { label: "Chi tiêu tháng này", value: `$${kpi.spend.toFixed(4)}` },
        ].map((item) => (
          <div key={item.label} className="px-5 py-4">
            <p className="text-[11px] uppercase tracking-wider text-text-muted">{item.label}</p>
            <p className="mt-1 text-2xl font-bold text-text-main tabular-nums tracking-tight">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : loadError ? (
          <div role="alert" className="p-10 text-center text-sm text-danger">
            Không tải được danh sách khóa.{" "}
            <button
              type="button"
              onClick={() => { setLoading(true); fetchKeys(); }}
              className="font-semibold underline underline-offset-2 cursor-pointer"
            >
              Thử lại
            </button>
          </div>
        ) : keys.length === 0 ? (
          <div className="p-10 text-center text-sm text-text-muted">
            Chưa có khóa nào. Tạo khóa đầu tiên để cấp cho các client khác.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-[11px] uppercase tracking-wider text-text-muted">
                  <th className="px-5 py-3 font-semibold">Tên</th>
                  <th className="px-5 py-3 font-semibold">Khóa</th>
                  <th className="px-5 py-3 font-semibold">Models</th>
                  <th className="px-5 py-3 font-semibold">Ngân sách</th>
                  <th className="px-5 py-3 font-semibold">RPM</th>
                  <th className="px-5 py-3 font-semibold">Hạn dùng</th>
                  <th className="px-5 py-3 font-semibold">Trạng thái</th>
                  <th className="px-5 py-3 font-semibold text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const st = statusOf(k);
                  const cap = Number(k.monthlyBudgetUsd) || 0;
                  const spent = Number(k.spentUsd) || 0;
                  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
                  return (
                    <tr key={k.id} className="border-b border-border-subtle/60 last:border-0 hover:bg-surface-2/60 transition-colors">
                      <td className="px-5 py-3">
                        <span className="font-medium text-text-main">{k.name}</span>
                        <p className="text-xs text-text-muted">{fmtDateTime(k.createdAt)}</p>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs bg-surface-2 px-2 py-1 rounded-md border border-border-subtle">
                            {revealedIds.has(k.id) ? k.key : maskKey(k.key)}
                          </code>
                          <button
                            type="button"
                            onClick={() => toggleReveal(k.id)}
                            className="text-text-muted hover:text-primary transition-colors"
                            title={revealedIds.has(k.id) ? "Ẩn khóa" : "Hiện khóa"}
                          >
                            <span className="material-symbols-outlined text-sm">{revealedIds.has(k.id) ? "visibility_off" : "visibility"}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => copyText(k.key)}
                            className="text-text-muted hover:text-primary transition-colors"
                            title="Sao chép"
                          >
                            <span className="material-symbols-outlined text-sm">content_copy</span>
                          </button>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        {!Array.isArray(k.allowedModels) || k.allowedModels.length === 0 ? (
                          <Badge variant="default">Tất cả</Badge>
                        ) : (
                          <Badge variant="info">{k.allowedModels.length} model</Badge>
                        )}
                      </td>
                      <td className="px-5 py-3 min-w-[140px]">
                        {cap > 0 ? (
                          <div>
                            <p className="tabular-nums text-xs text-text-main">${spent.toFixed(4)} / ${cap}</p>
                            <div className="mt-1 h-1.5 w-full bg-surface-2 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pct >= 100 ? "bg-danger" : pct >= 80 ? "bg-warning" : "bg-success"}`}
                                style={{ width: `${Math.max(pct, 2)}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 tabular-nums">{k.rateLimitRpm ?? "—"}</td>
                      <td className="px-5 py-3 text-xs">{k.expiresAt ? fmtDateTime(k.expiresAt) : "—"}</td>
                      <td className="px-5 py-3"><Badge variant={st.variant}>{st.label}</Badge></td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
                          <Toggle checked={k.isActive} onChange={() => toggleActive(k)} title="Bật/tắt khóa" />
                          <Button variant="outline" size="sm" onClick={() => openEdit(k)}>Sửa</Button>
                          <Button variant="outline" size="sm" onClick={() => setConfirmDelete(k)}>
                            <span className="text-danger">Xóa</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Form create/edit */}
      <Modal
        isOpen={showFormModal}
        onClose={() => setShowFormModal(false)}
        title={editingKey ? "Sửa khóa" : "Tạo khóa mới"}
      >
        <div className="space-y-4">
          <Input
            label="Tên khóa"
            placeholder="VD: laptop-codex"
            value={formData.name}
            onChange={(e) => setFormData((f) => ({ ...f, name: e.target.value }))}
            disabled={!!editingKey}
          />

          <div>
            <label className="text-sm font-medium text-text-main block mb-2">
              Models cho phép <span className="text-text-muted font-normal">(bỏ trống = tất cả)</span>
            </label>
            <Input
              placeholder="Tìm model…"
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
            />
            <div className="mt-2 max-h-48 overflow-y-auto custom-scrollbar border border-border-subtle rounded-lg p-2 space-y-1 bg-surface">
              {filteredModelOptions.length === 0 ? (
                <p className="text-xs text-text-muted p-2">Không tìm thấy model nào</p>
              ) : (
                filteredModelOptions.map((m) => {
                  const checked = formData.allowedModels.includes(m);
                  return (
                    <label key={m} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-surface-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setFormData((f) => ({
                          ...f,
                          allowedModels: checked
                            ? f.allowedModels.filter((x) => x !== m)
                            : [...f.allowedModels, m],
                        }))}
                        className="accent-[var(--color-brand-500)]"
                      />
                      <span className="text-xs font-mono text-text-main truncate">{m}</span>
                    </label>
                  );
                })
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              label="Ngân sách tháng ($)"
              type="number"
              step="0.0001"
              min="0"
              placeholder="Bỏ trống = không giới hạn"
              value={formData.monthlyBudgetUsd}
              onChange={(e) => setFormData((f) => ({ ...f, monthlyBudgetUsd: e.target.value }))}
            />
            <Input
              label="Giới hạn RPM"
              type="number"
              min="1"
              placeholder="Bỏ trống = không giới hạn"
              value={formData.rateLimitRpm}
              onChange={(e) => setFormData((f) => ({ ...f, rateLimitRpm: e.target.value }))}
            />
            <Input
              label="Hạn dùng"
              type="datetime-local"
              value={formData.expiresAt}
              onChange={(e) => setFormData((f) => ({ ...f, expiresAt: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setShowFormModal(false)}>Hủy</Button>
            <Button onClick={submitForm} disabled={saving}>{saving ? "Đang lưu…" : "Lưu"}</Button>
          </div>
        </div>
      </Modal>

      {/* Show full key once */}
      <Modal isOpen={!!createdFullKey} onClose={() => setCreatedFullKey(null)} title="Khóa đã tạo">
        <p className="text-sm text-text-muted mb-3">
          Sao chép khóa ngay — nó sẽ chỉ hiển thị đầy đủ ở hộp thoại này.
        </p>
        <div className="flex items-center gap-2 bg-surface-2 border border-border-subtle rounded-lg p-3">
          <code className="font-mono text-xs break-all flex-1 text-text-main">{createdFullKey?.key}</code>
          <Button variant="outline" size="sm" onClick={() => copyText(createdFullKey?.key || "")}>Sao chép</Button>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => deleteKey(confirmDelete)}
        title="Xóa khóa"
        message={`Xóa khóa "${confirmDelete?.name}"? Client đang dùng khóa này sẽ mất quyền truy cập ngay lập tức.`}
      />

      {/* Connect clients — base URLs, snippets, M365 (moved from the old endpoint page) */}
      <ClientSetupSection
        origin={typeof window === "undefined" ? "http://127.0.0.1:28701" : window.location.origin}
        keys={keys}
        officeAllowlistCount={officeAllowlistCount}
      />
    </div>
  );
}
