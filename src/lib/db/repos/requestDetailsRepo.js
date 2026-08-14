import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { toValidDateIso } from "./dateFilter.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
const CONFIG_CACHE_TTL_MS = 5000;

// Two writers use two different words for the same outcome: usageHistory rows
// are stored with status "ok", requestDetails rows with "success". Reads accept
// either so a filter never comes back empty just because of the writer.
const SUCCESS_STATUS_SYNONYMS = new Set(["ok", "success"]);

let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) return cachedConfig;
  try {
    const { getSettings } = await import("./settingsRepo.js");
    const settings = await getSettings();

    // `OBSERVABILITY_ENABLED=false` is a deployment-level hard kill-switch: it
    // wins over the stored setting so an operator can disable request logging
    // without touching the DB. Otherwise the dashboard toggle decides.
    //
    // NOTE: this used to read `settings.enableObservability2`, a key no writer
    // ever produced — the dashboard writes `enableObservability`
    // (src/app/(dashboard)/dashboard/profile/page.js) and DEFAULT_SETTINGS
    // declares `enableObservability`. The toggle was therefore inert and the env
    // var silently decided. `enableObservability2` is still honoured as a
    // fallback so any DB that did acquire the stray key keeps its value.
    const envKillSwitch = process.env.OBSERVABILITY_ENABLED === "false";
    const stored = typeof settings.enableObservability === "boolean"
      ? settings.enableObservability
      : (typeof settings.enableObservability2 === "boolean" ? settings.enableObservability2 : true);
    const enabled = envKillSwitch ? false : stored;
    cachedConfig = {
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: false,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }
  cachedConfigTs = Date.now();
  return cachedConfig;
}

let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) delete sanitized[key];
  }
  return sanitized;
}

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

function truncateField(obj, maxSize) {
  const str = JSON.stringify(obj || {});
  if (str.length > maxSize) {
    return { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
  }
  return obj || {};
}

async function flushToDatabase() {
  if (isFlushing) return;
  if (writeBuffer.length === 0) return;
  isFlushing = true;
  try {
    // Drain entire buffer (loop in case more pushed during await)
    while (writeBuffer.length > 0) {
      const items = writeBuffer.splice(0, writeBuffer.length);
      try {
        const db = await getAdapter();
        const config = await getObservabilityConfig();

        db.transaction(() => {
          for (const item of items) {
            if (!item.id) item.id = generateDetailId(item.model);
            if (!item.timestamp) item.timestamp = new Date().toISOString();
            if (item.request?.headers) item.request.headers = sanitizeHeaders(item.request.headers);

            const record = {
              id: item.id,
              provider: item.provider || null,
              model: item.model || null,
              connectionId: item.connectionId || null,
              timestamp: item.timestamp,
              status: item.status || null,
              latency: item.latency || {},
              tokens: item.tokens || {},
              request: truncateField(item.request, config.maxJsonSize),
              providerRequest: truncateField(item.providerRequest, config.maxJsonSize),
              providerResponse: truncateField(item.providerResponse, config.maxJsonSize),
              response: truncateField(item.response, config.maxJsonSize),
              pxpipe: item.pxpipe || undefined,
            };

            db.run(
              `INSERT INTO requestDetails(id, timestamp, provider, model, connectionId, status, data) VALUES(?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET timestamp = excluded.timestamp, provider = excluded.provider, model = excluded.model, connectionId = excluded.connectionId, status = excluded.status, data = excluded.data`,
              [record.id, record.timestamp, record.provider, record.model, record.connectionId, record.status, stringifyJson(record)]
            );
          }

          const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
          if (cnt && cnt.c > config.maxRecords) {
            db.run(
              `DELETE FROM requestDetails WHERE id IN (SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?)`,
              [cnt.c - config.maxRecords]
            );
          }
        });
      } catch (e) {
        // Requeue the drained batch so a transient DB error doesn't silently
        // drop observability data; the next flush attempt retries it.
        writeBuffer.unshift(...items);
        throw e;
      }
    }
  } catch (e) {
    console.error("[requestDetailsRepo] Batch write failed:", e);
  } finally {
    isFlushing = false;
  }
}

export async function saveRequestDetail(detail) {
  const config = await getObservabilityConfig();
  if (!config.enabled) return;

  writeBuffer.push(detail);

  // Trigger immediate flush if batch threshold reached.
  // flushToDatabase() drains entire buffer in a loop, so all pushes during await are persisted.
  if (writeBuffer.length >= config.batchSize) {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    flushToDatabase().catch((e) => console.error("[requestDetailsRepo] flush err:", e));
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushToDatabase().catch(() => {});
    }, config.flushIntervalMs);
  }
}

export async function getRequestDetails(filter = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];

  if (filter.provider) { conds.push("provider = ?"); params.push(filter.provider); }
  if (filter.model) { conds.push("model = ?"); params.push(filter.model); }
  if (filter.connectionId) { conds.push("connectionId = ?"); params.push(filter.connectionId); }
  // Status vocabulary differs by writer: usageHistory stores "ok"
  // (src/lib/db/repos/usageRepo.js) while requestDetails stores "success"
  // (open-sse/handlers/chatCore/*Handler.js). A UI filtering for one term would
  // silently return nothing for rows written under the other, so treat the
  // success synonyms as one class here rather than rewriting historical rows.
  if (filter.status) {
    const synonyms = SUCCESS_STATUS_SYNONYMS.has(String(filter.status).toLowerCase())
      ? [...SUCCESS_STATUS_SYNONYMS]
      : [filter.status];
    conds.push(`status IN (${synonyms.map(() => "?").join(", ")})`);
    params.push(...synonyms);
  }
  if (filter.startDate) {
    const iso = toValidDateIso(filter.startDate);
    if (iso) { conds.push("timestamp >= ?"); params.push(iso); }
  }
  if (filter.endDate) {
    const iso = toValidDateIso(filter.endDate);
    if (iso) { conds.push("timestamp <= ?"); params.push(iso); }
  }

  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cntRow = db.get(`SELECT COUNT(*) as c FROM requestDetails ${where}`, params);
  const totalItems = cntRow ? cntRow.c : 0;

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const offset = (page - 1) * pageSize;

  const rows = db.all(
    `SELECT data FROM requestDetails ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );
  const details = rows.map((r) => parseJson(r.data, {}));

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getDistinctProviders() {
  const db = await getAdapter();
  const rows = db.all(`SELECT DISTINCT provider FROM requestDetails WHERE provider IS NOT NULL ORDER BY provider ASC`);
  return rows.map((r) => r.provider);
}

export async function getRequestDetailById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM requestDetails WHERE id = ?`, [id]);
  return row ? parseJson(row.data, null) : null;
}

const _shutdownHandler = async () => {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (writeBuffer.length > 0) await flushToDatabase();
};

const shutdownState = (globalThis.__switchRouterRequestDetailsShutdown ??= {
  handler: null,
});

function ensureShutdownHandler() {
  // Replace the previous module instance during Next.js hot reload. Retaining
  // the old function reference lets us remove it before registering the new one.
  if (shutdownState.handler) {
    process.off("beforeExit", shutdownState.handler);
    process.off("SIGINT", shutdownState.handler);
    process.off("SIGTERM", shutdownState.handler);
    process.off("exit", shutdownState.handler);
  }

  shutdownState.handler = _shutdownHandler;
  process.on("beforeExit", shutdownState.handler);
  process.on("SIGINT", shutdownState.handler);
  process.on("SIGTERM", shutdownState.handler);
  process.on("exit", shutdownState.handler);
}

ensureShutdownHandler();
