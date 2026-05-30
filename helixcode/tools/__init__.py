"""Shared utilities — AST parsing, git operations, file handling, text formatting."""

from helixcode.tools.ast_parser import ASTParser
from helixcode.tools.file_utils import find_files, get_project_structure, read_file, resolve_path
from helixcode.tools.git_utils import GitUtils
from helixcode.tools.language_detector import Language, detect_language
from helixcode.tools.text_utils import (
    count_lines,
    format_unified_diff,
    to_markdown_code_block,
    truncate_middle,
)

__all__ = [
    'ASTParser',
    'GitUtils',
    'Language',
    'count_lines',
    'detect_language',
    'find_files',
    'format_unified_diff',
    'get_project_structure',
    'read_file',
    'resolve_path',
    'to_markdown_code_block',
    'truncate_middle',
]
