import { describe, it, expect, vi, afterEach } from "vitest";

const hb = await import("../../gateway-heartbeat.js");

const {
  DEFAULT_INTERVAL_MS,
  MIN_INTERVAL_MS,
  isHeartbeatDisabled,
  resolveHeartbeatIntervalMs,
  formatDuration,
  formatBytes,
  buildStartLine,
  buildAliveLine,
  buildStopLine,
  createGatewayHeartbeat,
} = hb;

afterEach(() => {
  vi.useRealTimers();
});

describe("gateway heartbeat: formatting", () => {
  it("formats durations compactly", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(754_000)).toBe("12m34s");
    expect(formatDuration(7_500_000)).toBe("2h05m");
  });

  it("formats rss in whole megabytes", () => {
    expect(formatBytes(142 * 1024 * 1024)).toBe("142MB");
    expect(formatBytes(0)).toBe("0MB");
    // A missing rss must not render "NaNMB" — it has to stay greppable.
    expect(formatBytes(undefined)).toBe("?MB");
    expect(formatBytes("nonsense")).toBe("?MB");
  });

  it("builds lines that carry pid, uptime and an ISO timestamp", () => {
    const now = Date.parse("2026-09-14T09:13:00.000Z");

    const start = buildStartLine({ pid: 18852, nodeVersion: "v24.18.1", intervalMs: 300_000, now, cwd: "D:\\p" });
    expect(start).toContain("pid=18852");
    expect(start).toContain("node=v24.18.1");
    expect(start).toContain("interval=5m00s");
    expect(start).toContain("2026-09-14T09:13:00.000Z");
    expect(start).toContain("D:\\p");

    const alive = buildAliveLine({ pid: 18852, uptimeMs: 754_000, rssBytes: 100 * 1024 * 1024, now });
    expect(alive).toContain("pid=18852");
    expect(alive).toContain("up=12m34s");
    expect(alive).toContain("rss=100MB");
    expect(alive).toContain("2026-09-14T09:13:00.000Z");

    const stop = buildStopLine({ pid: 18852, now, reason: "process exiting" });
    expect(stop).toContain("stopped pid=18852");
    expect(stop).toContain("process exiting");
  });
});

describe("gateway heartbeat: configuration", () => {
  it("defaults to a 5 minute interval", () => {
    expect(resolveHeartbeatIntervalMs({})).toBe(DEFAULT_INTERVAL_MS);
    expect(DEFAULT_INTERVAL_MS).toBe(5 * 60 * 1000);
  });

  it("honours SWITCH_ROUTER_HEARTBEAT_MS", () => {
    expect(resolveHeartbeatIntervalMs({ SWITCH_ROUTER_HEARTBEAT_MS: "60000" })).toBe(60_000);
  });

  it("floors the interval so a typo cannot flood the log", () => {
    expect(resolveHeartbeatIntervalMs({ SWITCH_ROUTER_HEARTBEAT_MS: "1" })).toBe(MIN_INTERVAL_MS);
  });

  it("falls back to the default on a non-numeric value", () => {
    expect(resolveHeartbeatIntervalMs({ SWITCH_ROUTER_HEARTBEAT_MS: "soon" })).toBe(DEFAULT_INTERVAL_MS);
    expect(resolveHeartbeatIntervalMs({ SWITCH_ROUTER_HEARTBEAT_MS: "0" })).toBe(DEFAULT_INTERVAL_MS);
    expect(resolveHeartbeatIntervalMs({ SWITCH_ROUTER_HEARTBEAT_MS: "-5" })).toBe(DEFAULT_INTERVAL_MS);
  });

  it("treats only an explicit 'off' as disabled, case/space insensitively", () => {
    expect(isHeartbeatDisabled({})).toBe(false);
    expect(isHeartbeatDisabled({ SWITCH_ROUTER_HEARTBEAT: "on" })).toBe(false);
    expect(isHeartbeatDisabled({ SWITCH_ROUTER_HEARTBEAT: "OFF" })).toBe(true);
    expect(isHeartbeatDisabled({ SWITCH_ROUTER_HEARTBEAT: "  off  " })).toBe(true);
  });
});

describe("gateway heartbeat: lifecycle", () => {
  function harness(env = {}, intervalMs = 60_000) {
    const lines = [];
    let uptimeMs = 0;
    const beat = createGatewayHeartbeat({
      env,
      intervalMs,
      log: (l) => lines.push(l),
      now: () => Date.parse("2026-09-14T09:13:00.000Z"),
      pid: 4242,
      nodeVersion: "v24.0.0",
      cwd: "/repo",
      uptimeMs: () => uptimeMs,
      memoryUsage: () => ({ rss: 50 * 1024 * 1024 }),
    });
    return { beat, lines, advanceUptime: (ms) => { uptimeMs += ms; } };
  }

  it("logs a start line and then an alive line per tick", () => {
    vi.useFakeTimers();
    const { beat, lines, advanceUptime } = harness();

    expect(beat.start()).toBe(true);
    expect(beat.isRunning()).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[heartbeat] started pid=4242");

    advanceUptime(120_000);
    vi.advanceTimersByTime(60_000);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("[heartbeat] alive pid=4242");
    expect(lines[1]).toContain("up=2m00s");
  });

  it("is idempotent — a second start does not install a second timer", () => {
    vi.useFakeTimers();
    const { beat, lines } = harness();
    beat.start();
    expect(beat.start()).toBe(false);
    vi.advanceTimersByTime(60_000);
    // start + exactly one tick, not two
    expect(lines).toHaveLength(2);
  });

  it("stops ticking and logs a stop line", () => {
    vi.useFakeTimers();
    const { beat, lines } = harness();
    beat.start();
    expect(beat.stop("process exiting")).toBe(true);
    expect(beat.isRunning()).toBe(false);
    vi.advanceTimersByTime(600_000);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("stopped pid=4242");
  });

  it("does nothing at all when disabled", () => {
    vi.useFakeTimers();
    const { beat, lines } = harness({ SWITCH_ROUTER_HEARTBEAT: "off" });
    expect(beat.start()).toBe(false);
    expect(beat.isRunning()).toBe(false);
    vi.advanceTimersByTime(600_000);
    expect(lines).toHaveLength(0);
  });

  it("never keeps the process alive on its own", () => {
    vi.useFakeTimers();
    const unref = vi.fn();
    const realSetInterval = global.setInterval;
    global.setInterval = (fn, ms) => {
      const t = realSetInterval(fn, ms);
      t.unref = unref;
      return t;
    };
    try {
      const { beat } = harness();
      beat.start();
      expect(unref).toHaveBeenCalledTimes(1);
    } finally {
      global.setInterval = realSetInterval;
    }
  });
});
