"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card, Button, Modal, CardSkeleton, OAuthModal, Toggle, Select, EditConnectionModal, NoAuthProxyCard, ConfirmModal } from "@/shared/components";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS, FREE_PROVIDERS, FREE_TIER_PROVIDERS, WEB_COOKIE_PROVIDERS, getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { useModelCaps } from "@/shared/hooks/useModelCaps";
import { translate } from "@/i18n/runtime";
import { fetchSuggestedModels } from "@/shared/utils/providerModelsFetcher";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";
import { fetchWithTimeout } from "@/shared/utils/fetchWithTimeout";
import ModelRow from "./ModelRow";
import PassthroughModelsSection from "./PassthroughModelsSection";
import CompatibleModelsSection from "./CompatibleModelsSection";
import ConnectionRow from "./ConnectionRow";
import { useNotificationStore } from "@/store/notificationStore";
import dynamic from "next/dynamic";

// Click-only modals: keep them out of the route's initial chunk.
const AddApiKeyModal = dynamic(() => import("./AddApiKeyModal"), { ssr: false });
const EditCompatibleNodeModal = dynamic(() => import("./EditCompatibleNodeModal"), { ssr: false });
const AddCustomModelModal = dynamic(() => import("./AddCustomModelModal"), { ssr: false });
const BulkImportCodexModal = dynamic(() => import("./BulkImportCodexModal"), { ssr: false });

const ONE_BY_ONE_DELAY_MS = 1000;

