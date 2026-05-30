"""Text formatting utilities: diff rendering, truncation, markdown."""

from __future__ import annotations

import difflib


def format_unified_diff(
    original: str,
    modified: str,
    file_path: str,
    *,
    context_lines: int = 3,
) -> str:
    """Produce a unified diff between *original* and *modified*.

    Args:
        original: The original file contents.
        modified: The modified file contents.
        file_path: Displayed in the diff header.
        context_lines: Number of context lines around each hunk.
    """
    original_lines = original.splitlines(keepends=True)
    modified_lines = modified.splitlines(keepends=True)

    diff = difflib.unified_diff(
        original_lines,
        modified_lines,
        fromfile=f'a/{file_path}',
        tofile=f'b/{file_path}',
        n=context_lines,
    )
    return ''.join(diff)


def truncate_middle(text: str, max_lines: int = 40) -> str:
    """If *text* exceeds *max_lines*, show the first and last halves.

    Returns the original text unchanged when it fits within *max_lines*.
    """
    lines = text.splitlines()
    if len(lines) <= max_lines:
        return text

    half = max_lines // 2
    top = '\n'.join(lines[:half])
    bottom = '\n'.join(lines[-half:])
    return f'{top}\n\n... [{len(lines) - max_lines} lines truncated] ...\n\n{bottom}'


def to_markdown_code_block(code: str, language: str = '') -> str:
    """Wrap *code* in a fenced Markdown code block."""
    lang = language or ''
    return f'```{lang}\n{code}\n```'


def count_lines(text: str) -> int:
    """Return the number of lines in *text*."""
    if not text:
        return 0
    return text.count('\n') + 1
