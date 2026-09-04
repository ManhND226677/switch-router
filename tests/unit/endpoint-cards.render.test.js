import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import AccessSecurityCard from "../../src/app/(dashboard)/dashboard/endpoint/components/AccessSecurityCard.js";import BaseUrlsCard from "../../src/app/(dashboard)/dashboard/endpoint/components/BaseUrlsCard.js";
import EndpointRow from "../../src/app/(dashboard)/dashboard/endpoint/components/EndpointRow.js";
import ProviderDistribution from "../../src/app/(dashboard)/dashboard/endpoint/components/ProviderDistribution.js";
import TopModelBilling from "../../src/app/(dashboard)/dashboard/endpoint/components/TopModelBilling.js";

const ORIGIN = "http://127.0.0.1:28701";
const noop = () => {};

/**
 * The endpoint page is fully client-rendered, so `next build` cannot catch a
 * broken import or a bad prop contract in these cards. Render each one to
 * static markup instead: that executes the component body for real.
 */
describe("endpoint page cards render", () => {
  it("renders provider distribution with ranked providers", () => {
    const html = renderToStaticMarkup(
      React.createElement(ProviderDistribution, {
        byProvider: {
          openai: { requests: 7, promptTokens: 1000, completionTokens: 500 },
          claude: { requests: 3, promptTokens: 200, completionTokens: 100 },
        },
      }),
    );
    expect(html).toContain("openai");
    expect(html).toContain("claude");
    expect(html).toContain("70%");
    expect(html).toContain("30%");
  });

  it("renders top model billing sorted by cost", () => {
    const html = renderToStaticMarkup(
      React.createElement(TopModelBilling, {
        byModel: {
          "m-cheap (openai)": { rawModel: "m-cheap", provider: "openai", cost: 0.01, promptTokens: 10, completionTokens: 5, cachedTokens: 0, requests: 1 },
          "m-pricey (anthropic)": { rawModel: "m-pricey", provider: "anthropic", cost: 1.25, promptTokens: 200, completionTokens: 100, cachedTokens: 20, requests: 4 },
        },
        modelNames: {},
      }),
    );
    // The pricier model must appear first in the document.
    expect(html.indexOf("m-pricey")).toBeGreaterThan(-1);
    expect(html.indexOf("m-pricey")).toBeLessThan(html.indexOf("m-cheap"));
    expect(html).toContain("$1.25");
  });

  it("renders base URLs with the OpenAI and Anthropic rows on the /v1 surface", () => {
    const html = renderToStaticMarkup(
      React.createElement(BaseUrlsCard, { origin: ORIGIN }),
    );
    // Row 1 — OpenAI-compatible (no Anthropic routes leaked in).
    expect(html).toContain("http://127.0.0.1:28701/v1");
    expect(html).toContain("POST /v1/responses");
    // Row 2 — Anthropic Messages, same surface, own copy URL.
    expect(html).toContain("http://127.0.0.1:28701/v1/messages");
    expect(html).toContain("POST /v1/messages/count_tokens");
    // Removed surfaces must never be advertised again.
    expect(html).not.toContain("/codex");
    expect(html).not.toContain("/v1beta");
  });

  it("renders the office namespace inside base URLs in both flag states", () => {
    // Office is now a row of BaseUrlsCard (gated), not a standalone card.
    const enabled = renderToStaticMarkup(
      React.createElement(BaseUrlsCard, { origin: ORIGIN, officeEnabled: true }),
    );
    expect(enabled).toContain("/office/v1/messages");
    expect(enabled).toContain("Đã bật");

    const disabled = renderToStaticMarkup(
      React.createElement(BaseUrlsCard, { origin: ORIGIN, officeEnabled: false }),
    );
    expect(disabled).toContain("Optional Features");
    expect(disabled).not.toContain("/office/v1/messages");
    // The /v1 rows must survive regardless of the office flag.
    expect(disabled).toContain("/v1/messages");
  });

  it("flags a non-loopback bind without API-key enforcement", () => {
    const safe = renderToStaticMarkup(
      React.createElement(AccessSecurityCard, { origin: ORIGIN, requireApiKey: false }),
    );
    expect(safe).toContain("loopback only");
    expect(safe).not.toContain("exposed without auth");

    const risky = renderToStaticMarkup(
      React.createElement(AccessSecurityCard, { origin: "http://192.168.1.20:28701", requireApiKey: false }),
    );
    expect(risky).toContain("exposed without auth");
    expect(risky).toContain("192.168.1.20");

    const guarded = renderToStaticMarkup(
      React.createElement(AccessSecurityCard, { origin: "http://192.168.1.20:28701", requireApiKey: true }),
    );
    expect(guarded).toContain("non-loopback bind");
    expect(guarded).not.toContain("exposed without auth");
  });

  it("renders an endpoint row with and without route detail", () => {
    const rich = renderToStaticMarkup(
      React.createElement(EndpointRow, {
        label: "OpenAI",
        badge: "OAI",
        tone: "accent",
        url: `${ORIGIN}/v1`,
        copyId: "x",
        copied: null,
        onCopy: noop,
        desc: "chat/completions",
        routes: ["POST /v1/chat/completions"],
      }),
    );
    expect(rich).toContain("OpenAI");
    expect(rich).toContain("POST /v1/chat/completions");

    const plain = renderToStaticMarkup(
      React.createElement(EndpointRow, {
        label: "Models",
        url: `${ORIGIN}/office/v1/models`,
        copyId: "y",
        copied: "y",
        onCopy: noop,
      }),
    );
    expect(plain).toContain("/office/v1/models");
    // Unknown tone must fall back rather than emit "undefined" in the class list.
    expect(plain).not.toContain("undefined");
  });
});
