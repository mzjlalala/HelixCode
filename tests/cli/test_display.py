"""CLI 显示格式化函数的测试。"""

from __future__ import annotations

from helixcode.cli.display import (
    display_diff,
    display_error,
    display_explanation,
    display_plan,
    display_review,
    display_search_results,
)


class TestDisplay:
    def test_display_review_empty(self) -> None:
        """空问题列表不应崩溃。"""
        display_review([])  # 不应该抛出异常

    def test_display_review_with_problems(self) -> None:
        """各类问题应该正确显示。"""
        problems = [
            {
                'severity': 'CRITICAL',
                'file_path': 'a.py',
                'line': 10,
                'message': '严重问题',
                'suggestion': '修复建议',
            },
            {
                'severity': 'WARNING',
                'file_path': 'b.py',
                'line': 20,
                'message': '警告',
            },
            {
                'severity': 'SUGGESTION',
                'file_path': 'c.py',
                'line': 30,
                'message': '建议',
            },
        ]
        display_review(problems)  # 不应该抛出异常

    def test_display_search_empty(self) -> None:
        """空搜索结果不应崩溃。"""
        display_search_results([])

    def test_display_search_results(self) -> None:
        """搜索结果应该正确显示。"""
        results = [
            {
                'file_path': 'test.py',
                'symbol_name': 'test_func',
                'start_line': 1,
                'score': 0.95,
            },
        ]
        display_search_results(results)

    def test_display_plan_empty(self) -> None:
        display_plan([])

    def test_display_plan_with_steps(self) -> None:
        steps = [
            {
                'step_number': 1,
                'title': '创建 DTO',
                'description': '定义数据传输对象',
                'layer': 'DTO',
                'target_file': 'dto.py',
                'dependencies': [],
            },
        ]
        display_plan(steps)

    def test_display_diff_empty(self) -> None:
        display_diff([])

    def test_display_diff_with_changes(self) -> None:
        diffs = [
            {
                'file_path': 'test.py',
                'description': '修复 bug',
                'original_lines': 'old',
                'modified_lines': 'new',
                'start_line': 1,
                'end_line': 1,
            },
        ]
        display_diff(diffs)

    def test_display_explanation(self) -> None:
        analysis = {
            'summary': '这是一个测试分析',
            'call_chain': [
                {'caller': 'A', 'callee': 'B', 'relationship': '直接调用'},
            ],
        }
        display_explanation(analysis)

    def test_display_error(self) -> None:
        display_error('测试错误信息')
