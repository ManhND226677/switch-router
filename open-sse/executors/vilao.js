import { DefaultExecutor } from "./default.js";
import { resolveVilaoConnectionEndpoint, VILAO_CHAT_PATH } from "../providers/vilao.js";

export class VilaoExecutor extends DefaultExecutor {
  constructor() {
    super("vilao");
  }

  // ViLao is a P2P marketplace: the gateway host is NOT guaranteed to be
  // identical for every key, so a per-key override (providerSpecificData.baseUrl)
  // wins over the default gateway. Same resolution as models/validate so the
  // call sites cannot drift.
  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    return resolveVilaoConnectionEndpoint(credentials, VILAO_CHAT_PATH);
  }
}