const AUTO_PING_SETTINGS_KEYS = {
  claude: "claudeAutoPing",
  codex: "codexAutoPing",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function ProviderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const providerId = params.id;
  const { getCaps } = useModelCaps();
  const notifySuccess = useNotificationStore((s) => s.success);
  const notifyError = useNotificationStore((s) => s.error);
  const notifyWarning = useNotificationStore((s) => s.warning);
  const notifyInfo = useNotificationStore((s) => s.info);
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [providerNode, setProviderNode] = useState(null);
  const [proxyPools, setProxyPools] = useState([]);
  const [showOAuthModal, setShowOAuthModal] = useState(false);
  // Extra OAuth flow variant (e.g. workbuddy "web login as another account"
  // instead of importing the desktop app session); null = default flow.
  const [oauthModalMeta, setOauthModalMeta] = useState(null);
  const [showAddApiKeyModal, setShowAddApiKeyModal] = useState(false);
  const [addConnectionError, setAddConnectionError] = useState("");
  const [showBulkImportCodex, setShowBulkImportCodex] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showEditNodeModal, setShowEditNodeModal] = useState(false);
  const [showBulkProxyModal, setShowBulkProxyModal] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState(null);
  const [modelAliases, setModelAliases] = useState({});
  const [customModels, setCustomModels] = useState([]);
  const [headerImgError, setHeaderImgError] = useState(false);
  const [modelTestResults, setModelTestResults] = useState({});
  const [modelsTestError, setModelsTestError] = useState("");
  const [testingModelIds, setTestingModelIds] = useState(() => new Set());
  const [showAddCustomModel, setShowAddCustomModel] = useState(false);
  const [selectedConnectionIds, setSelectedConnectionIds] = useState([]);
  const [bulkProxyPoolId, setBulkProxyPoolId] = useState("__none__");
  const [bulkUpdatingProxy, setBulkUpdatingProxy] = useState(false);
  const [providerStrategy, setProviderStrategy] = useState(null);
  const [providerStickyLimit, setProviderStickyLimit] = useState("");
  const [thinkingMode, setThinkingMode] = useState("auto");
  const [autoPing, setAutoPing] = useState({ enabled: false, connections: {} });
  const [suggestedModels, setSuggestedModels] = useState([]);
  const [kiloFreeModels, setKiloFreeModels] = useState([]);
  const [disabledModelIds, setDisabledModelIds] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [showAgRiskModal, setShowAgRiskModal] = useState(false);
  const [oneByOneRunning, setOneByOneRunning] = useState(false);
  const [oneByOneStopping, setOneByOneStopping] = useState(false);
  const [oneByOneCurrentConnectionId, setOneByOneCurrentConnectionId] = useState(null);
  const [oneByOneResults, setOneByOneResults] = useState({});
  const [oneByOneSummary, setOneByOneSummary] = useState(null);
  const stopOneByOneRef = useRef(false);

  const [importingFreeModels, setImportingFreeModels] = useState(false);
  const [importingVilaoModels, setImportingVilaoModels] = useState(false);
  const [vilaoImportSummary, setVilaoImportSummary] = useState(null);
  const { copied, copy } = useCopyToClipboard();

  const AG_RISK_STORAGE_KEY = "ag_risk_confirmed";

  const openOAuthConnection = (meta = null) => {
    setOauthModalMeta(meta);
    setShowOAuthModal(true);
  };

  const triggerOAuthConnection = () => {
    if (providerId === "antigravity" && typeof window !== "undefined") {
      const confirmed = window.localStorage.getItem(AG_RISK_STORAGE_KEY) === "true";
      if (!confirmed) {
        setShowAgRiskModal(true);
        return;
      }
    }
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  // WorkBuddy: the default OAuth button imports the desktop app session; this
  // variant always opens the real web login so a second account can be added.
  const triggerOAuthWebConnection = () => {
    openOAuthConnection({ mode: "web" });
  };

  const triggerApiKeyConnection = () => {
    setAddConnectionError("");
    setShowAddApiKeyModal(true);
  };

  const triggerAddConnection = () => {
    if (isOAuth) {
      triggerOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const handleAgRiskConfirm = () => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AG_RISK_STORAGE_KEY, "true");
    }
    setShowAgRiskModal(false);
    if (isOAuth) {
      openOAuthConnection();
      return;
    }
    triggerApiKeyConnection();
  };

  const providerInfo = providerNode
    ? {
        id: providerNode.id,
        name: providerNode.name || (providerNode.type === "anthropic-compatible" ? "Anthropic Compatible" : "OpenAI Compatible"),
        color: providerNode.type === "anthropic-compatible" ? "#D97757" : "#10A37F",
        textIcon: providerNode.type === "anthropic-compatible" ? "AC" : "OC",
        apiType: providerNode.apiType,
        baseUrl: providerNode.baseUrl,
        type: providerNode.type,
      }
    : (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId] || WEB_COOKIE_PROVIDERS[providerId]);
  const authModes = providerInfo?.authModes || [];
  const isOAuth = !!OAUTH_PROVIDERS[providerId] || !!FREE_PROVIDERS[providerId] || authModes.includes("oauth");
  const supportsApiKeyAuth = !!APIKEY_PROVIDERS[providerId] || authModes.includes("apikey");
  const isFreeNoAuth = !!FREE_PROVIDERS[providerId]?.noAuth;
  const models = getModelsByProviderId(providerId);
  const providerAlias = getProviderAlias(providerId);
  
  const isOpenAICompatible = isOpenAICompatibleProvider(providerId);
  const isAnthropicCompatible = isAnthropicCompatibleProvider(providerId);
  const isCompatible = isOpenAICompatible || isAnthropicCompatible;
  const hasDualAuthModes = !isCompatible && isOAuth && supportsApiKeyAuth;
  const oauthConnectionLabel =
    providerId === "grok-cli" ? "Grok CLI Device Login"
    : "OAuth";
  const apiKeyConnectionLabel = "API Key";
  // Resolve suffix "(level)" for a model when a thinking level is picked and the model supports it.
  const resolveThinkingSuffix = (modelId) => {
    if (!thinkingMode || thinkingMode === "auto") return null;
    const levels = getThinkingLevels(providerId, modelId);
    return levels && levels.includes(thinkingMode) ? thinkingMode : null;
  };
  const providerStorageAlias = isCompatible ? providerId : providerAlias;
  // Union of levels across this provider's reasoning models — drives the level picker options.
  // Include custom models too (e.g. manually added gpt-5.6-sol → max).
  const providerThinkingLevels = (() => {
    const set = new Set();
    const seen = new Set();
    const addLevels = (modelId) => {
      if (!modelId || seen.has(modelId)) return;
      seen.add(modelId);
      const lv = getThinkingLevels(providerId, modelId);
      if (lv) lv.forEach((l) => { if (l !== "none") set.add(l); });
    };
    for (const m of models) addLevels(m.id);
    for (const m of kiloFreeModels) addLevels(m.id);
    for (const entry of customModels) {
      if (entry.providerAlias !== providerStorageAlias) continue;
      if ((entry.kind || entry.type || "llm") !== "llm") continue;
      addLevels(entry.id);
    }
    return set.size ? ["auto", ...[...set]] : null;
  })();
  const providerDisplayAlias = isCompatible
    ? (providerNode?.prefix || providerId)
    : providerAlias;

  const fetchDisabledModels = useCallback(async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setDisabledModelIds(data.ids || []);
    } catch (error) {
      console.error("Error fetching disabled models:", error);
    }
  }, [providerStorageAlias]);

  const handleDisableModel = async (modelId) => {
    try {
      const res = await fetch("/api/models/disabled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerStorageAlias, ids: [modelId] }),
      });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error disabling model:", error);
    }
  };

  const handleEnableModel = async (modelId) => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}&id=${encodeURIComponent(modelId)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error enabling model:", error);
    }
  };

  const handleDisableAll = async (ids) => {
    if (!ids.length) return;
    setConfirmState({
      title: "Disable All Models",
      message: `Disable all ${ids.length} model(s)?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch("/api/models/disabled", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ providerAlias: providerStorageAlias, ids }),
          });
          if (res.ok) await fetchDisabledModels();
        } catch (error) {
          console.error("Error disabling all models:", error);
        }
      }
    });
  };

  const handleEnableAll = async () => {
    try {
      const res = await fetch(`/api/models/disabled?providerAlias=${encodeURIComponent(providerStorageAlias)}`, { method: "DELETE" });
      if (res.ok) await fetchDisabledModels();
    } catch (error) {
      console.error("Error enabling all models:", error);
    }
  };

  // Define callbacks BEFORE the useEffect that uses them
  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias");
      const data = await res.json();
      if (res.ok) {
        setModelAliases(data.aliases || {});
      }
    } catch (error) {
      console.error("Error fetching aliases:", error);
    }
  }, []);

  const fetchCustomModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models/custom", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setCustomModels(data.models || []);
      }
    } catch (error) {
      console.error("Error fetching custom models:", error);
    }
  }, []);

  // Fetch free models from Kilo API for kilocode provider
  useEffect(() => {
    if (providerId !== "kilocode") return;
    fetch("/api/providers/kilo/free-models")
      .then((res) => res.json())
      .then((data) => { if (data.models?.length) setKiloFreeModels(data.models); })
      .catch(() => {});
  }, [providerId]);

  const fetchConnections = useCallback(async () => {
    try {
      const [connectionsRes, nodesRes, proxyPoolsRes, settingsRes] = await Promise.all([
        fetch("/api/providers", { cache: "no-store" }),
        fetch("/api/provider-nodes", { cache: "no-store" }),
        fetch("/api/proxy-pools?isActive=true", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" }),
      ]);
      const connectionsData = await connectionsRes.json();
      const nodesData = await nodesRes.json();
      const proxyPoolsData = await proxyPoolsRes.json();
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      if (connectionsRes.ok) {
        const filtered = (connectionsData.connections || []).filter(c => c.provider === providerId);
        setConnections(filtered);
      }
      if (proxyPoolsRes.ok) {
        setProxyPools(proxyPoolsData.proxyPools || []);
      }
      // Load per-provider strategy override
      const override = (settingsData.providerStrategies || {})[providerId] || {};
      setProviderStrategy(override.fallbackStrategy || null);
      setProviderStickyLimit(override.stickyRoundRobinLimit != null ? String(override.stickyRoundRobinLimit) : "1");
      // Load per-provider thinking config
      const thinkingCfg = (settingsData.providerThinking || {})[providerId] || {};
      setThinkingMode(thinkingCfg.mode || "auto");
      const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
      const apCfg = autoPingSettingsKey ? settingsData[autoPingSettingsKey] || {} : {};
      setAutoPing({ enabled: apCfg.enabled === true, connections: apCfg.connections || {} });
      if (nodesRes.ok) {
        let node = (nodesData.nodes || []).find((entry) => entry.id === providerId) || null;

        // Newly created compatible nodes can be briefly unavailable on one worker.
        // Retry a few times before showing "Provider not found".
        if (!node && isCompatible) {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 150));
            const retryRes = await fetch("/api/provider-nodes", { cache: "no-store" });
            if (!retryRes.ok) continue;
            const retryData = await retryRes.json();
            node = (retryData.nodes || []).find((entry) => entry.id === providerId) || null;
            if (node) break;
          }
        }

        setProviderNode(node);
      }
    } catch (error) {
      console.error("Error fetching connections:", error);
    } finally {
      setLoading(false);
    }
  }, [providerId, isCompatible]);

  const handleUpdateNode = async (formData) => {
    try {
      const res = await fetch(`/api/provider-nodes/${providerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (res.ok) {
        setProviderNode(data.node);
        await fetchConnections();
        setShowEditNodeModal(false);
      }
    } catch (error) {
      console.error("Error updating provider node:", error);
    }
  };

  const saveProviderStrategy = async (strategy, stickyLimit) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerStrategies || {};

      // Build override: null strategy means remove override, use global
      const override = {};
      if (strategy) override.fallbackStrategy = strategy;
      if (strategy === "round-robin" && stickyLimit !== "") {
        override.stickyRoundRobinLimit = Number(stickyLimit) || 3;
      }

      const updated = { ...current };
      if (Object.keys(override).length === 0) {
        delete updated[providerId];
      } else {
        updated[providerId] = override;
      }

      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerStrategies: updated }),
      });
    } catch (error) {
      console.error("Error saving provider strategy:", error);
    }
  };

  const handleRoundRobinToggle = (enabled) => {
    const strategy = enabled ? "round-robin" : null;
    const sticky = enabled ? (providerStickyLimit || "1") : providerStickyLimit;
    if (enabled && !providerStickyLimit) setProviderStickyLimit("1");
    setProviderStrategy(strategy);
    saveProviderStrategy(strategy, sticky);
  };

  const handleStickyLimitChange = (value) => {
    setProviderStickyLimit(value);
    saveProviderStrategy("round-robin", value);
  };

  const saveThinkingConfig = async (mode) => {
    try {
      const settingsRes = await fetch("/api/settings", { cache: "no-store" });
      const settingsData = settingsRes.ok ? await settingsRes.json() : {};
      const current = settingsData.providerThinking || {};
      const updated = { ...current };
      if (!mode || mode === "auto") {
        delete updated[providerId];
      } else {
        updated[providerId] = { mode };
      }
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerThinking: updated }),
      });
    } catch (error) {
      console.error("Error saving thinking config:", error);
    }
  };

  const handleThinkingModeChange = (mode) => {
    setThinkingMode(mode);
    saveThinkingConfig(mode);
  };

  const saveAutoPing = async (next) => {
    const autoPingSettingsKey = AUTO_PING_SETTINGS_KEYS[providerId];
    if (!autoPingSettingsKey) return;

    setAutoPing(next);
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [autoPingSettingsKey]: next }),
      });
    } catch (error) {
      console.error("Error saving auto-ping config:", error);
    }
  };

  const handleAutoPingConnection = (connectionId, on) => {
    saveAutoPing({ ...autoPing, connections: { ...autoPing.connections, [connectionId]: on } });
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch initial data on mount; state updates only after the responses resolve
    fetchConnections();
    fetchAliases();
    fetchCustomModels();
    fetchDisabledModels();
  }, [fetchConnections, fetchAliases, fetchCustomModels, fetchDisabledModels]);

  // Fetch suggested models from provider's public API (if configured)
  useEffect(() => {
    const fetcher = (OAUTH_PROVIDERS[providerId] || APIKEY_PROVIDERS[providerId] || FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher;
    if (!fetcher) return;
    fetchSuggestedModels(fetcher).then(setSuggestedModels);
  }, [providerId]);

  const handleSetAlias = async (modelId, alias, providerAliasOverride = providerAlias) => {
    const fullModel = `${providerAliasOverride}/${modelId}`;
    try {
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: fullModel, alias }),
      });
      if (res.ok) {
        await fetchAliases();
      } else {
        const data = await res.json();
        notifyError(data.error || "Failed to set alias");
      }
    } catch (error) {
      console.error("Error setting alias:", error);
    }
  };

  const handleDeleteAlias = async (alias) => {
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(alias)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await fetchAliases();
      }
    } catch (error) {
      console.error("Error deleting alias:", error);
    }
  };

  const handleAddCustomModel = async (modelId, type = "llm", providerAliasOverride = providerStorageAlias) => {
    try {
      const res = await fetch("/api/models/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerAlias: providerAliasOverride, id: modelId, type }),
      });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      } else {
        const data = await res.json();
        notifyError(data.error || "Failed to add custom model");
      }
    } catch (error) {
      console.error("Error adding custom model:", error);
    }
  };

  const handleDeleteCustomModel = async (modelId, type = "llm", providerAliasOverride = providerStorageAlias) => {
    try {
      const params = new URLSearchParams({ providerAlias: providerAliasOverride, id: modelId, type });
      const res = await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      if (res.ok) {
        await fetchCustomModels();
        if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("customModelChanged"));
      }
    } catch (error) {
      console.error("Error deleting custom model:", error);
    }
  };

  // Fetch marketplace model ids bound to the active ViLao key (per-key baseUrl).
  // Do NOT strip path prefixes — ids look like "moonshotai/kimi-k3-free".
  const handleImportVilaoModels = async () => {
    if (importingVilaoModels) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) {
      notifyWarning(translate("Please add an active connection first") || "Please add an active ViLao connection first");
      return;
    }

    setImportingVilaoModels(true);
    setVilaoImportSummary(null);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      const meta = data.meta || null;

      if (meta) {
        setConnections((prev) => prev.map((c) => (
          c.id === activeConnection.id
            ? {
                ...c,
                providerSpecificData: {
                  ...(c.providerSpecificData || {}),
                  lastProbe: { ...meta, testedAt: new Date().toISOString() },
                },
              }
            : c
        )));
      }

      if (!res.ok) {
        const msg = data.error || translate("Failed to fetch models");
        setVilaoImportSummary({ ok: false, message: msg, meta });
        notifyError(msg);
        return;
      }

      if (meta?.walletEmpty) {
        const msg = data.warning || "ViLao key is valid but the wallet is empty (HTTP 402).";
        setVilaoImportSummary({ ok: true, imported: 0, skipped: 0, total: 0, message: msg, meta });
        notifyWarning(msg);
        return;
      }

      const remoteModels = data.models || [];
      if (remoteModels.length === 0) {
        const msg = translate("No models returned") || "No models returned from this key.";
        setVilaoImportSummary({ ok: true, imported: 0, skipped: 0, total: 0, message: msg, meta });
        notifyWarning(msg);
        return;
      }

      let importedCount = 0;
      let skippedCount = 0;
      for (const model of remoteModels) {
        const modelId = model.id || model.name;
        if (!modelId) continue;
        // Keep full marketplace id (may contain "/").
        const alreadyExists = customModels.some(
          (entry) => entry.providerAlias === providerStorageAlias && entry.id === modelId && (entry.kind || entry.type || "llm") === "llm"
        ) || Object.values(modelAliases).includes(`${providerStorageAlias}/${modelId}`);
        if (alreadyExists) {
          skippedCount += 1;
          continue;
        }
        await handleAddCustomModel(modelId, "llm", providerStorageAlias);
        importedCount += 1;
      }

      const summary = {
        ok: true,
        imported: importedCount,
        skipped: skippedCount,
        total: remoteModels.length,
        message: importedCount === 0
          ? (translate("All models already exist, no new models added") || "All models already imported")
          : `${translate("Successfully added") || "Added"} ${importedCount} / ${remoteModels.length}`,
        meta,
      };
      setVilaoImportSummary(summary);
      notifySuccess(summary.message);
    } catch (error) {
      console.error("Error importing ViLao models:", error);
      const msg = (translate("Error fetching models") || "Error fetching models") + ": " + error.message;
      setVilaoImportSummary({ ok: false, message: msg });
      notifyError(msg);
    } finally {
      setImportingVilaoModels(false);
    }
  };

  // Fetch free models from the provider's public API and add them all at once
  // (used by no-auth free providers: opencode)
  const handleImportFreeModels = async () => {
    if (importingFreeModels) return;
    const fetcher = (FREE_PROVIDERS[providerId] || FREE_TIER_PROVIDERS[providerId])?.modelsFetcher;
    if (!fetcher) return;

    setImportingFreeModels(true);
    try {
      const fetched = await fetchSuggestedModels(fetcher, { force: true });
      if (fetched.length === 0) {
        notifyWarning(translate("No models returned"));
        return;
      }

      const addedFullModels = new Set([
        ...Object.values(modelAliases),
        ...customModels.map((m) => `${providerStorageAlias}/${m.id}`),
      ]);
      const hardcodedIds = new Set(models.map((m) => m.id));
      const notAdded = fetched.filter(
        (m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id)
      );
      if (notAdded.length === 0) {
        notifyInfo(translate("All models already exist, no new models added"));
        return;
      }

      let importedCount = 0;
      for (const model of notAdded) {
        await handleAddCustomModel(model.id, "llm", providerStorageAlias);
        importedCount += 1;
      }
      notifySuccess(translate("Successfully added") + ` ${importedCount} ` + translate("models"));
    } catch (error) {
      console.error("Error importing free models:", error);
      notifyError(translate("Error fetching models") + ": " + error.message);
    } finally {
      setImportingFreeModels(false);
    }
  };

  const handleRunOneByOneTest = async () => {
    if (oneByOneRunning || connections.length === 0) return;

    const queuedState = Object.fromEntries(
      connections.map((connection) => [connection.id, { state: "queued", error: null }]),
    );

    stopOneByOneRef.current = false;
    setOneByOneRunning(true);
    setOneByOneStopping(false);
    setOneByOneCurrentConnectionId(null);
    setOneByOneResults(queuedState);
    setOneByOneSummary({ total: connections.length, completed: 0, passed: 0, failed: 0, stopped: false });

    let passed = 0;
    let failed = 0;

    try {
      for (let index = 0; index < connections.length; index += 1) {
        if (stopOneByOneRef.current) {
          setOneByOneSummary({
            total: connections.length,
            completed: index,
            passed,
            failed,
            stopped: true,
          });
          break;
        }

        const connection = connections[index];
        setOneByOneCurrentConnectionId(connection.id);
        setOneByOneResults((prev) => ({
          ...prev,
          [connection.id]: { state: "testing", error: null },
        }));

        try {
          const res = await fetchWithTimeout(`/api/providers/${connection.id}/test`, { method: "POST" });
          const data = await res.json();
          const valid = !!data.valid;

          if (valid) {
            passed += 1;
          } else {
            failed += 1;
          }

          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: valid ? "success" : "failed",
              error: valid ? null : (data.error || null),
              warning: data.warning || null,
              meta: data.meta || null,
            },
          }));
          // Reflect probe snapshot on the connection row without a full reload.
          if (data.meta) {
            setConnections((prev) => prev.map((c) => (
              c.id === connection.id
                ? {
                    ...c,
                    testStatus: valid ? "active" : "error",
                    lastError: valid ? (data.warning || null) : (data.error || c.lastError),
                    providerSpecificData: {
                      ...(c.providerSpecificData || {}),
                      lastProbe: { ...data.meta, testedAt: data.testedAt || new Date().toISOString() },
                    },
                  }
                : c
            )));
          }
        } catch (error) {
          failed += 1;
          setOneByOneResults((prev) => ({
            ...prev,
            [connection.id]: {
              state: "failed",
              error: error.message || "Test failed",
            },
          }));
        }

        setOneByOneSummary({
          total: connections.length,
          completed: index + 1,
          passed,
          failed,
          stopped: false,
        });

        if (index < connections.length - 1) {
          await sleep(ONE_BY_ONE_DELAY_MS);
        }
      }
    } finally {
      setOneByOneCurrentConnectionId(null);
      setOneByOneRunning(false);
      setOneByOneStopping(false);
      stopOneByOneRef.current = false;
    }
  };

  const handleStopOneByOneTest = () => {
    if (!oneByOneRunning) return;
    stopOneByOneRef.current = true;
    setOneByOneStopping(true);
  };

  const handleDelete = async (id) => {
    setConfirmState({
      title: "Delete Connection",
      message: "Delete this connection?",
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
          if (res.ok) {
            setConnections(prev => prev.filter(c => c.id !== id));
          }
        } catch (error) {
          console.error("Error deleting connection:", error);
        }
      }
    });
  };

  const handleBulkDelete = () => {
    const count = selectedConnectionIds.length;
    if (count === 0) return;
    setConfirmState({
      title: `Delete ${count} Connection${count > 1 ? "s" : ""}`,
      message: `Delete ${count} connection${count > 1 ? "s" : ""}? This cannot be undone.`,
      onConfirm: async () => {
        setConfirmState(null);
        let failed = 0;
        const idsToDelete = [...selectedConnectionIds];
        for (const id of idsToDelete) {
          try {
            const res = await fetch(`/api/providers/${id}`, { method: "DELETE" });
            if (!res.ok) failed += 1;
          } catch (error) {
            console.error("Error deleting connection:", error);
            failed += 1;
          }
        }
        setConnections(prev => prev.filter(c => !idsToDelete.includes(c.id)));
        setSelectedConnectionIds([]);
        if (failed > 0) notifyWarning(`Deleted ${idsToDelete.length - failed} connection(s), ${failed} failed.`);
      }
    });
  };

  const handleOAuthSuccess = () => {
    fetchConnections();
    setShowOAuthModal(false);
  };

  const handleSaveApiKey = async (formData) => {
    setAddConnectionError("");
    try {
      const res = await fetch("/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, ...formData }),
      });

      let data = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (res.ok) {
        await fetchConnections();
        setShowAddApiKeyModal(false);
        return;
      }

      setAddConnectionError(data?.error || "Failed to save connection");
    } catch (error) {
      console.error("Error saving connection:", error);
      setAddConnectionError("Failed to save connection");
    }
  };

  const handleUpdateConnection = async (formData) => {
    try {
      const res = await fetch(`/api/providers/${selectedConnection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        await fetchConnections();
        setShowEditModal(false);
      }
    } catch (error) {
      console.error("Error updating connection:", error);
    }
  };

  const handleUpdateConnectionStatus = async (id, isActive) => {
    try {
      const res = await fetch(`/api/providers/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      });
      if (res.ok) {
        setConnections(prev => prev.map(c => c.id === id ? { ...c, isActive } : c));
      }
    } catch (error) {
      console.error("Error updating connection status:", error);
    }
  };

  const handleSwapPriority = async (index1, index2) => {
    // Optimistic update state
    const newConnections = [...connections];
    [newConnections[index1], newConnections[index2]] = [newConnections[index2], newConnections[index1]];
    setConnections(newConnections);

    try {
      await Promise.all([
        fetch(`/api/providers/${newConnections[index1].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index1 }),
        }),
        fetch(`/api/providers/${newConnections[index2].id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ priority: index2 }),
        }),
      ]);
    } catch (error) {
      console.error("Error swapping priority:", error);
      await fetchConnections();
    }
  };

  const selectedConnections = connections.filter((conn) => selectedConnectionIds.includes(conn.id));
  const allSelected = connections.length > 0 && selectedConnectionIds.length === connections.length;

  const toggleSelectConnection = (connectionId) => {
    setSelectedConnectionIds((prev) => (
      prev.includes(connectionId)
        ? prev.filter((id) => id !== connectionId)
        : [...prev, connectionId]
    ));
  };

  const toggleSelectAllConnections = () => {
    if (allSelected) {
      setSelectedConnectionIds([]);
      return;
    }
    setSelectedConnectionIds(connections.map((conn) => conn.id));
  };

  const clearSelection = () => {
    setSelectedConnectionIds([]);
    setBulkProxyPoolId("__none__");
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prune selections that no longer reference an existing connection
    setSelectedConnectionIds((prev) => prev.filter((id) => connections.some((conn) => conn.id === id)));
  }, [connections]);

  const selectedProxySummary = (() => {
    if (selectedConnections.length === 0) return "";
    const poolIds = new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"));
    if (poolIds.size === 1) {
      const onlyId = [...poolIds][0];
      if (onlyId === "__none__") return "All selected currently unbound";
      const pool = proxyPools.find((p) => p.id === onlyId);
      return `All selected currently bound to ${pool?.name || onlyId}`;
    }
    return "Selected connections have mixed proxy bindings";
  })();

  const openBulkProxyModal = () => {
    if (selectedConnections.length === 0) return;
    const uniquePoolIds = [...new Set(selectedConnections.map((conn) => conn.providerSpecificData?.proxyPoolId || "__none__"))];
    setBulkProxyPoolId(uniquePoolIds.length === 1 ? uniquePoolIds[0] : "__none__");
    setShowBulkProxyModal(true);
  };

  const closeBulkProxyModal = () => {
    if (bulkUpdatingProxy) return;
    setShowBulkProxyModal(false);
  };

  const applyProxyAssignments = async (assignments) => {
    setBulkUpdatingProxy(true);
    try {
      let failed = 0;
      for (const { connectionId, proxyPoolId } of assignments) {
        try {
          const res = await fetch(`/api/providers/${connectionId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ proxyPoolId }),
          });
          if (!res.ok) failed += 1;
        } catch (e) {
          console.error("Error applying proxy for", connectionId, e);
          failed += 1;
        }
      }
      if (failed > 0) notifyWarning(`Updated with ${failed} failed request(s).`);
      await fetchConnections();
      setShowBulkProxyModal(false);
    } finally {
      setBulkUpdatingProxy(false);
    }
  };

  const handleApplySinglePool = (proxyPoolId) => {
    const targets = connections.map((c) => ({ connectionId: c.id, proxyPoolId }));
    return applyProxyAssignments(targets);
  };

  const handleApplyOneToOne = () => {
    const activePools = proxyPools.filter((p) => p.isActive === true);
    if (activePools.length === 0) {
      notifyWarning("No active proxy pools available.");
      return;
    }
    const targets = connections.map((c, i) => ({
      connectionId: c.id,
      proxyPoolId: activePools[i % activePools.length].id,
    }));
    return applyProxyAssignments(targets);
  };


  const isSelected = (connectionId) => selectedConnectionIds.includes(connectionId);

  const connectionsList = (
    <div className="flex min-w-0 flex-col divide-y divide-black/[0.03] dark:divide-white/[0.03]">
      {connections
        .map((conn, index) => (
          <div key={conn.id} className="flex min-w-0 items-stretch">
            <div className="flex shrink-0 items-center pl-1 sm:pl-2">
              <input
                type="checkbox"
                checked={isSelected(conn.id)}
                onChange={() => toggleSelectConnection(conn.id)}
                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
              />
            </div>
            <div className="flex-1 min-w-0">
              <ConnectionRow
                connection={conn}
                proxyPools={proxyPools}
                isOAuth={isOAuth}
                isFirst={index === 0}
                isLast={index === connections.length - 1}
                onMoveUp={() => handleSwapPriority(index, index - 1)}
                onMoveDown={() => handleSwapPriority(index, index + 1)}
                onToggleActive={(isActive) => handleUpdateConnectionStatus(conn.id, isActive)}
                autoPing={AUTO_PING_SETTINGS_KEYS[providerId] && conn.authType === "oauth" ? {
                  on: autoPing.connections[conn.id] === true,
                  onToggle: (on) => handleAutoPingConnection(conn.id, on),
                  provider: providerId,
                } : null}
                onUpdateProxy={async (proxyPoolId) => {
                  try {
                    const res = await fetch(`/api/providers/${conn.id}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ proxyPoolId: proxyPoolId || null }),
                    });
                    if (res.ok) {
                      setConnections(prev => prev.map(c =>
                        c.id === conn.id
                          ? { ...c, providerSpecificData: { ...c.providerSpecificData, proxyPoolId: proxyPoolId || null } }
                          : c
                      ));
                    }
                  } catch (error) {
                    console.error("Error updating proxy:", error);
                  }
                }}
                onEdit={() => {
                  setSelectedConnection(conn);
                  setShowEditModal(true);
                }}
                onDelete={() => handleDelete(conn.id)}
                oneByOneStatus={oneByOneResults[conn.id] || null}
              />
            </div>
          </div>
        ))}
    </div>
  );

  const activePools = proxyPools.filter((p) => p.isActive === true);

  const bulkActionModal = (
    <Modal
      isOpen={showBulkProxyModal}
      onClose={closeBulkProxyModal}
      title={`Apply Proxy (${connections.length} connections)`}
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col">
          <button
            onClick={handleApplyOneToOne}
            disabled={bulkUpdatingProxy || activePools.length === 0}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-text-muted text-lg">sync_alt</span>
            <span className="text-sm text-text-main">One-to-one (rotate)</span>
          </button>
          <button
            onClick={() => handleApplySinglePool(null)}
            disabled={bulkUpdatingProxy}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="material-symbols-outlined text-text-muted text-lg">link_off</span>
            <span className="text-sm text-text-main">None (unbind all)</span>
          </button>
          {proxyPools.map((pool) => (
            <button
              key={pool.id}
              onClick={() => handleApplySinglePool(pool.id)}
              disabled={bulkUpdatingProxy || pool.isActive !== true}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="material-symbols-outlined text-text-muted text-lg">lan</span>
              <span className="truncate text-sm text-text-main">{pool.name}</span>
              {pool.isActive !== true && (
                <span className="text-xs text-text-muted">(inactive)</span>
              )}
            </button>
          ))}
        </div>

        {bulkUpdatingProxy && <p className="text-xs text-text-muted">Applying...</p>}

        <Button onClick={closeBulkProxyModal} variant="ghost" fullWidth disabled={bulkUpdatingProxy}>
          Cancel
        </Button>
      </div>
    </Modal>
  );

  const handleTestModel = async (modelId) => {
    if (testingModelIds.has(modelId)) return;
    setTestingModelIds((prev) => new Set(prev).add(modelId));
    try {
      // Antigravity/Gemini probes can take 30–90s (cold start / 429). Default
      // fetchWithTimeout(20s) only shows "operation aborted" and masks upstream.
      const isSlowProbe = providerId === "antigravity"
        || /gemini-3\.|gemini-pro-agent/i.test(modelId);
      const res = await fetchWithTimeout(
        "/api/models/test",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
        },
        isSlowProbe ? 100000 : 35000,
      );
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
      setModelsTestError(data.ok ? "" : (data.error || "Model not reachable"));
    } catch (err) {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
      const timedOut = err?.name === "AbortError" || /aborted|timeout/i.test(err?.message || "");
      setModelsTestError(timedOut ? "Test timed out — model may be slow or rate-limited" : "Network error");
    } finally {
      setTestingModelIds((prev) => { const n = new Set(prev); n.delete(modelId); return n; });
    }
  };

  const renderModelsSection = () => {
    if (isCompatible) {
      return (
        <CompatibleModelsSection
          providerStorageAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          modelAliases={modelAliases}
          customModels={customModels}
          copied={copied}
          onCopy={copy}
          onSetAlias={handleSetAlias}
          onDeleteAlias={handleDeleteAlias}
          onAddCustomModel={(modelId) => handleAddCustomModel(modelId, "llm", providerStorageAlias)}
          onDeleteCustomModel={(modelId) => handleDeleteCustomModel(modelId, "llm", providerStorageAlias)}
          connections={connections}
          isAnthropic={isAnthropicCompatible}
        />
      );
    }
    // Combine hardcoded models with Kilo free models (deduplicated)
    const allModels = [
      ...models,
      ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
    ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; });
    const disabledSet = new Set(disabledModelIds);
    const displayModels = allModels.filter((m) => !disabledSet.has(m.id));
    const disabledDisplayModels = allModels.filter((m) => disabledSet.has(m.id));
    const customModelRows = getProviderCustomModelRows({
      customModels,
      modelAliases,
      providerAlias: providerStorageAlias,
      builtInModels: models,
      type: "llm",
    });

    return (
      <div className="flex flex-wrap gap-3">
        {/* Custom models first */}
        {customModelRows.map((model) => (
          <ModelRow
            key={`${model.source}-${model.fullModel}`}
            model={{ id: model.id, name: model.name }}
            fullModel={`${providerDisplayAlias}/${model.id}`}
            alias={model.alias}
            copied={copied}
            onCopy={copy}
            onSetAlias={() => {}}
            onDeleteAlias={() => {
              if (model.source === "custom") {
                handleDeleteCustomModel(model.id, "llm", providerStorageAlias);
              } else {
                handleDeleteAlias(model.alias);
              }
            }}
            testStatus={modelTestResults[model.id]}
            onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
            isTesting={testingModelIds.has(model.id)}
            isCustom
            isFree={false}
            caps={getCaps(`${providerId}/${model.id}`)}
            thinkingSuffix={resolveThinkingSuffix(model.id)}
          />
        ))}

        {displayModels.map((model) => {
          const fullModel = `${providerStorageAlias}/${model.id}`;
          const oldFormatModel = `${providerId}/${model.id}`;
          const existingAlias = Object.entries(modelAliases).find(
            ([, m]) => m === fullModel || m === oldFormatModel
          )?.[0];
          return (
            <ModelRow
              key={model.id}
              model={model}
              fullModel={`${providerDisplayAlias}/${model.id}`}
              alias={existingAlias}
              copied={copied}
              onCopy={copy}
              onSetAlias={(alias) => handleSetAlias(model.id, alias, providerStorageAlias)}
              onDeleteAlias={() => handleDeleteAlias(existingAlias)}
              testStatus={modelTestResults[model.id]}
              onTest={connections.length > 0 || isFreeNoAuth ? () => handleTestModel(model.id) : undefined}
              isTesting={testingModelIds.has(model.id)}
              isFree={model.isFree}
              onDisable={() => handleDisableModel(model.id)}
              caps={getCaps(`${providerId}/${model.id}`)}
              thinkingSuffix={resolveThinkingSuffix(model.id)}
            />
          );
        })}

        {/* Add model button — inline, same style as model chips */}
        <button
          onClick={() => setShowAddCustomModel(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-primary/40 px-3 py-2 text-xs text-primary transition-colors hover:border-primary hover:bg-primary/5 sm:w-auto"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          Add Model
        </button>

        {/* Fetch models bound to the active ViLao marketplace key */}
        {providerId === "vilao" && connections.some((conn) => conn.isActive !== false) && (
          <button
            onClick={handleImportVilaoModels}
            disabled={importingVilaoModels}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-sky-500/40 px-3 py-2 text-xs text-sky-600 dark:text-sky-400 transition-colors hover:border-sky-500 hover:bg-sky-500/5 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
            title="Load model ids from GET /v1/models on this key's gateway"
          >
            <span className="material-symbols-outlined text-sm" style={importingVilaoModels ? { animation: "spin 1s linear infinite" } : undefined}>
              {importingVilaoModels ? "progress_activity" : "download"}
            </span>
            {importingVilaoModels ? (translate("Fetching...") || "Fetching...") : (translate("Fetch ViLao Models") || "Fetch ViLao Models")}
          </button>
        )}
        {providerId === "vilao" && vilaoImportSummary && (
          <p className={`w-full text-xs ${vilaoImportSummary.ok ? "text-text-muted" : "text-red-500"}`}>
            {vilaoImportSummary.message}
            {vilaoImportSummary.meta?.modelCount != null && (
              <span className="ml-1">· {vilaoImportSummary.meta.modelCount} on key</span>
            )}
            {vilaoImportSummary.meta?.walletEmpty && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">· empty wallet</span>
            )}
            {vilaoImportSummary.meta?.latencyMs != null && (
              <span className="ml-1">· {vilaoImportSummary.meta.latencyMs}ms</span>
            )}
          </p>
        )}

        {/* Load free models button — only show for no-auth free providers with a public models API */}
        {(providerId === "opencode") && (
          <button
            onClick={handleImportFreeModels}
            disabled={importingFreeModels}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-blue-500/40 px-3 py-2 text-xs text-blue-600 dark:text-blue-400 transition-colors hover:border-blue-500 hover:bg-blue-500/5 sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-sm" style={importingFreeModels ? { animation: "spin 1s linear infinite" } : undefined}>
              {importingFreeModels ? "progress_activity" : "download"}
            </span>
            {importingFreeModels ? translate("Fetching...") : translate("Load Free Models")}
          </button>
        )}

        {/* Suggested models from provider API — show only models not yet added */}
        {suggestedModels.length > 0 && (() => {
          const addedFullModels = new Set([
            ...Object.values(modelAliases),
            ...customModelRows.map((model) => model.fullModel),
          ]);
          const hardcodedIds = new Set(models.map((m) => m.id));
          const notAdded = suggestedModels.filter(
            (m) => !addedFullModels.has(`${providerStorageAlias}/${m.id}`) && !hardcodedIds.has(m.id)
          );
          if (notAdded.length === 0) return null;
          return (
            <div className="w-full mt-2">
              <p className="text-xs text-text-muted mb-2">Suggested free models (≥200k context):</p>
              <div className="flex flex-wrap gap-2">
                {notAdded.map((m) => (
                  <button
                    key={m.id}
                    onClick={async () => {
                      await handleAddCustomModel(m.id, "llm", providerStorageAlias);
                    }}
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-black/10 dark:border-white/10 text-xs text-text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                    title={`${m.name} · ${(m.contextLength / 1000).toFixed(0)}k ctx`}
                  >
                    <span className="material-symbols-outlined text-sm">add</span>
                    {m.id.split("/").pop()}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Disabled models — restorable */}
        {disabledDisplayModels.length > 0 && (
          <div className="w-full mt-2">
            <p className="text-xs text-text-muted mb-2">Disabled models ({disabledDisplayModels.length}):</p>
            <div className="flex flex-wrap gap-2">
              {disabledDisplayModels.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handleEnableModel(m.id)}
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-black/10 dark:border-white/10 text-xs text-text-muted hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  title="Restore model"
                >
                  <span className="material-symbols-outlined text-sm">add</span>
                  {m.id}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
}

  if (!providerInfo) {
    return (
      <div className="text-center py-20">
        <p className="text-text-muted">Provider not found</p>
        <Link href="/dashboard/providers" className="text-primary mt-4 inline-block">
          Back to Providers
        </Link>
      </div>
    );
  }

  // Determine icon path: OpenAI Compatible providers use specialized icons
  const getHeaderIconPath = () => {
    if (isOpenAICompatible && providerInfo.apiType) {
      return providerInfo.apiType === "responses" ? "/providers/oai-r.png" : "/providers/oai-cc.png";
    }
    if (isAnthropicCompatible) {
      return "/providers/anthropic-m.png";
    }
    return `/providers/${providerInfo.id}.png`;
  };

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:gap-8 sm:px-0">
      {/* Header */}
      <div className="min-w-0">
        <Link
          href="/dashboard/providers"
          className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary transition-colors mb-4"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to Providers
        </Link>
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${providerInfo.color}15` }}
          >
            {headerImgError ? (
              <span className="text-sm font-bold" style={{ color: providerInfo.color }}>
                {providerInfo.textIcon || providerInfo.id.slice(0, 2).toUpperCase()}
              </span>
            ) : (
              <Image
                src={getHeaderIconPath()}
                alt={providerInfo.name}
                width={48}
                height={48}
                className="max-h-12 max-w-12 rounded-lg object-contain"
                sizes="48px"
                onError={() => setHeaderImgError(true)}
              />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{providerInfo.name}</h2>
              {(providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website) && (
                <a
                  href={providerInfo.notice?.apiKeyUrl || providerInfo.notice?.signupUrl || providerInfo.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  {providerInfo.notice?.apiKeyUrl ? "Get API Key" : "Sign up / Learn more"}
                </a>
              )}
            </div>
            <p className="text-text-muted">
              {connections.length} connection{connections.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>

      {providerInfo.deprecated && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <span className="material-symbols-outlined text-base text-yellow-500 mt-0.5 shrink-0">warning</span>
          <p className="text-xs text-red-600 dark:text-yellow-400 leading-relaxed">{providerInfo.deprecationNotice}</p>
        </div>
      )}

      {providerInfo.notice?.text && !providerInfo.deprecated && (
        <div className="flex flex-col gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 sm:flex-row sm:items-center">
          <span className="material-symbols-outlined text-base text-blue-500 shrink-0">info</span>
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-blue-600 dark:text-blue-400">{providerInfo.notice.text}</p>
          {providerInfo.notice.apiKeyUrl && (
            <a
              href={providerInfo.notice.apiKeyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex justify-center rounded bg-blue-500 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-600 sm:py-0.5"
            >
              Get API Key →
            </a>
          )}
        </div>
      )}

      {isCompatible && providerNode && (
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold">{isAnthropicCompatible ? "Anthropic Compatible Details" : "OpenAI Compatible Details"}</h2>
              <p className="break-all text-sm text-text-muted">
                {isAnthropicCompatible ? "Messages API" : (providerNode.apiType === "responses" ? "Responses API" : "Chat Completions")} · {(providerNode.baseUrl || "").replace(/\/$/, "")}/
                {isAnthropicCompatible ? "messages" : (providerNode.apiType === "responses" ? "responses" : "chat/completions")}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:flex sm:items-center">
              <Button
                size="sm"
                icon="add"
                onClick={() => {
                  setAddConnectionError("");
                  setShowAddApiKeyModal(true);
                }}
                className="w-full sm:w-auto"
              >
                Add API Key
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="edit"
                onClick={() => setShowEditNodeModal(true)}
                className="w-full sm:w-auto"
              >
                Edit
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon="delete"
                onClick={async () => {
                  setConfirmState({
                    title: "Delete Compatible Node",
                    message: `Delete this ${isAnthropicCompatible ? "Anthropic" : "OpenAI"} Compatible node?`,
                    onConfirm: async () => {
                      setConfirmState(null);
                      try {
                        const res = await fetch(`/api/provider-nodes/${providerId}`, { method: "DELETE" });
                        if (res.ok) {
                          router.push("/dashboard/providers");
                        }
                      } catch (error) {
                        console.error("Error deleting provider node:", error);
                      }
                    }
                  });
                }}
                className="w-full sm:w-auto"
              >
                Delete
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Connections */}
      {isFreeNoAuth ? (
        <NoAuthProxyCard providerId={providerId} />
      ) : (
        <Card>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">Connections</h2>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              {connections.length > 0 && proxyPools.length > 0 && (
                <Button
                  size="sm"
                  variant="secondary"
                  icon="lan"
                  onClick={() => setShowBulkProxyModal(true)}
                >
                  Apply Proxy
                </Button>
              )}
              {connections.length > 0 && (
                <>
                  {selectedConnectionIds.length > 0 && (
                    <Button
                      size="sm"
                      variant="danger"
                      icon="delete"
                      onClick={handleBulkDelete}
                    >
                      Delete Selected ({selectedConnectionIds.length})
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    icon="sync"
                    onClick={handleRunOneByOneTest}
                    disabled={oneByOneRunning}
                  >
                    {oneByOneRunning ? "Testing Connection One-by-One..." : "Test Connection One-by-One"}
                  </Button>
                  {oneByOneRunning && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="stop"
                      onClick={handleStopOneByOneTest}
                      disabled={oneByOneStopping}
                    >
                      {oneByOneStopping ? "Stopping..." : "Stop"}
                    </Button>
                  )}
                </>
              )}
              {/* Round Robin toggle */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-muted font-medium">Round Robin</span>
                <Toggle
                  checked={providerStrategy === "round-robin"}
                  onChange={handleRoundRobinToggle}
                />
                {providerStrategy === "round-robin" && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-text-muted">Sticky:</span>
                    <input
                      type="number"
                      min={1}
                      value={providerStickyLimit}
                      onChange={(e) => handleStickyLimitChange(e.target.value)}
                      placeholder="1"
                      className="w-14 px-2 py-1 text-xs border border-border rounded-md bg-background focus:outline-none focus:border-primary"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {connections.length === 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-primary/10 text-primary shrink-0">
                  <span className="material-symbols-outlined text-lg">{isOAuth ? "lock" : "key"}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-text-muted">No connections yet</p>
                  {hasDualAuthModes && (
                    <p className="text-xs text-text-muted">
                      Choose {oauthConnectionLabel} or {apiKeyConnectionLabel}.
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                {hasDualAuthModes ? (
                  <>
                    <Button size="sm" icon="lock" variant="secondary" onClick={triggerOAuthConnection}>
                      {oauthConnectionLabel}
                    </Button>
                    {providerId === "workbuddy" && (
                      <Button size="sm" icon="language" variant="secondary" onClick={triggerOAuthWebConnection}>
                        OAuth (Web Login)
                      </Button>
                    )}
                    <Button size="sm" icon="key" onClick={triggerApiKeyConnection}>
                      {apiKeyConnectionLabel}
                    </Button>
                  </>
                ) : (
                  <>
                    {providerId === "codex" && (
                      <Button size="sm" icon="playlist_add" variant="secondary" onClick={() => setShowBulkImportCodex(true)}>
                        {translate("Bulk Add")}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      icon="add"
                      onClick={triggerAddConnection}
                    >
                      {isCompatible ? "Add API Key" : "Add Connection"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              {oneByOneSummary && (
                <div className="mb-4 rounded-lg border border-black/10 bg-black/[0.02] px-3 py-2 text-xs text-text-muted dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>Total: {oneByOneSummary.total}</span>
                    <span>Completed: {oneByOneSummary.completed}</span>
                    <span>Passed: {oneByOneSummary.passed}</span>
                    <span>Failed: {oneByOneSummary.failed}</span>
                    {oneByOneSummary.stopped && (
                      <span className="text-amber-600 dark:text-amber-400">Stopped</span>
                    )}
                    {oneByOneRunning && oneByOneCurrentConnectionId && (
                      <span>Running: {connections.find((conn) => conn.id === oneByOneCurrentConnectionId)?.name || oneByOneCurrentConnectionId}</span>
                    )}
                  </div>
                </div>
              )}
              {connections.length > 0 && (
                <div className="mb-3 flex items-center gap-2 border-b border-black/[0.03] pb-2 dark:border-white/[0.03]">
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-text-muted hover:text-primary">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAllConnections}
                      className="h-3.5 w-3.5 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    Select All
                  </label>
                </div>
              )}
              {connectionsList}
              {!isCompatible && (
                <div className="mt-4 grid grid-cols-1 gap-2 sm:flex">
                  {providerId === "codex" && (
                    <Button
                      size="sm"
                      icon="playlist_add"
                      variant="secondary"
                      onClick={() => setShowBulkImportCodex(true)}
                      title={translate("Bulk import codex accounts from JSON")}
                      className="w-full sm:w-auto"
                    >
                      {translate("Bulk Add")}
                    </Button>
                  )}
                  {hasDualAuthModes ? (
                    <>
                      <Button
                        size="sm"
                        icon="lock"
                        variant="secondary"
                        onClick={triggerOAuthConnection}
                        className="w-full sm:w-auto"
                      >
                        {oauthConnectionLabel}
                      </Button>
                      {providerId === "workbuddy" && (
                        <Button
                          size="sm"
                          icon="language"
                          variant="secondary"
                          onClick={triggerOAuthWebConnection}
                          className="w-full sm:w-auto"
                        >
                          OAuth (Web Login)
                        </Button>
                      )}
                      <Button
                        size="sm"
                        icon="key"
                        onClick={triggerApiKeyConnection}
                        className="w-full sm:w-auto"
                      >
                        {apiKeyConnectionLabel}
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      icon="add"
                      onClick={triggerAddConnection}
                      className="w-full sm:w-auto"
                    >
                      Add
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {/* Models */}
      <Card>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">
              {"Available Models"}
            </h2>
            {providerThinkingLevels && (
              <select
                value={thinkingMode}
                onChange={(e) => handleThinkingModeChange(e.target.value)}
                title="Appends (level) suffix to copied model names"
                className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:border-primary focus:outline-none"
              >
                {providerThinkingLevels.map((opt) => (
                  <option key={opt} value={opt}>{`Thinking: ${opt.charAt(0).toUpperCase() + opt.slice(1)}`}</option>
                ))}
              </select>
            )}
          </div>
          {!isCompatible && (() => {
            const allIds = [
              ...models,
              ...kiloFreeModels.filter((fm) => !models.some((m) => m.id === fm.id)),
            ].filter((m) => { const k = getModelKind(m); return !k || k === "llm"; }).map((m) => m.id);
            const activeIds = allIds.filter((id) => !disabledModelIds.includes(id));
            return (
              <div className="flex gap-2">
                {disabledModelIds.length > 0 && (
                  <Button size="sm" variant="secondary" icon="restart_alt" onClick={handleEnableAll}>
                    Active All
                  </Button>
                )}
                {activeIds.length > 0 && (
                  <Button size="sm" variant="secondary" icon="block" onClick={() => handleDisableAll(activeIds)}>
                    Disable All
                  </Button>
                )}
              </div>
            );
          })()}
        </div>
        {!!modelsTestError && (
          <p className="text-xs text-red-500 mb-3 break-words">{modelsTestError}</p>
        )}
        {renderModelsSection()}
      </Card>

      {bulkActionModal}

      {/* Modals */}
      <OAuthModal
        isOpen={showOAuthModal}
        provider={providerId}
        providerInfo={providerInfo}
        oauthMeta={oauthModalMeta || undefined}
        onSuccess={handleOAuthSuccess}
        onClose={() => setShowOAuthModal(false)}
      />
      <AddApiKeyModal
        isOpen={showAddApiKeyModal}
        provider={providerId}
        providerName={providerInfo.name}
        isCompatible={isCompatible}
        isAnthropic={isAnthropicCompatible}
        authType={providerInfo?.authType}
        authHint={providerInfo?.authHint}
        website={providerInfo?.website}
        proxyPools={proxyPools}
        error={addConnectionError}
        existingNames={connections.map((c) => c.name).filter(Boolean)}
        onSave={handleSaveApiKey}
        onBulkDone={fetchConnections}
        onClose={() => {
          setAddConnectionError("");
          setShowAddApiKeyModal(false);
        }}
      />
      <EditConnectionModal
        isOpen={showEditModal}
        connection={selectedConnection}
        proxyPools={proxyPools}
        onSave={handleUpdateConnection}
        onClose={() => setShowEditModal(false)}
      />
      {isCompatible && (
        <EditCompatibleNodeModal
          isOpen={showEditNodeModal}
          node={providerNode}
          onSave={handleUpdateNode}
          onClose={() => setShowEditNodeModal(false)}
          isAnthropic={isAnthropicCompatible}
        />
      )}
      {!isCompatible && (
        <AddCustomModelModal
          isOpen={showAddCustomModel}
          providerAlias={providerStorageAlias}
          providerDisplayAlias={providerDisplayAlias}
          onSave={async (modelId) => {
            await handleAddCustomModel(modelId, "llm", providerStorageAlias);
            setShowAddCustomModel(false);
          }}
          onClose={() => setShowAddCustomModel(false)}
        />
      )}

      {providerId === "codex" && (
        <BulkImportCodexModal
          isOpen={showBulkImportCodex}
          onClose={() => setShowBulkImportCodex(false)}
          onSuccess={fetchConnections}
        />
      )}

      {/* AG Risk Confirmation Modal */}
      <ConfirmModal
        isOpen={showAgRiskModal}
        onClose={() => setShowAgRiskModal(false)}
        onConfirm={handleAgRiskConfirm}
        title="Risk Notice"
        message={providerInfo?.deprecationNotice}
        confirmText="I Understand, Continue"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmState}
        onClose={() => setConfirmState(null)}
        onConfirm={confirmState?.onConfirm}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message}
        variant="danger"
      />
    </div>
  );
}
