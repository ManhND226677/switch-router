---
name: switch-router-video
description: Create, edit, extend, and poll asynchronous video jobs through Switch-Router.
---

# Switch-Router Video

The current video adapter targets the configured xAI video connection. Use the local base URL `http://127.0.0.1:28701`.

## Discover

```bash
curl http://127.0.0.1:28701/v1/models/video
```

The current model is normally exposed as `xai/grok-imagine-video` when the xAI connection is available.

## Create a job

```bash
curl -i -X POST http://127.0.0.1:28701/v1/videos/generations \
  -H "Content-Type: application/json" \
  -d '{"model":"xai/grok-imagine-video","prompt":"A cinematic tracking shot through a neon city","duration":8,"aspect_ratio":"16:9","resolution":"720p"}'
```

The response contains a `request_id` and `x-switch-router-connection-id`; keep that value for polling.

## Poll the job

```bash
curl http://127.0.0.1:28701/v1/videos/<request_id> \
  -H "x-connection-id: <connection-id>"
```

Poll until the response reports `done` or `failed`. A completed job contains `video.url`.

Other endpoints:

- `POST /v1/videos/edits`
- `POST /v1/videos/extensions`
- `GET /v1/videos/{request_id}`

Video jobs are account-bound. Creation is not freely retried because a retry could create and bill a second job. Combos are not supported for video generation.

There is no CLI-only video command in Switch-Router. Use the Web API above.
