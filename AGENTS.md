# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

See [CLAUDE.md](CLAUDE.md) for the full architecture reference. Key points:

- Native OpenAI-compatible **tool calling** is the primary protocol; JSON-in-text is a legacy fallback.
- Tools are registered centrally in `src/tools/registry.ts`.
- Session settings live in `.helix/config.json` (`maxToolRounds`, `maxHistoryMessages`, `compactKeepMessages`).
- Run `npm test` and `npm run typecheck` before claiming work is complete.
