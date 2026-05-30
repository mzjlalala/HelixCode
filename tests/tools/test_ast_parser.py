"""Tests for ASTParser."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from helixcode.core.entities import SymbolKind
from helixcode.tools.ast_parser import ASTParser


@pytest.fixture
def parser() -> ASTParser:
    return ASTParser()


class TestASTParser:
    def test_parse_python_class_and_function(self, parser: ASTParser) -> None:
        source = '''
class OrderService:
    """Handles order lifecycle."""

    def create_order(self, user_id: int) -> Order:
        """Create a new order."""
        return Order(user_id=user_id)

def standalone_function():
    pass
'''
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.py', delete=False
        ) as f:
            f.write(source)
            f.flush()

        try:
            symbols = parser.parse_file(f.name)
        finally:
            Path(f.name).unlink()

        names = {s.name for s in symbols}
        kinds = {s.kind for s in symbols}

        assert 'OrderService' in names
        assert 'create_order' in names
        assert 'standalone_function' in names
        assert SymbolKind.CLASS in kinds
        assert SymbolKind.METHOD in kinds
        assert SymbolKind.FUNCTION in kinds

    def test_parse_unsupported_language_returns_empty(
        self, parser: ASTParser
    ) -> None:
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.xyz', delete=False
        ) as f:
            f.write('some content')
            f.flush()

        try:
            symbols = parser.parse_file(f.name)
        finally:
            Path(f.name).unlink()

        assert symbols == []

    def test_parse_missing_file_returns_empty(self, parser: ASTParser) -> None:
        symbols = parser.parse_file('/nonexistent/file.py')
        assert symbols == []

    def test_parse_class_with_docstring(self, parser: ASTParser) -> None:
        source = '''
class MyClass:
    """A documented class."""
    pass
'''
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.py', delete=False
        ) as f:
            f.write(source)
            f.flush()

        try:
            symbols = parser.parse_file(f.name)
        finally:
            Path(f.name).unlink()

        assert len(symbols) == 1
        assert symbols[0].docstring == 'A documented class.'

    def test_parse_method_has_parent(self, parser: ASTParser) -> None:
        source = '''
class Service:
    def handle(self):
        pass
'''
        with tempfile.NamedTemporaryFile(
            mode='w', suffix='.py', delete=False
        ) as f:
            f.write(source)
            f.flush()

        try:
            symbols = parser.parse_file(f.name)
        finally:
            Path(f.name).unlink()

        # Find the method
        method = [s for s in symbols if s.name == 'handle']
        assert len(method) == 1
        assert method[0].parent_name == 'Service'
        assert method[0].kind == SymbolKind.METHOD
