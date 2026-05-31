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

HelixCode reads configuration from environment variables. Copy `.env.example` to `.env` or set them directly.

### OpenAI

```bash
export HELIX_PROVIDER=openai
export OPENAI_API_KEY=sk-your-openai-key
export HELIX_CHAT_MODEL=gpt-4o
```

### DeepSeek (with thinking/reasoning)

```bash
export HELIX_PROVIDER=deepseek
export DEEPSEEK_API_KEY=sk-your-deepseek-key
export HELIX_CHAT_MODEL=deepseek-chat
```

DeepSeek thinking mode is automatically enabled. `reasoning_content` is captured and returned in subsequent requests as required by the API.

### Custom OpenAI-compatible endpoint

```bash
export HELIX_PROVIDER=custom
export HELIX_API_KEY=your-api-key
export HELIX_BASE_URL=https://your-provider.example/v1
export HELIX_CHAT_MODEL=your-model
```

### Environment variables reference

| Variable | Description |
|----------|-------------|
| `HELIX_PROVIDER` | Provider: `openai`, `deepseek`, or `custom` |
| `HELIX_API_KEY` | Universal API key (fallback) |
| `OPENAI_API_KEY` | OpenAI-specific key |
| `DEEPSEEK_API_KEY` | DeepSeek-specific key |
| `HELIX_CHAT_MODEL` | Model override (default: `gpt-4o` / `deepseek-chat`) |
| `HELIX_BASE_URL` | API base URL override |

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

### Slash commands

| Command | Description |
|---------|-------------|
| `/help` | Show help |
| `/status` | Show project, model, and session state |
| `/doctor` | Show full diagnostics |
| `/model` | Show current model |
| `/model <name>` | Switch model at runtime |
| `/history` | Show history message count |
| `/plan` | Show session plan |
| `/compact` | Compact session history |
| `/compact N` | Compact to N messages |
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
- **Styled terminal UI** — colored output, symbols, confirmation previews with diffs
- **Confirmation flow** — safe tools auto-execute, risky tools show a preview before proceeding
- **Ctrl+C cancellation** — interrupt an in-progress LLM call without exiting the REPL
- **Runtime model switching** — change the model mid-session with `/model <name>`

---

## Development

```bash
npm install                 # Install dependencies
npm run dev -- --cwd .      # Start REPL from source
npm test                    # Run tests (61 tests)
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
