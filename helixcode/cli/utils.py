"""CLI 共享工具 — 配置加载、错误处理、公共参数。"""

from __future__ import annotations

from pathlib import Path

from helixcode.config import Settings


def load_settings(project_root: str | None = None) -> Settings:
    """加载配置，支持通过命令行参数覆盖项目根目录。

    Args:
        project_root: 可选，覆盖 .env 中的项目根目录。

    Returns:
        完整的 Settings 实例。
    """
    settings = Settings()
    if project_root:
        settings.project_root = project_root
    return settings


def resolve_project_path(project_root: str) -> Path:
    """解析并验证项目根目录。"""
    path = Path(project_root).resolve()
    if not path.exists():
        raise FileNotFoundError(f'项目目录不存在: {project_root}')
    return path


def validate_api_key(settings: Settings) -> None:
    """验证是否配置了 API Key，未设置则直接中断并提示。"""
    if not settings.llm.api_key:
        from helixcode.core.exceptions import ConfigurationError
        raise ConfigurationError(
            '未设置 API Key。\n'
            '请设置环境变量 HELIX_API_KEY，或创建 .env 文件：\n'
            '  echo HELIX_API_KEY=sk-xxx > .env\n'
            '\n'
            '支持的 API 提供商（兼容 OpenAI 协议）:\n'
            '  - OpenAI: https://api.openai.com/v1\n'
            '  - DeepSeek: https://api.deepseek.com/v1\n'
            '  - GLM (智谱): https://open.bigmodel.cn/api/paas/v4\n'
            '  - Kimi (月之暗面): https://api.moonshot.cn/v1\n'
            '\n'
            '通过 HELIX_BASE_URL 设置 API 地址。'
        )
