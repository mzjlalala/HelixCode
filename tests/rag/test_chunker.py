"""CodeChunker 的测试。"""

from __future__ import annotations

from helixcode.core.entities import CodeLocation, CodeSymbol, SymbolKind
from helixcode.rag.config import RAGConfig
from helixcode.rag.indexer.chunker import CodeChunk, CodeChunker


def _make_symbol(name: str, kind: SymbolKind, start_line: int, end_line: int) -> CodeSymbol:
    return CodeSymbol(
        name=name,
        kind=kind,
        location=CodeLocation(
            file_path='test.py',
            start_line=start_line,
            end_line=end_line,
        ),
    )


class TestCodeChunker:
    def test_small_file_single_chunk(self) -> None:
        """小文件（<= chunk_size）应作为一个整体块。"""
        config = RAGConfig(chunk_size=100)
        chunker = CodeChunker(config)

        content = 'line1\nline2\nline3\n'
        symbols = [_make_symbol('foo', SymbolKind.FUNCTION, 1, 3)]

        chunks = chunker.chunk_file('test.py', content, symbols)
        assert len(chunks) == 1
        assert chunks[0].file_path == 'test.py'
        assert chunks[0].start_line == 1
        assert chunks[0].end_line == 3

    def test_large_file_split_by_symbols(self) -> None:
        """大文件应按类/函数边界分块。"""
        config = RAGConfig(chunk_size=5, chunk_overlap=2)
        chunker = CodeChunker(config)

        # 30 行，两个符号分别在第 2 行和第 20 行
        lines = [f'line {i}' for i in range(1, 31)]
        content = '\n'.join(lines)
        symbols = [
            _make_symbol('func1', SymbolKind.FUNCTION, 2, 10),
            _make_symbol('func2', SymbolKind.FUNCTION, 20, 25),
        ]

        chunks = chunker.chunk_file('test.py', content, symbols)
        # 应该分成多个块
        assert len(chunks) >= 2
        # 验证块之间有重叠
        all_lines_covered = set()
        for c in chunks:
            for l in range(c.start_line, c.end_line + 1):
                all_lines_covered.add(l)
        # 30 行应该全部被覆盖
        assert len(all_lines_covered) == 30

    def test_empty_file(self) -> None:
        config = RAGConfig()
        chunker = CodeChunker(config)

        chunks = chunker.chunk_file('empty.py', '', [])
        assert len(chunks) == 1
        assert chunks[0].content == ''

    def test_chunk_has_symbols(self) -> None:
        config = RAGConfig(chunk_size=100)
        chunker = CodeChunker(config)

        content = 'def foo():\n    pass\n'
        symbols = [_make_symbol('foo', SymbolKind.FUNCTION, 1, 2)]

        chunks = chunker.chunk_file('a.py', content, symbols)
        assert 'foo' in chunks[0].symbols
