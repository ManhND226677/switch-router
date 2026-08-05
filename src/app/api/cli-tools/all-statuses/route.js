"use server";

import { NextResponse } from "next/server";
import { GET as claudeGet } from "../claude-settings/route";
import { GET as codexGet } from "../codex-settings/route";
import { GET as opencodeGet } from "../opencode-settings/route";
import { GET as openclawGet } from "../openclaw-settings/route";
import { GET as hermesGet } from "../hermes-settings/route";
import { GET as coworkGet } from "../cowork-settings/route";

const STATUS_GETTERS = {
  claude: claudeGet,
  codex: codexGet,
  opencode: opencodeGet,
  openclaw: openclawGet,
  hermes: hermesGet,
  cowork: coworkGet,
};

// Batch endpoint: gather all CLI tool statuses in one round-trip
export async function GET() {
  const entries = await Promise.all(
    Object.entries(STATUS_GETTERS).map(async ([toolId, getter]) => {
      try {
        const res = await getter();
        const data = await res.json();
        return [toolId, data];
      } catch {
        return [toolId, null];
      }
    })
  );
  return NextResponse.json(Object.fromEntries(entries));
}
