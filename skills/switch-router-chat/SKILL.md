---
name: switch-router-chat
description: Chat and code generation through Switch-Router using OpenAI or Anthropic request formats, with model routing, fallback, tools, and streaming.
---

# Switch-Router Chat

Set `SWITCH_ROUTER_URL` to `http://127.0.0.1:28701` by default. API-key headers are optional unless local API-key enforcement is enabled.

## Endpoints

- `POST /v1/chat/completions` accepts OpenAI-compatible requests.
- `POST /v1/messages` accepts Anthropic-compatible requests.

## Discover a model

```bash
curl http://127.0.0.1:28701/v1/models
curl "http://127.0.0.1:28701/v1/models/info?id=provider/model"
```

Use a model id returned by the local server, or use a configured combo name.

## OpenAI request

```bash
curl -X POST http://127.0.0.1:28701/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"provider/model","messages":[{"role":"user","content":"Hello"}],"stream":false}'
```

When API-key enforcement is enabled, add:

```text
Authorization: Bearer <SWITCH_ROUTER_KEY>
```

The response is OpenAI-compatible. With `stream: true`, the response is Server-Sent Events and ends with `data: [DONE]`.

## Anthropic request

```bash
curl -X POST http://127.0.0.1:28701/v1/messages \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"provider/model","max_tokens":1024,"messages":[{"role":"user","content":"Hello"}]}'
```

Switch-Router detects the client format, translates the request for the selected provider, then translates the provider response back to the client format. Tool calls, thinking/reasoning fields, multimodal content, and usage are handled by the existing translation and chat-core layers.

## Model selection and fallback

- A combo name runs its configured model order and fallback strategy.
- Account fallback only occurs for statuses classified as recoverable by the routing policy.
- Streaming requests keep the response as SSE; non-streaming requests return JSON.

No CLI launcher is required. Point any local OpenAI or Anthropic client at Switch-Router instead.
