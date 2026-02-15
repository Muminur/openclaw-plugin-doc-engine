# Configuration Reference

Complete reference for OpenClaw configuration options.

## Gateway Settings

The gateway binds to `127.0.0.1:18789` by default.

### Binding

```json
{
  "gateway": {
    "host": "127.0.0.1",
    "port": 18789
  }
}
```

### Logging

Logs are written to `/tmp/openclaw/openclaw-YYYY-MM-DD.log`.

```json
{
  "logging": {
    "level": "info",
    "directory": "/tmp/openclaw"
  }
}
```

## Model Configuration

### Primary Model

The primary model is the first model attempted for each request.

### Fallback Chain

Fallbacks are tried in order when the primary model fails. Each fallback must be a plain model ID.

```json
{
  "model": {
    "primary": "google-antigravity/claude-opus-4-6-thinking",
    "fallbacks": [
      "minimax/MiniMax-M2.1",
      "openai-codex/gpt-5.2"
    ]
  }
}
```

## Plugin Configuration

Plugins extend gateway functionality. Configure them in the `plugins` section:

```json
{
  "plugins": {
    "entries": {
      "doc-engine": {
        "enabled": true,
        "config": {
          "repositories": [],
          "chunkMaxTokens": 800
        }
      }
    }
  }
}
```

## Security

### Secret Patterns

Configure regex patterns to automatically redact secrets from indexed content:

```json
{
  "secretPatterns": [
    "sk-[a-zA-Z0-9]{20,}",
    "ghp_[a-zA-Z0-9]{36}"
  ]
}
```
