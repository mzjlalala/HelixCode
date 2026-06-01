# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
npm install                  # Install dependencies
npm run dev -- --cwd .       # Start the REPL for local development
npm run build                # Build dist/ via tsup (esm format)
npm test                     # Run all tests (vitest run)
npm run typecheck            # Full type check via tsc --noEmit
npm run prepack              # Build before npm publish
npx tsx src/cli/main.ts --doctor  # Diagnostics without API key

# Single-file test
npx vitest run tests/agent.test.ts
# Filtered test
npx vitest run tests/tools.test.ts -t "shell safety"
```

## Project Overview

HelixCode is a terminal coding agent (CLI binary: `helix`) that uses an OpenAI-compatible chat API with **native tool calling** (`tools` / `tool_calls`). Safe tools auto-execute; risky tools pause for user confirmation. A legacy JSON tool protocol fallback exists for models without native tool support.

## Architecture

```
src/index.ts                          # Library entry: exports TerminalAgent + loadConfig
src/cli/main.ts                       # Commander CLI + readline REPL
  └─ src/cli/slash-commands.ts        # /help, /status, /model, /plan, /compact, /tools, ...
  └─ src/core/config.ts               # Env + .helix/config.json (model, permissionMode, session limits)
  └─ src/core/constants.ts            # Shared limits (history, tool rounds, search)
  └─ src/core/history-store.ts        # .helix/history.json persistence
  └─ src/core/plan-store.ts           # .helix/plan.json persistence
  └─ src/agent/terminal-agent.ts      # Agent loop, parallel safe tools, configurable rounds
       ├─ src/agent/tool-request.ts   # Legacy JSON tool parsing fallback
       ├─ src/agent/confirmed-action.ts # Confirmation preview/execute via ToolRegistry
       ├─ src/tools/registry.ts       # Central tool definitions + handlers
       ├─ src/llm/openai-provider.ts  # Unified fetch-based OpenAI-compatible provider
       └─ src/tools/                   # filesystem, git, patch, shell, web, undo, text-diff
```

### Key Design Details

- **Tool protocol:** Primary path is OpenAI native `tool_calls`. Legacy fallback parses JSON like `{"tool":"read_file","args":{...}}` from text responses.

- **ToolRegistry:** All tool definitions, safe execution, confirmed execution, and previews live in `src/tools/registry.ts`. `TerminalAgent` and the CLI confirmation UI share the same registry instance via `agent.getToolRegistry()`.

- **Two-phase execution:** Safe tools execute inline (parallel when batched). Confirmed tools return `{type:'confirmation'}`; CLI handles approval via `continueAfterConfirmation`.

- **Session limits** (`.helix/config.json` or defaults in `constants.ts`):
  - `maxToolRounds` (default 6) — overridable via `--max-tool-rounds`
  - `maxHistoryMessages` (default 80) — in-memory and on-disk cap
  - `compactKeepMessages` (default 20)

- **Persistence:** History → `.helix/history.json`, Plan → `.helix/plan.json`, Undo stack → `.helix/undo-stack.json`, backups → `.helix/undo/`

- **search_files:** Prefers `rg` when available; falls back to in-memory walk with ignore dirs, binary skip, and 512KB file cap.

- **web_search:** Bing API when `HELIX_BING_API_KEY` is set; otherwise HTML scraping with layered parsers.

- **web_fetch:** Blocks private/localhost URLs (SSRF guard).

## Tests

Vitest with real tmpdir fixtures. `ScriptedProvider` in `agent.test.ts` simulates LLM responses. No `__mocks__` directory.
