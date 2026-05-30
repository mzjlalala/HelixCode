"""Agent 状态定义 — LangGraph 节点间传递的共享状态。

使用 TypedDict 风格定义，兼容 LangGraph StateGraph 的状态管理。
"""

from __future__ import annotations

from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    """LangGraph 流水线中节点间传递的共享状态。

    Keys:
        task: 用户的原始请求
        command: 当前执行的命令 (explain|review|search|plan|fix)
        messages: 对话历史
        plan: Planner 输出的步骤列表
        search_results: Searcher 输出的搜索结果
        analysis: Analyzer 输出的分析结果
        diffs: Executor 输出的代码变更
        review: Reviewer 输出的审查结果
        final_result: 最终返回给用户的格式化结果
        errors: 累积的错误信息
    """

    task: str
    command: str
    messages: list[dict[str, str]]
    plan: list[dict[str, Any]] | None
    search_results: list[dict[str, Any]] | None
    analysis: dict[str, Any] | None
    diffs: list[dict[str, Any]] | None
    review: dict[str, Any] | None
    final_result: str | None
    errors: list[str]
