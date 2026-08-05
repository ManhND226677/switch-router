// Check if running in Node.js environment (has fs module)
const isNode = typeof process !== "undefined" && process.versions?.node && typeof window === "undefined";

// Check if logging is enabled via environment variable (default: false)
const LOGGING_ENABLED = typeof process !== "undefined" && process.env?.ENABLE_REQUEST_LOGS === "true";

let fs = null;
let path = null;
let fsPromises = null;
let LOGS_DIR = null;

const QUEUE_MAX_BYTES = 8 * 1024 * 1024;
const QUEUE_RESUME_BYTES = Math.floor(QUEUE_MAX_BYTES / 2);
const BATCH_MAX_BYTES = 256 * 1024;
const BATCH_MAX_ITEMS = 64;
const FLUSH_INTERVAL_MS = 40;

// Lazy load Node.js modules (avoid top-level await)
async function ensureNodeModules() {
  if (!isNode || !LOGGING_ENABLED || fs) return;
  try {
    fs = await import("fs");
    path = await import("path");
    fsPromises = fs.promises || fs.default?.promises;
    LOGS_DIR = path.join(typeof process !== "undefined" && process.cwd ? process.cwd() : ".", "logs");
  } catch {
    // Running in non-Node environment (Worker, Browser, etc.)
  }
}

function getGlobalState() {
  if (!global.__requestLoggerState) {
    global.__requestLoggerState = {
      appendQueues: new Map(),
      jsonTails: new Map(),
      activeWriters: new Set(),
      reportedErrors: new Set(),
    };
  }
  return global.__requestLoggerState;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function reportWriterError(filePath, error) {
  const state = getGlobalState();
  const key = `${filePath}:${error?.message || String(error)}`;
  if (state.reportedErrors.has(key)) return;
  state.reportedErrors.add(key);
  console.log(`[LOG] Failed to write ${filePath}:`, error?.message || String(error));
}

class AsyncAppendQueue {
  constructor(filePath) {
    this.filePath = filePath;
    this.items = [];
    this.queuedBytes = 0;
    this.stream = null;
    this.flushTimer = null;
    this.pumpPromise = null;
    this.closed = false;
    this.failed = false;
    this.waiters = [];
  }

  ensureStream() {
    if (this.stream || this.closed || this.failed || !fs) return this.stream;
    this.stream = fs.createWriteStream(this.filePath, {
      flags: "a",
      encoding: "utf8",
      highWaterMark: 1024 * 1024,
    });
    this.stream.on("error", (error) => {
      this.failed = true;
      this.items.splice(0, this.items.length);
      this.queuedBytes = 0;
      reportWriterError(this.filePath, error);
      this.resolveWaiters(true);
    });
    return this.stream;
  }

  enqueue(value) {
    if (this.closed || this.failed || value === null || value === undefined) return null;
    const chunk = typeof value === "string" ? value : String(value);
    if (!chunk) return null;

    const size = byteLength(chunk);
    this.items.push(chunk);
    this.queuedBytes += size;
    this.schedulePump();

    if (this.queuedBytes <= QUEUE_MAX_BYTES) return null;
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }

  schedulePump() {
    if (this.closed || this.flushTimer || this.pumpPromise) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.startPump();
    }, FLUSH_INTERVAL_MS);
    this.flushTimer?.unref?.();
  }

  startPump() {
    if (this.closed || this.pumpPromise) return;
    this.pumpPromise = this.pump()
      .catch((error) => reportWriterError(this.filePath, error))
      .finally(() => {
        this.pumpPromise = null;
        if (this.items.length && !this.closed) this.startPump();
        else this.resolveWaiters();
      });
  }

  async pump() {
    const stream = this.ensureStream();
    if (!stream) return;

    while (this.items.length && !this.closed && !this.failed) {
      const batch = [];
      let batchBytes = 0;

      while (this.items.length && batch.length < BATCH_MAX_ITEMS) {
        const item = this.items[0];
        const size = byteLength(item);
        if (batch.length > 0 && batchBytes + size > BATCH_MAX_BYTES) break;
        batch.push(this.items.shift());
        batchBytes += size;
        this.queuedBytes -= size;
      }

      const canContinue = stream.write(batch.join(""));
      if (!canContinue) {
        await new Promise((resolve) => {
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            resolve();
          };
          stream.once("drain", settle);
          stream.once("error", settle);
        });
      }
      this.resolveWaiters();
    }
  }

  resolveWaiters(force = false) {
    if (!force && this.queuedBytes > QUEUE_RESUME_BYTES) return;
    const waiters = this.waiters.splice(0, this.waiters.length);
    for (const resolve of waiters) resolve();
  }

  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.startPump();
    }
    if (this.items.length && !this.pumpPromise) this.startPump();
    if (this.pumpPromise) await this.pumpPromise;
    this.resolveWaiters(true);
  }

  async close() {
    if (this.closed) return;
    await this.flush();
    this.closed = true;
    if (!this.stream || this.failed) return;
    await new Promise((resolve) => {
      this.stream.once("close", resolve);
      this.stream.end();
    });
  }
}

function getAppendQueue(filePath) {
  const state = getGlobalState();
  let queue = state.appendQueues.get(filePath);
  if (!queue || queue.closed) {
    queue = new AsyncAppendQueue(filePath);
    state.appendQueues.set(filePath, queue);
    state.activeWriters.add(queue);
  }
  return queue;
}

function writeJsonFile(sessionPath, filename, data) {
  if (!fsPromises || !sessionPath) return null;

  const filePath = path.join(sessionPath, filename);
  const state = getGlobalState();
  const previous = state.jsonTails.get(filePath) || Promise.resolve();
  const operation = previous
    .catch(() => {})
    .then(() => fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), "utf8"))
    .catch((error) => {
      reportWriterError(filePath, error);
    });
  state.jsonTails.set(filePath, operation);
  operation.finally(() => {
    if (state.jsonTails.get(filePath) === operation) state.jsonTails.delete(filePath);
  }).catch(() => {});
  return operation;
}

