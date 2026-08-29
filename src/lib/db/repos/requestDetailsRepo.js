import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { classifyErrorBucket, aggregateErrorBuckets } from "../helpers/errorBuckets.js";
import { toValidDateIso, toValidDateUpperBoundIso } from "./dateFilter.js";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024;
// Hard ceilings so a bad settings value (e.g. 1024 interpreted as KB → 1 MB/field)
// cannot grow requestDetails into a multi-hundred-MB freeze bomb again.
const MAX_RECORDS_CEILING = 2000;
const MAX_JSON_SIZE_KB_CEILING = 64;
const CONFIG_CACHE_TTL_MS = 5000;
// Rows larger than this are treated as historical bloat and dropped on compact.
const BLOATED_ROW_BYTES = 64 * 1024;

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
    const maxRecordsRaw = Number(settings.observabilityMaxRecords
      || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10)
      || DEFAULT_MAX_RECORDS);
    const batchSizeRaw = Number(settings.observabilityBatchSize
      || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10)
      || DEFAULT_BATCH_SIZE);
    const flushRaw = Number(settings.observabilityFlushIntervalMs
      || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10)
      || DEFAULT_FLUSH_INTERVAL_MS);
    // Settings store KB. Clamp aggressively — values like 1024 used to become 1 MB/field.
    const maxJsonKbRaw = Number(settings.observabilityMaxJsonSize
      || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)
      || 5);
    cachedConfig = {
      enabled,
      maxRecords: Math.min(Math.max(Math.floor(maxRecordsRaw) || DEFAULT_MAX_RECORDS, 50), MAX_RECORDS_CEILING),
      batchSize: Math.min(Math.max(Math.floor(batchSizeRaw) || DEFAULT_BATCH_SIZE, 1), 200),
      flushIntervalMs: Math.min(Math.max(Math.floor(flushRaw) || DEFAULT_FLUSH_INTERVAL_MS, 500), 60000),
      maxJsonSize: Math.min(Math.max(Math.floor(maxJsonKbRaw) || 5, 1), MAX_JSON_SIZE_KB_CEILING) * 1024,
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
  if (filter.keyId) {
    // Lọc theo virtual key: usageHistory/requestDetails lưu fingerprint
    // (xem helpers/apiKeyPrivacy.js), so cả raw cho dữ liệu cũ.
    const { getApiKeyById } = await import("./apiKeysRepo.js");
    const { fingerprintApiKey } = await import("../helpers/apiKeyPrivacy.js");
    const keyRow = await getApiKeyById(String(filter.keyId));
    if (keyRow?.key) {
      conds.push("(apiKey = ? OR apiKey = ?)");
      params.push(fingerprintApiKey(keyRow.key), keyRow.key);
    } else {
      conds.push("0 = 1");
    }
  }
  // Status vocabulary differs by writer: usageHistory stores "ok"
  // (src/lib/db/repos/usageRepo.js) while requestDetails stores "success"
  // (open-sse/handlers/chatCore/*Handler.js). A UI filtering for one term would
  // silently return nothing for rows written under the other, so treat the
  // success synonyms as one class here rather than rewriting historical rows.
  if (String(filter.status).toLowerCase() === "error") {
    // "error" is a class, not a stored value: anything that is not a success
    // synonym — including rows whose status never got written (same rule as
    // getErrorAnalytics, so the errors page and the inspector agree).
    conds.push(`(status IS NULL OR status NOT IN (${[...SUCCESS_STATUS_SYNONYMS].map(() => "?").join(", ")}))`);
    params.push(...SUCCESS_STATUS_SYNONYMS);
  } else if (filter.status) {
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
    const iso = toValidDateUpperBoundIso(filter.endDate);
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

// `provider:model` etc. are whitelisted keys, never raw input — the VALUES are
// always bound, so nothing user-controlled reaches the string-built SQL below.
const ERROR_GROUP_COLUMNS = {
  "provider:model": { select: "provider, model", group: "provider, model" },
  provider: { select: "provider", group: "provider" },
  model: { select: "model", group: "model" },
};
const ERROR_SIGNATURE_LIMIT = 10;
const GROUP_ROW_LIMIT = 200;
// `response.error` usually holds a whole JSON envelope ({"error":{"message":…}})
// with newlines, which renders as an unreadable blob. Unwrap the inner message
// first and fall back to the raw text when it is not JSON.
const ERROR_TEXT_SQL = `COALESCE(json_extract(data,'$.response.error'), '')`;
// json_extract RAISES "malformed JSON" on a non-JSON argument, and plain texts
// like "fetch connect timeout" are the common case — hence the json_valid gate.
const ERROR_MESSAGE_SQL = `(CASE WHEN json_valid(${ERROR_TEXT_SQL})
              THEN COALESCE(
                json_extract(${ERROR_TEXT_SQL}, '$.error.message'),
                json_extract(${ERROR_TEXT_SQL}, '$.error'),
                ${ERROR_TEXT_SQL})
              ELSE ${ERROR_TEXT_SQL} END)`;

/**
 * Failure analytics over requestDetails: counts grouped by provider/model,
 * per-day burst, the top recurring error signatures, and a recent list.
 *
 * Reads the indexed `status` column rather than `data.$.status`, and takes the
 * upstream HTTP status from `$.response.status` — that is what the chatCore
 * writers actually store (`status_code` does not exist in the payload).
 */
export async function getErrorAnalytics({
  startDate,
  endDate,
  groupBy = "provider:model",
  recentLimit = 20,
  signatureLimit = ERROR_SIGNATURE_LIMIT,
} = {}) {
  const db = await getAdapter();
  const cols = ERROR_GROUP_COLUMNS[groupBy] || ERROR_GROUP_COLUMNS["provider:model"];

  // Success synonyms differ by writer ("ok" / "success"), so a failure is
  // anything that is not one of them — including rows whose status never got
  // written, which must not silently disappear from an error report.
  const conds = [`(status IS NULL OR status NOT IN (${[...SUCCESS_STATUS_SYNONYMS].map(() => "?").join(", ")}))`];
  const params = [...SUCCESS_STATUS_SYNONYMS];

  const startIso = startDate ? toValidDateIso(startDate) : null;
  const endIso = endDate ? toValidDateUpperBoundIso(endDate) : null;
  if (startIso) { conds.push("timestamp >= ?"); params.push(startIso); }
  if (endIso) { conds.push("timestamp <= ?"); params.push(endIso); }
  const errWhere = `WHERE ${conds.join(" AND ")}`;

  const allWhere = [];
  const allParams = [];
  if (startIso) { allWhere.push("timestamp >= ?"); allParams.push(startIso); }
  if (endIso) { allWhere.push("timestamp <= ?"); allParams.push(endIso); }
  const dateWhere = allWhere.length ? `WHERE ${allWhere.join(" AND ")}` : "";

  const limit = Math.min(Math.max(parseInt(recentLimit, 10) || 20, 1), 100);
  const sigLimit = Math.min(Math.max(parseInt(signatureLimit, 10) || ERROR_SIGNATURE_LIMIT, 1), 50);

  const byGroup = db.all(
    `SELECT ${cols.select},
            COUNT(*) AS errors,
            ROUND(AVG(json_extract(data,'$.latency.total')), 1) AS avgMs,
            MIN(json_extract(data,'$.response.status')) AS minStatus,
            MAX(json_extract(data,'$.response.status')) AS maxStatus,
            MIN(timestamp) AS firstTs,
            MAX(timestamp) AS lastTs
     FROM requestDetails ${errWhere}
     GROUP BY ${cols.group}
     ORDER BY errors DESC
     LIMIT ?`,
    [...params, GROUP_ROW_LIMIT]
  );

  const byDay = db.all(
    `SELECT substr(timestamp, 1, 10) AS day, COUNT(*) AS errors
     FROM requestDetails ${errWhere}
     GROUP BY day
     ORDER BY day DESC
     LIMIT 60`,
    params
  );

  const signatures = db.all(
    `SELECT COALESCE(json_extract(data,'$.response.status'), 0) AS status,
            substr(replace(${ERROR_MESSAGE_SQL}, char(10), ' '), 1, 160) AS message,
            COUNT(*) AS count,
            MAX(timestamp) AS lastTs
     FROM requestDetails ${errWhere}
     GROUP BY status, message
     ORDER BY count DESC
     LIMIT ?`,
    [...params, sigLimit]
  ).map((s) => ({ ...s, bucket: classifyErrorBucket(s.status, s.message) }));

  const totalRequests = (db.get(`SELECT COUNT(*) AS c FROM requestDetails ${dateWhere}`, allParams) || {}).c || 0;
  const totalErrors = (db.get(`SELECT COUNT(*) AS c FROM requestDetails ${errWhere}`, params) || {}).c || 0;
  const errorLatencyMs = (db.get(
    `SELECT COALESCE(ROUND(SUM(json_extract(data,'$.latency.total')), 1), 0) AS ms FROM requestDetails ${errWhere}`,
    params
  ) || {}).ms || 0;

  // Bucket aggregates cover every error in the window (not just the top-N
  // signatures). requestDetails is capped (MAX_RECORDS_CEILING), so pulling
  // status+message and classifying in JS stays small and needs no new SQL.
  const errorRows = db.all(
    `SELECT COALESCE(json_extract(data,'$.response.status'), 0) AS status,
            substr(replace(${ERROR_MESSAGE_SQL}, char(10), ' '), 1, 160) AS message
     FROM requestDetails ${errWhere}`,
    params
  );
  const buckets = aggregateErrorBuckets(errorRows);

  const recent = db.all(
    `SELECT id, timestamp, provider, model, connectionId,
            json_extract(data,'$.response.status') AS statusCode,
            substr(replace(${ERROR_MESSAGE_SQL}, char(10), ' '), 1, 240) AS errorMessage,
            json_extract(data,'$.latency.total') AS totalMs
     FROM requestDetails ${errWhere}
     ORDER BY timestamp DESC
     LIMIT ?`,
    [...params, limit]
  ).map((r) => ({ ...r, bucket: classifyErrorBucket(r.statusCode, r.errorMessage) }));

  return {
    groupBy: ERROR_GROUP_COLUMNS[groupBy] ? groupBy : "provider:model",
    period: { startDate: startIso, endDate: endIso },
    totals: {
      totalRequests,
      totalErrors,
      successRate: totalRequests ? Math.round(((totalRequests - totalErrors) / totalRequests) * 1000) / 10 : 100,
      errorLatencyMs,
    },
    buckets,
    byGroup,
    byDay,
    signatures,
    recent,
  };
}

/**
 * One-shot maintenance: drop oversized historical requestDetails rows and
 * enforce maxRecords. Safe to call repeatedly — no-ops when already healthy.
 * Returns a small summary for logs; never throws to callers.
 */
export async function compactRequestDetails({ force = false } = {}) {
  try {
    const db = await getAdapter();
    const config = await getObservabilityConfig();
    const before = db.get(
      `SELECT COUNT(*) AS c, COALESCE(SUM(LENGTH(data)), 0) AS bytes, COALESCE(MAX(LENGTH(data)), 0) AS maxLen
       FROM requestDetails`,
    ) || { c: 0, bytes: 0, maxLen: 0 };

    // Skip when the table is already within healthy bounds unless forced.
    if (!force && before.c <= config.maxRecords && before.maxLen <= BLOATED_ROW_BYTES) {
      return { skipped: true, ...before };
    }

    let deletedBloated = 0;
    db.transaction(() => {
      const bloated = db.run(
        `DELETE FROM requestDetails WHERE LENGTH(data) > ?`,
        [BLOATED_ROW_BYTES],
      );
      deletedBloated = bloated?.changes || 0;

      const cnt = db.get(`SELECT COUNT(*) as c FROM requestDetails`);
      if (cnt && cnt.c > config.maxRecords) {
        db.run(
          `DELETE FROM requestDetails WHERE id IN (
             SELECT id FROM requestDetails ORDER BY timestamp ASC LIMIT ?
           )`,
          [cnt.c - config.maxRecords],
        );
      }
    });

    // Reclaim freelist pages when a native driver is available. sql.js ignores this.
    try { db.exec?.("VACUUM"); } catch {}
    try { db.checkpoint?.(); } catch {}

    const after = db.get(
      `SELECT COUNT(*) AS c, COALESCE(SUM(LENGTH(data)), 0) AS bytes, COALESCE(MAX(LENGTH(data)), 0) AS maxLen
       FROM requestDetails`,
    ) || { c: 0, bytes: 0, maxLen: 0 };

    return {
      skipped: false,
      deletedBloated,
      before,
      after,
      maxRecords: config.maxRecords,
    };
  } catch (e) {
    console.error("[requestDetailsRepo] compact failed:", e.message);
    return { skipped: true, error: e.message };
  }
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
