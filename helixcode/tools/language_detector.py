"""Map file extensions to programming languages."""

from __future__ import annotations

from enum import Enum
from pathlib import Path


class Language(str, Enum):
    """Programming languages supported for AST parsing."""

    PYTHON = 'python'
    JAVASCRIPT = 'javascript'
    TYPESCRIPT = 'typescript'
    GO = 'go'
    RUST = 'rust'
    JAVA = 'java'
    CSHARP = 'csharp'
    CPP = 'cpp'
    C = 'c'
    UNKNOWN = 'unknown'


_EXTENSION_MAP: dict[str, Language] = {
    '.py': Language.PYTHON,
    '.pyi': Language.PYTHON,
    '.js': Language.JAVASCRIPT,
    '.mjs': Language.JAVASCRIPT,
    '.cjs': Language.JAVASCRIPT,
    '.ts': Language.TYPESCRIPT,
    '.tsx': Language.TYPESCRIPT,
    '.go': Language.GO,
    '.rs': Language.RUST,
    '.java': Language.JAVA,
    '.cs': Language.CSHARP,
    '.cpp': Language.CPP,
    '.cc': Language.CPP,
    '.cxx': Language.CPP,
    '.hpp': Language.CPP,
    '.h': Language.C,
    '.c': Language.C,
}


def detect_language(file_path: str | Path) -> Language:
    """Return the :class:`Language` for *file_path* based on its extension."""
    suffix = Path(file_path).suffix.lower()
    return _EXTENSION_MAP.get(suffix, Language.UNKNOWN)
