"use client";

import { useMemo, useState } from "react";
import { Button, SegmentedControl, Select } from "@/shared/components";
import { SNIPPET_TABS, buildSnippet } from "../endpointConstants";

const PLACEHOLDER_OPTION = "__placeholder__";

/**
 * Copy-pasteable client configuration for the local gateway.
 *
 * A real API key is never inlined by default: the snippet keeps the
 * <YOUR_API_KEY> placeholder until the user explicitly picks a key from the
 * dropdown, so screenshots and casual copies stay safe.
 */
export default function QuickStartCard({ origin, keys, copied, onCopy }) {
  const [tab, setTab] = useState("curl");
  const [selectedKeyId, setSelectedKeyId] = useState(PLACEHOLDER_OPTION);

  const activeKeys = useMemo(
    () => (keys || []).filter((key) => key.isActive !== false),
    [keys],
  );

  const selectedKey = activeKeys.find((key) => key.id === selectedKeyId)?.key;
  const snippet = buildSnippet(tab, origin, selectedKey);

  // Select renders its own disabled placeholder for value "", so the
  // "no real key" choice needs a concrete value to stay re-selectable.
  const keyOptions = [
    { value: PLACEHOLDER_OPTION, label: "Use placeholder <YOUR_API_KEY>" },
    ...activeKeys.map((key) => ({ value: key.id, label: `Insert real key: ${key.name}` })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <SegmentedControl
          options={SNIPPET_TABS}
          value={tab}
          onChange={setTab}
          size="sm"
        />
        {activeKeys.length > 0 && (
          <div className="w-full">
            <Select
              value={selectedKeyId}
              onChange={(event) => setSelectedKeyId(event.target.value)}
              options={keyOptions}
            />
          </div>
        )}
      </div>

      <div className="relative">
        <pre className="max-h-[320px] overflow-auto rounded-lg border border-border-subtle bg-surface-2 p-4 font-mono text-xs leading-6 text-text-main">
{snippet}
        </pre>
        <div className="absolute right-2 top-2">
          <Button
            size="sm"
            variant="secondary"
            icon={copied === `snippet_${tab}` ? "check" : "content_copy"}
            onClick={() => onCopy(snippet, `snippet_${tab}`)}
          >
            {copied === `snippet_${tab}` ? "Copied!" : "Copy"}
          </Button>
        </div>
      </div>

      {selectedKey && (
        <p className="text-xs text-yellow-600 dark:text-yellow-400">
          This snippet contains a real API key. Do not paste it into a shared document or screenshot.
        </p>
      )}
    </div>
  );
}
