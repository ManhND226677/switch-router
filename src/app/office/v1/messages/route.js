import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import {
  officeOptionsResponse,
  requireOfficeGatewayAccess,
  withOfficeCors,
} from "../_shared.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export async function OPTIONS(request) {
  return await officeOptionsResponse(request);
}

/**
 * POST /office/v1/messages - isolated Claude Messages API for Claude for M365.
 */
export async function POST(request) {
  const accessError = await requireOfficeGatewayAccess(request);
  if (accessError) return accessError;

  await ensureInitialized();
  return withOfficeCors(await handleChat(request), request);
}
