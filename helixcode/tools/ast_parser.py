"""TreeSitter-based AST parser for extracting code symbols."""

from __future__ import annotations

from pathlib import Path

from helixcode.core.entities import CodeLocation, CodeSymbol, SymbolKind
from helixcode.tools.file_utils import read_file
from helixcode.tools.language_detector import Language, detect_language


def _strip_string_quotes(text: str) -> str:
    """Strip matching quotes from a string literal captured by TreeSitter."""
    if text.startswith('"""') and text.endswith('"""') and len(text) >= 6:
        return text[3:-3]
    if text.startswith("'''") and text.endswith("'''") and len(text) >= 6:
        return text[3:-3]
    if text.startswith('"') and text.endswith('"') and len(text) >= 2:
        return text[1:-1]
    if text.startswith("'") and text.endswith("'") and len(text) >= 2:
        return text[1:-1]
    return text


class ASTParser:
    """Parses source files with TreeSitter and extracts structured symbols."""

    def __init__(self) -> None:
        self._parsers: dict[Language, object] = {}

    def _get_parser(self, language: Language):
        """Lazily load a TreeSitter parser for *language*."""
        if language not in self._parsers:
            try:
                from tree_sitter import Language as TSLanguage, Parser
                lang_obj = self._load_tree_sitter_language(language)
                if lang_obj is not None:
                    self._parsers[language] = Parser(lang_obj)
                else:
                    self._parsers[language] = None
            except Exception:
                self._parsers[language] = None
        return self._parsers[language]

    @staticmethod
    def _load_tree_sitter_language(language: Language):
        """Load a tree-sitter Language object for the given language."""
        try:
            from tree_sitter import Language as TSLanguage
            import tree_sitter_python
            return TSLanguage(tree_sitter_python.language())
        except ImportError:
            return None

    def parse_file(self, file_path: str | Path) -> list[CodeSymbol]:
        """Parse *file_path* and return a list of extracted symbols.

        Returns an empty list for unsupported languages or files that
        cannot be parsed.
        """
        language = detect_language(file_path)
        if language == Language.UNKNOWN:
            return []

        parser = self._get_parser(language)
        if parser is None:
            return []

        try:
            source = read_file(file_path)
        except FileNotFoundError:
            return []

        try:
            tree = parser.parse(source.encode('utf-8'))
        except Exception:
            return []

        return self._extract_symbols(
            tree, source, str(file_path), language
        )

    def _extract_symbols(
        self,
        tree,
        source: str,
        file_path: str,
        language: Language,
    ) -> list[CodeSymbol]:
        """Walk the concrete syntax tree and collect symbols."""
        symbols: list[CodeSymbol] = []
        source_bytes = source.encode('utf-8')
        lines = source.splitlines()

        if language == Language.PYTHON:
            self._extract_python_symbols(
                tree.root_node, source_bytes, file_path, lines, symbols
            )

        return symbols

    def _extract_python_symbols(
        self,
        node,
        source_bytes: bytes,
        file_path: str,
        lines: list[str],
        symbols: list[CodeSymbol],
        parent_name: str | None = None,
    ) -> None:
        """Recursively extract Python symbols from a TreeSitter node."""
        from tree_sitter import Node

        for child in node.children:
            if child.type == 'class_definition':
                name_node = child.child_by_field_name('name')
                if name_node is not None:
                    name = name_node.text.decode('utf-8')
                    symbols.append(self._make_symbol(
                        name, SymbolKind.CLASS, child, file_path, lines,
                        parent_name,
                    ))
                    # Recurse into class body for methods
                    body = child.child_by_field_name('body')
                    if body is not None:
                        self._extract_python_symbols(
                            body, source_bytes, file_path, lines, symbols, name,
                        )

            elif child.type == 'function_definition':
                name_node = child.child_by_field_name('name')
                if name_node is not None:
                    name = name_node.text.decode('utf-8')
                    kind = SymbolKind.METHOD if parent_name else SymbolKind.FUNCTION
                    symbols.append(self._make_symbol(
                        name, kind, child, file_path, lines, parent_name,
                    ))

            else:
                # Recurse for nested symbols (e.g., functions inside if blocks)
                if child.child_count > 0:
                    self._extract_python_symbols(
                        child, source_bytes, file_path, lines, symbols, parent_name,
                    )

    def _make_symbol(
        self,
        name: str,
        kind: SymbolKind,
        node,
        file_path: str,
        lines: list[str],
        parent_name: str | None,
    ) -> CodeSymbol:
        """Build a CodeSymbol from a TreeSitter node."""
        start_line = node.start_point[0] + 1
        end_line = node.end_point[0] + 1
        start_col = node.start_point[1]
        end_col = node.end_point[1]

        # Extract docstring if present
        docstring = self._extract_docstring(node)

        # Build signature from first line
        first_line = lines[node.start_point[0]][node.start_point[1]:].rstrip(':')
        signature = first_line.strip()

        return CodeSymbol(
            name=name,
            kind=kind,
            location=CodeLocation(
                file_path=file_path,
                start_line=start_line,
                end_line=end_line,
                start_col=start_col,
                end_col=end_col,
            ),
            docstring=docstring,
            parent_name=parent_name,
            signature=signature,
            language='python',
        )

    @staticmethod
    def _extract_docstring(node) -> str | None:
        """Extract the docstring from a function or class definition node."""
        body = node.child_by_field_name('body')
        if body is None or body.child_count == 0:
            return None

        # The body field IS the block node. Its first child may be an
        # expression_statement containing a string (the docstring).
        first_stmt = body.children[0] if body.child_count > 0 else None
        if first_stmt is not None and first_stmt.type == 'expression_statement':
            str_node = first_stmt.children[0] if first_stmt.child_count > 0 else None
            if str_node is not None and str_node.type == 'string':
                text = str_node.text.decode('utf-8')
                return _strip_string_quotes(text)

        return None
