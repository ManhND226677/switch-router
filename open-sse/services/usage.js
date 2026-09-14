/**
 * Usage Fetcher - Get usage data from provider APIs
 */

import { getGitHubUsage } from "./usage/github.js";
import { getAntigravityUsage } from "./usage/google.js";
import { getClaudeUsage } from "./usage/claude.js";
import { getCodexUsage, consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "./usage/codex.js";

export { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits };
import { getMiniMaxUsage } from "./usage/minimax.js";
import { getGrokCliUsage } from "./usage/grok-cli.js";
import { getWorkbuddyUsage } from "./usage/workbuddy.js";
import { ensureWorkbuddyAutoCheckinStarted } from "../../src/shared/services/workbuddyAutoCheckin.js";
import { getNovitaUsage } from "./usage/novita.js";
import {
  getOllamaUsage,
  getGlmUsage,
  getVilaoUsage,
  getStepFunUsage,
} from "./usage/misc.js";

/**
 * Get usage data for a provider connection
 * @param {Object} connection - Provider connection with accessToken
 * @returns {Object} Usage data with quotas
 */
// provider → usage handler (ctx carries every arg each handler needs)
const USAGE_HANDLERS = {
  github: (c) => getGitHubUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  antigravity: (c) => getAntigravityUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  claude: (c) => getClaudeUsage(c.accessToken, c.proxyOptions),
  codex: (c) => getCodexUsage(c.accessToken, c.proxyOptions),
  ollama: (c) => getOllamaUsage(c.accessToken),
  glm: (c) => getGlmUsage(c.apiKey, c.provider, c.proxyOptions),
  minimax: (c) => getMiniMaxUsage(c.apiKey, c.provider, c.proxyOptions),
  "grok-cli": (c) => getGrokCliUsage(c.accessToken, c.providerSpecificData, c.proxyOptions),
  vilao: (c) => getVilaoUsage(c.apiKey, c.providerSpecificData, c.proxyOptions),
  stepfun: (c) => getStepFunUsage(c.apiKey, c.providerSpecificData, c.proxyOptions),
  workbuddy: (c) => {
    // Quota view of a workbuddy connection also (re)arms the auto check-in
    // scheduler — the only place the user looks at rewards.
    ensureWorkbuddyAutoCheckinStarted();
    return getWorkbuddyUsage({
      connectionId: c.connectionId,
      accessToken: c.accessToken,
      apiKey: c.apiKey,
      providerSpecificData: c.providerSpecificData,
      proxyOptions: c.proxyOptions,
    });
  },
  novita: (c) => getNovitaUsage({
    connectionId: c.connectionId,
    apiKey: c.apiKey,
    proxyOptions: c.proxyOptions,
  }),
};

export async function getUsageForProvider(connection, proxyOptions = null) {
  const { id: connectionId, provider, accessToken, apiKey, providerSpecificData, projectId } = connection;
  const providerDataWithProjectId = {
    ...(providerSpecificData || {}),
    ...(projectId ? { projectId } : {}),
  };

  const handler = USAGE_HANDLERS[provider];
  if (!handler) return { message: `Usage API not implemented for ${provider}` };
  return await handler({ connectionId, provider, accessToken, apiKey, providerSpecificData, providerDataWithProjectId, proxyOptions });
}
