---
name: switch-router-tts
description: Convert text to speech through Switch-Router and the configured voice providers.
---

# Switch-Router Text-to-Speech

Use `http://127.0.0.1:28701` as the local base URL. API-key headers are optional unless enabled in local settings.

## Discover models and voices

```bash
curl http://127.0.0.1:28701/v1/models/tts
curl "http://127.0.0.1:28701/v1/models/info?id=provider/voice-or-model"
curl "http://127.0.0.1:28701/v1/audio/voices?provider=edge-tts&lang=vi"
```

## Endpoint

`POST /v1/audio/speech`

Required fields:

- `model`: voice or TTS model id from `/v1/models/tts`
- `input`: text to speak

```bash
curl -X POST http://127.0.0.1:28701/v1/audio/speech \
  -H "Content-Type: application/json" \
  -d '{"model":"provider/voice-or-model","input":"Xin chao"}' \
  --output speech.mp3
```

The default response is audio bytes. Use `?response_format=json` for a JSON object containing base64 audio and its format.

Voice ids and provider options vary. Always use the local model and voice discovery endpoints instead of assuming a provider or voice exists.
