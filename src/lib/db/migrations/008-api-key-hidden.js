// 008: Mark internal API keys hidden from dashboard/API key pickers.
// Existing keys remain visible (0/default); hidden keys are still valid for
// gateway enforcement and internal model probes.

const migration = {
  version: 8,
  name: "api-key-hidden",
  up(db) {
    const cols = db.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    if (!cols.includes("isHidden")) {
      db.run(`ALTER TABLE apiKeys ADD COLUMN isHidden INTEGER DEFAULT 0`);
    }
  },
};

export default migration;
