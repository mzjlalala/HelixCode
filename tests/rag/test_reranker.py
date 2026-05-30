"""Reranker 的测试。"""

from __future__ import annotations

from helixcode.rag.config import RAGConfig
from helixcode.rag.searcher.reranker import Reranker


class TestReranker:
    def test_rerank_boosts_keyword_match(self) -> None:
        config = RAGConfig(rerank_keyword_boost=0.3)
        reranker = Reranker(config)

        results = [
            {'id': '1', 'score': 0.8, 'text': '处理订单超时逻辑', 'symbols': ['process_order']},
            {'id': '2', 'score': 0.9, 'text': '发送通知邮件', 'symbols': ['send_email']},
        ]
        query = '订单超时'

        reranked = reranker.rerank(query, results)
        # 第一个结果匹配了关键词，分数应该提升
        assert reranked[0]['id'] == '1'
        assert reranked[0]['score'] > 0.8

    def test_rerank_empty_results(self) -> None:
        reranker = Reranker(RAGConfig())
        result = reranker.rerank('query', [])
        assert result == []

    def test_rerank_no_keywords(self) -> None:
        """查询中没有关键词时，结果不应改变。"""
        reranker = Reranker(RAGConfig(rerank_keyword_boost=0.3))
        results = [
            {'id': '1', 'score': 0.8, 'text': 'some text', 'symbols': []},
        ]
        reranked = reranker.rerank('-', results)
        assert reranked[0]['score'] == 0.8

    def test_extract_keywords_mixed_cn_en(self) -> None:
        """中英文混合关键词提取。"""
        keywords = Reranker._extract_keywords('订单 order timeout 处理')
        assert '订单' in keywords
        assert '处理' in keywords
        assert 'order' in keywords
        assert 'timeout' in keywords
