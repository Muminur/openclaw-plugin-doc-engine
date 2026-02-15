# Getting Started

Welcome to OpenClaw, the AI gateway for managing Claude and other LLM providers.

## Installation

Install OpenClaw globally using npm:

```bash
npm install -g openclaw
```

After installation, initialize your configuration:

```bash
openclaw init
```

## Configuration

The main configuration file lives at `~/.openclaw/openclaw.json`. You can edit it directly or use the CLI commands.

### Model Setup

Configure your primary model and fallbacks:

```json
{
  "model": {
    "primary": "google-antigravity/claude-opus-4-6-thinking",
    "fallbacks": ["minimax/MiniMax-M2.1"]
  }
}
```

### Authentication

Add your API keys using the auth command:

```bash
openclaw auth add --provider google-antigravity --key YOUR_KEY
```

## First Steps

Once configured, start the gateway:

```bash
openclaw gateway start
```

You can verify the gateway is running with:

```bash
openclaw gateway status
```
