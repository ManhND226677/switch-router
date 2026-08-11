import { GOOGLE_OAUTH_CLIENT } from "../shared.js";

export default {
  id: "gemini",
  priority: 50,
  hasFree: true,
  alias: "gemini",
  display: {
    name: "Gemini",
    icon: "diamond",
    color: "#4285F4",
    textIcon: "GE",
    website: "https://ai.google.dev",
    notice: {
      apiKeyUrl: "https://aistudio.google.com/app/apikey",
    },
  },
  category: "freeTier",
  mediaPriority: 1,
  transport: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models",
    format: "gemini",
    clientId: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com",
    clientSecret: "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",
    auth: {
      apiKey: {
        header: "x-goog-api-key",
        scheme: "raw",
      },
      oauth: {
        header: "Authorization",
        scheme: "bearer",
      },
    },
  },
  models: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    { id: "gemma-4-31b-it", name: "Gemma 4 31B IT" },
  ],
  serviceKinds: ["llm"],
};
