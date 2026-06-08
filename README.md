# HelixCode

**HelixCode** is a terminal AI coding agent. Run `helix` in any project directory, describe what you want in natural language, and it inspects files, searches code, edits source, runs commands, and manages git — all with user confirmation for risky actions.

```
        ╭─╮       ╭─╮
       ╱   ╲     ╱   ╲
      ╱     ╲   ╱     ╲
      ╲     ╱   ╲     ╱
       ╲   ╱     ╲   ╱
        ╰─╯       ╰─╯

      H E L I X C O D E
  AI Software Engineering Agent
```

Powered by OpenAI-compatible APIs with native tool calling, streaming output, and DeepSeek reasoning mode support.

---

## Quick Start

```bash
# Install globally
npm install -g helixcode

# Or run from source
git clone https://github.com/mzjlalala/HelixCode.git
cd HelixCode
npm install
npm run build
npm install -g .
```

Set your API key and start the REPL:

```bash
export HELIX_PROVIDER=openai
export OPENAI_API_KEY=sk-your-key-here
helix
```

## Requirements

- **Node.js 20+**
- An **OpenAI-compatible API key** (OpenAI, DeepSeek, or custom provider)

## Configuration

HelixCode reads configuration from multiple sources (priority: CLI flag > env var > config file > default).

### 1. Environment variables

Copy `.env.example` to `.env` or set them directly.

| Variable | Description | Required |
|----------|-------------|:--------:|
| `HELIX_API_KEY` | Universal API key | At least one |
| `OPENAI_API_KEY` | OpenAI-specific key | |
| `DEEPSEEK_API_KEY` | DeepSeek-specific key | |
| `HELIX_PROVIDER` | Provider: `openai`, `deepseek`, or `custom` | |
| `HELIX_CHAT_MODEL` | Model override (default: `gpt-4o` / `deepseek-chat`) | |
| `HELIX_BASE_URL` | API base URL override | |

#### OpenAI

```bash
export HELIX_PROVIDER=openai
export OPENAI_API_KEY=sk-your-openai-key
export HELIX_CHAT_MODEL=gpt-4o
```

#### DeepSeek (with thinking/reasoning)

```bash
export HELIX_PROVIDER=deepseek
export DEEPSEEK_API_KEY=sk-your-deepseek-key
export HELIX_CHAT_MODEL=deepseek-v4-pro
```

DeepSeek thinking mode is automatically enabled. `reasoning_content` is captured and returned in subsequent requests as required by the API.

Copy `helix.config.example.json` to `.helix/config.json` to set per-model context limits (e.g. `deepseek-v4-pro` → 1M tokens).

#### Custom OpenAI-compatible endpoint

```bash
export HELIX_PROVIDER=custom
export HELIX_API_KEY=your-api-key
export HELIX_BASE_URL=https://your-provider.example/v1
export HELIX_CHAT_MODEL=your-model
```

### 2. Config file (`.helix/config.json`)

Create `.helix/config.json` in your project root to persist settings (see `helix.config.example.json`):

```json
{
  "model": "deepseek-v4-pro",
  "permissionMode": "auto",
  "instructions": ["CUSTOM.md"],
  "modelContextLimits": {
    "deepseek-v4-pro": 1000000,
    "gpt-4o": 128000
  },
  "contextTokenLimit": 128000,
  "maxHistoryMessages": 80,
  "compactKeepMessages": 20
}
```

| Field | Description |
|-------|-------------|
| `model` | Default model (overridden by env var `HELIX_CHAT_MODEL` or `--model`) |
| `permissionMode` | Permission mode: `default`, `acceptEdits`, `plan`, or `auto` |
| `instructions` | Additional project instruction file paths |
| `modelContextLimits` | Per-model context window (tokens); used by `/status` and `/model` |
| `contextTokenLimit` | Fallback context limit when model is not in `modelContextLimits` |
| `maxHistoryMessages` | In-memory and persisted history cap (default 80) |
| `compactKeepMessages` | Default keep count for `/compact N` (message mode) |

The permission mode is **automatically saved** when you change it with Shift+Tab or `/mode`.

### Web search (optional)

Set `HELIX_BING_API_KEY` in `.env` for reliable `web_search` results via the Bing Web Search API. Without it, HelixCode falls back to HTML scraping (less stable).

### 3. CLI flags

```bash
helix --model gpt-4o-mini    # Override model for this session
helix --mode edit              # Start in acceptEdits mode
```

---

## Usage

### Interactive REPL

