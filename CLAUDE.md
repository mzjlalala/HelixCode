# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```powershell
npm install                  # Install dependencies
npm run dev -- --cwd .       # Start the REPL for local development
npm run build                # Build dist/ via tsup
npm test                     # Run all tests (vitest)
npm run typecheck            # Type check without emitting
```

## Project Overview

HelixCode is a terminal coding agent (CLI binary: `helix`) that uses an OpenAI-compatible chat API with a JSON tool protocol. The REPL accepts natural language, the agent generates tool requests, and the CLI loop confirms risky actions (write file, replace in file, apply patch, run shell) before executing them.

## Architecture

```
main.ts (Commander CLI + readline REPL)
  └─ TerminalAgent (chat history, plan, tool execution loop)
       ├─ ChatProvider (OpenAI-compatible API call)
       ├─ Tool parsing (parseToolRequest from LLM response)
       └─ Tool implementations:
            ├─ filesystem.ts    (read_file, write_file, replace_in_file, list_files, search_files)
            ├─ git.ts           (git_status, git_diff)
            ├─ patch.ts         (apply_patch — git apply wrapper)
            ├─ shell.ts         (run_shell — exec wrapper with destructive command blocking)
            └─ text-diff.ts     (compact unified-diff preview for confirmations)
confirmed-action.ts  (executes confirmed tools + generates previews before confirmation)
slash-commands.ts    (built-in /help, /status, /doctor, /model, /history, /plan, /compact, /tools, /reset, /clear, /exit)
config.ts            (env-based config: HELIX_API_KEY, HELIX_BASE_URL, HELIX_CHAT_MODEL; loads AGENTS.md / .helix/instructions.md)
```

### Key Design Details

- **Two-phase tool execution:** Safe tools (read_file, list_files, search_files, git_status, git_diff, update_plan) auto-execute; risky tools (write_file, replace_in_file, apply_patch, run_shell) pause for user confirmation with a diff preview.
- **Tool request parsing** (`tool-request.ts`): Extracts JSON from three formats in priority order — raw JSON, fenced ` ```json ` code blocks, and balanced `{...}` objects found anywhere in the response.
- **History management:** 80-message hard cap, `/compact` trims to 20 messages, `/reset` clears all.
- **Plan tracking:** In-memory `PlanItem[]` accessed via `update_plan` tool and `/plan` command.
- **Project instructions:** `AGENTS.md` and `.helix/instructions.md` are loaded at startup and injected into the system prompt.
- **Destructive command blocking** (`shell.ts`): Blocks `rm -rf`, `git reset --hard`, `git clean -fd`, `del /s`, `rmdir /s`, `format`, `diskpart` before they reach the shell.
- **Path safety** (`filesystem.ts`): All file operations resolve the target relative to `cwd` and reject paths outside the project root.
- **Config:** Uses environment variables (`HELIX_API_KEY`, `HELIX_BASE_URL`, `HELIX_CHAT_MODEL`), with `OPENAI_API_KEY` as fallback for the key.
- **Only `dist/` is published** (via `files` in package.json). No runtime dep on `tsx` — it's a dev-only tool.

## Tests

```
tests/config.test.ts
tests/tool-request.test.ts
tests/confirmed-action.test.ts
tests/agent.test.ts
tests/tools.test.ts
tests/cli.test.ts
```

Vitest with `restoreMocks: true, clearMocks: true` (mocks auto-reset between tests). Tests use `node` environment.
