---
name: switch-router-image
description: Generate images through Switch-Router using the configured image provider and model registry.
---

# Switch-Router Image Generation

Use the local base URL `http://127.0.0.1:28701`.

## Discover

```bash
curl http://127.0.0.1:28701/v1/models/image
curl "http://127.0.0.1:28701/v1/models/info?id=provider/image-model"
```

## Endpoint

`POST /v1/images/generations`

Required fields:

| Field | Description |
|---|---|
| `model` | Model id from `/v1/models/image` |
| `prompt` | Image description |

Common optional fields include `n`, `size`, `quality`, `style`, and `response_format`. Provider-specific options are accepted when supported by the selected model.

```bash
curl -X POST http://127.0.0.1:28701/v1/images/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"provider/image-model","prompt":"A quiet mountain lake at sunrise","size":"1024x1024"}'
```

The normal response contains an image URL or base64 data. Use `response_format=b64_json` for JSON base64 output or query `?response_format=binary` when raw image bytes are required.

Configured combos can provide image fallback. Local no-auth image providers use their local connection directly; credentialed providers use the configured account and cooldown policy.
