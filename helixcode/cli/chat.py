"""HelixCode 交互式对话模式 — 类似 Claude Code 的 REPL 体验。

输入 helix 即可进入对话，AI 自动识别意图、分析代码、流式输出思考过程。
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel
from rich.spinner import Spinner

from helixcode.agent.context import AgentContext
from helixcode.agent.orchestrator import AgentOrchestrator
from helixcode.config import Settings
from helixcode.core.interfaces.llm import ChatProvider
from helixcode.memory.session import InMemorySession

console = Console()

# 意图识别的系统提示 — 用最少的 token 判断用户想干什么
INTENT_PROMPT = """分析用户输入，判断意图，返回 JSON:
{"intent": "explain|fix|search|plan|review|chat", "target": "目标", "query": "完整查询"}

- explain: 分析代码结构、调用链
- fix: 修复 bug
- search: 搜索代码
- plan: 制定执行计划
- review: 审查代码变更
- chat: 一般对话

只返回 JSON，不要其他内容。"""


class HelixChat:
    """HelixCode 交互式对话引擎。"""

    def __init__(
        self,
        chat_provider: ChatProvider,
        settings: Settings,
        project_root: Path,
    ) -> None:
        self._chat = chat_provider
        self._settings = settings
        self._project_root = project_root
        self._session = InMemorySession()
        self._orchestrator: AgentOrchestrator | None = None

    async def _init_orchestrator(self) -> AgentOrchestrator:
        """延迟初始化编排器，只在需要执行任务时创建。"""
        if self._orchestrator is None:
            from helixcode.cli.bootstrap import create_orchestrator
            self._orchestrator = await create_orchestrator(
                self._settings, str(self._project_root)
            )
        return self._orchestrator

    async def _detect_intent(self, user_input: str) -> dict[str, str]:
        """用 LLM 快速判断用户意图。"""
        try:
            response = await self._chat.chat(
                [{'role': 'user', 'content': user_input}],
                system=INTENT_PROMPT,
                temperature=0,
                max_tokens=100,
            )
            # 提取 JSON
            response = response.strip()
            if response.startswith('```'):
                response = response.split('\n', 1)[1].rsplit('\n', 1)[0]
            return json.loads(response)
        except Exception:
            # 意图识别失败，默认为 chat
            return {'intent': 'chat', 'target': '', 'query': user_input}

    async def run(self) -> None:
        """启动交互式对话循环。"""
        self._print_welcome()

        while True:
            try:
                user_input = console.input('\n[bold cyan]你:[/] ').strip()
            except (EOFError, KeyboardInterrupt):
                console.print('\n[dim]再见！[/]')
                break

            if not user_input:
                continue

            # 处理内置命令
            if user_input.startswith('/'):
                await self._handle_command(user_input)
                continue

            # 处理用户消息
            await self._handle_message(user_input)

    async def _handle_message(self, user_input: str) -> None:
        """处理用户输入 — 意图识别 → 执行 → 展示结果。"""
        # 1. 意图识别
        with console.status('[dim]正在理解你的意图...[/]'):
            intent = await self._detect_intent(user_input)

        intent_type = intent.get('intent', 'chat')
        query = intent.get('query', user_input)

        console.print(f'  [dim]🎯 识别意图: {intent_type}[/]')

        # 2. 根据意图执行
        if intent_type == 'chat':
            await self._handle_chat(user_input)
        else:
            await self._handle_task(intent_type, query)

    async def _handle_chat(self, user_input: str) -> None:
        """一般对话 — 流式输出 LLM 回复。"""
        self._session.add_message('user', user_input)
        console.print('\n[bold green]Helix:[/]')

        # 构建消息列表，包含历史
        history = self._session.get_conversation()

        try:
            stream = self._chat.chat_stream(
                history[:-1],  # 历史消息
                system=CHAT_SYSTEM_PROMPT,
            )

            full_response = ''
            async for token in stream:
                console.print(token, end='')
                full_response += token

            console.print()  # 换行
            self._session.add_message('assistant', full_response)

        except Exception as exc:
            console.print(f'\n[red]错误: {exc}[/]')

    async def _handle_task(self, intent: str, query: str) -> None:
        """执行具体任务（explain/fix/search/plan/review）。"""
        self._session.add_message('user', query)

        console.print(f'\n[bold green]Helix[/] [dim]({intent})[/]:')

        try:
            orch = await self._init_orchestrator()
            result = await orch.run(query, command=intent)

            # 展示结果
            if result.get('errors'):
                for err in result['errors']:
                    console.print(f'  [red]✗ {err}[/]')

            final = result.get('final_result', '')
            if final:
                console.print(Markdown(final))

            self._session.add_message('assistant', final or '任务完成')

        except Exception as exc:
            console.print(f'\n[red]执行失败: {exc}[/]')

    async def _handle_command(self, cmd: str) -> None:
        """处理斜杠命令。"""
        parts = cmd.split()
        action = parts[0].lower()

        if action == '/help':
            console.print("""
[bold]可用命令:[/]
  [cyan]/help[/]     - 显示帮助
  [cyan]/clear[/]    - 清空对话历史
  [cyan]/quit[/]     - 退出
  [cyan]/explain[/]  - 分析代码
  [cyan]/fix[/]      - 修复问题
  [cyan]/search[/]   - 搜索代码
  [cyan]/plan[/]     - 制定计划
  [cyan]/review[/]   - 审查变更
            """)
        elif action == '/clear':
            self._session.clear()
            console.print('[dim]对话历史已清空[/]')
        elif action in ('/quit', '/exit', '/q'):
            console.print('[dim]再见！[/]')
            sys.exit(0)
        elif action in ('/explain', '/fix', '/search', '/plan', '/review'):
            target = ' '.join(parts[1:])
            if target:
                await self._handle_task(action[1:], target)
            else:
                console.print('[yellow]请指定目标，如: /explain OrderService[/]')
        else:
            console.print(f'[yellow]未知命令: {action}，输入 /help 查看帮助[/]')

    def _print_welcome(self) -> None:
        """打印欢迎信息。"""
        console.print()
        console.print(Panel(
            '[bold cyan]🧬 HelixCode[/] — AI 代码助手\n\n'
            '我能帮你分析代码、修复 bug、搜索代码库、制定计划。\n'
            '直接输入你的需求，我会自动理解并执行。\n\n'
            '[dim]输入 /help 查看帮助，/quit 退出[/]',
            border_style='cyan',
        ))


# 对话模式的系统提示词
CHAT_SYSTEM_PROMPT = """你是 HelixCode，一个 AI 代码助手。你可以帮助用户:

- 📖 分析和解释代码
- 🔧 查找和修复 bug
- 🔍 搜索代码库
- 📋 制定开发计划
- ✅ 审查代码变更

你可以访问用户的文件系统、git 仓库和代码索引。
当用户需要帮助时，先理解他们的需求，再给出具体可操作的方案。

回复风格:
- 简洁直接，不要啰嗦
- 涉及到代码的，给出具体文件路径和行号
- 用中文回复，代码和术语保持英文
- 如果问到超出能力范围的事情，诚实说明
"""