function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

// Create log session folder: {sourceFormat}_{targetFormat}_{model}_{timestamp}
async function createLogSession(sourceFormat, targetFormat, model) {
  await ensureNodeModules();
  if (!fsPromises || !LOGS_DIR) return null;

  try {
    await fsPromises.mkdir(LOGS_DIR, { recursive: true });
    const timestamp = formatTimestamp();
    const safeModel = (model || "unknown").replace(/[/:]/g, "-");
    const folderName = `${sourceFormat}_${targetFormat}_${safeModel}_${timestamp}`;
    const sessionPath = path.join(LOGS_DIR, folderName);
    await fsPromises.mkdir(sessionPath, { recursive: true });
    return sessionPath;
  } catch (error) {
    console.log("[LOG] Failed to create log session:", error?.message || String(error));
    return null;
  }
}

// Keep the existing local behavior: full headers are retained for debugging.
function maskSensitiveHeaders(headers) {
  if (!headers) return {};
  return { ...headers };
}

function createNoOpLogger() {
  return {
    sessionPath: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {},
    async flush() {},
    async close() {},
  };
}

/**
 * Create a new log session and return logger functions.
 * The public logger method names and output file names intentionally remain
 * unchanged. Writes are queued so streaming chunks do not perform sync I/O.
 */
export async function createRequestLogger(sourceFormat, targetFormat, model) {
  if (!LOGGING_ENABLED) return createNoOpLogger();

  const sessionPath = await createLogSession(sourceFormat, targetFormat, model);
  const pendingOperations = new Set();
  const sessionQueues = new Set();

  const track = (promise) => {
    if (!promise || typeof promise.then !== "function") return promise;
    pendingOperations.add(promise);
    promise.finally(() => pendingOperations.delete(promise)).catch(() => {});
    return promise;
  };

  const append = (filename, chunk) => {
    if (!fs || !sessionPath) return null;
    const filePath = path.join(sessionPath, filename);
    const queue = getAppendQueue(filePath);
    sessionQueues.add(queue);
    return queue.enqueue(chunk);
  };

  return {
    get sessionPath() { return sessionPath; },

    logClientRawRequest(endpoint, body, headers = {}) {
      track(writeJsonFile(sessionPath, "1_req_client.json", {
        timestamp: new Date().toISOString(), endpoint,
        headers: maskSensitiveHeaders(headers), body,
      }));
    },

    logRawRequest(body, headers = {}) {
      track(writeJsonFile(sessionPath, "2_req_source.json", {
        timestamp: new Date().toISOString(),
        headers: maskSensitiveHeaders(headers), body,
      }));
    },

    logOpenAIRequest(body) {
      track(writeJsonFile(sessionPath, "3_req_openai.json", {
        timestamp: new Date().toISOString(), body,
      }));
    },

    logTargetRequest(url, headers, body) {
      track(writeJsonFile(sessionPath, "4_req_target.json", {
        timestamp: new Date().toISOString(), url,
        headers: maskSensitiveHeaders(headers), body,
      }));
    },

    logProviderResponse(status, statusText, headers, body) {
      track(writeJsonFile(sessionPath, "5_res_provider.json", {
        timestamp: new Date().toISOString(), status, statusText,
        headers: headers
          ? (typeof headers.entries === "function" ? Object.fromEntries(headers.entries()) : headers)
          : {},
        body,
      }));
    },

    appendProviderChunk(chunk) {
      return append("5_res_provider.txt", chunk);
    },

    appendOpenAIChunk(chunk) {
      return append("6_res_openai.txt", chunk);
    },

    logConvertedResponse(body) {
      track(writeJsonFile(sessionPath, "7_res_client.json", {
        timestamp: new Date().toISOString(), body,
      }));
    },

    appendConvertedChunk(chunk) {
      return append("7_res_client.txt", chunk);
    },

    logError(error, requestBody = null) {
      track(writeJsonFile(sessionPath, "6_error.json", {
        timestamp: new Date().toISOString(),
        error: error?.message || String(error),
        stack: error?.stack,
        requestBody,
      }));
    },

    async flush() {
      await Promise.all([...pendingOperations]);
      await Promise.all([...sessionQueues].map((queue) => queue.flush()));
    },

    async close() {
      await this.flush();
      await Promise.all([...sessionQueues].map(async (queue) => {
        await queue.close();
        const state = getGlobalState();
        state.activeWriters.delete(queue);
        if (state.appendQueues.get(queue.filePath) === queue) state.appendQueues.delete(queue.filePath);
      }));
    },
  };
}

// Legacy functions for backward compatibility
export function logRequest() {}
export function logResponse() {}

export function logError(provider, { error, url, model, requestBody }) {
  if (!isNode || !LOGGING_ENABLED) return;

  void ensureNodeModules().then(async () => {
    if (!fsPromises || !LOGS_DIR) return;
    try {
      await fsPromises.mkdir(LOGS_DIR, { recursive: true });
      const date = new Date().toISOString().split("T")[0];
      const logPath = path.join(LOGS_DIR, `${provider}-${date}.log`);
      const logEntry = {
        timestamp: new Date().toISOString(), type: "error", provider, model,
        url, error: error?.message || String(error), stack: error?.stack, requestBody,
      };
      const queue = getAppendQueue(logPath);
      queue.enqueue(JSON.stringify(logEntry) + "\n");
    } catch (err) {
      console.log("[LOG] Failed to write error log:", err?.message || String(err));
    }
  }).catch(() => {});
}
