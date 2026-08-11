export const OFFICE_MESSAGES_ENDPOINT = "/office/v1/messages";
export const OFFICE_MODEL_IDS_ENV = "OFFICE_MODEL_IDS";

export function getOfficeModelIds() {
  return String(process.env[OFFICE_MODEL_IDS_ENV] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

// This instruction belongs to the gateway. It is intentionally kept separate
// from the Office-supplied system context, history, tool results, and files.
export const OFFICE_POWERPOINT_RUNTIME_GUARDRAIL = [
  "PowerPoint Office.js execution safety:",
  "for a collection of shapes, never call shape.textFrame or shape.getTextFrameOrNullObject() on every item.",
  "First queue shape.load(\"type\") for each candidate and await context.sync().",
  "Only attempt a TextFrame for known text-bearing types such as PowerPoint.ShapeType.geometricShape, PowerPoint.ShapeType.placeholder, and PowerPoint.ShapeType.textBox.",
  "Handle tables through their table API, and skip chart, contentApp, diagram, graphic, group, image, ink, line, media, model3D, ole, smartArt, and unsupported shapes.",
  "After obtaining an OrNullObject text frame, load hasText and textRange, await context.sync(), then check !textFrame.isNullObject && textFrame.hasText before reading textRange.",
  "An unsupported shape must be skipped, never allowed to fail the full batch.",
].join(" ");

export function isOfficeMessagesRequest(endpoint = "") {
  return endpoint === OFFICE_MESSAGES_ENDPOINT;
}

// Office already owns the task-pane context. Keep its supplied payload intact
// by disabling optional prompt/content transforms only for this endpoint.
export function getOfficeRequestPolicy(settings = {}, endpoint = "") {
  const isOfficeRequest = isOfficeMessagesRequest(endpoint);
  return {
    isOfficeRequest,
    preserveClientPayload: isOfficeRequest,
    rtkEnabled: !isOfficeRequest && !!settings?.rtkEnabled,
    cavemanEnabled: !isOfficeRequest && !!settings?.cavemanEnabled,
    ponytailEnabled: !isOfficeRequest && !!settings?.ponytailEnabled,
    pxpipeEnabled: !isOfficeRequest && !!settings?.pxpipeEnabled,
  };
}

// Claude for Office can issue auxiliary requests with a fixed fast-model ID in
// parallel with the user-selected model. Keep those requests inside the Office
// allowlist so a direct provider model cannot fail independently of the combo.
// The caller-owned request remains untouched; only the working routing copy is
// changed.
export function routeOfficeRequestModel(body, endpoint = "") {
  if (!isOfficeMessagesRequest(endpoint) || !body || typeof body !== "object") return body;

  const allowedModels = getOfficeModelIds();
  if (!allowedModels.length || allowedModels.includes(body.model)) return body;

  return { ...body, model: allowedModels[0] };
}

// Add a gateway-owned execution constraint without mutating any caller-owned
// object. It is applied only after the raw Office request has been captured.
export function appendOfficePowerPointRuntimeGuardrail(body, endpoint = "") {
  if (!isOfficeMessagesRequest(endpoint) || !body || typeof body !== "object") return body;

  const guardrailBlock = { type: "text", text: OFFICE_POWERPOINT_RUNTIME_GUARDRAIL };
  if (Array.isArray(body.system)) {
    if (body.system.some((block) => block?.type === "text" && block.text === OFFICE_POWERPOINT_RUNTIME_GUARDRAIL)) {
      return body;
    }
    return { ...body, system: [...body.system, guardrailBlock] };
  }

  if (typeof body.system === "string") {
    const existing = body.system.trim() ? [{ type: "text", text: body.system }] : [];
    return { ...body, system: [...existing, guardrailBlock] };
  }

  if (body.system === undefined || body.system === null) {
    return { ...body, system: [guardrailBlock] };
  }

  // Do not coerce an unfamiliar system envelope: preserving it takes priority.
  return body;
}

// Backward-compatible selector used by existing callers and tests.
export function getRequestPromptInjectionFlags(settings = {}, endpoint = "") {
  const policy = getOfficeRequestPolicy(settings, endpoint);
  return {
    cavemanEnabled: policy.cavemanEnabled,
    ponytailEnabled: policy.ponytailEnabled,
  };
}
