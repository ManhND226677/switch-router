---
name: switch-router-web-fetch
description: Fetch a public URL through Switch-Router and return normalized Markdown, text, or HTML content.
---

# Switch-Router Web Fetch

Use the local base URL `http://127.0.0.1:28701`.

## Discover

```bash
curl http://127.0.0.1:28701/v1/models/web
curl "http://127.0.0.1:28701/v1/models/info?id=provider/fetch"
```

## Endpoint

`POST /v1/web/fetch`

The request accepts either `model` or `provider`, plus a required public `url`.

```bash
curl -X POST http://127.0.0.1:28701/v1/web/fetch \
  -H "Content-Type: application/json" \
  -d '{"model":"provider/fetch","url":"https://example.com","format":"markdown","max_characters":5000}'
```

Supported formats are `markdown`, `text`, and `html`. `max_characters` limits returned content when supported by the provider.

Switch-Router validates the URL and blocks private, loopback, and metadata targets before making the upstream request. A configured combo can fallback across fetch providers.
