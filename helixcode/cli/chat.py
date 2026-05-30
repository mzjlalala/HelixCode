"""HelixCode 交互式对话模式 — 流式输出，类似 Claude Code。

输入 helix 进入对话，一个 LLM 请求流式输出，自动智能响应。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

from helixcode.config import Settings
from helixcode.core.interfaces.llm import ChatProvider
from helixcode.memory.session import InMemorySession

console = Console()


# 核心系统提示词 — 让 LLM 自动判断用户意图并做对应处理
SYSTEM_PROMPT = """你是 HelixCode，一个专业的 AI 代码助手。你可以：

- 📖 分析代码：解释代码结构、调用链、依赖关系
- 🔧 修复问题：找到 bug 并给出修复方案
- 🔍 搜索代码：在项目中查找相关文件和符号
- 📋 制定计划：将复杂任务拆解为可执行的步骤
- ✅ 审查代码：发现代码中的问题和改进点
- 💬 一般对话：回答技术问题

## 工作规则

1. 如果用户提到具体的**类名、文件名、方法名**，先尝试在项目中查找相关代码文件，然后分析
2. 如果用户让你**修复 bug**，先分析原因，再给出具体 diff
3. 如果用户让你**审查代码**，按严重级别（CRITICAL/WARNING/SUGGESTION）列出问题
4. 如果用户问**一般的编程问题**，直接回答
5. 每次回复后，询问用户是否需要进一步帮助

## 回复格式

- 用 Markdown 格式，关键内容用粗体
- 代码块用 ``` 包裹并标注语言
- 涉及文件路径时用 ` 包裹
- 用中文回复，代码和术语保持英文
- 简洁直接，不要啰嗦
"""


class HelixChat:
    """HelixCode 交互式对话引擎 — 单次 LLM 调用，流式输出。"""

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

            # 内置命令
            if user_input.startswith('/'):
                self._handle_command(user_input)
                continue

            # 处理消息
            await self._respond(user_input)

    async def _respond(self, user_input: str) -> None:
        """流式响应用户输入。

        流程：查找相关代码 → 构建上下文 → 流式输出 LLM 回复。
        """
        self._session.add_message('user', user_input)

        # 1. 查找相关文件
        code_context, file_count = self._gather_context(user_input)
        if file_count > 0:
            console.print(f'  [dim]📄 已加载 {file_count} 个相关文件[/]')

        # 2. 构建消息：有文件上下文时放在用户消息里；无上下文时直接用原始输入
        if code_context:
            user_message = (
                f'{user_input}\n\n'
                f'--- 项目相关文件 ---\n\n{code_context}'
            )
        else:
            user_message = user_input

        # 3. 流式输出
        console.print()
        console.print('[bold green]Helix:[/] ', end='')

        history = self._session.get_conversation()
        full_response = ''

        try:
            system_prompt = SYSTEM_PROMPT + f'\n\n当前项目: {self._project_root}'
            if code_context:
                system_prompt += '\n用户消息中已附带相关文件内容，请直接分析，不要说找不到文件。'

            stream = self._chat.chat_stream(
                history[:-1] if len(history) > 1 else [],
                system=system_prompt,
            )

            # 流式输出，token 级别的实时展示
            async for token in stream:
                console.print(token, end='')
                full_response += token

            console.print()
            self._session.add_message('assistant', full_response)

        except Exception as exc:
            console.print(f'\n[red]错误: {exc}[/]')

    def _gather_context(self, user_input: str) -> tuple[str | None, int]:
        """从用户输入中提取目标，查找文件并读取内容作为上下文。

        返回: (上下文字符串, 加载的文件数)
        """
        # 提取类名: 大写开头驼峰，长度 >= 3
        class_names = re.findall(r'\b([A-Z][a-zA-Z0-9]{2,})\b', user_input)
        # 提取文件名: 明确包含 .扩展名
        file_names = re.findall(
            r'([a-zA-Z0-9_./-]+\.(java|py|js|ts|go|rs|cpp|c|h|md|txt))',
            user_input,
        )
        file_names = [f[0] for f in file_names]

        candidates = set(class_names) | set(file_names)
        if not candidates:
            return None, 0

        loaded: list[str] = []
        loaded_count = 0

        for name in candidates:
            if len(name) < 3:
                continue

            # 搜索优先级: 精确路径 > 根目录 > 子目录
            for pattern in [
                name,                           # 精确路径
                f'{name}.java',                 # 根目录 + 扩展名
                f'{name}.py',
                f'{name}',
                f'**/{name}.java',              # 子目录搜索
                f'**/{name}.py',
                f'**/{name}.*',
            ]:
                matches = list(self._project_root.glob(pattern))
                if matches:
                    for match in matches[:3]:
                        try:
                            content = match.read_text(
                                encoding='utf-8', errors='replace'
                            )
                            if len(content) > 6000:
                                content = content[:6000] + '\n... (截断)'
                            loaded.append(
                                f'### {match.relative_to(self._project_root)}\n'
                                f'```\n{content}\n```'
                            )
                            loaded_count += 1
                        except Exception:
                            pass
                    break  # 找到匹配就跳出 pattern 循环

        return ('\n\n'.join(loaded) if loaded else None), loaded_count

    def _handle_command(self, cmd: str) -> None:
        """处理内置命令。"""
        action = cmd.split()[0].lower()

        if action == '/help':
            console.print("""
[bold]可用命令:[/]
  [cyan]/help[/]     - 显示帮助
  [cyan]/clear[/]    - 清空对话历史
  [cyan]/quit[/]     - 退出
  [cyan]/files[/]    - 重新加载当前项目的文件索引

[bold]使用方式:[/]
  直接输入你的问题或需求，AI 会自动理解并处理。
  例如:
  - "分析 GitLabWebhookController 的逻辑"
  - "帮我修一下这个 NPE"
  - "审查最近的改动"
  - "怎么用 CompletableFuture？"
            """)
        elif action == '/clear':
            self._session.clear()
            console.print('[dim]对话历史已清空[/]')
        elif action in ('/quit', '/exit', '/q'):
            console.print('[dim]再见！[/]')
            sys.exit(0)
        elif action == '/files':
            console.print('[dim]正在扫描项目文件...[/]')
            py_files = list(self._project_root.glob('**/*.py'))
            java_files = list(self._project_root.glob('**/*.java'))
            console.print(f'  找到 {len(py_files)} 个 .py 文件, {len(java_files)} 个 .java 文件')
        else:
            console.print(f'[yellow]未知命令: {action}，输入 /help 查看帮助[/]')

    def _print_welcome(self) -> None:
        """打印欢迎信息。"""
        console.print()
        console.print(Panel(
            '[bold cyan]🧬 HelixCode[/] — AI 代码助手\n\n'
            '我能帮你分析代码、修复 bug、制定计划、审查变更。\n'
            '直接输入需求，我会自动查找相关文件并流式回复。\n\n'
            '[dim]/help 帮助 | /quit 退出[/]',
            border_style='cyan',
        ))
