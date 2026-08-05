import { DefaultExecutor } from "./default.js";
import { CAVOTI_CHAT_PATH, resolveCavotiConnectionEndpoint } from "../providers/cavoti.js";

export class CavotiExecutor extends DefaultExecutor {
  constructor() {
    super("cavoti");
  }

  buildUrl(_model, _stream, _urlIndex = 0, credentials = null) {
    return resolveCavotiConnectionEndpoint(credentials, "chat", CAVOTI_CHAT_PATH);
  }
}

export default CavotiExecutor;
