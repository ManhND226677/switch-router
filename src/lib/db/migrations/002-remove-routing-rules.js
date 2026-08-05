import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export default {
  version: 2,
  name: "remove-routing-rules",
  up(db) {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    if (!row) return;

    const settings = parseJson(row.data, {});
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) return;

    delete settings.activeRoutingProfile;
    delete settings.routingProfiles;
    db.run(
      `UPDATE settings SET data = ? WHERE id = 1`,
      [stringifyJson(settings)],
    );
  },
};
