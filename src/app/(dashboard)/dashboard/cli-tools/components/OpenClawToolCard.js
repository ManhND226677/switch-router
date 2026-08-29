"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button, ModelSelectModal, ManualConfigModal } from "@/shared/components";
import Image from "next/image";
import BaseUrlSelect from "./BaseUrlSelect";
import ApiKeySelect from "./ApiKeySelect";
import { matchKnownEndpoint } from "./cliEndpointMatch";
import {
  SWITCH_ROUTER_PROVIDER,
  SWITCH_ROUTER_MODEL_PREFIX,
  getSwitchRouterProvider,
  stripSwitchRouterModelPrefix,
} from "@/lib/switchRouterIdentity";

export default function OpenClawToolCard({
  tool,
  isExpanded,
  onToggle,
  baseUrl,
  hasActiveProviders,
  apiKeys,
  activeProviders,
  initialStatus,
}) {
  const [openclawStatus, setOpenclawStatus] = useState(initialStatus || null);
  const [checkingOpenclaw, setCheckingOpenclaw] = useState(false);
  const [applying, setApplying] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(null);
  const [selectedApiKey, setSelectedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [agentModels, setAgentModels] = useState({}); // { [agentId]: modelId }
  const [agentModalFor, setAgentModalFor] = useState(null); // agentId opening modal
  const [modalOpen, setModalOpen] = useState(false);
  const [modelAliases, setModelAliases] = useState({});
  const [showManualConfigModal, setShowManualConfigModal] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState("");
  const hasInitializedModel = useRef(false);

  const getConfigStatus = () => {
    if (!openclawStatus?.installed) return null;
    const currentProvider = getSwitchRouterProvider(openclawStatus.settings?.models?.providers);
    if (!currentProvider) return "not_configured";
    return matchKnownEndpoint(currentProvider.baseUrl) ? "configured" : "other";
  };

  const configStatus = getConfigStatus();
  const configuredProvider = getSwitchRouterProvider(openclawStatus?.settings?.models?.providers);

  useEffect(() => {
    if (apiKeys?.length > 0 && !selectedApiKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- seed the selected key from the first loaded API key
      setSelectedApiKey(apiKeys[0].key);
    }
  }, [apiKeys, selectedApiKey]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate status from the initial prop once
    if (initialStatus) setOpenclawStatus(initialStatus);
  }, [initialStatus]);

  useEffect(() => {
    if (isExpanded && !openclawStatus) {
      // eslint-disable-next-line react-hooks/immutability -- expand-triggered effect intentionally calls handlers declared below
      checkOpenclawStatus();
      // eslint-disable-next-line react-hooks/immutability -- expand-triggered effect intentionally calls handlers declared below
      fetchModelAliases();
    }
    if (isExpanded) fetchModelAliases();
  }, [isExpanded]);

  const fetchModelAliases = async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) setModelAliases(data.aliases || {});
    } catch (error) {
      console.error("Error fetching model aliases:", error);
    }
  };

  useEffect(() => {
    if (openclawStatus?.installed && !hasInitializedModel.current) {
      hasInitializedModel.current = true;
      const provider = getSwitchRouterProvider(openclawStatus.settings?.models?.providers);
      if (provider) {
        const primaryModel = openclawStatus.settings?.agents?.defaults?.model?.primary;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate the selected model once from the fetched config
        if (primaryModel) setSelectedModel(stripSwitchRouterModelPrefix(primaryModel));
        if (provider.apiKey && apiKeys?.some(k => k.key === provider.apiKey)) {
          setSelectedApiKey(provider.apiKey);
        }
      }
      // Init per-agent models from enriched agents list
      const agentList = openclawStatus.agents || [];
      const initAgentModels = {};
      agentList.forEach((agent) => {
        if (agent.currentModel) initAgentModels[agent.id] = agent.currentModel;
      });
      setAgentModels(initAgentModels);
    }
  }, [openclawStatus, apiKeys]);

  const checkOpenclawStatus = async () => {
    setCheckingOpenclaw(true);
    try {
      const res = await fetch("/api/cli-tools/openclaw-settings");
      const data = await res.json();
      setOpenclawStatus(data);
    } catch (error) {
      setOpenclawStatus({ installed: false, error: error.message });
    } finally {
      setCheckingOpenclaw(false);
    }
  };

  const normalizeLocalhost = (url) => url.replace("://localhost", "://127.0.0.1");

  const getLocalBaseUrl = () => {
    if (typeof window !== "undefined") {
      return normalizeLocalhost(window.location.origin);
    }
    return "http://127.0.0.1:28701";
  };

  const getEffectiveBaseUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const getDisplayUrl = () => {
    const url = customBaseUrl || getLocalBaseUrl();
    return url.endsWith("/v1") ? url : `${url}/v1`;
  };

  const handleApplySettings = async () => {
    setApplying(true);
    setMessage(null);
    try {
      const keyToUse = selectedApiKey?.trim()
        || (apiKeys?.length > 0 ? apiKeys[0].key : null)
        || "sk_switch_router";

      const res = await fetch("/api/cli-tools/openclaw-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: getEffectiveBaseUrl(),
          apiKey: keyToUse,
          model: selectedModel,
          agentModels,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings applied successfully!" });
        checkOpenclawStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to apply settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setApplying(false);
    }
  };

  const handleResetSettings = async () => {
    setRestoring(true);
    setMessage(null);
    try {
      const res = await fetch("/api/cli-tools/openclaw-settings", { method: "DELETE" });
      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: "Settings reset successfully!" });
        setSelectedModel("");
        setSelectedApiKey("");
        checkOpenclawStatus();
      } else {
        setMessage({ type: "error", text: data.error || "Failed to reset settings" });
      }
    } catch (error) {
      setMessage({ type: "error", text: error.message });
    } finally {
      setRestoring(false);
    }
  };

  const handleModelSelect = (model) => {
    if (agentModalFor) {
      setAgentModels(prev => ({ ...prev, [agentModalFor]: model.value }));
      setAgentModalFor(null);
    } else {
      setSelectedModel(model.value);
    }
    setModalOpen(false);
  };

  const getManualConfigs = () => {
    const keyToUse = (selectedApiKey && selectedApiKey.trim())
      ? selectedApiKey
      : "sk_switch_router";

    const settingsContent = {
      agents: {
        defaults: {
          model: {
            primary: `${SWITCH_ROUTER_MODEL_PREFIX}${selectedModel || "provider/model-id"}`,
          },
        },
      },
      models: {
        providers: {
          [SWITCH_ROUTER_PROVIDER]: {
            baseUrl: getEffectiveBaseUrl(),
            apiKey: keyToUse,
            api: "openai-completions",
            models: [
              {
                id: selectedModel || "provider/model-id",
                name: (selectedModel || "provider/model-id").split("/").pop(),
              },
            ],
          },
        },
      },
    };

    return [
      {
        filename: "~/.openclaw/openclaw.json",
        content: JSON.stringify(settingsContent, null, 2),
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
            <Image src="/providers/openclaw.png" alt={tool.name} width={32} height={32} className="size-8 object-contain rounded-lg" sizes="32px" onError={(e) => { e.target.style.display = "none"; }} />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h3 className="font-medium text-sm">{tool.name}</h3>
              {configStatus === "configured" && <span className="px-1.5 py-0.5 text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400 rounded-full">Connected</span>}
              {configStatus === "not_configured" && <span className="px-1.5 py-0.5 text-xs font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded-full">Not configured</span>}
              {configStatus === "other" && <span className="px-1.5 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 rounded-full">Other</span>}
            </div>
            <p className="text-xs text-text-muted truncate">{tool.description}</p>
          </div>
        </div>
        <span className={`material-symbols-outlined text-text-muted text-xl transition-transform ${isExpanded ? "rotate-180" : ""}`}>expand_more</span>
      </button>

      {isExpanded && (
        <div id={`${tool.id}-panel`} className="mt-4 pt-4 border-t border-border flex flex-col gap-4">
          {checkingOpenclaw && (
            <div className="flex items-center gap-2 text-text-muted">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              <span>Checking Open Claw CLI...</span>
            </div>
          )}

          {!checkingOpenclaw && openclawStatus && !openclawStatus.installed && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-yellow-500">warning</span>
                  <div className="flex-1">
                    <p className="font-medium text-yellow-600 dark:text-yellow-400">Open Claw CLI not detected locally</p>
                    <p className="text-sm text-text-muted">Manual configuration is available if the tool does not auto-detect the local endpoint.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 pl-9">
                  <Button variant="secondary" size="sm" onClick={() => setShowManualConfigModal(true)} className="!bg-yellow-500/20 !border-yellow-500/40 !text-yellow-700 dark:!text-yellow-300 hover:!bg-yellow-500/30">
                    <span className="material-symbols-outlined text-lg mr-1">content_copy</span>
                    Manual Config
                  </Button>
                </div>
              </div>
            </div>
          )}

          {!checkingOpenclaw && openclawStatus?.installed && (
            <>
              <div className="flex flex-col gap-2">
                {/* Endpoint (selector) */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Select Endpoint</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <BaseUrlSelect
                    value={customBaseUrl || getDisplayUrl()}
                    onChange={setCustomBaseUrl}
                  />
                </div>

                {/* Current configured */}
                {configuredProvider?.baseUrl && (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                    <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Current</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                    <span className="min-w-0 truncate rounded bg-surface/40 px-2 py-2 text-xs text-text-muted sm:py-1.5">
                      {configuredProvider.baseUrl}
                    </span>
                  </div>
                )}

                {/* API Key */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">API Key</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <ApiKeySelect value={selectedApiKey} onChange={setSelectedApiKey} apiKeys={apiKeys} />
                </div>

                {/* Default Model */}
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-[8rem_auto_1fr_auto] sm:items-center sm:gap-2">
                  <span className="text-xs font-semibold text-text-main sm:text-right sm:text-sm">Default Model</span>
                  <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                  <div className="relative w-full min-w-0">
                    <input type="text" value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} placeholder="provider/model-id" className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5" />
                    {selectedModel && <button onClick={() => setSelectedModel("")} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-sm">close</span></button>}
                  </div>
                  <button onClick={() => { setAgentModalFor(null); setModalOpen(true); }} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select</button>
                </div>

                {/* Per-agent model overrides */}
                {(openclawStatus.agents || []).filter(a => a.agentDir).map((agent) => (
                  <div key={agent.id} className="flex items-center gap-2 pl-4">
                    <span className="w-32 shrink-0 text-xs text-primary text-right truncate" title={agent.name || agent.id}>Agent {agent.name || agent.id}</span>
                    <span className="material-symbols-outlined hidden text-text-muted text-sm sm:inline">arrow_forward</span>
                    <div className="relative w-full min-w-0">
                      <input
                        type="text"
                        value={agentModels[agent.id] || ""}
                        onChange={(e) => setAgentModels(prev => ({ ...prev, [agent.id]: e.target.value }))}
                        placeholder={`default (${selectedModel || "provider/model-id"})`}
                        className="w-full min-w-0 pl-2 pr-7 py-2 bg-surface rounded border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary/50 sm:py-1.5"
                      />
                      {agentModels[agent.id] && <button onClick={() => setAgentModels(prev => ({ ...prev, [agent.id]: "" }))} className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-red-500 rounded transition-colors" title="Clear"><span className="material-symbols-outlined text-sm">close</span></button>}
                    </div>
                    <button onClick={() => { setAgentModalFor(agent.id); setModalOpen(true); }} disabled={!hasActiveProviders} className={`w-full sm:w-auto rounded border px-2 py-2 text-xs transition-colors sm:py-1.5 whitespace-nowrap sm:shrink-0 ${hasActiveProviders ? "bg-surface border-border text-text-main hover:border-primary cursor-pointer" : "opacity-50 cursor-not-allowed border-border"}`}>Select</button>
                  </div>
                ))}
              </div>

              {message && (
                <div className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${message.type === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}>
                  <span className="material-symbols-outlined text-sm">{message.type === "success" ? "check_circle" : "error"}</span>
                  <span>{message.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
                <Button variant="primary" size="sm" onClick={handleApplySettings} disabled={!selectedModel} loading={applying}>
                  <span className="material-symbols-outlined text-sm mr-1">save</span>Apply
                </Button>
                <Button variant="outline" size="sm" onClick={handleResetSettings} disabled={!openclawStatus?.hasSwitchRouter} loading={restoring}>
                  <span className="material-symbols-outlined text-sm mr-1">restore</span>Reset
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
        onSelect={handleModelSelect}
        selectedModel={selectedModel}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        title="Select Model for Open Claw"
      />

      <ManualConfigModal
        isOpen={showManualConfigModal}
        onClose={() => setShowManualConfigModal(false)}
        title="Open Claw - Manual Configuration"
        configs={getManualConfigs()}
      />
    </Card>
  );
}
