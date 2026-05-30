# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
npm install                  # Install dependencies
npm run dev -- --cwd .       # Start the REPL for local development
npm run build                # Build dist/ via tsup (esm format)
npm test                    # Run all tests (vitest run)
npm run typecheck            # Full type check via tsc --noEmit
npm run prepack              # Build before npm publish
npx tsx src/cli/main.ts --doctor  # Diagnostics without API key

# Single-file test
npx vitest run tests/agent.test.ts
# Filtered test
npx vitest run tests/tools.test.ts -t "shell safety"
```

## Project Overview

HelixCode is a terminal coding agent (CLI binary: `helix`) that uses an OpenAI-compatible chat API with a custom JSON tool protocol (not native function calling). The REPL accepts natural language, the agent generates tool requests in JSON, safe tools auto-execute, and risky actions pause for user confirmation.

## Architecture

```
src/index.ts                          # Library entry: exports TerminalAgent + loadConfig
src/cli/main.ts                       # Commander CLI + readline REPL, also a library entry
  └─ src/cli/slash-commands.ts        # /help, /status, /doctor, /model, /history, /plan, /compact, /tools, /reset, /clear, /exit
  └─ src/core/config.ts               # Env-driven config: HELIX_API_KEY, HELIX_PROVIDER, HELIX_BASE_URL, HELIX_CHAT_MODEL
  └─ src/agent/terminal-agent.ts      # Chat history, plan, 6-turn tool execution loop
       ├─ src/agent/tool-request.ts   # parseToolRequest: raw JSON → fenced block → balanced {...}
       ├─ src/agent/confirmed-action.ts # Preview generation + confirmed tool execution dispatch
       ├─ src/llm/types.ts            # ChatMessage + ChatProvider interface
       ├─ src/llm/openai-provider.ts  # OpenAI SDK wrapper (temperature 0.2)
       └─ Tool implementations:
            ├─ src/tools/filesystem.ts  # read/write/replace/edit/list/search, path-safety check
            ├─ src/tools/git.ts         # git_status, git_diff
            ├─ src/tools/patch.ts       # apply_patch via `git apply` with path-safety check
            ├─ src/tools/shell.ts       # run_shell + destructive-command blocking
            └─ src/tools/text-diff.ts   # Compact unified-diff preview for confirmation UI
```

### Key Design Details

- **Tool protocol:** The agent replies with a JSON object like `{"tool":"read_file","args":{"path":"README.md"}}` — no native model tool calling. If no tool is requested, the text response is returned as a final answer. Parsing tries three formats in priority: raw JSON, ` ```json ` fenced blocks, and balanced `{...}` objects anywhere in the response.

- **Two-phase execution:** Safe tools (read_file, list_files, search_files, git_status, git_diff, update_plan) execute inline in the agent loop. Risky tools (write_file, replace_in_file, edit_file, apply_patch, run_shell) pause execution and return an `AgentTurnResult` discriminated union (`{type:'confirmation'}` or `{type:'final'}`). The CLI handles the confirmation/rejection UI loop; the agent is notified via `continueAfterConfirmation`.

- **Six-turn loop:** The agent gets up to 6 tool rounds per `run()` call. Each non-confirmable tool appends a tool observation message and loops back. Exceeding 6 turns returns a "too many tool rounds" final message. Confirmation always terminates the turn immediately (the UI loop continues outside).

- **Config:** Environment variables only (supports `HELIX_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`). Provider auto-detection: `HELIX_PROVIDER=deepseek|openai|custom`, or falls back to `openai` (also auto-detects deepseek from `HELIX_BASE_URL` if it contains `deepseek.com`). Default models: `gpt-4o` (openai), `deepseek-chat` (deepseek). `HELIX_CHAT_MODEL` overrides; `HELIX_MODEL` is a secondary fallback. `HELIX_BASE_URL` for custom endpoints.

- **Project instructions:** `AGENTS.md` and `.helix/instructions.md` at the project root are loaded at startup and appended to the system prompt. Both files are optional.

- **History management:** 80-message hard cap in the history array. `/compact` splices to 20 messages (configurable). `/reset` clears all. Plan state is in-memory only and survives compact/reset.

- **Plan tracking:** In-memory `PlanItem[]` with status pending/in_progress/completed, managed via the `update_plan` tool. Exposed via `/plan` command and `currentPlan()` getter.

- **Path safety** (filesystem.ts): All file ops resolve relative to `cwd` via `resolveInsideProject` — rejects any path that escapes the project root (relative `..`, absolute paths).

- **Patch safety** (patch.ts): Scans `diff --git`, `---`, `+++` header lines for absolute paths, Windows drive letters, backslashes, or `..` segments — rejects unsafe patches before calling `git apply`.

- **Shell blocking** (shell.ts): Destructive commands (`rm -rf`, `git reset --hard`, `git clean -fd`, `del /s`, `rmdir /s`, `format`, `diskpart`) are blocked server-side before reaching the shell.

- **File editing tools:** Four variants — `write_file` (full content replace), `replace_in_file` (exact text match with optional `replaceAll`), `edit_file` (inclusive line range replacement), `apply_patch` (unified diff via `git apply`).

- **Preview pipeline** (confirmed-action.ts): Before confirmation, each risky tool produces a text preview. `write_file`/`replace_in_file`/`edit_file` use `createCompactTextDiff` (prefix/suffix trim + `-`/`+` diff). `apply_patch` shows the first 40 lines of the patch. `run_shell` shows command + risk classification.

- **One-shot mode** (`--yes`, `--max-turns <N>`): Non-interactive mode that auto-confirms up to N turns, then prints a git summary. Also supports piping REPL lines via stdin (non-TTY mode).

- **CLI binary:** Published as `helix` via `"bin"` in package.json. Only `dist/` is shipped. `src/cli/main.ts` doubles as CLI entry and library entry via the `isMainModule` guard.

- **Language:** The project uses a mix of Chinese and English in commit messages and tool definitions (e.g., `HELIX_*` env vars). Code identifiers and comments are in English.

## Tests

```
tests/config.test.ts          # Config loading and env var resolution
tests/tool-request.test.ts    # JSON tool request parsing
tests/confirmed-action.test.ts # Preview generation for each tool type
tests/agent.test.ts           # TerminalAgent: system prompt, safe tools, confirmation flow, plan, history
tests/tools.test.ts           # filesystem, patch, shell safety unit tests
tests/cli.test.ts             # CLI flags, one-shot mode, REPL flow
tests/openai-provider.test.ts # OpenAI provider
```

- Vitest with `restoreMocks: true, clearMocks: true` (mocks auto-reset between tests). Tests use `node` environment.
- **Testing pattern:** Tests use real tmpdir fixtures (`mkdtemp` + `writeFile`) rather than mocking filesystem state. The `ScriptedProvider` class (agent.test.ts) simulates LLM responses by returning pre-written JSON tool calls and text replies in sequence. Tests assert both agent behavior (what tool was requested) and filesystem outcomes (file was written correctly).
- No `__mocks__` directory — mocking is inline and minimal.