```bash
helix
```

### One-shot mode

```bash
helix "explain this project"
helix --model gpt-4o-mini "find all TODO comments"
helix --yes --max-turns 10 "fix the failing tests"
```

### CLI flags

| Flag | Description |
|------|-------------|
| `-C, --cwd <path>` | Project directory |
| `--doctor` | Show diagnostics and exit |
| `-y, --yes` | Auto-confirm actions in one-shot mode |
| `--max-turns <N>` | Max auto-confirm turns (default: 10) |
| `--model <name>` | Override chat model |
| `--mode <name>` | Permission mode: `default`, `edit`, `plan`, `auto` |

### Slash commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/status` | Show project, model, session state, and context usage (`API` / `est.`) |
| `/doctor` | Show full diagnostics |
| `/model` | Show current model |
| `/model <name>` | Switch model (updates context limit from config) |
| `/mode` | Cycle permission mode (default/edit/plan/auto) |
| `/undo` | Undo the last file modification |
| `/history` | Show history message count |
| `/history search <keyword>` | Search conversation history |
| `/history save` | Manually save history to disk |
| `/plan` | Show session plan |
| `/compact` | Compact history to ~50% of context limit (token-aware) |
| `/compact N` | Compact to N messages |
| `/compact 40k` | Compact to ~40k estimated history tokens |
| `/tools` | List available tools |
| `/reset` | Clear session context |
| `/clear` | Clear screen and context |
| `/exit`, `/quit`, `/q` | Exit HelixCode |

---

## Architecture

HelixCode uses **native OpenAI tool calling** (`tools` parameter + `tool_calls` response) to drive an agent loop. The agent can make up to 6 tool calls per turn.

### Tools

| Tool | Auto-execute | Description |
|------|:---:|-------------|
| `read_file` | ✅ | Read file by path, optionally by line range |
| `list_files` | ✅ | List project files |
| `search_files` | ✅ | Search text with glob/context/limit |
| `git_status` | ✅ | Git working tree status |
| `git_diff` | ✅ | Git diff (unstaged) |
| `update_plan` | ✅ | Track multi-step plan |
| `web_search` | ✅ | Search the web (Bing API with `HELIX_BING_API_KEY`, HTML fallback) |
| `web_fetch` | ✅ | Fetch and extract text from a URL |
| `write_file` | — | Write file (confirmed) |
| `replace_in_file` | — | Replace exact text (confirmed) |
| `edit_file` | — | Replace line range (confirmed) |
| `apply_patch` | — | Apply unified diff (confirmed) |
| `run_shell` | — | Run shell command (confirmed) |

**Safety**: Destructive commands (`rm -rf`, `git reset --hard`, etc.) are blocked server-side. Shell commands have a 120s timeout. File paths are checked against project root traversal.

### Project instructions

Place `AGENTS.md` or `.helix/instructions.md` at the project root to inject custom instructions into the agent's system prompt.

---

## Features

- **Streaming output** — tokens appear in real-time as the model generates them
- **Native tool calling** — uses OpenAI-compatible `tools`/`tool_calls` protocol
- **DeepSeek reasoning** — automatic thinking mode with `reasoning_content` preservation
- **Web search & fetch** — search the web via Bing (`web_search`) and fetch URLs (`web_fetch`), no API key required for either
- **Permission modes** — cycle via Shift+Tab: `default` (ask each), `edit` (auto file edits), `plan` (read-only), `auto` (all auto). Persisted to config file
- **Session persistence** — conversation history auto-saves to `.helix/history.json` and restores on next launch
- **Undo** — `/undo` reverts the last file modification (write, edit, replace, patch)
- **History search** — `/history search <keyword>` finds past messages
- **Styled terminal UI** — colored output, mode-aware prompt, inline diffs
- **Confirmation flow** — safe tools auto-execute, risky tools show a diff preview
- **Ctrl+C cancellation** — interrupt LLM calls or running tools mid-execution
- **Runtime model switching** — change model mid-session with `/model <name>`

---

## Development

```bash
npm install                 # Install dependencies
npm run dev -- --cwd .      # Start REPL from source
npm test                    # Run tests (90 tests)
npm run typecheck           # Full type check
npm run build               # Build dist/ via tsup
```

### Validation

```bash
npm run typecheck
npm test
npm run build
npx tsx src/cli/main.ts --help
npx tsx src/cli/main.ts --doctor
```

---

## License

[Apache-2.0](LICENSE) — Copyright 2025 Mason
