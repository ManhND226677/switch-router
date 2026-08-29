import { AntigravityExecutor } from "./antigravity.js";
import { GithubExecutor } from "./github.js";
import { CodexExecutor } from "./codex.js";
import { QwenExecutor } from "./qwen.js";
import { OpenCodeExecutor } from "./opencode.js";
import { OpenCodeGoExecutor } from "./opencode-go.js";
import { GrokWebExecutor } from "./grok-web.js";
import { GrokCliExecutor } from "./grok-cli.js";
import { XiaomiTokenplanExecutor } from "./xiaomi-tokenplan.js";
import { StepFunExecutor } from "./stepfun.js";
import { VilaoExecutor } from "./vilao.js";
import { WorkbuddyExecutor } from "./workbuddy.js";
import { DefaultExecutor } from "./default.js";

const executors = {
  antigravity: new AntigravityExecutor(),
  github: new GithubExecutor(),
  codex: new CodexExecutor(),
  qwen: new QwenExecutor(),
  opencode: new OpenCodeExecutor(),
  "opencode-go": new OpenCodeGoExecutor(),
  "grok-web": new GrokWebExecutor(),
  "grok-cli": new GrokCliExecutor(),
  gcli: new GrokCliExecutor(), // Alias
  gb: new GrokCliExecutor(), // Alias (Grok Build)
  "xiaomi-tokenplan": new XiaomiTokenplanExecutor(),
  stepfun: new StepFunExecutor(),
  vilao: new VilaoExecutor(),
  workbuddy: new WorkbuddyExecutor(),
};

const defaultCache = new Map();

export function getExecutor(provider) {
  if (executors[provider]) return executors[provider];
  if (!defaultCache.has(provider)) defaultCache.set(provider, new DefaultExecutor(provider));
  return defaultCache.get(provider);
}

export function hasSpecializedExecutor(provider) {
  return !!executors[provider];
}

export { BaseExecutor } from "./base.js";
export { AntigravityExecutor } from "./antigravity.js";
export { GithubExecutor } from "./github.js";
export { CodexExecutor } from "./codex.js";
export { DefaultExecutor } from "./default.js";

