import { PROVIDER_MEDIA } from "../../providers/index.js";
import { resolveStepFunEndpoints } from "../../providers/stepfun.js";

const imageConfig = PROVIDER_MEDIA.stepfun?.imageConfig || {};

const JSON_FIELDS = [
  "model",
  "prompt",
  "size",
  "n",
  "response_format",
  "seed",
  "steps",
  "cfg_scale",
  "negative_prompt",
  "text_mode",
];

const FORM_FIELDS = JSON_FIELDS.filter((field) => field !== "model");

function appendFormValue(form, key, value) {
  if (value === undefined || value === null || value === "") return;
  form.append(key, typeof value === "boolean" ? String(value) : String(value));
}

export default {
  supportsEdit: true,
  buildUrl: (_model, credentials, body) => {
    const endpoints = resolveStepFunEndpoints(credentials);
    return body?.image ? endpoints.imageEdits : endpoints.images;
  },
  buildHeaders: (credentials, requestBody) => {
    const token = credentials?.apiKey || credentials?.accessToken;
    const headers = {};
    if (!(typeof FormData !== "undefined" && requestBody instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  },
  buildBody: (model, body) => {
    if (body?.image) {
      const form = new FormData();
      form.append("model", model || imageConfig.defaultModel);
      const image = body.image;
      form.append("image", image, image.name || "image");
      appendFormValue(form, "prompt", body.prompt);
      for (const field of FORM_FIELDS) appendFormValue(form, field, body[field]);
      return form;
    }

    const request = {};
    for (const field of JSON_FIELDS) {
      const value = field === "model" ? model || imageConfig.defaultModel : body?.[field];
      if (value !== undefined && value !== null && value !== "") request[field] = value;
    }
    return request;
  },
  normalize: (responseBody) => responseBody,
};
