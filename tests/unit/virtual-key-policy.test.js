// Unit test cho Virtual Key policy (migration 004):
// - keyPolicy: hết hạn / allowlist / budget (hàm thuần)
// - keyRateLimiter: sliding-window RPM (in-memory)
// - apiKeysRepo.normalizeKeyPolicyInput: validator input dashboard API
import { describe, it, expect, beforeEach } from "vitest";
import { checkKeyPolicy, checkBudget } from "../../src/sse/services/keyPolicy.js";
import { consumeRateLimit, resetRateLimits } from "../../src/sse/services/keyRateLimiter.js";
import { normalizeKeyPolicyInput } from "../../src/lib/db/repos/apiKeysRepo.js";

describe("keyPolicy.checkKeyPolicy", () => {
  const baseKey = { isActive: true, expiresAt: null, allowedModels: [] };

  it("bỏ qua key đang tắt", () => {
    const res = checkKeyPolicy({ ...baseKey, isActive: false, expiresAt: "2000-01-01T00:00:00Z" }, "gpt-x");
    expect(res.ok).toBe(true);
  });

  it("key chưa đặt hạn thì không hết hạn", () => {
    expect(checkKeyPolicy(baseKey, "gpt-x").ok).toBe(true);
  });

  it("key quá hạn bị chặn với code expired", () => {
    const res = checkKeyPolicy({ ...baseKey, expiresAt: "2000-01-01T00:00:00Z" }, "gpt-x");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("expired");
  });

  it("key còn hạn thì đi tiếp", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(checkKeyPolicy({ ...baseKey, expiresAt: future }, "gpt-x").ok).toBe(true);
  });

  it("allowlist rỗng/null = mọi model", () => {
    expect(checkKeyPolicy({ ...baseKey, allowedModels: [] }, "any-model").ok).toBe(true);
    expect(checkKeyPolicy({ ...baseKey, allowedModels: null }, "any-model").ok).toBe(true);
  });

  it("allowlist chặn model ngoài danh sách", () => {
    const key = { ...baseKey, allowedModels: ["claude-sonnet-5", "combo-a"] };
    expect(checkKeyPolicy(key, "claude-sonnet-5").ok).toBe(true);
    expect(checkKeyPolicy(key, "combo-a").ok).toBe(true);
    const res = checkKeyPolicy(key, "gpt-secret");
    expect(res.ok).toBe(false);
    expect(res.code).toBe("model_not_allowed");
  });

  it("thiếu model khi có allowlist thì chặn", () => {
    const res = checkKeyPolicy({ ...baseKey, allowedModels: ["claude-sonnet-5"] }, null);
    expect(res.ok).toBe(false);
  });
});

describe("keyPolicy.checkBudget", () => {
  it("không đặt trần thì luôn qua", () => {
    expect(checkBudget(null, 999).ok).toBe(true);
    expect(checkBudget(0, 999).ok).toBe(true);
    expect(checkBudget(-5, 999).ok).toBe(true);
    expect(checkBudget(undefined, 0).ok).toBe(true);
  });

  it("tiêu dưới trần thì qua", () => {
    expect(checkBudget(10, 9.9999).ok).toBe(true);
  });

  it("tiêu chạm/over trần thì chặn budget_exceeded", () => {
    const res = checkBudget(10, 10);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("budget_exceeded");
    expect(checkBudget(10, 12).ok).toBe(false);
  });
});

