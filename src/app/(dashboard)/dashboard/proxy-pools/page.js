"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, CardSkeleton, Input, Modal, Toggle, ConfirmModal } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

function getStatusVariant(status) {
  if (status === "active") return "success";
  if (status === "error") return "error";
  return "default";
}

function formatDateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Never" : date.toLocaleString();
}

function normalizeFormData(data = {}) {
  return {
    name: data.name || "",
    proxyUrl: data.proxyUrl || "",
    noProxy: data.noProxy || "",
    isActive: data.isActive !== false,
    strictProxy: data.strictProxy === true,
  };
}

export default function ProxyPoolsPage() {
  const [proxyPools, setProxyPools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormModal, setShowFormModal] = useState(false);
  const [showBatchImportModal, setShowBatchImportModal] = useState(false);
  const [editingProxyPool, setEditingProxyPool] = useState(null);
  const [formData, setFormData] = useState(normalizeFormData());
  const [batchImportText, setBatchImportText] = useState("");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthProgress, setHealthProgress] = useState({ current: 0, total: 0 });
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [loadError, setLoadError] = useState(false);
  // Selector từng action rồi gộp lại, thay vì subscribe cả store.
  // Các action ổn định (tạo 1 lần lúc create()) nên object `notify` cũng ổn
  // định; trước đây subscribe cả store khiến trang re-render mỗi lần có toast.
  const notifySuccess = useNotificationStore((s) => s.success);
  const notifyError = useNotificationStore((s) => s.error);
  const notifyWarning = useNotificationStore((s) => s.warning);
  const notify = useMemo(
    () => ({ success: notifySuccess, error: notifyError, warning: notifyWarning }),
    [notifySuccess, notifyError, notifyWarning],
  );

  const fetchProxyPools = useCallback(async () => {
    try {
      const response = await fetch("/api/proxy-pools?includeUsage=true", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) {
        setProxyPools((data.proxyPools || []).filter((pool) => pool.type === "http"));
        setLoadError(false);
      } else {
        setLoadError(true);
      }
    } catch (error) {
      console.error("Error fetching local proxy pools:", error);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchProxyPools();
  }, [fetchProxyPools]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIds((previous) => previous.filter((id) => proxyPools.some((pool) => pool.id === id)));
  }, [proxyPools]);

  const resetForm = () => {
    setEditingProxyPool(null);
    setFormData(normalizeFormData());
  };

  const openCreateModal = () => {
    resetForm();
    setShowFormModal(true);
  };

  const openEditModal = (proxyPool) => {
    setEditingProxyPool(proxyPool);
    setFormData(normalizeFormData(proxyPool));
    setShowFormModal(true);
  };

  const closeFormModal = () => {
    setShowFormModal(false);
    resetForm();
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name.trim(),
      proxyUrl: formData.proxyUrl.trim(),
      noProxy: formData.noProxy.trim(),
      isActive: formData.isActive === true,
      strictProxy: formData.strictProxy === true,
      type: "http",
    };
    if (!payload.name || !payload.proxyUrl) return;

    setSaving(true);
    try {
      const isEdit = !!editingProxyPool;
      const response = await fetch(isEdit ? `/api/proxy-pools/${editingProxyPool.id}` : "/api/proxy-pools", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        notify.error(data.error || "Failed to save proxy pool");
        return;
      }
      await fetchProxyPools();
      closeFormModal();
      notify.success(isEdit ? "Proxy pool updated" : "Proxy pool created");
    } catch (error) {
      console.error("Error saving proxy pool:", error);
      notify.error("Failed to save proxy pool");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (proxyPool) => {
    setConfirmState({
      title: "Delete Proxy Pool",
      message: `Delete proxy pool "${proxyPool.name}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const response = await fetch(`/api/proxy-pools/${proxyPool.id}`, { method: "DELETE" });
          const data = await response.json();
          if (!response.ok) {
            notify.error(response.status === 409
              ? `Cannot delete: ${data.boundConnectionCount || 0} connection(s) still use this pool.`
              : (data.error || "Failed to delete proxy pool"));
            return;
          }
          setProxyPools((previous) => previous.filter((pool) => pool.id !== proxyPool.id));
          notify.success("Proxy pool deleted");
        } catch (error) {
          console.error("Error deleting proxy pool:", error);
          notify.error("Failed to delete proxy pool");
        }
      },
    });
  };

  const handleTest = async (proxyPoolId) => {
    setTestingId(proxyPoolId);
    try {
      const response = await fetch(`/api/proxy-pools/${proxyPoolId}/test`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        notify.error(data.error || "Failed to test proxy");
        return;
      }
      await fetchProxyPools();
      notify[data.ok ? "success" : "error"](data.ok ? "Proxy test passed" : "Proxy test failed");
    } catch (error) {
      console.error("Error testing proxy pool:", error);
      notify.error("Failed to test proxy");
    } finally {
      setTestingId(null);
    }
  };

  const handleToggleActive = async (pool) => {
    const next = !pool.isActive;
    setProxyPools((previous) => previous.map((item) => item.id === pool.id ? { ...item, isActive: next } : item));
    try {
      const response = await fetch(`/api/proxy-pools/${pool.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      if (!response.ok) throw new Error("request failed");
    } catch (error) {
      console.error("Error toggling proxy pool:", error);
      setProxyPools((previous) => previous.map((item) => item.id === pool.id ? { ...item, isActive: pool.isActive } : item));
      notify.error("Failed to update active state");
    }
  };

  const allSelected = proxyPools.length > 0 && selectedIds.length === proxyPools.length;
  const toggleSelect = (id) => setSelectedIds((previous) => (
    previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
  ));
  const toggleSelectAll = () => setSelectedIds(allSelected ? [] : proxyPools.map((pool) => pool.id));

  const bulkSetActive = async (isActive) => {
    const targets = selectedIds.length > 0 ? selectedIds : proxyPools.map((pool) => pool.id);
    if (targets.length === 0) return;
    setBulkBusy(true);
    try {
      let successCount = 0;
      let failedCount = 0;
      for (const id of targets) {
        try {
          const response = await fetch(`/api/proxy-pools/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive }),
          });
          if (response.ok) successCount += 1;
          else failedCount += 1;
        } catch {
          failedCount += 1;
        }
      }
      await fetchProxyPools();
      notify.success(`${isActive ? "Activated" : "Deactivated"} ${successCount}${failedCount ? `, failed ${failedCount}` : ""}`);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = () => {
    if (selectedIds.length === 0) return;
    setConfirmState({
      title: "Delete Proxy Pools",
      message: `Delete ${selectedIds.length} proxy pool(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true);
        try {
          let successCount = 0;
          let blockedCount = 0;
          let failedCount = 0;
          for (const id of selectedIds) {
            try {
              const response = await fetch(`/api/proxy-pools/${id}`, { method: "DELETE" });
              if (response.ok) successCount += 1;
              else if (response.status === 409) blockedCount += 1;
              else failedCount += 1;
            } catch {
              failedCount += 1;
            }
          }
          await fetchProxyPools();
          setSelectedIds([]);
          notify.success(`Deleted ${successCount}${blockedCount ? `, ${blockedCount} bound` : ""}${failedCount ? `, ${failedCount} failed` : ""}`);
        } finally {
          setBulkBusy(false);
        }
      },
    });
  };

  const handleHealthCheck = async () => {
    const targets = selectedIds.length > 0
      ? proxyPools.filter((pool) => selectedIds.includes(pool.id))
      : proxyPools;
    if (targets.length === 0) return;

    setHealthChecking(true);
    setHealthProgress({ current: 0, total: targets.length });
    let alive = 0;
    const deadIds = [];
    let done = 0;
    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0) {
        const pool = queue.shift();
        if (!pool) break;
        try {
          const response = await fetch(`/api/proxy-pools/${pool.id}/test`, { method: "POST" });
          const data = await response.json();
          if (response.ok && data.ok) alive += 1;
          else deadIds.push(pool.id);
        } catch {
          deadIds.push(pool.id);
        } finally {
          done += 1;
          setHealthProgress({ current: done, total: targets.length });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(10, targets.length) }, worker));
    await fetchProxyPools();
    setHealthChecking(false);
    setHealthProgress({ current: 0, total: 0 });

    if (deadIds.length === 0) {
      notify.success(`Health check done. Alive: ${alive}, Dead: 0`);
      return;
    }

    setConfirmState({
      title: "Disable Dead Proxies",
      message: `Alive: ${alive}, Dead: ${deadIds.length}.\n\nDisable the dead proxy pools?`,
      onConfirm: async () => {
        setConfirmState(null);
        setBulkBusy(true);
        try {
          for (const id of deadIds) {
            await fetch(`/api/proxy-pools/${id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isActive: false }),
            });
          }
          await fetchProxyPools();
          notify.success(`Disabled ${deadIds.length} dead proxy pools`);
        } finally {
          setBulkBusy(false);
        }
      },
    });
  };

  const parseProxyLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (trimmed.includes("://")) {
      const parsed = new URL(trimmed);
      const hostLabel = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
      return { proxyUrl: parsed.toString(), name: `Imported ${hostLabel}` };
    }
    const parts = trimmed.split(":");
    if (parts.length !== 4) throw new Error("Unsupported format");
    const [host, port, username, password] = parts;
    if (!host || !port || !username || !password) throw new Error("Invalid host:port:user:pass format");
    return {
      proxyUrl: `http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`,
      name: `Imported ${host}:${port}`,
    };
  };

  const handleBatchImport = async () => {
    const lines = batchImportText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      notify.warning("Please paste at least one proxy line.");
      return;
    }

    const parsedEntries = [];
    const invalidLines = [];
    lines.forEach((line, index) => {
      try {
        const parsed = parseProxyLine(line);
        if (parsed) parsedEntries.push(parsed);
      } catch (error) {
        invalidLines.push(`Line ${index + 1}: ${error.message}`);
      }
    });
    if (invalidLines.length > 0) {
      notify.error(`Invalid proxy format:\n${invalidLines.join("\n")}`);
      return;
    }

    setImporting(true);
    try {
      const existingKeys = new Set(proxyPools.map((pool) => `${(pool.proxyUrl || "").trim()}|||${(pool.noProxy || "").trim()}`));
      let created = 0;
      let skipped = 0;
      let failed = 0;
      for (const entry of parsedEntries) {
        const dedupeKey = `${entry.proxyUrl}|||`;
        if (existingKeys.has(dedupeKey)) {
          skipped += 1;
          continue;
        }
        const response = await fetch("/api/proxy-pools", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...entry, noProxy: "", isActive: true, type: "http" }),
        });
        if (response.ok) {
          created += 1;
          existingKeys.add(dedupeKey);
        } else {
          failed += 1;
        }
      }
      await fetchProxyPools();
      setShowBatchImportModal(false);
      notify.success(`Batch import completed: Created ${created}, Skipped ${skipped}, Failed ${failed}`);
    } catch (error) {
      console.error("Error batch importing proxies:", error);
      notify.error("Batch import failed");
    } finally {
      setImporting(false);
    }
  };

  const activeCount = useMemo(() => proxyPools.filter((pool) => pool.isActive === true).length, [proxyPools]);

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:gap-6 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold sm:text-2xl">Proxy Pools</h1>
          <p className="mt-1 text-sm text-text-muted">HTTP proxy pools for outbound provider requests from this local instance.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
          <Button size="sm" variant="secondary" icon="upload_file" onClick={() => { setBatchImportText(""); setShowBatchImportModal(true); }}>
            Batch Import
          </Button>
          <Button size="sm" icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-primary">{selectedIds.length > 0 ? `${selectedIds.length} selected` : "All pools"}</span>
          <span className="text-xs text-text-muted">{activeCount} active</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              icon={healthChecking ? "progress_activity" : "health_and_safety"}
              onClick={handleHealthCheck}
              disabled={healthChecking || bulkBusy || proxyPools.length === 0}
            >
              {healthChecking ? `Checking ${healthProgress.current}/${healthProgress.total}` : "Health Check"}
            </Button>
            {selectedIds.length > 0 && (
              <>
                <Button size="sm" variant="secondary" icon="toggle_on" onClick={() => bulkSetActive(true)} disabled={bulkBusy || healthChecking}>Activate</Button>
                <Button size="sm" variant="secondary" icon="toggle_off" onClick={() => bulkSetActive(false)} disabled={bulkBusy || healthChecking}>Deactivate</Button>
                <Button size="sm" variant="secondary" icon="delete" onClick={bulkDelete} disabled={bulkBusy || healthChecking}>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setSelectedIds([])} disabled={bulkBusy || healthChecking}>Clear</Button>
              </>
            )}
          </div>
        </div>

        {loadError ? (
          <div role="alert" className="py-10 text-center text-sm text-danger">
            <p className="mb-3 font-medium">Failed to load proxy pools.</p>
            <Button variant="outline" icon="refresh" onClick={() => { setLoading(true); fetchProxyPools(); }}>Retry</Button>
          </div>
        ) : proxyPools.length === 0 ? (
          <div className="py-10 text-center">
            <p className="mb-1 font-medium text-text-main">No local proxy pools yet</p>
            <p className="mb-4 text-sm text-text-muted">Add a local HTTP proxy, then assign it to provider connections.</p>
            <Button icon="add" onClick={openCreateModal}>Add Proxy Pool</Button>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-black/[0.04] dark:divide-white/[0.05]">
            <label className="flex items-center gap-3 py-2 text-xs text-text-muted">
              <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} className="size-4 rounded" />
              Select all local pools
            </label>
            {proxyPools.map((pool) => (
              <div key={pool.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <input type="checkbox" aria-label={`Select ${pool.name || pool.host || pool.id}`} checked={selectedIds.includes(pool.id)} onChange={() => toggleSelect(pool.id)} className="mt-1 size-4 shrink-0 rounded" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="max-w-full truncate text-sm font-medium sm:max-w-[18rem]">{pool.name}</p>
                      <Badge variant={getStatusVariant(pool.testStatus)} size="sm" dot>{pool.testStatus || "unknown"}</Badge>
                      <Badge variant={pool.isActive ? "success" : "default"} size="sm">{pool.isActive ? "active" : "inactive"}</Badge>
                      <Badge variant="default" size="sm">{pool.boundConnectionCount || 0} bound</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-text-muted">{pool.proxyUrl}</p>
                    {pool.noProxy && <p className="mt-1 truncate text-xs text-text-muted">No proxy: {pool.noProxy}</p>}
                    <p className="mt-1 text-xs text-text-muted">Last tested: {formatDateTime(pool.lastTestedAt)}{pool.lastError ? ` · ${pool.lastError}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Toggle size="sm" checked={pool.isActive === true} onChange={() => handleToggleActive(pool)} title={pool.isActive ? "Disable" : "Enable"} aria-label={pool.isActive ? "Disable proxy pool" : "Enable proxy pool"} />
                  <button type="button" onClick={() => handleTest(pool.id)} className="rounded p-2 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5" title="Test proxy" aria-label={testingId === pool.id ? "Testing proxy" : "Test proxy"} disabled={testingId === pool.id}>
                    <span className="material-symbols-outlined text-lg" aria-hidden="true" style={testingId === pool.id ? { animation: "spin 1s linear infinite" } : undefined}>{testingId === pool.id ? "progress_activity" : "science"}</span>
                  </button>
                  <button type="button" onClick={() => openEditModal(pool)} className="rounded p-2 text-text-muted hover:bg-black/5 hover:text-primary dark:hover:bg-white/5" title="Edit" aria-label="Edit proxy pool">
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">edit</span>
                  </button>
                  <button type="button" onClick={() => handleDelete(pool)} className="rounded p-2 text-red-500 hover:bg-red-500/10" title="Delete" aria-label="Delete proxy pool">
                    <span className="material-symbols-outlined text-lg" aria-hidden="true">delete</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal isOpen={showBatchImportModal} title="Batch Import Local Proxies" onClose={() => { if (!importing) setShowBatchImportModal(false); }}>
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-main">Paste proxy list (one per line)</label>
            <textarea
              value={batchImportText}
              onChange={(event) => setBatchImportText(event.target.value)}
              placeholder={"http://user:pass@127.0.0.1:7897\n127.0.0.1:7897:user:pass"}
              className="min-h-[180px] w-full rounded-md border border-black/10 bg-white px-3 py-2 text-sm transition-all focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30 dark:border-white/10 dark:bg-white/5"
            />
            <p className="mt-1 text-xs text-text-muted">Supported: protocol://user:pass@host:port or host:port:user:pass.</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={handleBatchImport} disabled={!batchImportText.trim() || importing}>{importing ? "Importing..." : "Import"}</Button>
            <Button fullWidth variant="ghost" onClick={() => setShowBatchImportModal(false)} disabled={importing}>Cancel</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={showFormModal} title={editingProxyPool ? "Edit Local Proxy Pool" : "Add Local Proxy Pool"} onClose={closeFormModal}>
        <div className="flex flex-col gap-4">
          <Input label="Name" value={formData.name} onChange={(event) => setFormData((previous) => ({ ...previous, name: event.target.value }))} placeholder="Office Proxy" />
          <Input label="Proxy URL" value={formData.proxyUrl} onChange={(event) => setFormData((previous) => ({ ...previous, proxyUrl: event.target.value }))} placeholder="http://127.0.0.1:7897" />
          <Input label="No Proxy" value={formData.noProxy} onChange={(event) => setFormData((previous) => ({ ...previous, noProxy: event.target.value }))} placeholder="localhost,127.0.0.1,.internal" hint="Comma-separated hosts/domains to bypass the proxy." />
          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-medium">Active</p><p className="text-xs text-text-muted">Inactive pools are ignored by runtime resolution.</p></div>
            <Toggle checked={formData.isActive === true} onChange={() => setFormData((previous) => ({ ...previous, isActive: !previous.isActive }))} disabled={saving} />
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-border/50 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="text-sm font-medium">Strict Proxy</p><p className="text-xs text-text-muted">Fail the request if this proxy is unreachable.</p></div>
            <Toggle checked={formData.strictProxy === true} onChange={() => setFormData((previous) => ({ ...previous, strictProxy: !previous.strictProxy }))} disabled={saving} />
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button fullWidth onClick={handleSave} disabled={!formData.name.trim() || !formData.proxyUrl.trim() || saving}>{saving ? "Saving..." : "Save"}</Button>
            <Button fullWidth variant="ghost" onClick={closeFormModal} disabled={saving}>Cancel</Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message || "Are you sure?"}
        variant="danger"
      />
    </div>
  );
}
