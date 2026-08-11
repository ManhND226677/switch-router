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
    if (settings.apiKey) setSelectedApiKey(settings.apiKey);
    if (Array.isArray(settings.models)) setSelectedModels(settings.models);
    if (settings.activeModel) setActiveModel(settings.activeModel);
    if (settings.subagentModel) setSubagentModel(settings.subagentModel);
    if (settings.thinkingEffort) setThinkingEffort(settings.thinkingEffort);
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

  const checkStatus = async () => {
    setChecking(true);
    try {
      const res = await fetch(ENDPOINT);
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
      const keyToUse = selectedApiKey || "sk_switch_router";
      const body = {
        baseUrl: customBaseUrl || baseUrl,
        apiKey: keyToUse,
        models: selectedModels,
        activeModel: activeModel || selectedModels[0] || "",
        subagentModel: subagentModel || "",
        thinkingEffort: thinkingEffort,
        autoCompact: autoCompact,
        mcpCodebaseMemory: mcpCodebaseMemory,
      };

      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Settings saved! Aizen is now connected." });
        checkStatus();
      } else {
        const err = await res.json();
        setMessage({ type: "error", text: err.error || "Failed to save settings" });
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
      if (res.ok) {
        setMessage({ type: "success", text: "Aizen settings reset successfully" });
        setCustomBaseUrl("");
        setSelectedApiKey("");
        setSelectedModels([]);
        setActiveModel("");
        setSubagentModel("");
        setThinkingEffort(null);
        setAutoCompact(false);
        setMcpCodebaseMemory(false);
        checkStatus();
      }
    } catch (error) {
      console.log("Error resetting aizen settings:", error);
    } finally {
      setRestoring(false);
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

  const getDisplayUrl = () => baseUrl || "http://127.0.0.1:28701";

  const configStatus = (() => {
    if (!status?.hasSwitchRouter) return "not_configured";
    return "configured";
  })();

  const getManualConfigs = () => {
    const keyToUse = selectedApiKey || "sk_switch_router";
    const modelsToShow = selectedModels.length > 0 ? selectedModels : ["provider/model-id"];
    const activeModelToShow = activeModel || selectedModels[0] || modelsToShow[0];
    const effectiveSubagentModel = subagentModel || activeModelToShow;

    const config = {
      baseUrl: customBaseUrl || baseUrl || "http://127.0.0.1:28701",
      apiKey: keyToUse,
      models: modelsToShow,
      activeModel: activeModelToShow,
      subagentModel: effectiveSubagentModel,
    };
    if (thinkingEffort) config.thinkingEffort = thinkingEffort;
    if (autoCompact) config.autoCompact = true;
    if (mcpCodebaseMemory) config.mcpCodebaseMemory = true;

    return [{
      filename: "Dashboard Settings (saved in DB)",
      content: JSON.stringify(config, null, 2),
    }];
  };

  return (
    <Card padding="xs" className="overflow-hidden">
      <div className="flex items-start justify-between gap-3 hover:cursor-pointer sm:items-center" onClick={onToggle}>
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-8 flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-3xl" style={{ color: "#6C5CE7" }}>smart_toy</span>
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-xl transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checking && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Aizen config...</span>
            </div>
          )}

          {!checking && (
            <>
              <div className="flex flex-col gap-2">
                {/* Endpoint */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <BaseUrlSelect value={customBaseUrl || getDisplayUrl()} onChange={setCustomBaseUrl} />
                </div>

                {/* Current configured */}
                {status?.settings?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">{status.settings.baseUrl}</span>
                  </div>
                )}

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

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApply} loading={applying}>
                  <span className="material-symbols-outlined text-sm mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleRestore} loading={restoring}>
                  <span className="material-symbols-outlined text-sm mr-1">restart_alt</span>Reset
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