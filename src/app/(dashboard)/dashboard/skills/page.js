"use client";

import { useState } from "react";
import { Card, Badge } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  SKILLS,
  getSkillAbsoluteUrl,
  getSkillInstruction,
  getSkillRawUrl,
} from "@/shared/constants/skills";

function CopyButton({ value, label = "Copy URL" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <button
      onClick={() => copy(value)}
      className="px-2 py-1 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1"
      title={value}
      type="button"
    >
      <span className="material-symbols-outlined text-xs">
        {copied ? "check" : "content_copy"}
      </span>
      {copied ? "Copied!" : label}
    </button>
  );
}

function CopySkillButton({ skill }) {
  const { copied, copy } = useCopyToClipboard(2000);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleCopy = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch(getSkillRawUrl(skill.id), { cache: "no-store" });
      if (!response.ok) throw new Error(`Skill request failed: ${response.status}`);
      copy(await response.text());
    } catch {
      setFailed(true);
      window.setTimeout(() => setFailed(false), 2000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="px-2 py-1 rounded-md bg-primary text-white text-xs font-medium hover:bg-primary/90 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1"
      title="Copy the complete local Markdown skill"
      type="button"
      disabled={loading}
    >
      <span className="material-symbols-outlined text-xs">
        {loading ? "progress_activity" : failed ? "error" : copied ? "check" : "description"}
      </span>
      {loading ? "Loading..." : failed ? "Unavailable" : copied ? "Copied!" : "Copy skill"}
    </button>
  );
}

function SkillRow({ skill }) {
  const localUrl = getSkillAbsoluteUrl(skill.id);
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-[14px] border shadow-[var(--shadow-soft)] transition-colors ${
        skill.isEntry
          ? "border-brand-500/40 bg-brand-500/5"
          : "border-border-subtle bg-surface hover:bg-surface-2"
      }`}
    >
      <div
        className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
          skill.isEntry ? "bg-primary text-white" : "bg-primary/10 text-primary"
        }`}
      >
        <span className="material-symbols-outlined text-lg">{skill.icon}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
          {skill.isEntry && (
            <Badge variant="primary" size="sm">START HERE</Badge>
          )}
          {skill.endpoint && (
            <Badge variant="default" size="sm">
              <code className="text-xs">{skill.endpoint}</code>
            </Badge>
          )}
        </div>
        <p className="text-xs text-text-muted mt-0.5">{skill.description}</p>
        <a
          href={getSkillRawUrl(skill.id)}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-text-muted hover:text-primary mt-1 inline-flex items-center gap-1 break-all"
        >
          {localUrl}
          <span className="material-symbols-outlined text-xs">open_in_new</span>
        </a>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <CopySkillButton skill={skill} />
        <CopyButton value={localUrl} />
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const entryInstruction = getSkillInstruction("switch-router");

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card padding="md">
        <div className="text-xs text-text-muted mb-2">Paste this to your local AI agent:</div>
        <div className="px-3 py-2 rounded bg-surface-2 font-mono text-xs text-text-main break-all">
          {entryInstruction}
        </div>
        <p className="text-xs text-text-muted mt-2">
          Agents that cannot access localhost can use the Copy skill button to receive the complete Markdown content.
        </p>
      </Card>

      <div className="space-y-2">
        {SKILLS.map((skill) => (
          <SkillRow key={skill.id} skill={skill} />
        ))}
      </div>

      <Card padding="md">
        <div>
          <h2 className="text-sm font-semibold text-text-main">Local skill source</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Skills are bundled with Switch-Router and served locally. Older skill URLs continue to resolve as compatibility aliases.
          </p>
        </div>
      </Card>
    </div>
  );
}
