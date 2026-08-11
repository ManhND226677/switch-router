"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CardSkeleton } from "@/shared/components";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import { getModelsByProviderId, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  ClaudeToolCard, CodexToolCard, OpenClawToolCard,
  HermesToolCard, OpenCodeToolCard, CoworkToolCard, AizenToolCard,
} from "../components";

export default function ToolDetailClient({ toolId }) {
  const tool = CLI_TOOLS[toolId];
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modelMappings, setModelMappings] = useState({});
  const [apiKeys, setApiKeys] = useState([]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [provRes, keysRes] = await Promise.all([
          fetch("/api/providers"),
          fetch("/api/keys"),
        ]);
        if (!mounted) return;
        if (provRes.ok) {
          const data = await provRes.json();
          setConnections(data.connections || []);
        }
        if (keysRes.ok) {
          const data = await keysRes.json();
          setApiKeys(data.keys || []);
        }
      } catch (error) {
        console.log("Error loading tool data:", error);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const getActiveProviders = () => connections.filter(c => c.isActive !== false);

  const getAllAvailableModels = () => {
    const activeProviders = getActiveProviders();
    const models = [];
    const seenModels = new Set();
    activeProviders.forEach(conn => {
      const alias = PROVIDER_ID_TO_ALIAS[conn.provider] || conn.provider;
      const providerModels = getModelsByProviderId(conn.provider);
      providerModels.forEach(m => {
        const modelValue = `${alias}/${m.id}`;
        if (!seenModels.has(modelValue)) {
          seenModels.add(modelValue);
          models.push({ value: modelValue, label: `${alias}/${m.id}`, provider: conn.provider, alias, connectionName: conn.name, modelId: m.id });
        }
      });
    });
    return models;
  };

  const handleModelMappingChange = useCallback((tId, alias, target) => {
    setModelMappings(prev => {
      if (prev[tId]?.[alias] === target) return prev;
      return { ...prev, [tId]: { ...prev[tId], [alias]: target } };
    });
  }, []);

  const getBaseUrl = () => {
    if (typeof window !== "undefined") return window.location.origin;
    return "http://127.0.0.1:28701";
  };

  const renderToolCard = () => {
    const availableModels = getAllAvailableModels();
    const hasActiveProviders = availableModels.length > 0;
    const commonProps = {
      tool,
      isExpanded: true,
      onToggle: () => {},
      baseUrl: getBaseUrl(),
      apiKeys,
    };

    switch (toolId) {
      case "claude":
        return <ClaudeToolCard {...commonProps} activeProviders={getActiveProviders()} modelMappings={modelMappings[toolId] || {}} onModelMappingChange={(a, t) => handleModelMappingChange(toolId, a, t)} hasActiveProviders={hasActiveProviders} />;
      case "codex":
        return <CodexToolCard {...commonProps} activeProviders={getActiveProviders()} />;
      case "opencode":
        return <OpenCodeToolCard {...commonProps} activeProviders={getActiveProviders()} />;
      case "cowork":
        return <CoworkToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} />;
      case "openclaw":
        return <OpenClawToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} />;
      case "hermes":
        return <HermesToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} />;
      case "aizen":
        return <AizenToolCard {...commonProps} activeProviders={getActiveProviders()} hasActiveProviders={hasActiveProviders} />;
      default:
        return null;
    }
  };

  // Guard removed/unknown tools (e.g. disabled Cowork) to avoid crash on direct URL.
  if (!tool) {
    return (
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:px-0">
        <Link href="/dashboard/cli-tools" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary w-fit">
          <span className="material-symbols-outlined text-lg">arrow_back</span>
          Back to CLI Tools
        </Link>
        <p className="text-sm text-text-muted">Tool not found or disabled.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-1 sm:px-0">
      <Link href="/dashboard/cli-tools" className="inline-flex items-center gap-1 text-sm text-text-muted hover:text-primary w-fit">
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Back to CLI Tools
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-text-main sm:text-2xl">{tool.name}</h1>
        <p className="text-sm text-text-muted">{tool.description}</p>
      </div>
      {loading ? <CardSkeleton /> : renderToolCard()}
    </div>
  );
}
