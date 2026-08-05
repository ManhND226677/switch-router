---
name: switch-router
description: Entry skill for Switch-Router, a local single-user AI gateway with OpenAI-compatible APIs, provider switching, model routing, combos, and fallback.
---

# Switch-Router

Switch-Router is a local Web gateway. It keeps one client endpoint while routing requests to the configured AI providers and accounts.

## Connection

Default local URL:

```bash
export SWITCH_ROUTER_URL="http://127.0.0.1:28701"
export SWITCH_ROUTER_KEY=""
```

The API key is only needed when `requireApiKey` is enabled in the local settings.

All requests use `${SWITCH_ROUTER_URL}/v1/...`. Add `Authorization: Bearer ${SWITCH_ROUTER_KEY}` only when an API key is configured.

Verify the local server:

```bash
curl http://127.0.0.1:28701/api/health
```

## Discover models

```bash
curl http://127.0.0.1:28701/v1/models
curl http://127.0.0.1:28701/v1/models/image
curl http://127.0.0.1:28701/v1/models/video
curl http://127.0.0.1:28701/v1/models/tts
curl http://127.0.0.1:28701/v1/models/stt
curl http://127.0.0.1:28701/v1/models/embedding
curl http://127.0.0.1:28701/v1/models/image-to-text
curl http://127.0.0.1:28701/v1/models/web
curl "http://127.0.0.1:28701/v1/models/info?id=provider/model"
```

Use a returned `data[].id` as the request `model`. Provider availability and model names come from the local provider registry and configured connections; do not assume a provider is enabled until it appears in the model list.

## Capabilities

| Capability | Endpoint |
|---|---|
| Chat and code generation | `POST /v1/chat/completions` |
| Anthropic messages | `POST /v1/messages` |
| Image generation | `POST /v1/images/generations` |
| Video jobs | `POST /v1/videos/generations`, `GET /v1/videos/{request_id}` |
| Text-to-speech | `POST /v1/audio/speech` |
| Speech-to-text | `POST /v1/audio/transcriptions` |
| Embeddings | `POST /v1/embeddings` |
| Web search | `POST /v1/search` |
| Web fetch | `POST /v1/web/fetch` |

Read the capability skill that matches the task before constructing a request.

## Model selection and fallback

- `provider/model` selects a provider model directly.
- A configured combo name selects an ordered group of models with fallback or round-robin behavior.
- Provider account fallback happens when the configured failure policy allows it.
- The router refreshes supported OAuth credentials and records usage locally.
- Video creation is account-bound and must be polled with the returned connection id.

This is a local Web workflow. No CLI launcher, remote dashboard, tunnel, or external installation is required.

## Common errors

- `401`: provide the configured API key or disable API-key enforcement for trusted loopback use.
- `400 Invalid model format`: use an id returned by `/v1/models` or a configured combo name.
- `404 No active credentials`: connect or enable the provider account in the dashboard.
- `503 All accounts unavailable`: inspect quota, cooldown, provider status, or fallback configuration.
