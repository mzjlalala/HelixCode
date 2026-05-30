"""混合重排序器 — 结合向量相似度和关键词匹配得分。"""

from __future__ import annotations

import re

from helixcode.rag.config import RAGConfig


class Reranker:
    """对搜索结果进行关键词加权重排序。

    将查询中的关键词与结果的文本内容和符号名匹配，
    匹配命中时增加相关性分数，实现混合检索效果。
    """

    def __init__(self, config: RAGConfig | None = None) -> None:
        self._config = config or RAGConfig()
        self._boost = self._config.rerank_keyword_boost

    def rerank(
        self, query: str, results: list[dict]
    ) -> list[dict]:
        """按关键词匹配加权重新排序结果列表。"""
        if not results:
            return results

        # 提取查询中的关键词（中英文词）
        keywords = self._extract_keywords(query)
        if not keywords:
            return results

        for r in results:
            text = r.get('text', '')
            symbols = ' '.join(r.get('symbols', []))
            combined = f'{text} {symbols}'.lower()

            # 计算关键词命中率
            hits = sum(1 for kw in keywords if kw.lower() in combined)
            boost = self._boost * (hits / len(keywords))

            r['score'] = min(1.0, r.get('score', 0.0) + boost)

        # 按新分数降序排列
        results.sort(key=lambda r: r.get('score', 0.0), reverse=True)
        return results

    @staticmethod
    def _extract_keywords(query: str) -> list[str]:
        """从查询中提取有意义的关键词。

        中英文混合提取：
        - 英文：按空格和标点分割，过滤长度 <= 1 的词
        - 中文：提取连续的 CJK 字符作为词组
        """
        # 提取中文词组（连续 2+ 个 CJK 字符）
        cjk = re.findall(r'[一-鿿]{2,}', query)
        # 提取英文单词（长度 > 1）
        eng = re.findall(r'[a-zA-Z_]{2,}', query)

        return list(set(cjk + eng))
