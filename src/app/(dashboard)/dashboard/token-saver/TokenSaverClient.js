"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Toggle, Input } from "@/shared/components";
import {
  CAVEMAN_LEVELS,
  PONYTAIL_LEVELS,
} from "../endpoint/endpointConstants";

export default function TokenSaverClient() {
  const [rtkEnabled, setRtkEnabledState] = useState(true);
  const [cavemanEnabled, setCavemanEnabled] = useState(false);
  const [cavemanLevel, setCavemanLevel] = useState("full");
  const [ponytailEnabled, setPonytailEnabled] = useState(false);
  const [ponytailLevel, setPonytailLevel] = useState("full");
  const [pxpipeMinChars, setPxpipeMinChars] = useState(25000);
  const [contextGuardEnabled, setContextGuardEnabled] = useState(true);
  const [contextAutoTrimEnabled, setContextAutoTrimEnabled] = useState(false);
  const [contextTrimMarginPct, setContextTrimMarginPct] = useState(5);
  const patchSetting = useCallback(async (patch) => {
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch (error) {
      console.error("Error updating setting:", error);
    }
  }, []);

  const handleRtkEnabled = async (value) => {
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rtkEnabled: value }),
      });
      if (res.ok) setRtkEnabledState(value);
    } catch (error) {
      console.error("Error updating rtkEnabled:", error);
    }
  };

  const handleCavemanEnabled = (value) => {
    setCavemanEnabled(value);
    patchSetting({ cavemanEnabled: value });
  };

  const handleCavemanLevel = (level) => {
    setCavemanLevel(level);
    patchSetting({ cavemanLevel: level });
  };

  const handlePonytailEnabled = (value) => {
    setPonytailEnabled(value);
    patchSetting({ ponytailEnabled: value });
  };

  const handlePonytailLevel = (level) => {
    setPonytailLevel(level);
    patchSetting({ ponytailLevel: level });
  };

  const handlePxpipeMinCharsBlur = () => {
    const next = Math.max(0, Number(pxpipeMinChars) || 25000);
    setPxpipeMinChars(next);
    patchSetting({ pxpipeMinChars: next });
  };

  const handleContextGuardEnabled = (value) => {
    setContextGuardEnabled(value);
    patchSetting({ contextGuardEnabled: value });
  };

  const handleContextAutoTrimEnabled = (value) => {
    setContextAutoTrimEnabled(value);
    patchSetting({ contextAutoTrimEnabled: value });
  };

  const handleContextMarginBlur = () => {
    const parsed = Number.parseInt(contextTrimMarginPct, 10);
    const next = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 25) : 5;
    setContextTrimMarginPct(next);
    patchSetting({ contextTrimMarginPct: next });
  };

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setRtkEnabledState(data.rtkEnabled !== false);
          setCavemanEnabled(!!data.cavemanEnabled);
          setCavemanLevel(data.cavemanLevel || "full");
          setPonytailEnabled(!!data.ponytailEnabled);
          setPonytailLevel(data.ponytailLevel || "full");
          if (typeof data.pxpipeMinChars === "number") setPxpipeMinChars(data.pxpipeMinChars);
          setContextGuardEnabled(data.contextGuardEnabled !== false);
          setContextAutoTrimEnabled(!!data.contextAutoTrimEnabled);
          if (typeof data.contextTrimMarginPct === "number") setContextTrimMarginPct(data.contextTrimMarginPct);
        }
      } catch {}
    };
    loadSettings();
  }, [patchSetting]);

  return (
    <div id="token-saver" className="space-y-6">
      <Card id="rtk">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">
              bolt
            </span>
            Token Saver
          </h2>
        </div>
        <div className="flex items-center justify-between pt-2 pb-4 border-b border-border gap-4">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress tool output{" "}
              <a
                href="https://github.com/rtk-ai/rtk"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (RTK)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              git/grep/ls/tree/logs → 60-90% fewer input tokens
            </p>
          </div>
          <Toggle
            checked={rtkEnabled}
            onChange={() => handleRtkEnabled(!rtkEnabled)}
          />
        </div>
        <div className="flex items-center justify-between pt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Compress LLM output{" "}
              <a
                href="https://github.com/JuliusBrussee/caveman"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Caveman)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Terse-style system prompt → ~65% fewer output tokens (up to 87%)
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {cavemanEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {CAVEMAN_LEVELS.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handleCavemanLevel(lvl.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        cavemanLevel === lvl.id
                          ? "bg-primary text-white border-primary"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {
                    CAVEMAN_LEVELS.find((lvl) => lvl.id === cavemanLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Toggle
              checked={cavemanEnabled}
              onChange={() => handleCavemanEnabled(!cavemanEnabled)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between pt-4 mt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              Lazy senior dev{" "}
              <a
                href="https://github.com/DietrichGebert/ponytail"
                target="_blank"
                rel="noreferrer"
                className="text-xs font-normal text-primary underline hover:opacity-80"
              >
                (Ponytail)
              </a>
            </p>
            <p className="text-sm text-text-muted">
              Bias the model toward minimal code: YAGNI, reuse stdlib,
              deletion over addition
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {ponytailEnabled && (
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  {PONYTAIL_LEVELS.map((lvl) => (
                    <button
                      key={lvl.id}
                      onClick={() => handlePonytailLevel(lvl.id)}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        ponytailLevel === lvl.id
                          ? "bg-primary text-white border-primary"
                          : "bg-transparent border-border text-text-muted hover:bg-surface-2"
                      }`}
                      title={lvl.desc}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-primary">
                  {
                    PONYTAIL_LEVELS.find((lvl) => lvl.id === ponytailLevel)
                      ?.desc
                  }
                </p>
              </div>
            )}
            <Toggle
              checked={ponytailEnabled}
              onChange={() => handlePonytailEnabled(!ponytailEnabled)}
            />
          </div>
        </div>
        {/* PXPIPE control moved to Settings → Optional Features; the old inline
            block (with its /dashboard/pxpipe link) was removed. */}

        <div className="flex items-center justify-between pt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Context overflow detection</p>
            <p className="text-sm text-text-muted">
              Recognises a provider&apos;s &quot;prompt too long&quot; rejection and
              stops replaying the same doomed request across every account.
            </p>
          </div>
          <Toggle
            checked={contextGuardEnabled}
            onChange={() => handleContextGuardEnabled(!contextGuardEnabled)}
          />
        </div>

        {contextGuardEnabled && (
        <div className="flex items-center justify-between pt-4 border-t border-border gap-4 flex-wrap">
          <div className="min-w-0 flex-1">
            <p className="font-medium">Trim &amp; retry once</p>
            <p className="text-sm text-text-muted">
              Drops the oldest turns until the request fits the window the provider
              reported, then re-sends it to the same account. The answer is built on
              a trimmed history — the response carries
              <code className="mx-1 text-xs">x-switch-router-context-trim</code>
              and the request detail records what was dropped.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {contextAutoTrimEnabled && (
              <div className="flex flex-col items-end gap-1">
                <Input
                  value={String(contextTrimMarginPct)}
                  onChange={(e) => setContextTrimMarginPct(e.target.value)}
                  onBlur={handleContextMarginBlur}
                  placeholder="5"
                  className="w-20 font-mono text-sm"
                />
                <p className="text-xs text-text-muted">margin %</p>
              </div>
            )}
            <Toggle
              checked={contextAutoTrimEnabled}
              onChange={() => handleContextAutoTrimEnabled(!contextAutoTrimEnabled)}
            />
          </div>
        </div>
        )}
      </Card>
    </div>
  );
}
