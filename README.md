# HelixCode

AI Software Engineering Agent — analyze, understand, modify, test, and commit code in local repositories via CLI.

## Installation

```bash
pip install -e ".[dev]"
```

## Usage

```bash
helix explain <target>    # Explain code structure and call chains
helix review              # Review current git changes
helix search "<query>"    # Semantic search across the codebase
helix plan "<task>"       # Generate a task execution plan
helix fix "<problem>"     # Generate a fix diff for a problem
```

## Requirements

- Python 3.13+
- OpenAI-compatible API (or OpenAI API key)
