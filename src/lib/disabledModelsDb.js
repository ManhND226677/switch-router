// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./db/index.js";
