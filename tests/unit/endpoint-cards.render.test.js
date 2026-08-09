import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

import RuntimeStatusCard from "../../src/app/(dashboard)/dashboard/endpoint/components/RuntimeStatusCard.js";
import QuickStartCard from "../../src/app/(dashboard)/dashboard/endpoint/components/QuickStartCard.js";
import OfficeGatewayCard from "../../src/app/(dashboard)/dashboard/endpoint/components/OfficeGatewayCard.js";
import AccessSecurityCard from "../../src/app/(dashboard)/dashboard/endpoint/components/AccessSecurityCard.js";
import EndpointRow from "../../src/app/(dashboard)/dashboard/endpoint/components/EndpointRow.js";

const ORIGIN = "http://127.0.0.1:28701";
const noop = () => {};

/**
 * The endpoint page is fully client-rendered, so `next build` cannot catch a
 * broken import or a bad prop contract in these cards. Render each one to
 * static markup instead: that executes the component body for real.
 */
describe("endpoint page cards render", () => {
  it("renders the runtime status card with live values", () => {
    const html = renderToStaticMarkup(
      React.createElement(RuntimeStatusCard, {
        health: "ok",
        origin: ORIGIN,
        requireApiKey: true,
        modelCount: 698,
        activeKeyCount: 1,
        officeGatewayEnabled: true,
      }),
    );
    expect(html).toContain("127.0.0.1:28701");
    expect(html).toContain("698");
    expect(html).toContain("Listening on");
    expect(html).toContain("running");
  });

  it("renders the runtime status card while values are still unknown", () => {
    const html = renderToStaticMarkup(
      React.createElement(RuntimeStatusCard, {
        health: "checking",
        origin: ORIGIN,
        requireApiKey: false,
        modelCount: null,
        activeKeyCount: null,
        officeGatewayEnabled: false,
      }),
    );
    expect(html).toContain("—");
    expect(html).toContain("checking...");
  });

  it("renders the quick-start card without leaking a key by default", () => {
    const html = renderToStaticMarkup(
      React.createElement(QuickStartCard, {
        origin: ORIGIN,
        keys: [{ id: "k1", name: "Local CLI", key: "sk-secret-abc", isActive: true }],
        copied: null,
        onCopy: noop,
      }),
    );
    expect(html).toContain("&lt;YOUR_API_KEY&gt;");
    expect(html).not.toContain("sk-secret-abc");
    // The key picker is offered, but selecting it is an explicit user action.
    expect(html).toContain("Insert real key: Local CLI");
  });

  it("renders the quick-start card with no keys at all", () => {
    const html = renderToStaticMarkup(
      React.createElement(QuickStartCard, { origin: ORIGIN, keys: [], copied: null, onCopy: noop }),
    );
    expect(html).toContain("curl");
    expect(html).not.toContain("Insert real key");
  });

  it("renders the office card in both flag states", () => {
    const enabled = renderToStaticMarkup(
      React.createElement(OfficeGatewayCard, {
        origin: ORIGIN,
        enabled: true,
        allowlistCount: 2,
        copied: null,
        onCopy: noop,
      }),
    );
    expect(enabled).toContain("/office/v1/messages");

    const disabled = renderToStaticMarkup(
      React.createElement(OfficeGatewayCard, {
        origin: ORIGIN,
        enabled: false,
        allowlistCount: 0,
        copied: null,
        onCopy: noop,
      }),
    );
    expect(disabled).toContain("OFFICE_GATEWAY_ENABLED=true");
    expect(disabled).not.toContain("/office/v1/messages");
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
