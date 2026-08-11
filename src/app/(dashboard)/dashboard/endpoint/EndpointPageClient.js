"use client";

import { useEffect, useState } from "react";
import { Card, Button, Input, Modal, CardSkeleton, Toggle, ConfirmModal } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import EndpointRow from "./components/EndpointRow";
import RuntimeStatusCard from "./components/RuntimeStatusCard";
import OfficeGatewayCard from "./components/OfficeGatewayCard";
import { ENDPOINT_GROUPS } from "./endpointConstants";

export default function EndpointPageClient() {
  const [keys, setKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requireApiKey, setRequireApiKey] = useState(false);
  const [officeGatewayEnabled, setOfficeGatewayEnabled] = useState(false);
  const [officeAllowlistCount, setOfficeAllowlistCount] = useState(0);
  const [health, setHealth] = useState("checking");
  const [modelCount, setModelCount] = useState(null);
  const [origin] = useState(() => (
    typeof window === "undefined" ? "" : window.location.origin
  ));
  const [showAddModal, setShowAddModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState(null);
  const [confirmState, setConfirmState] = useState(null);
  const [visibleKeys, setVisibleKeys] = useState(new Set());
  const { copied, copy } = useCopyToClipboard();

  const fetchData = async () => {
    try {
      const response = await fetch("/api/keys", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setKeys(data.keys || []);
    } catch (error) {
      console.log("Error fetching API keys:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadSettings = async () => {
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) {
        setRequireApiKey(data.requireApiKey === true);
        setOfficeGatewayEnabled(data.officeGatewayEnabled === true);
        setOfficeAllowlistCount(Number(data.officeModelAllowlistCount) || 0);
      }
    } catch (error) {
      console.log("Error fetching local settings:", error);
    }
  };

  const loadRuntimeStatus = async () => {
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      setHealth(response.ok ? "ok" : "down");
    } catch {
      setHealth("down");
    }

    try {
      const response = await fetch("/api/models", { cache: "no-store" });
      const data = await response.json();
      if (response.ok) setModelCount((data.models || []).length);
    } catch (error) {
      console.log("Error fetching model catalog size:", error);
    }
  };

  useEffect(() => {
    queueMicrotask(() => {
      fetchData();
      loadSettings();
      loadRuntimeStatus();
    });
  }, []);

  const handleRequireApiKey = async (value) => {
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requireApiKey: value }),
      });
      if (response.ok) setRequireApiKey(value);
    } catch (error) {
      console.log("Error updating requireApiKey:", error);
    }
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    try {
      const response = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await response.json();
      if (!response.ok) return;
      setCreatedKey(data.key);
      setNewKeyName("");
      setShowAddModal(false);
      await fetchData();
    } catch (error) {
      console.log("Error creating API key:", error);
    }
  };

  const handleDeleteKey = (id, name) => {
    setConfirmState({
      title: "Delete API Key",
      message: `Delete API key "${name}"?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const response = await fetch(`/api/keys/${id}`, { method: "DELETE" });
          if (!response.ok) return;
          setKeys((previous) => previous.filter((key) => key.id !== id));
          setVisibleKeys((previous) => {
            const next = new Set(previous);
            next.delete(id);
            return next;
          });
        } catch (error) {
          console.log("Error deleting API key:", error);
        }
      },
    });
  };

  const handleToggleKey = async (id, isActive) => {
    try {
      const response = await fetch(`/api/keys/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (response.ok) {
        setKeys((previous) => previous.map((key) => (
          key.id === id ? { ...key, isActive } : key
        )));
      }
    } catch (error) {
      console.log("Error toggling API key:", error);
    }
  };

  const toggleKeyVisibility = (id) => {
    setVisibleKeys((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const maskKey = (value) => {
    if (!value || value.length <= 10) return value || "";
    return `${value.slice(0, 6)}${"•".repeat(value.length - 10)}${value.slice(-4)}`;
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const visibleGroups = ENDPOINT_GROUPS.filter(
    (group) => (!group.requiresOfficeGateway || officeGatewayEnabled) && !group.excludeFromBaseUrls
  );
  const activeKeyCount = keys.filter((key) => key.isActive !== false).length;

  return (
    <div className="flex flex-col gap-6">
      <Card title="Gateway Status" icon="monitor_heart">
        <RuntimeStatusCard
          health={health}
          origin={origin}
          requireApiKey={requireApiKey}
          modelCount={modelCount}
          activeKeyCount={activeKeyCount}
          officeGatewayEnabled={officeGatewayEnabled}
        />
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Main Content Area - spans 1 column */}
        <div className="flex flex-col gap-6">
          <Card id="require-api-key" title="API Keys" icon="vpn_key" action={<Button icon="add" onClick={() => setShowAddModal(true)}>Create Key</Button>}>
            <div className="flex flex-col">
              <div className="mb-4 flex items-center justify-between border-b border-border-subtle pb-4">
                <div>
                  <p className="font-medium text-text-main">Require API key</p>
                  <p className="text-sm text-text-muted">Requests without a valid key will be rejected.</p>
                </div>
                <Toggle checked={requireApiKey} onChange={() => handleRequireApiKey(!requireApiKey)} />
              </div>

              {keys.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <span className="material-symbols-outlined text-4xl">vpn_key</span>
                  </div>
                  <p className="mb-1 font-medium text-text-main">No API keys yet</p>
                  <p className="mb-4 text-sm text-text-muted">Create a key for local clients and CLI tools.</p>
                  <Button icon="add" onClick={() => setShowAddModal(true)}>Create Key</Button>
                </div>
              ) : (
                <div className="flex flex-col">
                  {keys.map((key) => (
                    <div
                      key={key.id}
                      className={`group flex items-center justify-between border-b border-border-subtle py-3 last:border-b-0 ${key.isActive === false ? "opacity-60" : ""}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-text-main">{key.name}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <code className="font-mono text-xs text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">
                            {visibleKeys.has(key.id) ? key.key : maskKey(key.key)}
                          </code>
                          <button
                            onClick={() => toggleKeyVisibility(key.id)}
                            className="rounded p-1 text-text-muted transition-all hover:bg-black/5 hover:text-primary dark:hover:bg-white/5 sm:opacity-40 sm:group-hover:opacity-100"
                            title={visibleKeys.has(key.id) ? "Hide key" : "Show key"}
                          >
                            <span className="material-symbols-outlined text-sm">
                              {visibleKeys.has(key.id) ? "visibility_off" : "visibility"}
                            </span>
                          </button>
                          <button
                            onClick={() => copy(key.key, key.id)}
                            className="rounded p-1 text-text-muted transition-all hover:bg-black/5 hover:text-primary dark:hover:bg-white/5 sm:opacity-40 sm:group-hover:opacity-100"
                            title="Copy key"
                          >
                            <span className="material-symbols-outlined text-sm">
                              {copied === key.id ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          <p className="text-xs text-text-muted">
                            Created {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : "unknown date"}
                          </p>
                          {key.isActive === false && (
                            <span className="text-xs font-medium text-orange-500 bg-orange-500/10 px-1.5 py-0.5 rounded">Paused</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <Toggle
                          size="sm"
                          checked={key.isActive !== false}
                          onChange={(checked) => handleToggleKey(key.id, checked)}
                          title={key.isActive === false ? "Resume key" : "Pause key"}
                        />
                        <div className="w-[1px] h-6 bg-border-subtle mx-1"></div>
                        <button
                          onClick={() => handleDeleteKey(key.id, key.name)}
                          className="rounded p-2 text-text-muted transition-all hover:bg-red-500/10 hover:text-red-500 sm:opacity-40 sm:group-hover:opacity-100"
                          title="Delete key"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Side Column - spans 1 column */}
        <div className="flex flex-col gap-6">
          <Card title="Claude for M365 Gateway" icon="description" subtitle="An isolated namespace for Office agents. It never changes the behaviour of the endpoints above.">
            <OfficeGatewayCard
              origin={origin}
              enabled={officeGatewayEnabled}
              allowlistCount={officeAllowlistCount}
              copied={copied}
              onCopy={copy}
            />
          </Card>
        </div>
      </div>

      <Card title="Base URLs" icon="api" subtitle="One gateway, several client formats. Point each tool at the base URL matching the API it speaks.">
        <div className="grid grid-cols-1 gap-x-10 gap-y-5 2xl:grid-cols-2">
          {visibleGroups.map((group) => (
            <EndpointRow
              key={group.id}
              label={group.label}
              badge={group.badge}
              tone={group.tone}
              url={`${origin}${group.path}`}
              copyId={`endpoint_${group.id}`}
              copied={copied}
              onCopy={copy}
              desc={group.desc}
              routes={group.routes}
            />
          ))}
        </div>
      </Card>

      <Modal
        isOpen={showAddModal}
        title="Create API Key"
        onClose={() => { setShowAddModal(false); setNewKeyName(""); }}
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Key Name"
            value={newKeyName}
            onChange={(event) => setNewKeyName(event.target.value)}
            placeholder="Local CLI"
          />
          <div className="flex justify-end gap-2 mt-2">
            <Button
              onClick={() => { setShowAddModal(false); setNewKeyName(""); }}
              variant="ghost"
            >Cancel</Button>
            <Button onClick={handleCreateKey} disabled={!newKeyName.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!createdKey} title="API Key Created" onClose={() => setCreatedKey(null)}>
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
            <p className="mb-2 text-sm font-medium text-yellow-800 dark:text-yellow-200">Save this key now!</p>
            <p className="text-sm text-yellow-700 dark:text-yellow-300">This is the only time you will see the full key.</p>
          </div>
          <div className="flex gap-2">
            <Input value={createdKey || ""} readOnly className="flex-1 font-mono text-sm" />
            <Button
              variant="secondary"
              icon={copied === "created_key" ? "check" : "content_copy"}
              onClick={() => copy(createdKey, "created_key")}
            >{copied === "created_key" ? "Copied!" : "Copy"}</Button>
          </div>
          <div className="flex justify-end mt-2">
            <Button onClick={() => setCreatedKey(null)}>Done</Button>
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
