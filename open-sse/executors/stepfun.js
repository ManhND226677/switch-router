import { DefaultExecutor } from "./default.js";
import { resolveStepFunEndpoint } from "../providers/stepfun.js";

const MESSAGE_ARTIFACT_KEYS = new Set([
  "cache_control",
  "signature",
  "metadata",
]);

function cleanMessageBlocks(messages) {
  if (!Array.isArray(messages)) return;
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    delete message.cache_control;
    if (!Array.isArray(message.content)) continue;
    message.content = message.content
      .filter((block) => block?.type !== "thinking" && block?.type !== "redacted_thinking")
      .map((block) => {
        if (!block || typeof block !== "object") return block;
        return Object.fromEntries(Object.entries(block).filter(([key]) => !MESSAGE_ARTIFACT_KEYS.has(key)));
      });
  }
}

function normalizeEffort(value) {
  if (typeof value !== "string") return null;
  const effort = value.toLowerCase();
  return ["low", "medium", "high"].includes(effort) ? effort : null;
}

export class StepFunExecutor extends DefaultExecutor {
  constructor() {
    super("stepfun");
  }

  buildUrl(_model, _stream, _urlIndex = 0, credentials = null) {
    const runtime = credentials?.runtimeTransport;
    const format = runtime?.format || "openai";
    return resolveStepFunEndpoint(format, credentials);
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    if (!transformed || typeof transformed !== "object") return transformed;

    const format = credentials?.runtimeTransport?.format || "openai";
    const outputConfigEffort = transformed.output_config?.effort;
    const responsesEffort = transformed.reasoning?.effort;
    const requestedEffort = normalizeEffort(
      outputConfigEffort || responsesEffort || transformed.reasoning_effort,
    );

    if (format === "claude") {
      if (requestedEffort) {
        transformed.output_config = { ...(transformed.output_config || {}), effort: requestedEffort };
      } else {
        delete transformed.output_config;
      }
      delete transformed.reasoning_effort;
      delete transformed.reasoning;
      delete transformed.thinking;
      delete transformed.anthropic_version;
      if (!Number.isFinite(Number(transformed.max_tokens)) || Number(transformed.max_tokens) <= 0) {
        transformed.max_tokens = Number(transformed.max_output_tokens) || 64000;
      }
      delete transformed.max_output_tokens;
      cleanMessageBlocks(transformed.messages);
      if (Array.isArray(transformed.tools)) {
        transformed.tools = transformed.tools.map((tool) => {
          if (!tool || typeof tool !== "object") return tool;
          return Object.fromEntries(Object.entries(tool).filter(([key]) => !MESSAGE_ARTIFACT_KEYS.has(key)));
        });
      }
    } else if (format === "openai-responses") {
      if (requestedEffort) {
        transformed.reasoning = { ...(transformed.reasoning || {}), effort: requestedEffort };
      } else {
        delete transformed.reasoning;
      }
      delete transformed.reasoning_effort;
      delete transformed.output_config;
      delete transformed.thinking;
    } else {
      if (!requestedEffort) delete transformed.reasoning_effort;
      else transformed.reasoning_effort = requestedEffort;
      delete transformed.output_config;
    }

    if (transformed.max_completion_tokens != null && transformed.max_tokens == null) {
      transformed.max_tokens = transformed.max_completion_tokens;
      delete transformed.max_completion_tokens;
    }

    return transformed;
  }
}

export default StepFunExecutor;
