---
name: switch-router-stt
description: Transcribe audio through Switch-Router using the configured speech-to-text models.
---

# Switch-Router Speech-to-Text

Use the local base URL `http://127.0.0.1:28701`.

## Discover

```bash
curl http://127.0.0.1:28701/v1/models/stt
curl "http://127.0.0.1:28701/v1/models/info?id=provider/stt-model"
```

## Endpoint

`POST /v1/audio/transcriptions` using `multipart/form-data`.

Required fields:

- `model`: model id from `/v1/models/stt`
- `file`: audio file

Optional fields include `language`, `prompt`, `temperature`, and `response_format`. Supported response formats can include `json`, `text`, `verbose_json`, `srt`, and `vtt`, depending on the selected provider.

```bash
curl -X POST http://127.0.0.1:28701/v1/audio/transcriptions \
  -F "model=provider/stt-model" \
  -F "file=@audio.mp3" \
  -F "language=vi"
```

Switch-Router selects the provider account, refreshes credentials when supported, and uses the provider-specific STT adapter. Do not send JSON for this endpoint.
