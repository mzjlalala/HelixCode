"""Tests for core domain entities."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from helixcode.core.entities import CallChain, CodeDiff, CodeLocation, CodeSymbol, SymbolKind


class TestSymbolKind:
    def test_all_expected_members(self) -> None:
        expected = {'file', 'class', 'method', 'function', 'variable', 'import', 'module'}
        assert expected.issubset({m.value for m in SymbolKind})


class TestCodeLocation:
    def test_minimal_valid(self) -> None:
        loc = CodeLocation(file_path='app/main.py', start_line=10, end_line=20)
        assert loc.file_path == 'app/main.py'
        assert loc.start_line == 10
        assert loc.end_line == 20
        assert loc.start_col == 0
        assert loc.end_col == 0

    def test_start_line_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            CodeLocation(file_path='x.py', start_line=0, end_line=1)

    def test_end_line_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            CodeLocation(file_path='x.py', start_line=1, end_line=0)

    def test_empty_file_path_rejected(self) -> None:
        with pytest.raises(ValidationError):
            CodeLocation(file_path='', start_line=1, end_line=1)


class TestCodeSymbol:
    def test_full_symbol(self) -> None:
        loc = CodeLocation(file_path='service.py', start_line=5, end_line=25)
        sym = CodeSymbol(
            name='OrderService',
            kind=SymbolKind.CLASS,
            location=loc,
            docstring='Handles order lifecycle.',
            parent_name=None,
            signature='class OrderService(BaseService):',
            annotations=['@dataclass'],
            language='python',
        )
        assert sym.name == 'OrderService'
        assert sym.kind == SymbolKind.CLASS
        assert sym.docstring == 'Handles order lifecycle.'

    def test_name_must_not_be_empty(self) -> None:
        loc = CodeLocation(file_path='a.py', start_line=1, end_line=1)
        with pytest.raises(ValidationError):
            CodeSymbol(name='', kind=SymbolKind.FUNCTION, location=loc)


class TestCallChain:
    def test_depth_direct_call(self) -> None:
        a = CodeSymbol(
            name='caller', kind=SymbolKind.FUNCTION,
            location=CodeLocation(file_path='m.py', start_line=1, end_line=1),
        )
        b = CodeSymbol(
            name='callee', kind=SymbolKind.FUNCTION,
            location=CodeLocation(file_path='m.py', start_line=10, end_line=10),
        )
        chain = CallChain(source_symbol=a, target_symbol=b)
        assert chain.depth == 1

    def test_depth_with_intermediates(self) -> None:
        a = CodeSymbol(
            name='A', kind=SymbolKind.FUNCTION,
            location=CodeLocation(file_path='m.py', start_line=1, end_line=1),
        )
        b = CodeSymbol(
            name='B', kind=SymbolKind.FUNCTION,
            location=CodeLocation(file_path='m.py', start_line=10, end_line=10),
        )
        c = CodeSymbol(
            name='C', kind=SymbolKind.FUNCTION,
            location=CodeLocation(file_path='m.py', start_line=20, end_line=20),
        )
        chain = CallChain(source_symbol=a, target_symbol=c, intermediate_calls=[b])
        assert chain.depth == 2


class TestCodeDiff:
    def test_roundtrip(self) -> None:
        diff = CodeDiff(
            file_path='src/api.py',
            original_lines='def foo():\n    pass\n',
            modified_lines='def foo():\n    return 42\n',
            start_line=10,
            end_line=11,
            description='Add return value.',
        )
        data = diff.model_dump()
        restored = CodeDiff(**data)
        assert restored.original_lines == diff.original_lines
        assert restored.modified_lines == diff.modified_lines
