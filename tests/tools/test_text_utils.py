"""Tests for text_utils."""

from __future__ import annotations

from helixcode.tools.text_utils import (
    count_lines,
    format_unified_diff,
    to_markdown_code_block,
    truncate_middle,
)


class TestFormatUnifiedDiff:
    def test_produces_diff_header(self) -> None:
        diff = format_unified_diff(
            'line1\nline2\nline3\n',
            'line1\nline2_changed\nline3\n',
            'test.py',
        )
        assert '--- a/test.py' in diff
        assert '+++ b/test.py' in diff

    def test_identical_content_yields_empty(self) -> None:
        diff = format_unified_diff('same\n', 'same\n', 'x.py')
        # Identical content produces no hunks
        assert diff == ''


class TestTruncateMiddle:
    def test_short_text_unchanged(self) -> None:
        text = 'a\nb\nc\n'
        assert truncate_middle(text, max_lines=10) == text

    def test_long_text_truncated(self) -> None:
        lines = [f'line {i}' for i in range(100)]
        text = '\n'.join(lines)
        result = truncate_middle(text, max_lines=20)
        assert 'truncated' in result.lower()
        # Should contain the first ~10 and last ~10 lines
        assert 'line 0' in result
        assert 'line 99' in result


class TestToMarkdownCodeBlock:
    def test_wraps_with_language(self) -> None:
        block = to_markdown_code_block('print("hello")', 'python')
        assert block == '```python\nprint("hello")\n```'

    def test_wraps_without_language(self) -> None:
        block = to_markdown_code_block('some code')
        assert block.startswith('```\n')
        assert block.endswith('\n```')


class TestCountLines:
    def test_empty_string(self) -> None:
        assert count_lines('') == 0

    def test_multiline(self) -> None:
        assert count_lines('a\nb\nc') == 3
