"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, Button } from "@/shared/components";
import { getModelKind, getModelsByProviderId } from "@/shared/constants/models";
import { fetchWithTimeout } from "@/shared/utils/fetchWithTimeout";
import {
  AI_PROVIDERS,
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";

const STORAGE_KEYS = {
  sessions: "basic-chat.sessions",
  activeSessionId: "basic-chat.activeSessionId",
  activeProviderId: "basic-chat.activeProviderId",
  draft: "basic-chat.draft",
};

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function safeParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function humanize(value = "") {
  return String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim() || "Unknown";
}

function formatChatError(status, detail, model) {
  const providerName = model?.providerName || "Selected provider";
  const cleanDetail = textValue(detail).replace(/\s+/g, " ").trim().slice(0, 240);
  const normalizedDetail = cleanDetail.toLowerCase();
  const suffix = cleanDetail ? ` ${cleanDetail}` : "";

  if ((status === 401 || status === 403) && /(missing|invalid) api key/.test(normalizedDetail)) {
    return "Switch-Router requires a local API key. Open Endpoint & Key to create or activate one.";
  }
  if (status === 401 || status === 403) {
    return `${providerName} rejected the connection credentials. Open Providers to reconnect this account.`;
  }
  if (status === 429) {
    return `${providerName} is rate-limited for this model. Try another model or retry later.${suffix}`;
  }
  if (status === 503) {
    return `${providerName} has no capacity for this model right now. Try another model.${suffix}`;
  }
  return `${providerName} request failed (${status}).${suffix}`;
}

function formatRelativeTime(value) {
  if (!value) return "Now";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "Now";
  const diffMinutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

function makeSessionTitle(text = "") {
  const normalized = textValue(text).replace(/\s+/g, " ").trim();
  if (!normalized) return "New chat";
  return normalized.length > 52 ? `${normalized.slice(0, 52).trimEnd()}…` : normalized;
}

function buildUserContent(message) {
  const text = textValue(message.content).trim();
  const attachments = Array.isArray(message.attachments) ? message.attachments : [];

  if (attachments.length === 0) return text;

  const content = [];
  if (text) content.push({ type: "text", text });

  for (const attachment of attachments) {
    if (attachment?.dataUrl) {
      content.push({ type: "image_url", image_url: { url: attachment.dataUrl } });
    }
  }

  return content.length > 0 ? content : text;
}

function readAssistantText(chunk) {
  if (!chunk || typeof chunk !== "object") return "";
  const choice = chunk.choices?.[0];
  const delta = choice?.delta || {};
  const pieces = [delta.content, choice?.message?.content, chunk.output_text, chunk.text]
    .map(textValue)
    .filter(Boolean);
  return pieces[0] || "";
}

async function fileToDataUrl(file) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function cloneSession(session) {
  return {
    ...session,
    messages: Array.isArray(session.messages) ? session.messages.map((message) => ({ ...message })) : [],
  };
}

function getProviderLabel(connection) {
  const providerId = connection?.provider || connection?.id;
  return AI_PROVIDERS[providerId]?.name || connection?.name || humanize(providerId || "provider");
}

function isAvailableChatModel(model) {
  const kind = getModelKind(model, "llm");
  if (kind !== "llm" && kind !== "imageToText") return false;
  return !model?.availability || model.availability === "available";
}

function getLiveModelIds(model, connection) {
  const values = [model?.id, model?.requestModel]
    .filter(Boolean)
    .map(String);
  const prefixes = [connection.provider, getProviderAlias(connection.provider)].filter(Boolean);
  const ids = new Set(values);

  for (const value of values) {
    for (const prefix of prefixes) {
      const prefixWithSlash = `${prefix}/`;
      if (value.startsWith(prefixWithSlash)) ids.add(value.slice(prefixWithSlash.length));
    }
  }

  return ids;
}

function isLiveModelInCatalog(model, connection, catalog) {
  if (catalog.length === 0) return true;
  const liveIds = getLiveModelIds(model, connection);
  return catalog.some((catalogModel) => liveIds.has(String(catalogModel.id)));
}

function normalizeStaticModel(model, connection) {
  if (!model?.id) return null;
  return {
    id: `${connection.provider}/${model.id}`,
    requestModel: `${connection.provider}/${model.id}`,
    name: model.name || model.id,
    providerId: connection.provider,
    providerName: getProviderLabel(connection),
    kind: getModelKind(model, "llm"),
    source: "static",
  };
}

function normalizeLiveModel(model, connection) {
  const rawId = typeof model === "string" ? model : model?.id || model?.name || model?.model || "";
  if (!rawId) return null;

  const displayName = typeof model === "string"
    ? model
    : model?.name || model?.displayName || rawId;

  let requestModel = rawId;
  const providerAlias = getProviderAlias(connection.provider);
  const isPassthrough = Boolean(AI_PROVIDERS[connection.provider]?.passthroughModels);
  if (isPassthrough && !rawId.startsWith(`${providerAlias}/`)) {
    requestModel = `${providerAlias}/${rawId}`;
  }
  const isCompatible = isOpenAICompatibleProvider(connection.provider) || isAnthropicCompatibleProvider(connection.provider);
  if (!isPassthrough && isCompatible && !rawId.includes("/")) {
    requestModel = `${connection.provider}/${rawId}`;
  }
  if (connection.provider === "cavoti" && !rawId.includes("/")) {
    requestModel = `${providerAlias || connection.provider}/${rawId}`;
  }

  return {
    id: requestModel,
    requestModel,
    name: displayName,
    providerId: connection.provider,
    providerName: getProviderLabel(connection),
    kind: getModelKind(model, "llm"),
    ...(model?.availability ? { availability: model.availability } : {}),
    source: "live",
  };
}

const OPENROUTER_FREE_ROUTER = "openrouter/free";
const OPENROUTER_VERIFIED_FREE_MODEL = "openrouter/openai/gpt-oss-20b:free";

function resolveChatRequestModel(model, providerGroups) {
  const requestedModel = model?.requestModel || model?.id || "";
  if (requestedModel !== OPENROUTER_FREE_ROUTER) return requestedModel;

  const openRouterGroup = providerGroups.find((group) => group.providerId === "openrouter");
  const freeModels = openRouterGroup?.models?.filter((candidate) => (
    candidate.requestModel?.endsWith(":free") && candidate.requestModel !== OPENROUTER_FREE_ROUTER
  )) || [];
  const fallback = freeModels.find((candidate) => candidate.requestModel === OPENROUTER_VERIFIED_FREE_MODEL)
    || freeModels[0];

  return fallback?.requestModel || requestedModel;
}

function parseProviderModelsPayload(data) {
  if (Array.isArray(data?.models)) return data.models;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

function dedupeModels(models) {
  const map = new Map();
  for (const model of models) {
    if (!model?.id) continue;
    const current = map.get(model.id);
    if (!current || (current.source === "static" && model.source === "live")) {
      map.set(model.id, current ? { ...current, ...model } : model);
    }
  }
  return Array.from(map.values());
}

function normalizeComboModel(combo) {
  const name = typeof combo?.name === "string" ? combo.name.trim() : "";
  if (!name) return null;
  return {
    id: name,
    requestModel: name,
    name,
    providerId: "combo",
    providerName: "Combos",
    source: "combo",
  };
}

export default function BasicChatPageClient() {
  const [providerGroups, setProviderGroups] = useState([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [localApiKey, setLocalApiKey] = useState("");
  const [requiresLocalApiKey, setRequiresLocalApiKey] = useState(false);
  const [sessions, setSessions] = useState(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = safeParse(globalThis.localStorage.getItem(STORAGE_KEYS.sessions), []);
      return Array.isArray(saved) ? saved.map((session) => ({
        ...session,
        messages: Array.isArray(session.messages) ? session.messages : [],
      })) : [];
    } catch { return []; }
  });
  const [activeSessionId, setActiveSessionId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeSessionId) || "";
  });
  const [activeProviderId, setActiveProviderId] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.activeProviderId) || "";
  });
  const [activeModelId, setActiveModelId] = useState("");
  const [draft, setDraft] = useState(() => {
    if (typeof window === "undefined") return "";
    return globalThis.localStorage.getItem(STORAGE_KEYS.draft) || "";
  });
  const [attachments, setAttachments] = useState([]);
  const [isSending, setIsSending] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isHydrated] = useState(() => typeof window !== "undefined");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [modelProviderFilter, setModelProviderFilter] = useState("all");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [retryDraft, setRetryDraft] = useState(null);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const modelSearchRef = useRef(null);
  const abortRef = useRef(null);
  const initializedRef = useRef(false);
  const modelMenuRef = useRef(null);
  const historyMenuRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoadingData(true);
      setLoadError("");

      try {
        const [providersRes, settingsRes, keysRes, combosRes] = await Promise.all([
          fetch("/api/providers", { cache: "no-store" }),
          fetch("/api/settings", { cache: "no-store" }),
          fetch("/api/keys", { cache: "no-store" }),
          fetch("/api/combos", { cache: "no-store" }),
        ]);
        const providersData = await providersRes.json().catch(() => ({}));
        const settingsData = await settingsRes.json().catch(() => ({}));
        const keysData = await keysRes.json().catch(() => ({}));
        const combosData = await combosRes.json().catch(() => ({}));
        const configuredCombos = Array.isArray(combosData.combos)
          ? combosData.combos.filter((combo) => !combo.kind || combo.kind === "llm")
          : [];
        const activeLocalKey = Array.isArray(keysData.keys)
          ? keysData.keys.find((key) => key?.isActive !== false && typeof key.key === "string" && key.key.trim())?.key.trim() || ""
          : "";

        if (!cancelled) {
          setRequiresLocalApiKey(settingsData.requireApiKey === true);
          setLocalApiKey(activeLocalKey);
        }

        const connections = Array.isArray(providersData.connections)
          ? providersData.connections.filter((connection) => (
            connection?.isActive !== false
            && connection?.testStatus !== "error"
            && connection?.testStatus !== "unavailable"
          ))
          : [];

        if (connections.length === 0 && configuredCombos.length === 0) {
          if (!cancelled) {
            setProviderGroups([]);
            setLoadError("No providers connected yet.");
          }
          return;
        }

        const providerMap = new Map();

        for (const connection of connections) {
          const providerId = connection.provider || connection.id;
          const providerName = getProviderLabel(connection);
          const providerType = isOpenAICompatibleProvider(providerId)
            ? "openai-compatible"
            : isAnthropicCompatibleProvider(providerId)
              ? "anthropic-compatible"
              : providerId;

          if (!providerMap.has(providerId)) {
            providerMap.set(providerId, {
              providerId,
              providerName,
              providerType,
              connections: [],
              models: [],
              liveCatalogLoaded: false,
              liveModelIds: new Set(),
            });
          }

          const group = providerMap.get(providerId);
          group.providerName = group.providerName || providerName;
          group.providerType = group.providerType || providerType;
          group.connections.push(connection);

          const staticModels = getModelsByProviderId(providerId)
            .filter(isAvailableChatModel)
            .map((model) => normalizeStaticModel(model, connection))
            .filter(Boolean);
          group.models.push(...staticModels);
        }

        const liveResults = await Promise.all(
          connections.map(async (connection) => {
            try {
              const response = await fetchWithTimeout(`/api/providers/${connection.id}/models`, { cache: "no-store" });
              const data = await response.json().catch(() => ({}));
              if (!response.ok) return { connection, models: [] };
              const providerId = connection.provider || connection.id;
              const staticCatalog = getModelsByProviderId(providerId).filter(isAvailableChatModel);
              const rawModels = parseProviderModelsPayload(data);
              const models = rawModels
                .map((model) => normalizeLiveModel(model, connection))
                .filter((model) => model && isAvailableChatModel(model))
                .filter((model) => isLiveModelInCatalog(model, connection, staticCatalog));
              // A provider route may return catalog-only fallback entries when
              // its upstream catalog is temporarily unavailable. Those entries
              // must not suppress the static Available catalog.
              return { connection, models, liveCatalogLoaded: models.length > 0 };
            } catch {
              return { connection, models: [] };
            }
          })
        );

        for (const result of liveResults) {
          const providerId = result.connection.provider || result.connection.id;
          const group = providerMap.get(providerId);
          if (!group) continue;
          group.liveCatalogLoaded = group.liveCatalogLoaded || result.liveCatalogLoaded === true;
          for (const model of result.models) group.liveModelIds.add(model.id);
          group.models.push(...result.models);
        }

        const normalizedProviders = Array.from(providerMap.values())
          .map((group) => {
            const models = dedupeModels(group.models)
              .filter((model) => !group.liveCatalogLoaded
                || model.source !== "static"
                || group.liveModelIds.has(model.id))
              .sort((a, b) => a.name.localeCompare(b.name));
            return {
              providerId: group.providerId,
              providerName: group.providerName,
              providerType: group.providerType,
              connections: group.connections,
              models,
            };
          })
          .filter((group) => group.models.length > 0)
          .sort((a, b) => a.providerName.localeCompare(b.providerName));

        // Combos are user-authored routing definitions. Keep them visible even
        // when one or more referenced providers/models are currently offline.
        const comboModels = configuredCombos
          .map(normalizeComboModel)
          .filter(Boolean);
        const normalized = comboModels.length > 0
          ? [
              {
                providerId: "combo",
                providerName: "Combos",
                providerType: "combo",
                connections: [],
                models: comboModels.sort((a, b) => a.name.localeCompare(b.name)),
              },
              ...normalizedProviders,
            ]
          : normalizedProviders;

        if (!cancelled) {
          setProviderGroups(normalized);
          if (normalized.length === 0) {
            setLoadError("Providers connected but no models available.");
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(textValue(error?.message) || "Failed to load providers/models.");
          setProviderGroups([]);
        }
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target)) {
        setModelMenuOpen(false);
      }
      if (historyMenuRef.current && !historyMenuRef.current.contains(event.target)) {
        setHistoryOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key !== "Escape") return;
      setModelMenuOpen(false);
      setHistoryOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return undefined;
    const frame = requestAnimationFrame(() => modelSearchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [modelMenuOpen]);

  const modelIndex = useMemo(() => {
    const map = new Map();
    for (const group of providerGroups) {
      for (const model of group.models) {
        map.set(model.id, {
          ...model,
          providerId: group.providerId,
          providerName: group.providerName,
        });
      }
    }
    return map;
  }, [providerGroups]);

  const activeProviderGroup = useMemo(() => {
    return providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0] || null;
  }, [providerGroups, activeProviderId]);

  const activeModel = useMemo(() => {
    if (activeModelId && modelIndex.has(activeModelId)) return modelIndex.get(activeModelId);
    if (activeSessionId) {
      const session = sessions.find((item) => item.id === activeSessionId);
      if (session?.modelId && modelIndex.has(session.modelId)) return modelIndex.get(session.modelId);
    }
    return activeProviderGroup?.models?.[0] || null;
  }, [activeModelId, modelIndex, activeProviderGroup, sessions, activeSessionId]);

  const currentSession = useMemo(() => sessions.find((session) => session.id === activeSessionId) || null, [sessions, activeSessionId]);
  const currentMessages = currentSession?.messages || [];
  const sessionItems = useMemo(() => [...sessions].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()), [sessions]);
  const modelCount = useMemo(() => providerGroups.reduce((total, group) => total + group.models.length, 0), [providerGroups]);
  const filteredProviderGroups = useMemo(() => {
    const query = modelQuery.trim().toLowerCase();

    return providerGroups
      .filter((group) => modelProviderFilter === "all" || group.providerId === modelProviderFilter)
      .map((group) => ({
        ...group,
        models: group.models.filter((model) => {
          if (!query) return true;
          return [model.name, model.id, model.requestModel, group.providerName]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(query));
        }),
      }))
      .filter((group) => group.models.length > 0);
  }, [modelQuery, modelProviderFilter, providerGroups]);
  const canSend = !isSending && !!activeModel && (draft.trim().length > 0 || attachments.length > 0);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      globalThis.localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
      globalThis.localStorage.setItem(STORAGE_KEYS.activeSessionId, activeSessionId);
      globalThis.localStorage.setItem(STORAGE_KEYS.activeProviderId, activeProviderId);
      globalThis.localStorage.setItem(STORAGE_KEYS.draft, draft);
    } catch {
      // Ignore storage errors.
    }
  }, [isHydrated, sessions, activeSessionId, activeProviderId, draft]);

  /* eslint-disable react-hooks/set-state-in-effect -- initialize the chat session after providers load. */
  useEffect(() => {
    if (!isHydrated || loadingData || initializedRef.current) return;
    if (providerGroups.length === 0) return;

    const savedProvider = providerGroups.find((group) => group.providerId === activeProviderId) || providerGroups[0];
    const savedModel = activeModelId && modelIndex.has(activeModelId)
      ? modelIndex.get(activeModelId)
      : savedProvider.models[0];

    if (sessions.length > 0) {
      const session = sessions.find((item) => item.id === activeSessionId) || sessions[0];
      const sessionModel = session?.modelId && modelIndex.has(session.modelId)
        ? modelIndex.get(session.modelId)
        : savedModel;
      initializedRef.current = true;
      setActiveSessionId(session.id);
      setActiveProviderId(sessionModel?.providerId || savedProvider.providerId);
      setActiveModelId(sessionModel?.id || savedModel.id);
      return;
    }

    const session = {
      id: createId(),
      title: "New chat",
      providerId: savedProvider.providerId,
      providerName: savedProvider.providerName,
      modelId: savedModel.id,
      modelName: savedModel.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };

    initializedRef.current = true;
    setSessions([session]);
    setActiveSessionId(session.id);
    setActiveProviderId(savedProvider.providerId);
    setActiveModelId(savedModel.id);
  }, [isHydrated, loadingData, providerGroups, modelIndex, sessions, activeSessionId, activeProviderId, activeModelId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const updateSession = (sessionId, updater) => {
    setSessions((prev) => prev.map((session) => (session.id === sessionId ? updater(cloneSession(session)) : session)));
  };

  const ensureSessionForModel = (model) => {
    if (!model) return null;
    return {
      id: createId(),
      title: "New chat",
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messages: [],
    };
  };

  const handleNewChat = () => {
    if (!activeModel) return;
    const session = ensureSessionForModel(activeModel);
    if (!session) return;
    setSessions((prev) => [session, ...prev]);
    setActiveSessionId(session.id);
    setActiveProviderId(session.providerId);
    setActiveModelId(session.modelId);
    setDraft("");
    setAttachments([]);
    setStreamingMessageId("");
    setStreamingText("");
    setLoadError("");
    setRetryDraft(null);
    setHistoryOpen(false);
  };

  const handleSelectSession = (sessionId) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setActiveSessionId(sessionId);
    setActiveProviderId(session.providerId || activeProviderId);
    setActiveModelId(session.modelId || activeModelId);
    setHistoryOpen(false);
    setLoadError("");
    setRetryDraft(null);
  };

  const handleDeleteCurrentChat = () => {
    if (!activeSessionId) return;
    if (typeof window !== "undefined" && !window.confirm("Delete this chat?")) return;
    const nextSessions = sessions.filter((session) => session.id !== activeSessionId);
    const fallback = nextSessions[0] || null;
    setSessions(nextSessions);
    if (fallback) {
      setActiveSessionId(fallback.id);
      setActiveProviderId(fallback.providerId);
      setActiveModelId(fallback.modelId);
    } else {
      setActiveSessionId("");
      setActiveProviderId("");
      setActiveModelId("");
    }
    setLoadError("");
    setRetryDraft(null);
  };

  const handleSelectProvider = (providerId) => {
    const group = providerGroups.find((item) => item.providerId === providerId);
    if (!group || group.models.length === 0) return;
    const nextModel = group.models[0];

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(nextModel);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => (item.id === current.id ? {
        ...item,
        providerId: group.providerId,
        providerName: group.providerName,
        modelId: nextModel.id,
        modelName: nextModel.name,
      } : item)));
      setActiveSessionId(current.id);
    }

    setActiveProviderId(group.providerId);
    setActiveModelId(nextModel.id);
    setModelMenuOpen(false);
    setModelQuery("");
    setModelProviderFilter("all");
    setLoadError("");
  };

  const handleSelectModel = (modelId) => {
    const model = modelIndex.get(modelId);
    if (!model) return;

    const current = sessions.find((session) => session.id === activeSessionId);
    if (current && current.messages.length > 0) {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    } else if (current) {
      setSessions((prev) => prev.map((item) => (item.id === current.id ? {
        ...item,
        providerId: model.providerId,
        providerName: model.providerName,
        modelId: model.id,
        modelName: model.name,
      } : item)));
      setActiveSessionId(current.id);
    } else {
      const session = ensureSessionForModel(model);
      if (!session) return;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
    }

    setActiveProviderId(model.providerId);
    setActiveModelId(model.id);
    setModelMenuOpen(false);
    setModelQuery("");
    setModelProviderFilter("all");
    setLoadError("");
  };

  const handleAttachFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) {
      event.target.value = "";
      return;
    }

    const converted = await Promise.all(images.map(async (file) => ({
      id: createId(),
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: await fileToDataUrl(file),
    })));

    setAttachments((prev) => [...prev, ...converted]);
    event.target.value = "";
  };

  const removeAttachment = (attachmentId) => {
    setAttachments((prev) => prev.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleRetry = () => {
    if (!retryDraft) return;
    setDraft(retryDraft.text);
    setAttachments(retryDraft.attachments || []);
    setRetryDraft(null);
    setLoadError("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const finalizeSessionTitle = (sessionId, titleSeed) => {
    const title = makeSessionTitle(titleSeed);
    updateSession(sessionId, (session) => ({
      ...session,
      title: session.title === "New chat" ? title : session.title,
      updatedAt: new Date().toISOString(),
    }));
  };

  const sendMessage = async () => {
    const model = activeModel || activeProviderGroup?.models?.[0] || null;
    if (!model) return;
    const requestModel = resolveChatRequestModel(model, providerGroups);

    const userText = draft.trim();
    if (!userText && attachments.length === 0) return;
    if (requiresLocalApiKey && !localApiKey) {
      setLoadError("Switch-Router requires a local API key. Open Endpoint & Key to create or activate one.");
      return;
    }

    let sessionId = activeSessionId;
    let session = sessions.find((item) => item.id === sessionId);
    if (!session) {
      session = ensureSessionForModel(model);
      if (!session) return;
      sessionId = session.id;
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(sessionId);
    }

    const userMessage = {
      id: createId(),
      role: "user",
      content: userText,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        dataUrl: attachment.dataUrl,
      })),
      createdAt: new Date().toISOString(),
    };

    const assistantMessageId = createId();
    const assistantMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      status: "streaming",
    };

    const nextMessages = [...(session.messages || []), userMessage, assistantMessage];
    setSessions((prev) => prev.map((item) => (item.id === sessionId ? {
      ...item,
      providerId: model.providerId,
      providerName: model.providerName,
      modelId: model.id,
      modelName: model.name,
      messages: nextMessages,
      updatedAt: new Date().toISOString(),
      title: item.title === "New chat" ? makeSessionTitle(userText) : item.title,
    } : item)));
    setDraft("");
    setAttachments([]);
    setIsSending(true);
    setStreamingMessageId(assistantMessageId);
    setStreamingText("");
    setLoadError("");
    setRetryDraft(null);
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const requestMessages = nextMessages
      .filter((message) => !(message.role === "assistant" && message.id === assistantMessageId))
      .map((message) => ({
        role: message.role,
        content: message.role === "user" ? buildUserContent(message) : message.content,
      }));

    try {
      const response = await fetch("/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          ...(localApiKey ? { Authorization: `Bearer ${localApiKey}` } : {}),
        },
        body: JSON.stringify({
          model: requestModel,
          messages: requestMessages,
          stream: true,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(formatChatError(
          response.status,
          errorData.error || errorData.message,
          model,
        ));
      }

      const reader = response.body?.getReader();
      if (!reader) {
        const data = await response.json().catch(() => ({}));
        const fallbackText = textValue(data?.choices?.[0]?.message?.content || data?.output_text || data?.error || data?.message || "");
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: fallbackText, status: "done" } : message)),
          updatedAt: new Date().toISOString(),
        }));
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;

          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload);
            const text = readAssistantText(chunk);
            if (!text) continue;

            assistantText += text;
            setStreamingText(assistantText);
            updateSession(sessionId, (currentSession) => ({
              ...currentSession,
              messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText, status: "streaming" } : message)),
              updatedAt: new Date().toISOString(),
            }));
          } catch {
            // Ignore malformed chunks.
          }
        }
      }

      updateSession(sessionId, (currentSession) => ({
        ...currentSession,
        messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: assistantText || message.content, status: "done" } : message)),
        updatedAt: new Date().toISOString(),
      }));
      finalizeSessionTitle(sessionId, userText);
    } catch (error) {
      if (error.name === "AbortError") {
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId
            ? { ...message, content: message.content || "Generation stopped.", status: "stopped" }
            : message)),
          updatedAt: new Date().toISOString(),
        }));
      } else {
        const errorText = textValue(error?.message || error);
        updateSession(sessionId, (currentSession) => ({
          ...currentSession,
          messages: currentSession.messages.map((message) => (message.id === assistantMessageId ? { ...message, content: message.content || `Error: ${errorText}`, status: "error" } : message)),
          updatedAt: new Date().toISOString(),
        }));
        setRetryDraft({
          text: userText,
          attachments: userMessage.attachments,
        });
        setLoadError(errorText || "Failed to send message.");
      }
    } finally {
      setIsSending(false);
      setStreamingMessageId("");
      setStreamingText("");
      abortRef.current = null;
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) sendMessage();
    }
  };

  const modelLabel = activeModel ? `${activeModel.name}` : "Select model";
  const modelSubLabel = activeModel ? activeModel.requestModel : "Choose from connected providers";
  const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

  return (
    <div data-testid="basic-chat-surface" className="relative flex-1 flex flex-col h-full min-h-0 min-w-0 bg-bg text-text-main overflow-hidden">
      <div className="relative mx-auto flex flex-1 h-full min-h-0 w-full max-w-4xl flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 lg:px-6">
          <div ref={modelMenuRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setModelMenuOpen((value) => !value);
                setHistoryOpen(false);
              }}
              aria-label={`Choose model. Current model: ${modelLabel}`}
              aria-expanded={modelMenuOpen}
              aria-haspopup="dialog"
              aria-controls="basic-chat-model-picker"
              className={`${focusRingClass} flex items-center gap-3 rounded-2xl border border-border bg-surface-2 px-4 py-3 text-left text-text-main transition hover:bg-surface-3`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-main">{modelLabel}</span>
                  <span className="material-symbols-outlined text-[18px] text-text-muted">expand_more</span>
                </div>
                <p className="truncate text-xs text-text-muted">{modelSubLabel}</p>
              </div>
            </button>

            {modelMenuOpen ? (
              <div
                id="basic-chat-model-picker"
                role="dialog"
                aria-label="Choose a model"
                className="absolute left-0 top-[calc(100%+10px)] z-30 w-[min(560px,calc(100vw-2rem))] overflow-hidden rounded-[20px] border border-border bg-surface shadow-elevated"
              >
                <div className="space-y-3 border-b border-border-subtle px-4 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.22em] text-text-muted">Models</p>
                      <p className="mt-1 text-sm text-text-main">Connected providers only</p>
                    </div>
                    <span className="shrink-0 text-xs text-text-muted">
                      {filteredProviderGroups.reduce((total, group) => total + group.models.length, 0)} of {modelCount}
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      ref={modelSearchRef}
                      type="search"
                      value={modelQuery}
                      onChange={(event) => setModelQuery(event.target.value)}
                      placeholder={`Search ${modelCount} models`}
                      aria-label="Search models"
                      autoComplete="off"
                      className={`${focusRingClass} min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text-main outline-none placeholder:text-text-subtle focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20`}
                    />
                    <select
                      value={modelProviderFilter}
                      onChange={(event) => setModelProviderFilter(event.target.value)}
                      aria-label="Filter models by provider"
                      className={`${focusRingClass} rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text-main outline-none focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/20 sm:max-w-[180px]`}
                    >
                      <option value="all">All providers</option>
                      {providerGroups.map((group) => (
                        <option key={group.providerId} value={group.providerId}>{group.providerName}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto p-2 custom-scrollbar">
                  {filteredProviderGroups.length === 0 ? (
                    <div className="rounded-[16px] border border-dashed border-border bg-surface-2 p-5 text-center">
                      <p className="text-sm font-medium text-text-main">No matching models</p>
                      <p className="mt-1 text-xs text-text-muted">Try another name or provider.</p>
                    </div>
                  ) : null}
                  {filteredProviderGroups.map((group) => (
                    <div key={group.providerId} className="mb-2 rounded-[16px] border border-border bg-bg-alt p-2">
                      <div className="flex items-center justify-between px-2 py-2">
                        <h3 className="text-sm font-semibold text-text-main">{group.providerName}</h3>
                        <Badge size="sm" variant="default">{group.models.length}</Badge>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.models.map((model) => {
                          const isActive = model.id === activeModelId;
                          return (
                            <button
                              key={model.id}
                              type="button"
                              onClick={() => handleSelectModel(model.id)}
                              aria-pressed={isActive}
                              className={`${focusRingClass} rounded-[14px] border px-3 py-3 text-left transition ${isActive ? "border-brand-500/40 bg-brand-500/15" : "border-border bg-surface-2 hover:bg-surface-3"}`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-text-main">{model.name}</p>
                                  <p className="truncate text-[11px] text-text-muted">{model.requestModel}</p>
                                </div>
                                {isActive ? <span className="material-symbols-outlined text-[18px] text-brand-500">check_circle</span> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="add"
              onClick={handleNewChat}
              disabled={!activeModel || isSending}
              aria-label="Start a new chat"
              className={focusRingClass}
            >
              New chat
            </Button>
            <button
              type="button"
              onClick={() => {
                setHistoryOpen((value) => !value);
                setModelMenuOpen(false);
              }}
              aria-expanded={historyOpen}
              aria-haspopup="dialog"
              aria-controls="basic-chat-history"
              className={`${focusRingClass} rounded-2xl border border-border bg-surface-2 px-4 py-3 text-sm text-text-main transition hover:bg-surface-3`}
            >
              History
            </button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              icon="delete"
              onClick={handleDeleteCurrentChat}
              disabled={!activeSessionId || sessions.length === 0 || isSending}
              aria-label="Delete current chat"
              className={focusRingClass}
            >
              Delete chat
            </Button>
          </div>
        </div>

        {historyOpen ? (
          <div id="basic-chat-history" ref={historyMenuRef} role="dialog" aria-label="Chat history" className="absolute right-4 top-[72px] z-20 w-[min(360px,calc(100vw-2rem))] rounded-[20px] border border-border bg-surface p-2 shadow-elevated lg:right-6">
            <div className="px-3 py-2">
              <p className="text-xs uppercase tracking-[0.22em] text-text-muted">Recent chats</p>
            </div>
            <div className="max-h-[48vh] space-y-2 overflow-y-auto p-1 custom-scrollbar">
              {sessionItems.length === 0 ? (
                <div className="rounded-[16px] border border-dashed border-border bg-surface-2 p-4 text-sm text-text-muted">
                  No conversations yet.
                </div>
              ) : sessionItems.map((session) => {
                const isActive = session.id === activeSessionId;
                const latestMessage = [...(session.messages || [])].reverse().find((message) => message.role === "user") || session.messages?.[0];
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => handleSelectSession(session.id)}
                    className={`${focusRingClass} w-full rounded-[16px] border px-3 py-3 text-left transition ${isActive ? "border-brand-500/40 bg-brand-500/15" : "border-border bg-surface-2 hover:bg-surface-3"}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-main">{session.title}</p>
                        <p className="mt-1 truncate text-xs text-text-muted">{textValue(latestMessage?.content) || "Empty chat"}</p>
                      </div>
                      <span className="text-[10px] text-text-subtle shrink-0">{formatRelativeTime(session.updatedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {loadError ? (
          <div role="alert" aria-live="assertive" className="mt-4 rounded-[18px] border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-700 dark:text-red-100">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                <span className="material-symbols-outlined text-[20px]">error</span>
                <p className="min-w-0 text-sm leading-6">{loadError}</p>
              </div>
              {retryDraft ? (
                <Button type="button" variant="ghost" size="sm" icon="refresh" onClick={handleRetry} className={`${focusRingClass} shrink-0 text-red-700 hover:bg-red-500/15 hover:text-red-900 dark:text-red-100 dark:hover:text-text-main`}>
                  Retry
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
            {currentMessages.length === 0 ? (
              <div className="flex min-h-[50vh] items-center justify-center px-4 text-center">
                <div className="max-w-xl space-y-4">
                  <div className="mx-auto flex size-16 items-center justify-center rounded-[20px] border border-border bg-surface-2 text-text-muted">
                    <span className="material-symbols-outlined text-[30px]">chat</span>
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-semibold text-text-main">
                      {loadingData ? "Loading connected models" : activeModel ? `Ready with ${activeModel.name}` : "Connect a provider to start"}
                    </h2>
                    <p className="text-sm leading-6 text-text-muted">
                      {loadingData
                        ? "Checking your connected providers and available models."
                        : activeModel
                          ? "Send a prompt below. You can switch models at any time."
                          : "Connect a provider first, then choose a model for your conversation."}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4" role="log" aria-live="polite" aria-label="Conversation">
              {currentMessages.map((message) => {
                const isUser = message.role === "user";
                const isAssistant = message.role === "assistant";
                const isStreaming = isAssistant && message.id === streamingMessageId && message.status === "streaming";
                const content = textValue(message.content) || (isAssistant ? streamingText : "");

                return (
                  <div key={message.id} className={`flex w-full ${isUser ? "justify-end" : "justify-start"} mb-6`}>
                    <div className={`max-w-[min(88%,42rem)] ${isUser ? "rounded-3xl bg-surface-2 px-5 py-3.5 text-text-main" : "text-text-main"}`}>
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold">{isUser ? "You" : message.modelName || activeModel?.name || "Assistant"}</span>
                      </div>

                      {message.attachments?.length ? (
                        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 mt-2">
                          {message.attachments.map((attachment) => (
                            <a key={attachment.id} href={attachment.dataUrl} target="_blank" rel="noreferrer" className={`${focusRingClass} overflow-hidden rounded-[18px] border border-border bg-bg-alt`}>
                              <img src={attachment.dataUrl} alt={attachment.name} className="h-28 w-full object-cover" />
                            </a>
                          ))}
                        </div>
                      ) : null}

                      <div className="whitespace-pre-wrap break-words text-[15px] leading-7">
                        {content}
                        {isAssistant && isStreaming && !streamingText ? <span className="inline-block animate-pulse">▋</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="shrink-0 pt-2">
            {attachments.length > 0 ? (
              <div className="mx-auto mb-3 flex w-full max-w-3xl flex-wrap gap-2 px-4">
                {attachments.map((attachment) => (
                  <div key={attachment.id} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 px-3 py-2">
                    <span className="text-xs text-text-muted max-w-[12rem] truncate">{attachment.name}</span>
                    <button type="button" onClick={() => removeAttachment(attachment.id)} className={`${focusRingClass} rounded-full text-text-muted hover:bg-surface-3 hover:text-text-main`} aria-label="Remove attachment">
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mx-auto w-full max-w-3xl px-4 pb-2">
              <div data-testid="basic-chat-composer" className="rounded-[26px] border border-border bg-surface-2 px-3 pt-3 pb-2 shadow-soft ring-1 ring-border">
                <textarea
                  ref={textareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message AI"
                  aria-label="Message AI"
                  rows={1}
                  className="w-full resize-none bg-transparent px-2 text-[15px] leading-6 text-text-main outline-none placeholder:text-text-subtle focus-visible:ring-2 focus-visible:ring-brand-500/40 custom-scrollbar max-h-[25vh] overflow-y-auto"
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={!activeModel || loadingData} aria-label="Attach image" title="Attach image" className={`${focusRingClass} rounded-full p-2 text-text-muted transition hover:bg-surface-3 hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50`}>
                      <span className="material-symbols-outlined text-[20px]">attach_file</span>
                    </button>
                    <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleAttachFiles} />
                    <span className="text-xs font-medium text-text-muted truncate max-w-[180px]" title={activeModel?.name || "No model selected"}>{activeModel ? activeModel.name : "No model selected"}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    {isSending ? (
                      <button type="button" onClick={handleStop} aria-label="Stop response" title="Stop response" className={`${focusRingClass} flex h-8 w-8 items-center justify-center rounded-full bg-surface-3 p-2 text-text-main transition hover:bg-surface hover:text-text-main`}>
                        <span className="material-symbols-outlined text-[16px]">stop</span>
                      </button>
                    ) : null}
                    <button type="button" onClick={sendMessage} disabled={!canSend} aria-label="Send message" title="Send message" className={`${focusRingClass} flex h-8 w-8 items-center justify-center rounded-full transition ${canSend ? "bg-brand-500 text-bg hover:opacity-90" : "cursor-not-allowed bg-surface-3 text-text-muted"}`}>
                      <span className="material-symbols-outlined text-[16px]">arrow_upward</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="mx-auto mt-2 max-w-3xl px-4 pb-4 text-center text-[11px] text-text-muted">
            {modelCount > 0 ? `${modelCount} models available from connected providers.` : "Connect a provider to make models available."}
          </p>
        </div>
      </div>
    </div>
  );
}
