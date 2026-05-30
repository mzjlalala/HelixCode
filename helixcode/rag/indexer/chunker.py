"""代码分块器 — 将长文件按语义边界切分为若干重叠的代码块。

在类/函数边界处分块，保持语义完整性，避免在函数中间切断。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from helixcode.core.entities import CodeSymbol, SymbolKind
from helixcode.rag.config import RAGConfig


@dataclass
class CodeChunk:
    """一个代码块，包含文本内容、元数据和所属符号列表。"""

    content: str
    """代码块的文本内容。"""

    file_path: str
    """来源文件路径。"""

    start_line: int
    """起始行号（1-based）。"""

    end_line: int
    """结束行号（1-based）。"""

    symbols: list[str] = field(default_factory=list)
    """块内包含的符号名称列表。"""


class CodeChunker:
    """将文件内容按语义边界切分为代码块。"""

    def __init__(self, config: RAGConfig | None = None) -> None:
        self._config = config or RAGConfig()

    def chunk_file(
        self, file_path: str, content: str, symbols: list[CodeSymbol]
    ) -> list[CodeChunk]:
        """将文件内容按符号边界切分为多个代码块。

        策略：
        1. 如果文件行数 <= chunk_size，整个文件作为一个块
        2. 否则，在类/函数边界处分块，保持每个符号的完整性
        3. 块之间保留 overlap 行以维持上下文
        """
        lines = content.splitlines()
        total_lines = len(lines)

        # 小文件直接返回整个文件
        if total_lines <= self._config.chunk_size:
            return [
                CodeChunk(
                    content=content,
                    file_path=file_path,
                    start_line=1,
                    end_line=total_lines,
                    symbols=[s.name for s in symbols],
                )
            ]

        # 大文件按符号边界分块
        return self._chunk_by_symbols(file_path, lines, symbols)

    def _chunk_by_symbols(
        self, file_path: str, lines: list[str], symbols: list[CodeSymbol]
    ) -> list[CodeChunk]:
        """按符号边界切分大文件。

        按行号排序符号，以符号起始行为边界切分。
        """
        chunks: list[CodeChunk] = []

        # 仅用类和方法作为分块锚点
        anchors = sorted(
            [s for s in symbols if s.kind in (SymbolKind.CLASS, SymbolKind.FUNCTION, SymbolKind.METHOD)],
            key=lambda s: s.location.start_line,
        )

        if not anchors:
            # 没有符号时按固定大小分块
            return self._chunk_by_lines(file_path, lines)

        current_start = 1
        current_symbols: list[str] = []
        current_end = 1

        for anchor in anchors:
            anchor_start = anchor.location.start_line

            # 如果当前块已经足够大，切分
            if anchor_start - current_start >= self._config.chunk_size:
                end = min(current_end + self._config.chunk_overlap, len(lines))
                chunks.append(self._make_chunk(
                    file_path, lines, current_start, end, current_symbols,
                ))
                current_start = max(1, end - self._config.chunk_overlap)
                current_symbols = []

            current_end = anchor.location.end_line
            current_symbols.append(anchor.name)

        # 最后一个块
        if current_start <= len(lines):
            chunks.append(self._make_chunk(
                file_path, lines, current_start, len(lines), current_symbols,
            ))

        return chunks

    def _chunk_by_lines(
        self, file_path: str, lines: list[str]
    ) -> list[CodeChunk]:
        """按固定行数切分文件（无符号锚点时使用）。"""
        chunks: list[CodeChunk] = []
        step = self._config.chunk_size - self._config.chunk_overlap

        for i in range(0, len(lines), step):
            end = min(i + self._config.chunk_size, len(lines))
            chunks.append(self._make_chunk(file_path, lines, i + 1, end, []))

        return chunks

    def _make_chunk(
        self,
        file_path: str,
        lines: list[str],
        start: int,
        end: int,
        symbols: list[str],
    ) -> CodeChunk:
        content = '\n'.join(lines[start - 1:end])
        return CodeChunk(
            content=content,
            file_path=file_path,
            start_line=start,
            end_line=end,
            symbols=symbols,
        )
