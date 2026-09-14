import { describe, it, expect } from "vitest";

// Mirror of issue labeling used by availability API / badge
const MODEL_LOCK_PREFIX = "modelLock_";
const ACCOUNT_LOCK_MODEL = "__all";

function parseLockModel(key) {
  const raw = key.slice(MODEL_LOCK_PREFIX.length);
  return raw || ACCOUNT_LOCK_MODEL;
}

function issueLabel(model, accountLevel) {
  if (accountLevel || model === ACCOUNT_LOCK_MODEL) return "All models (account)";
  return model;
}

describe("model availability labels", () => {
  it("parses modelLock___all as account sentinel", () => {
    expect(parseLockModel("modelLock___all")).toBe("__all");
    expect(parseLockModel("modelLock_gpt-4o")).toBe("gpt-4o");
  });

  it("humanizes account locks", () => {
    expect(issueLabel("__all", true)).toBe("All models (account)");
    expect(issueLabel("gpt-4o", false)).toBe("gpt-4o");
  });
});
