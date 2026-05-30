"""Tests for value objects."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from helixcode.core.value_objects import (
    Problem,
    ProblemSeverity,
    SearchResult,
    TaskPlan,
    TaskStep,
)


class TestProblemSeverity:
    def test_string_values(self) -> None:
        assert ProblemSeverity.CRITICAL.value == 'CRITICAL'
        assert ProblemSeverity.WARNING.value == 'WARNING'
        assert ProblemSeverity.SUGGESTION.value == 'SUGGESTION'


class TestProblem:
    def test_minimal_critical(self) -> None:
        p = Problem(
            severity=ProblemSeverity.CRITICAL,
            file_path='auth.py',
            line=42,
            message='Hardcoded secret.',
        )
        assert p.severity == ProblemSeverity.CRITICAL
        assert p.message == 'Hardcoded secret.'

    def test_empty_message_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Problem(severity=ProblemSeverity.WARNING, file_path='x.py', message='')

    def test_full_suggestion(self) -> None:
        p = Problem(
            severity=ProblemSeverity.SUGGESTION,
            file_path='util.py',
            line=10,
            message='Use f-strings.',
            suggestion='Replace .format() calls with f-strings.',
            rule_name='use-fstring',
        )
        assert p.suggestion == 'Replace .format() calls with f-strings.'
        assert p.rule_name == 'use-fstring'


class TestSearchResult:
    def test_minimal_result(self) -> None:
        r = SearchResult(
            symbol_name='process_order',
            symbol_kind='function',
            file_path='orders.py',
            start_line=20,
            end_line=50,
            relevance_score=0.92,
        )
        assert r.symbol_name == 'process_order'
        assert r.relevance_score == 0.92

    def test_relevance_score_in_range(self) -> None:
        with pytest.raises(ValidationError):
            SearchResult(
                symbol_name='x', symbol_kind='function',
                file_path='x.py', start_line=1, end_line=1,
                relevance_score=1.5,
            )

    def test_negative_score_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SearchResult(
                symbol_name='x', symbol_kind='function',
                file_path='x.py', start_line=1, end_line=1,
                relevance_score=-0.1,
            )


class TestTaskStep:
    def test_minimal_step(self) -> None:
        step = TaskStep(step_number=1, title='Create model')
        assert step.step_number == 1
        assert step.title == 'Create model'

    def test_step_number_must_be_positive(self) -> None:
        with pytest.raises(ValidationError):
            TaskStep(step_number=0, title='Bad step')

    def test_with_dependencies(self) -> None:
        step = TaskStep(
            step_number=3,
            title='Create Service',
            description='Implement business logic.',
            target_file='services/order_service.py',
            layer='Service',
            dependencies=[1, 2],
        )
        assert step.layer == 'Service'
        assert step.dependencies == [1, 2]


class TestTaskPlan:
    def test_full_plan(self) -> None:
        steps = [
            TaskStep(step_number=1, title='Create DTO'),
            TaskStep(step_number=2, title='Create Repository', dependencies=[1]),
            TaskStep(step_number=3, title='Create Service', dependencies=[2]),
        ]
        plan = TaskPlan(
            original_task='Add export feature',
            steps=steps,
            estimated_complexity='medium',
            rationale='Standard layered pattern.',
        )
        assert len(plan.steps) == 3
        assert plan.estimated_complexity == 'medium'

    def test_empty_task_rejected(self) -> None:
        with pytest.raises(ValidationError):
            TaskPlan(original_task='')
