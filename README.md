# HelixCode

HelixCode is a terminal coding agent inspired by Claude Code. Run `helix` in a repository, describe the work in natural language, and let the agent inspect files, search code, review git state, and request confirmation for risky actions.

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
npm test
npm run typecheck
npm run build
```

## Run

```powershell
helix
```

Useful slash commands:

```text
/help
/status
/clear
/exit
```

## Safety

HelixCode can read and search files directly. It asks for confirmation before writing files or running shell commands. Destructive shell commands such as `git reset --hard` and `rm -rf` are blocked.
