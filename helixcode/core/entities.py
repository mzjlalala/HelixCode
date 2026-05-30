"""Core domain entities — fundamental building blocks used across all layers."""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints

FilePath = Annotated[str, StringConstraints(min_length=1)]


class SymbolKind(str, Enum):
    """Kinds of code symbols that can be extracted from source files."""

    FILE = 'file'
    CLASS = 'class'
    METHOD = 'method'
    FUNCTION = 'function'
    VARIABLE = 'variable'
    IMPORT = 'import'
    MODULE = 'module'


class CodeLocation(BaseModel):
    """Pinpoints a position in source code."""

    file_path: FilePath
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    start_col: int = Field(default=0, ge=0)
    end_col: int = Field(default=0, ge=0)


class CodeSymbol(BaseModel):
    """A named code element (class, function, method, etc.) with metadata."""

    name: str = Field(min_length=1)
    kind: SymbolKind
    location: CodeLocation
    docstring: str | None = None
    parent_name: str | None = None
    signature: str | None = None
    annotations: list[str] = Field(default_factory=list)
    language: str = 'python'


class CallChain(BaseModel):
    """Represents a chain of caller → callee relationships."""

    source_symbol: CodeSymbol
    target_symbol: CodeSymbol
    intermediate_calls: list[CodeSymbol] = Field(default_factory=list)

    @property
    def depth(self) -> int:
        """Number of hops from source to target (1 = direct call)."""
        return len(self.intermediate_calls) + 1


class CodeDiff(BaseModel):
    """Represents a planned code change without touching the file system."""

    file_path: FilePath
    original_lines: str
    modified_lines: str
    start_line: int = Field(ge=1)
    end_line: int = Field(ge=1)
    description: str = ''
