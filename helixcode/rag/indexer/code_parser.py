"""代码解析器 — 使用 TreeSitter 从源文件中提取 CodeSymbol 列表。"""

from __future__ import annotations

from pathlib import Path

from helixcode.core.entities import CodeSymbol
from helixcode.rag.config import RAGConfig
from helixcode.tools.ast_parser import ASTParser


class CodeParser:
    """解析项目源文件，提取所有代码符号。

    封装了 ASTParser，提供批量解析和进度跟踪能力。
    """

    def __init__(self, config: RAGConfig | None = None) -> None:
        self._config = config or RAGConfig()
        self._ast = ASTParser()

    def parse_file(self, file_path: Path) -> list[CodeSymbol]:
        """解析单个文件，返回符号列表。"""
        return self._ast.parse_file(str(file_path))

    def parse_files(self, file_paths: list[Path]) -> list[CodeSymbol]:
        """批量解析文件，返回所有符号的扁平列表。"""
        all_symbols: list[CodeSymbol] = []
        for fp in file_paths:
            symbols = self.parse_file(fp)
            all_symbols.extend(symbols)
        return all_symbols

    @staticmethod
    def should_index(file_path: Path, config: RAGConfig) -> bool:
        """判断一个文件是否需要被索引。"""
        suffix = file_path.suffix.lower()
        if suffix not in config.supported_extensions:
            return False
        # 跳过排除的目录
        parts = set(file_path.parts)
        if any(d in parts for d in config.excluded_dirs):
            return False
        return True
