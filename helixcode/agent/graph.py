"""LangGraph 图构建 — 根据命令类型构建不同的节点流水线。

路由规则:
- explain: Planner → Searcher → Analyzer → Reviewer → Result
- review:  Executor → Reviewer → Result (跳过搜索和分析)
- search:  Searcher → Result (最简路径)
- plan:    Planner → Reviewer → Result
- fix:     Planner → Searcher → Analyzer → Executor → Reviewer → Result
"""

from __future__ import annotations

from langgraph.graph import END, StateGraph

from helixcode.agent.context import AgentContext
from helixcode.agent.nodes.analyzer import AnalyzerNode
from helixcode.agent.nodes.executor import ExecutorNode
from helixcode.agent.nodes.planner import PlannerNode
from helixcode.agent.nodes.reviewer import ReviewerNode
from helixcode.agent.nodes.searcher import SearcherNode
from helixcode.agent.state import AgentState


def _route_after_planner(state: AgentState) -> str:
    """Planner 之后的路由：search/fix 进入 Searcher，plan 跳过。"""
    command = state.get('command', '')
    if command == 'plan':
        return 'reviewer'
    if command in ('explain', 'search', 'fix'):
        return 'searcher'
    # review 不需要 Planner
    return 'reviewer'


def _route_after_searcher(state: AgentState) -> str:
    """Searcher 之后的路由：explain/fix 进入 Analyzer，search 结束。"""
    command = state.get('command', '')
    if command == 'search':
        return 'reviewer'
    if command in ('explain', 'fix'):
        return 'analyzer'
    return 'reviewer'


def _route_after_analyzer(state: AgentState) -> str:
    """Analyzer 之后的路由：fix 进入 Executor，explain 进入 Reviewer。"""
    command = state.get('command', '')
    if command == 'fix':
        return 'executor'
    return 'reviewer'


def _route_after_executor(state: AgentState) -> str:
    """Executor 之后总是进入 Reviewer。"""
    return 'reviewer'


def _route_start(state: AgentState) -> str:
    """根据命令类型选择起始节点。"""
    command = state.get('command', '')
    if command == 'review':
        # review 直接执行（获取 git diff → 审查）
        return 'executor'
    if command == 'search':
        # search 直接搜索
        return 'searcher'
    # explain / plan / fix 都从 Planner 开始
    return 'planner'


def build_agent_graph(context: AgentContext) -> StateGraph:
    """构建 LangGraph 状态图。

    Args:
        context: 注入所有节点所需的依赖。

    Returns:
        编译后的 StateGraph，可调用 ainvoke() 执行。
    """
    # 创建节点实例
    planner = PlannerNode(context)
    searcher = SearcherNode(context)
    analyzer = AnalyzerNode(context)
    executor = ExecutorNode(context)
    reviewer = ReviewerNode(context)

    # 构建图
    workflow = StateGraph(AgentState)

    workflow.add_node('planner', planner.execute)
    workflow.add_node('searcher', searcher.execute)
    workflow.add_node('analyzer', analyzer.execute)
    workflow.add_node('executor', executor.execute)
    workflow.add_node('reviewer', reviewer.execute)

    # 设置入口：根据命令类型路由
    workflow.set_conditional_entry_point(
        _route_start,
        {
            'planner': 'planner',
            'searcher': 'searcher',
            'executor': 'executor',
        },
    )

    # 条件边：根据 command 决定下一步
    workflow.add_conditional_edges(
        'planner',
        _route_after_planner,
        {
            'searcher': 'searcher',
            'reviewer': 'reviewer',
        },
    )

    workflow.add_conditional_edges(
        'searcher',
        _route_after_searcher,
        {
            'analyzer': 'analyzer',
            'reviewer': 'reviewer',
        },
    )

    workflow.add_conditional_edges(
        'analyzer',
        _route_after_analyzer,
        {
            'executor': 'executor',
            'reviewer': 'reviewer',
        },
    )

    workflow.add_edge('executor', 'reviewer')
    workflow.add_edge('reviewer', END)

    return workflow.compile()
