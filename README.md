# HelixCode

HelixCode is a terminal coding agent inspired by Claude Code. Run `helix` in a repository, describe the work in natural language, and let the agent inspect files, search code, review git state, write files, apply patches, and request confirmation for risky actions.

## Requirements

- Node.js 20+
- An OpenAI-compatible API key

## Configuration

Set these environment variables:

```powershell
$env:HELIX_API_KEY="your-api-key"
$env:HELIX_BASE_URL="https://api.openai.com/v1"
$env:HELIX_CHAT_MODEL="gpt-4o"
```

`OPENAI_API_KEY` is also accepted as a fallback for `HELIX_API_KEY`.

## Development

```powershell
npm install
npm run dev -- --cwd .
npm test
npm run typecheck
npm run build
```

## Run

```powershell
helix
```

For local development without installing the CLI globally:

```powershell
npm run dev -- --cwd .
```

If neither `HELIX_API_KEY` nor `OPENAI_API_KEY` is set, HelixCode exits before
starting the REPL and prints a short setup hint. `helix --help` still works
without an API key.

Project-specific instructions can be placed in `AGENTS.md` or
`.helix/instructions.md` at the project root. HelixCode loads both files when
present and includes them in the agent's system prompt.

Useful slash commands:

```text
/help
/status
/doctor
/model
/history
/plan
/compact
/tools
/reset
/clear
/exit
```

## Safety

HelixCode can read and search files directly. It asks for confirmation before writing files, applying patches, or running shell commands. Before confirmation, it prints a readable preview that includes the target file, patch files, or shell command. Destructive shell commands such as `git reset --hard` and `rm -rf` are blocked.

Shell commands must be non-empty. A command that exits with a non-zero status is
reported as a failed action with its captured output, so the agent can continue
from the actual command result.

## Current Agent Tools

- `read_file`
- `list_files`
- `search_files`
- `git_status`
- `git_diff`
- `update_plan`
- `write_file`
- `replace_in_file`
- `apply_patch`
- `run_shell`

The REPL keeps short session context, so the agent can use prior tool observations and confirmed action results while the process is running.
The agent can maintain a lightweight in-memory task plan with `update_plan`;
use `/plan` to inspect it during the current session.

`read_file` can read a full file or a line range with `startLine` and `endLine`.
`search_files` accepts optional `glob`, `caseSensitive`, `maxResults`, and
`contextLines` fields. Prefer `replace_in_file` for small exact edits; it shows
a confirmation preview before changing the target file.

Use `/doctor` to inspect local runtime diagnostics, including cwd, model, base
URL, API key status, Node version, project instructions, history size, and plan
item count. Use `/model` to inspect the active chat model or `/model <name>` to
switch it for the current session. Use `/reset` to clear session context without
clearing the screen, `/compact` to keep only the most recent session messages,
`/clear` to clear both the screen and session context, and `/history` to inspect
the current context size.

Tool requests are parsed from strict JSON, fenced JSON code blocks, or a balanced JSON object embedded in a short assistant response.

## Validation

Before relying on a local build, run:

```powershell
npm run typecheck
npm test
npm run build
npx tsx src\cli\main.ts --help
```

The npm package includes the built `dist` directory, so run `npm run build`
before packing or installing from this checkout.
