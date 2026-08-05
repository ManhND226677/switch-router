# Switch-Router Agent Skills

These Markdown files describe the local Switch-Router API for AI agents. They are local documentation, not executable plugins.

Default local server:

```text
http://127.0.0.1:28701
```

## Canonical skills

| Skill | Endpoint |
|---|---|
| `switch-router` | Setup and capability index |
| `switch-router-chat` | `/v1/chat/completions`, `/v1/messages` |
| `switch-router-image` | `/v1/images/generations` |
| `switch-router-video` | `/v1/videos/*` |
| `switch-router-tts` | `/v1/audio/speech` |
| `switch-router-stt` | `/v1/audio/transcriptions` |
| `switch-router-embeddings` | `/v1/embeddings` |
| `switch-router-web-search` | `/v1/search` |
| `switch-router-web-fetch` | `/v1/web/fetch` |

For a local agent, read a skill from:

```text
http://127.0.0.1:28701/api/skills/<skill-id>
```

The Dashboard Skills page can copy either the local URL or the complete Markdown content. Copying the content is useful for agents that cannot access localhost.

## Compatibility

The old ids `9router`, `9router-chat`, and the other `9router-*` ids are API-level aliases for the canonical Switch-Router documents. They do not have separate legacy skill files. The client environment names `NINEROUTER_URL` and `NINEROUTER_KEY` remain accepted while integrations migrate to `SWITCH_ROUTER_URL` and `SWITCH_ROUTER_KEY`.

No remote dashboard, tunnel, CLI launcher, or GitHub connection is required to use these skills.
