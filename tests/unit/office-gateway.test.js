import { describe, it, expect, afterEach } from "vitest";

import {
  OFFICE_GATEWAY_ORIGIN,
  getOfficeModelIds,
  isOfficeGatewayEnabled,
  isOfficeModelId,
  selectOfficeModelIds,
  withOfficeCors,
} from "../../src/app/office/v1/_shared.js";
import { OPTIONS as messagesOptions } from "../../src/app/office/v1/messages/route.js";
import { OPTIONS as modelsOptions } from "../../src/app/office/v1/models/route.js";

const originalEnabled = process.env.OFFICE_GATEWAY_ENABLED;
const originalModelIds = process.env.OFFICE_MODEL_IDS;

function request(origin = OFFICE_GATEWAY_ORIGIN, headers = {}) {
  return new Request("https://router.test/office/v1/models", {
    headers: { Origin: origin, ...headers },
  });
}

afterEach(() => {
  if (originalEnabled === undefined) delete process.env.OFFICE_GATEWAY_ENABLED;
  else process.env.OFFICE_GATEWAY_ENABLED = originalEnabled;
  if (originalModelIds === undefined) delete process.env.OFFICE_MODEL_IDS;
  else process.env.OFFICE_MODEL_IDS = originalModelIds;
});

describe("Office gateway isolation", () => {
  it("is disabled unless explicitly enabled", () => {
    delete process.env.OFFICE_GATEWAY_ENABLED;
    expect(isOfficeGatewayEnabled()).toBe(false);

    process.env.OFFICE_GATEWAY_ENABLED = "true";
    expect(isOfficeGatewayEnabled()).toBe(true);
  });

  it("recognizes Claude model IDs without changing the shared catalog", () => {
    expect(isOfficeModelId("claude-sonnet-4-20250514")).toBe(true);
    expect(isOfficeModelId("anthropic/claude-opus-4-6")).toBe(true);
    expect(isOfficeModelId("openai/gpt-5")).toBe(false);
  });

  it("filters and deduplicates Claude models by default", () => {
    delete process.env.OFFICE_MODEL_IDS;
    expect(selectOfficeModelIds([
      { id: "openai/gpt-5" },
      { id: "anthropic/claude-opus-4-6" },
      { id: "anthropic/claude-opus-4-6" },
      { id: "office-claude" },
    ]).map((model) => model.id)).toEqual([
      "anthropic/claude-opus-4-6",
      "office-claude",
    ]);
  });

  it("honors an explicit exact model allowlist", () => {
    process.env.OFFICE_MODEL_IDS = "office-claude,anthropic/claude-opus-4-6";
    expect(getOfficeModelIds()).toEqual(["office-claude", "anthropic/claude-opus-4-6"]);
    expect(selectOfficeModelIds([
      { id: "openai/gpt-5" },
      { id: "anthropic/claude-opus-4-6" },
      { id: "office-claude" },
    ]).map((model) => model.id)).toEqual([
      "anthropic/claude-opus-4-6",
      "office-claude",
    ]);
  });

  it("adds Office CORS to success and error responses", async () => {
    const response = withOfficeCors(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      request(),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(OFFICE_GATEWAY_ORIGIN);
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("x-api-key");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("anthropic-version");
    expect(response.headers.get("Vary")).toBe("Origin, Access-Control-Request-Headers");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("allows the Anthropic browser SDK headers the taskpane always sends", () => {
    const response = withOfficeCors(new Response(null, { status: 204 }), request());
    const allowed = response.headers.get("Access-Control-Allow-Headers");

    expect(allowed).toContain("anthropic-dangerous-direct-browser-access");
    expect(allowed).toContain("x-stainless-retry-count");
    expect(allowed).toContain("x-stainless-timeout");
  });

  it("echoes any extra requested headers back on the preflight, deduped and lowercased", () => {
    const response = withOfficeCors(
      new Response(null, { status: 204 }),
      request(OFFICE_GATEWAY_ORIGIN, {
        "Access-Control-Request-Headers": "X-Api-Key, x-stainless-helper-method, x-future-sdk-header",
      }),
    );

    const allowed = response.headers.get("Access-Control-Allow-Headers").split(", ");
    expect(allowed).toContain("x-future-sdk-header");
    expect(allowed.filter((name) => name === "x-api-key")).toHaveLength(1);
    expect(allowed.filter((name) => name === "x-stainless-helper-method")).toHaveLength(1);
  });

  it("grants Private Network Access when the browser asks for it", () => {
    const withoutPna = withOfficeCors(new Response(null, { status: 204 }), request());
    expect(withoutPna.headers.get("Access-Control-Allow-Private-Network")).toBeNull();

    const withPna = withOfficeCors(
      new Response(null, { status: 204 }),
      request(OFFICE_GATEWAY_ORIGIN, { "Access-Control-Request-Private-Network": "true" }),
    );
    expect(withPna.headers.get("Access-Control-Allow-Private-Network")).toBe("true");
  });

  it("does not grant CORS access to an unrelated origin", () => {
    const response = withOfficeCors(
      new Response(null, { status: 401 }),
      request("https://untrusted.example"),
    );

    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response.status).toBe(401);
  });

  it("keeps both Office preflight routes disabled by default", async () => {
    delete process.env.OFFICE_GATEWAY_ENABLED;

    const messagesResponse = await messagesOptions(request());
    const modelsResponse = await modelsOptions(request());

    expect(messagesResponse.status).toBe(404);
    expect(modelsResponse.status).toBe(404);
    expect(messagesResponse.headers.get("Access-Control-Allow-Origin")).toBe(OFFICE_GATEWAY_ORIGIN);
    expect(modelsResponse.headers.get("Access-Control-Allow-Origin")).toBe(OFFICE_GATEWAY_ORIGIN);
  });

  it("returns a successful preflight only after explicit enablement", async () => {
    process.env.OFFICE_GATEWAY_ENABLED = "1";

    const response = await messagesOptions(request());

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("requires a valid API key on both Office data routes", async () => {
    process.env.OFFICE_GATEWAY_ENABLED = "true";

    const messagesRoute = await import("../../src/app/office/v1/messages/route.js");
    const modelsRoute = await import("../../src/app/office/v1/models/route.js");
    const messagesResponse = await messagesRoute.POST(
      new Request("https://router.test/office/v1/messages", {
        method: "POST",
        headers: { Origin: OFFICE_GATEWAY_ORIGIN, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "anthropic/claude-opus-4-6" }),
      }),
    );
    const modelsResponse = await modelsRoute.GET(request());

    expect(messagesResponse.status).toBe(401);
    expect(modelsResponse.status).toBe(401);
    expect(messagesResponse.headers.get("Access-Control-Allow-Origin")).toBe(OFFICE_GATEWAY_ORIGIN);
    expect(modelsResponse.headers.get("Access-Control-Allow-Origin")).toBe(OFFICE_GATEWAY_ORIGIN);
  });
});
