---
name: switch-router-embeddings
description: Generate embeddings through Switch-Router for RAG, semantic search, and similarity workflows.
---

# Switch-Router Embeddings

Use the local base URL `http://127.0.0.1:28701`.

## Discover

```bash
curl http://127.0.0.1:28701/v1/models/embedding
curl "http://127.0.0.1:28701/v1/models/info?id=provider/embedding-model"
```

## Endpoint

`POST /v1/embeddings`

Required fields:

- `model`: model id from `/v1/models/embedding`
- `input`: a string or an array of strings

Optional fields include `encoding_format` (`float` or `base64`) and `dimensions` when supported by the selected model.

```bash
curl -X POST http://127.0.0.1:28701/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{"model":"provider/embedding-model","input":["hello","world"]}'
```

The response is an OpenAI-compatible list containing one embedding per input item and usage metadata. Batch input is generally more efficient, but provider batch limits still apply.
