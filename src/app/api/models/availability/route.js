import { NextResponse } from "next/server";
import {
  getProviderConnections,
  updateProviderConnection,
} from "@/lib/localDb";

const MODEL_LOCK_PREFIX = "modelLock_";
const ACCOUNT_LOCK_MODEL = "__all";

function getActiveModelLocks(connection) {
  const now = Date.now();
  return Object.entries(connection)
    .filter(([key, value]) => key.startsWith(MODEL_LOCK_PREFIX) && value)
    .map(([key, value]) => {
      const raw = key.slice(MODEL_LOCK_PREFIX.length);
      // modelLock___all → raw is "__all"; modelLock_foo → "foo"
      const model = raw || ACCOUNT_LOCK_MODEL;
      return {
        key,
        model,
        until: value,
        active: new Date(value).getTime() > now,
        accountLevel: model === ACCOUNT_LOCK_MODEL,
      };
    })
    .filter((lock) => lock.active);
}

function issueLabel(model, accountLevel) {
  if (accountLevel || model === ACCOUNT_LOCK_MODEL) return "All models (account)";
  return model;
}

export async function GET() {
  try {
    const connections = await getProviderConnections();
    const models = [];

    for (const connection of connections) {
      const locks = getActiveModelLocks(connection);
      for (const lock of locks) {
        models.push({
          provider: connection.provider,
          model: lock.model,
          label: issueLabel(lock.model, lock.accountLevel),
          scope: lock.accountLevel ? "account" : "model",
          status: "cooldown",
          until: lock.until,
          connectionId: connection.id,
          connectionName: connection.name || connection.email || connection.id,
          lastError: connection.lastError || null,
        });
      }

      // Account marked unavailable with no per-model locks still active
      if (locks.length === 0 && connection.testStatus === "unavailable") {
        models.push({
          provider: connection.provider,
          model: ACCOUNT_LOCK_MODEL,
          label: "All models (account)",
          scope: "account",
          status: "unavailable",
          connectionId: connection.id,
          connectionName: connection.name || connection.email || connection.id,
          lastError: connection.lastError || null,
        });
      }
    }

    const connectionIds = new Set(models.map((m) => m.connectionId).filter(Boolean));

    return NextResponse.json({
      models,
      unavailableCount: models.length,
      affectedConnections: connectionIds.size,
    });
  } catch (error) {
    console.error("[API] Failed to get model availability:", error);
    return NextResponse.json(
      { error: "Failed to fetch model availability" },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { action, provider, model, connectionId } = body || {};

    if (action !== "clearCooldown" || !provider || !model) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider });
    const targets = connectionId
      ? connections.filter((c) => c.id === connectionId)
      : connections;

    const lockKey = `${MODEL_LOCK_PREFIX}${model}`;
    const isAccount = model === ACCOUNT_LOCK_MODEL;

    await Promise.all(
      targets.map(async (connection) => {
        const updates = {};
        let dirty = false;

        // Clear the specific lock key when present
        if (connection[lockKey]) {
          updates[lockKey] = null;
          dirty = true;
        }

        // Account-level unlock: clear every modelLock_* + restore availability
        if (isAccount) {
          for (const key of Object.keys(connection)) {
            if (key.startsWith(MODEL_LOCK_PREFIX) && connection[key]) {
              updates[key] = null;
              dirty = true;
            }
          }
          if (connection.testStatus === "unavailable") {
            updates.testStatus = "active";
            updates.lastError = null;
            updates.lastErrorAt = null;
            updates.backoffLevel = 0;
            dirty = true;
          }
        } else if (connection.testStatus === "unavailable" && connection[lockKey]) {
          updates.testStatus = "active";
          updates.lastError = null;
          updates.lastErrorAt = null;
          updates.backoffLevel = 0;
          dirty = true;
        }

        if (dirty) await updateProviderConnection(connection.id, updates);
      }),
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[API] Failed to clear model cooldown:", error);
    return NextResponse.json(
      { error: "Failed to clear cooldown" },
      { status: 500 },
    );
  }
}
