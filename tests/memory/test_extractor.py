"""MemoryExtractor 的测试。"""

from __future__ import annotations

from helixcode.memory.extractor import MemoryExtractor


class TestMemoryExtractor:
    def test_extract_fix_success(self) -> None:
        result = {
            'task': '修复超时问题',
            'success': True,
            'diffs': [{'file_path': 'service.py'}],
        }
        lessons = MemoryExtractor.extract_lessons(result)
        assert any('修复成功' in l['content'] for l in lessons)

    def test_extract_critical_review(self) -> None:
        result = {
            'task': '审查代码',
            'review': {'critical_count': 2},
        }
        lessons = MemoryExtractor.extract_lessons(result)
        assert any('严重问题' in l['content'] for l in lessons)

    def test_extract_no_lessons(self) -> None:
        """没有值得记忆的事件时返回空列表。"""
        result = {'task': '查询信息'}
        lessons = MemoryExtractor.extract_lessons(result)
        assert lessons == []

    def test_extract_repo_info(self) -> None:
        result = {
            'context': {
                'repo_info': {
                    'tech_stack': 'Python 3.13, FastAPI',
                }
            }
        }
        info = MemoryExtractor.extract_repo_info(result)
        assert info['tech_stack'] == 'Python 3.13, FastAPI'
