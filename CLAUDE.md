# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HelixCode is an open-source AI Software Engineering Agent (like Claude Code, Codex CLI, Aider). Users interact with an AI agent via CLI to analyze, understand, modify, test, and commit code in local repositories.

## Tech Stack

- **Language:** Python 3.13+
- **CLI Framework:** Typer
- **Agent Framework:** LangGraph
- **LLM SDK:** OpenAI SDK
- **Protocol:** MCP (Model Context Protocol)
- **AST Parsing:** TreeSitter
- **Vector DB:** Qdrant
- **Relational DB:** SQLite
- **Git Integration:** GitPython
- **Logging:** Loguru
- **Data Modeling:** Pydantic

## Architecture Principles

- Clean Architecture
- Domain Driven Design
- SOLID
- Dependency Injection

## Source Tree Layout

```
src/          # Application source
core/         # Domain entities, value objects, interfaces (Clean Architecture core)
agent/        # LangGraph agent — Planner, Searcher, Analyzer, Executor, Reviewer nodes
memory/       # Session, Repository, and Long-term memory
rag/          # Code indexing (TreeSitter) + embedding (OpenAI) + vector store (Qdrant)
mcp/          # MCP server/client integrations: filesystem, git, terminal, docker
cli/          # Typer commands: explain, review, search, plan, fix
llm/          # LLM abstraction layer (OpenAI SDK)
tools/        # Shared utilities and tool implementations
storage/      # SQLite persistence layer
tests/        # Test suite
docs/         # Documentation
```

## Phase 1 Commands

| Command | Example | Function |
|---------|---------|----------|
| `helix explain` | `helix explain OrderService` | Search code, locate target, analyze call chain, generate explanation |
| `helix review` | `helix review` | Get git diff, review changed code, output CRITICAL / WARNING / SUGGESTION |
| `helix search` | `helix search "订单超时"` | Semantic search via code index, return relevant files and methods |
| `helix plan` | `helix plan "增加导出功能"` | Agent decomposes task into Controller → Service → Repository → DTO → Test plan |
| `helix fix` | `helix fix "修复订单超时问题"` | Analyze code, find modification points, generate diff (no direct file overwrite) |

## Agent Workflow (LangGraph)

```
User Request → Planner → Searcher → Analyzer → Executor → Reviewer → Result
```

- **Planner:** Decomposes user request into steps
- **Searcher:** Finds relevant code via RAG
- **Analyzer:** Analyzes call chains and dependencies
- **Executor:** Generates code changes / diffs
- **Reviewer:** Reviews output quality before returning

## RAG / Code Indexing

- AST parsing via TreeSitter
- Embedding via OpenAI Embedding
- Vector storage via Qdrant
- Indexes: files, classes, methods, comments

## Memory System

Three tiers:
- **Session Memory** — per-invocation context
- **Repository Memory** — project-level (tech stack, structure, DB info, middleware)
- **Long-term Memory** — cross-project knowledge

## MCP Integrations

Initial: filesystem, git, terminal, docker
Future: playwright, mysql, postgres, redis

## Development Guidelines

- Generate complete, runnable implementations — no pseudocode, no TODO placeholders, no missing imports
- Each module ships with unit tests
- Implement one module at a time: design doc → file structure → code → tests → next steps
- Production-grade code standards
