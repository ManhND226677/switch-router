import { describe, expect, it } from "vitest";

import { capabilitiesFromServiceKind } from "../../open-sse/providers/capabilities.js";

describe("capabilitiesFromServiceKind", () => {
  it("maps imageToText custom models to vision-capable runtime models", () => {
    expect(capabilitiesFromServiceKind("imageToText")).toMatchObject({ vision: true });
  });

  it("returns null for unsupported media kinds", () => {
    expect(capabilitiesFromServiceKind("image")).toBeNull();
    expect(capabilitiesFromServiceKind("stt")).toBeNull();
    expect(capabilitiesFromServiceKind("tts")).toBeNull();
  });
});
