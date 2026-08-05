---
name: switch-router-web-search
description: Search the web through Switch-Router using the configured search providers and normalized results.
---

# Switch-Router Web Search

Use the local base URL `http://127.0.0.1:28701`.

## Discover

```bash
curl http://127.0.0.1:28701/v1/models/web
curl "http://127.0.0.1:28701/v1/models/info?id=provider/search"
```

## Endpoint

`POST /v1/search`

The request accepts either `model` or `provider`, plus a required `query`.

```bash
curl -X POST http://127.0.0.1:28701/v1/search \
  -H "Content-Type: application/json" \
  -d '{"model":"provider/search","query":"Switch-Router architecture","max_results":5}'
```

Optional fields include `search_type`, `country`, `language`, `time_range`, `domain_filter`, `offset`, and provider-specific options.

The response is normalized with `provider`, `query`, `results`, `answer`, `usage`, `metrics`, and `errors` fields. A configured combo can fallback across search providers.

Provider availability is determined by the local registry and configured credentials. Use `/v1/models/web` as the source of truth.
