"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";

const ENDPOINT = "/api/cli-tools/aizen-settings";

export default function AizenToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  apiKeys,
  activeProviders,
  hasActiveProviders,
  initialStatus,
}) {
  const initialSettings = initialStatus?.settings || {};
  const [status, setStatus] = useState(initialStatus || null);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState(initialSettings.apiKey || "");
  const [customBaseUrl, setCustomBaseUrl] = useState(initialSettings.baseUrl || "");

  // Models
  const [selectedModels, setSelectedModels] = useState(
    Array.isArray(initialSettings.models) ? initialSettings.models : [],
  );
  const [activeModel, setActiveModel] = useState(initialSettings.activeModel || "");
  const [subagentModel, setSubagentModel] = useState(initialSettings.subagentModel || "");
  const [modalOpen, setModalOpen] = useState(false);
  const [subagentModalOpen, setSubagentModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const selectedModelsRef = useRef([]);

  // Settings
  const [thinkingEffort, setThinkingEffort] = useState(initialSettings.thinkingEffort || null);
  const [autoCompact, setAutoCompact] = useState(initialSettings.autoCompact === true);
  const [mcpCodebaseMemory, setMcpCodebaseMemory] = useState(initialSettings.mcpCodebaseMemory === true);
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);

  useEffect(() => {
    selectedModelsRef.current = selectedModels;
  }, [selectedModels]);

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the selected key from the first loaded API key
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate status from the initial prop once
    if (initialStatus) setStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !status) {
      // eslint-disable-next-line react-hooks/immutability -- expand-triggered effect intentionally calls handlers declared below
      checkStatus();
      // eslint-disable-next-line react-hooks/immutability -- expand-triggered effect intentionally calls handlers declared below
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  const hydrateFormFromStatus = (nextStatus) => {
    const settings = nextStatus?.settings;
    if (!settings) return;

    if (settings.baseUrl) setCustomBaseUrl(settings.baseUrl);
    // Never hydrate raw apiKey from GET (masked). Keep user's selected gateway key.
    if (Array.isArray(settings.models) && settings.models.length) setSelectedModels(settings.models);
    if (settings.activeModel) setActiveModel(settings.activeModel);
    if (settings.subagentModel !== undefined) setSubagentModel(settings.subagentModel || "");
    if (settings.thinkingEffort !== undefined) setThinkingEffort(settings.thinkingEffort || null);
    if (typeof settings.autoCompact === "boolean") setAutoCompact(settings.autoCompact);
    if (typeof settings.mcpCodebaseMemory === "boolean") setMcpCodebaseMemory(settings.mcpCodebaseMemory);
  };

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.log("Error fetching model aliases:", error);
    }
  };

  const checkStatus = async (withLive = false) => {
    setChecking(true);
    try {
      const url = withLive
        ? `${ENDPOINT}?live=1${selectedApiKey ? `&probeKey=${encodeURIComponent(selectedApiKey)}` : ""}`
        : ENDPOINT;
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) {
        const nextStatus = await res.json();
        setStatus(nextStatus);
        hydrateFormFromStatus(nextStatus);
      }
    } catch (error) {
      console.log("Error checking aizen status:", error);
    } finally {
      setChecking(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey || "";
      const endpoint = (customBaseUrl || baseUrl || "").trim();
      if (!endpoint) {
        setMessage({ type: "error", text: "Chọn Base URL (endpoint Switch-Router)." });
        return;
      }
      if (!keyToUse) {
        setMessage({ type: "error", text: "Chọn API key gateway trước khi Apply." });
        return;
      }
      if (!activeModel && selectedModels.length === 0) {
        setMessage({ type: "error", text: "Chọn ít nhất một model (active)." });
        return;
      }

      const body = {
        baseUrl: endpoint,
        apiKey: keyToUse,
        models: selectedModels,
        activeModel: activeModel || selectedModels[0] || "",
        subagentModel: subagentModel || "",
        thinkingEffort: thinkingEffort,
        autoCompact: autoCompact,
        mcpCodebaseMemory: mcpCodebaseMemory,
        probe: true,
      };

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        const liveBit = data.live?.ok
          ? ` · live OK (${data.live.modelCount ?? "?"} models, ${data.live.latencyMs ?? "?"}ms)`
          : (data.live ? ` · live probe failed: ${data.live.error || data.live.status}` : "");
        const diskBit = data.wroteDisk ? "Đã ghi ~/.aizen/cli-config.json" : "Chỉ lưu DB";
        setMessage({
          type: "success",
          text: `${diskBit}${data.backupPath ? " (có backup)" : ""}.${liveBit}`,
        });
        checkStatus(true);
      } else {
        setMessage({ type: "error", text: data.error || "Failed to save settings" });
      }
    } catch (error) {
      console.log("Error applying aizen settings:", error);
      setMessage({ type: "error", text: "Network error saving settings" });
    } finally {
      setApplying(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch(ENDPOINT, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setMessage({
          type: "success",
          text: data.backupPath
            ? "Đã gỡ wire Switch-Router (backup config đã tạo)."
            : "Aizen settings reset successfully",
        });
        setCustomBaseUrl("");
        setSelectedApiKey("");
        setSelectedModels([]);
        setActiveModel("");
        setSubagentModel("");
        setThinkingEffort(null);
        setAutoCompact(false);
        setMcpCodebaseMemory(false);
        checkStatus(true);
      } else {
        setMessage({ type: "error", text: data.error || "Reset failed" });
      }
    } catch (error) {
      console.log("Error resetting aizen settings:", error);
      setMessage({ type: "error", text: "Network error on reset" });
    } finally {
      setRestoring(false);
    }
  };

  const handleTestConnection = async () => {
    setChecking(true);
    setMessage(null);
    try {
      await checkStatus(true);
      const st = status; // may be stale; re-fetch below
      const qs = new URLSearchParams({ live: "1" });
      if (selectedApiKey) qs.set("probeKey", selectedApiKey);
      const res = await fetch(`${ENDPOINT}?${qs}`, { cache: "no-store" });
      const data = await res.json();
      setStatus(data);
      if (!data.installed) {
        setMessage({ type: "error", text: "Aizen CLI chưa được phát hiện trên máy này." });
      } else if (data.live?.ok) {
        setMessage({
          type: "success",
          text: `Live OK — ${data.live.modelCount} models · ${data.live.latencyMs}ms · ${data.endpointMatch}`,
        });
      } else if (data.live) {
        setMessage({ type: "error", text: `Live probe failed: ${data.live.error || data.live.status}` });
      } else {
        setMessage({ type: "success", text: data.hasSwitchRouter ? "Config OK (no live probe)." : "Aizen installed; chưa wire Switch-Router." });
      }
      void st;
    } catch (error) {
      setMessage({ type: "error", text: "Test connection failed" });
    } finally {
      setChecking(false);
    }
  };

  const handleRemoveModel = async (model) => {
    try {
      const res = await fetch(`${ENDPOINT}?model=${encodeURIComponent(model)}`, { method: "DELETE" });
      if (res.ok) {
        const remaining = selectedModels.filter((m) => m !== model);
        setSelectedModels(remaining);
        if (activeModel === model) setActiveModel(remaining[0] || "");
        if (subagentModel === model) setSubagentModel("");
        checkStatus();
      }
    } catch (error) {
      console.log("Error removing model:", error);
    }
  };

  const handleToggleAutoCompact = async () => {
    const next = !autoCompact;
    setAutoCompact(next);
    try {
      await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoCompact: next }),
      });
    } catch (error) {
      console.log("Error toggling auto-compact:", error);
    }
  };

  const handleToggleMcp = async () => {
    const next = !mcpCodebaseMemory;
    setMcpCodebaseMemory(next);
    try {
      await fetch(ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mcpCodebaseMemory: next }),
      });
    } catch (error) {
      console.log("Error toggling MCP:", error);
    }
  };

  const getDisplayUrl = () => baseUrl || "http://127.0.0.1:28701/v1";

  const configStatus = (() => {
    if (status && status.installed === false) return "not_installed";
    if (status?.endpointMatch === "configured" || status?.hasSwitchRouter) return "configured";
    if (status?.endpointMatch === "other") return "other";
    if (status?.hasConfigFile || status?.settings?.baseUrl) return "other";
    return "not_configured";
  })();

  const getManualConfigs = () => {
    const keyToUse = selectedApiKey || "sk_switch_router";
    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const activeModelToShow = activeModel || selectedModels[0] || modelsToShow[0];
    const effectiveSubagentModel = subagentModel || activeModelToShow;
    const endpoint = customBaseUrl || baseUrl || "http://127.0.0.1:28701/v1";

    const cliConfig = {
      base_url: endpoint,
      api_key: keyToUse,
      model: activeModelToShow,
      active_provider: "Switch-Router",
      providers: [{
        name: "Switch-Router",
        base_url: endpoint,
        api_key: keyToUse,
        model: activeModelToShow,
      }],
      reasoning_effort: thinkingEffort || undefined,
      compact_threshold_pct: autoCompact ? 60 : 0,
    };
    if (effectiveSubagentModel && effectiveSubagentModel !== activeModelToShow) {
      cliConfig.subagent_model = effectiveSubagentModel;
    }

    return [
      {
        filename: "~/.aizen/cli-config.json (Apply writes this)",
        content: JSON.stringify(cliConfig, null, 2),
      },
      {
        filename: status?.configPath || "config path",
        content: status?.configPath || getDisplayUrl(),
      },
    ];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        aria-controls={`${tool.id}-panel`}
        className="flex w-full items-start justify-between gap-3 cursor-pointer text-left sm:items-center"
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-3xl" style={{ color: "#6C5CE7" }}>smart_toy</span>
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Wired · Switch-Router</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Wired · other</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not wired</span>}
              {configStatus === "not_installed" && <span className="px-1.5 py-0.5 text-xs font-medium bg-red-500/10 text-red-600 dark:text-red-400 rounded-full">Not installed</span>}
              {status?.live?.ok && <span className="px-1.5 py-0.5 text-xs font-medium bg-emerald-500/10 text-emerald-600 rounded-full">Live</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-xl transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && (
        <div id={`${tool.id}-panel`} className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Aizen config...</span>
            </div>
          )}

          {!checking && (
            <>
              {/* Status strip */}
              <div className="rounded-lg border border-border bg-surface/40 px-3 py-2 text-xs text-text-muted space-y-1">
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  <span>CLI: <span className="text-text-main">{status?.installed ? "installed" : "not found"}</span></span>
                  {status?.binaryPath && <span className="truncate max-w-[240px]" title={status.binaryPath}>bin: {status.binaryPath}</span>}
                  {status?.configPath && <span className="truncate max-w-[280px]" title={status.configPath}>config: {status.configPath}</span>}
                </div>
                {status?.settings?.baseUrl && (
                  <div>
                    Current endpoint: <span className="text-text-main">{status.settings.baseUrl}</span>
                    {status.settings.apiKeyMasked ? ` · key ${status.settings.apiKeyMasked}` : ""}
                    {status.settings.activeModel ? ` · model ${status.settings.activeModel}` : ""}
                  </div>
                )}
                {status?.live && (
                  <div>
                    Live: {status.live.ok
                      ? `OK · ${status.live.modelCount} models · ${status.live.latencyMs}ms`
                      : `fail · ${status.live.error || status.live.status}`}
                  </div>
                )}
                {status?.installed === false && (
                  <div className="text-amber-600 dark:text-amber-400">
                    Cài Aizen CLI rồi bấm Recheck. Config sẽ ghi vào %USERPROFILE%\.aizen\cli-config.json
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                {/* Endpoint */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} />
                </div>

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} />
                </div>

                {/* Models */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="w-32 shrink-0 text-sm font-semibold text-text-main text-right pt-1">Models</span>
                  <span className="material-symbols-outlined text-text-muted text-sm mt-1.5">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] px-2 py-1.5 bg-surface rounded border border-border">
                      {selectedModels.length === 0 ? (
                        <span className="text-xs text-text-muted">No models selected</span>
                      ) : (
                        selectedModels.map((model) => (
                          <span
                            key={model}
                            onClick={() => setActiveModel(model)}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs cursor-pointer transition-colors ${
                              model === activeModel
                                ? "bg-primary/10 text-primary border border-primary"
                                : "bg-black/5 dark:bg-white/5 text-text-muted border border-transparent hover:border-border"
                            }`}
                            title={model === activeModel ? "Active model" : "Click to set as active"}
                          >
                            {model === activeModel && <span className="material-symbols-outlined text-xs">star</span>}
                            {model}
                            <button
                              onClick={async (e) => { e.stopPropagation(); await handleRemoveModel(model); }}
                              className="ml-0.5 hover:text-red-500"
                            >
                              <span className="material-symbols-outlined text-xs">close</span>
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setModalOpen(true)}
                        disabled={!activeProviders?.length}
                        className={`px-2 py-1 rounded border text-xs transition-colors ${
                          activeProviders?.length
                            ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer"
                            : "opacity-50 cursor-not-allowed border-border"
                        }`}
                      >
                        + Add Model
                      </button>
                      <span className="text-xs text-text-muted">
                        {selectedModels.length > 0 && activeModel
                          ? <>Active: <span className="text-primary">{activeModel}</span></>
                          : selectedModels.length > 0
                            ? "Click a model to set as active"
                            : "Select models to add"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Subagent Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Subagent Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <input
                    type="text"
                    value={subagentModel}
                    onChange={(e) => setSubagentModel(e.target.value)}
                    placeholder={activeModel || "provider/model-id (defaults to main model)"}
                    className="w-full min-w-0 px-2 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                  />
                  <button
                    onClick={() => setSubagentModalOpen(true)}
                    disabled={!activeProviders?.length}
                    className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${
                      activeProviders?.length
                        ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer"
                        : "opacity-50 cursor-not-allowed border-border"
                    }`}
                  >
                    Select Model
                  </button>
                  {subagentModel && (
                    <button
                      onClick={() => setSubagentModel("")}
                      className="p-1 text-text-muted hover:text-red-500 rounded transition-colors"
                      title="Clear (will use main model)"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Settings Section */}
              <div className="border-t border-border pt-3">
                <h4 className="text-sm font-semibold text-text-main mb-3">Settings</h4>

                {/* Thinking Effort */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2 mb-3">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Thinking Effort</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { value: null, label: "None" },
                      { value: "low", label: "Low" },
                      { value: "medium", label: "Medium" },
                      { value: "high", label: "High" },
                    ].map((opt) => (
                      <button
                        key={opt.label}
                        onClick={() => setThinkingEffort(opt.value)}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                          thinkingEffort === opt.value
                            ? "bg-primary/10 text-primary border border-primary"
                            : "bg-surface border border-border text-text-muted hover:border-primary/50"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Auto Compact */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2 mb-3">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Auto-compact</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <label className="flex items-center gap-1.5 cursor-pointer select-none">
                    <input type="checkbox" checked={autoCompact} onChange={handleToggleAutoCompact} className="w-3.5 h-3.5 accent-primary cursor-pointer" />
                    <span className="text-xs text-text-muted">Compact messages to reduce token usage</span>
                  </label>
                </div>
              </div>

              {/* MCP Plugins Section */}
              <div className="border-t border-border pt-3">
                <h4 className="text-sm font-semibold text-text-main mb-3">MCP Plugins</h4>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-start sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm pt-0.5">Codebase Memory</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <div className="flex-1 flex flex-col gap-1.5">
                    <label className="flex items-start gap-2 cursor-pointer px-2 py-1.5 bg-surface rounded border border-border">
                      <input
                        type="checkbox"
                        checked={mcpCodebaseMemory}
                        onChange={handleToggleMcp}
                        className="mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">mcp-codebase-memory</div>
                        <p className="text-xs text-text-muted leading-snug">
                          Indexes code graph for semantic search and cross-file intelligence.
                          Enables Aizen to understand your codebase structure.
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-sm">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} loading={applying}>
                  <span className="material-symbols-outlined text-sm mr-1">save</span>Apply to CLI
                </Button>
                <Button variant="secondary" size="sm" onClick={handleTestConnection} loading={checking}>
                  <span className="material-symbols-outlined text-sm mr-1">wifi_tethering</span>Test / Recheck
                </Button>
                <Button variant="outline" size="sm" onClick={handleRestore} loading={restoring}>
                  <span className="material-symbols-outlined text-sm mr-1">restart_alt</span>Reset wire
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setShowManualConfigModal(true)}>
                  <span className="material-symbols-outlined text-sm mr-1">content_copy</span>Manual Config
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ModelSelectModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelect={(model) => {
          if (!selectedModels.includes(model.value)) {
            const updated = [...selectedModels, model.value];
            setSelectedModels(updated);
            if (!activeModel) setActiveModel(model.value);
          }
        }}
        onDeselect={(model) => {
          const remaining = selectedModels.filter((m) => m !== model.value);
          setSelectedModels(remaining);
          if (activeModel === model.value) setActiveModel(remaining[0] || "");
        }}
        selectedModel={null}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        addedModelValues={selectedModels}
        closeOnSelect={false}
        title="Add Model for Aizen"
      />

      <ModelSelectModal
        isOpen={subagentModalOpen}
        onClose={() => setSubagentModalOpen(false)}
        onSelect={(model) => { setSubagentModel(model.value); setSubagentModalOpen(false); }}
        selectedModel={subagentModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Subagent Model for Aizen"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Aizen - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}