describe("keyRateLimiter.consumeRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("không giới hạn khi rpm null/0/âm", () => {
    expect(consumeRateLimit("k1", null).limited).toBe(false);
    expect(consumeRateLimit("k1", 0).limited).toBe(false);
    expect(consumeRateLimit("k1", -3).limited).toBe(false);
  });

  it("chặn khi vượt số request trong cửa sổ 60s", () => {
    const t0 = 1_000_000;
    expect(consumeRateLimit("k2", 2, t0).limited).toBe(false);
    expect(consumeRateLimit("k2", 2, t0 + 1000).limited).toBe(false);
    const third = consumeRateLimit("k2", 2, t0 + 2000);
    expect(third.limited).toBe(true);
    expect(third.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("cửa sổ trượt: request cũ hơn 60s được giải phóng", () => {
    const t0 = 2_000_000;
    consumeRateLimit("k3", 1, t0);
    expect(consumeRateLimit("k3", 1, t0 + 30_000).limited).toBe(true);
    expect(consumeRateLimit("k3", 1, t0 + 60_001).limited).toBe(false);
  });

  it("hai key độc lập nhau", () => {
    const t0 = 3_000_000;
    consumeRateLimit("k4", 1, t0);
    expect(consumeRateLimit("k5", 1, t0).limited).toBe(false);
    expect(consumeRateLimit("k4", 1, t0 + 1).limited).toBe(true);
  });
});

describe("apiKeysRepo.normalizeKeyPolicyInput", () => {
  it("bỏ trống toàn bộ -> object rỗng (không đổi gì)", () => {
    expect(normalizeKeyPolicyInput({})).toEqual({ value: {} });
    expect(normalizeKeyPolicyInput()).toEqual({ value: {} });
  });

  it("allowedModels: trim, bỏ rỗng, dedupe", () => {
    const { value } = normalizeKeyPolicyInput({
      allowedModels: [" a ", "a", "", null, 42, "b"],
    });
    expect(value.allowedModels).toEqual(["a", "b"]);
  });

  it("allowedModels null -> mảng rỗng; không phải mảng -> lỗi", () => {
    expect(normalizeKeyPolicyInput({ allowedModels: null }).value.allowedModels).toEqual([]);
    expect(normalizeKeyPolicyInput({ allowedModels: "x" }).error).toBeTruthy();
  });

  it("monthlyBudgetUsd: nhận số/chuỗi số, làm tròn 4 chữ số", () => {
    expect(normalizeKeyPolicyInput({ monthlyBudgetUsd: "12.5" }).value.monthlyBudgetUsd).toBe(12.5);
    expect(normalizeKeyPolicyInput({ monthlyBudgetUsd: 1.23456 }).value.monthlyBudgetUsd).toBe(1.2346);
  });

  it("monthlyBudgetUsd sai -> lỗi; rỗng -> null", () => {
    expect(normalizeKeyPolicyInput({ monthlyBudgetUsd: -1 }).error).toBeTruthy();
    expect(normalizeKeyPolicyInput({ monthlyBudgetUsd: "abc" }).error).toBeTruthy();
    expect(normalizeKeyPolicyInput({ monthlyBudgetUsd: "" }).value.monthlyBudgetUsd).toBeNull();
  });

  it("rateLimitRpm: chỉ nhận nguyên dương", () => {
    expect(normalizeKeyPolicyInput({ rateLimitRpm: 30 }).value.rateLimitRpm).toBe(30);
    expect(normalizeKeyPolicyInput({ rateLimitRpm: 1.5 }).error).toBeTruthy();
    expect(normalizeKeyPolicyInput({ rateLimitRpm: 0 }).error).toBeTruthy();
    expect(normalizeKeyPolicyInput({ rateLimitRpm: null }).value.rateLimitRpm).toBeNull();
  });

  it("expiresAt: ISO hoá ngày hợp lệ, lỗi ngày vô nghĩa", () => {
    const { value } = normalizeKeyPolicyInput({ expiresAt: "2026-12-31T23:59:59.000Z" });
    expect(value.expiresAt).toBe("2026-12-31T23:59:59.000Z");
    expect(normalizeKeyPolicyInput({ expiresAt: "not-a-date" }).error).toBeTruthy();
    expect(normalizeKeyPolicyInput({ expiresAt: "" }).value.expiresAt).toBeNull();
  });
});
