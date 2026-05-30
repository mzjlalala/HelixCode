"""兼容 OpenAI 协议的 ChatProvider 实现。

支持 OpenAI、DeepSeek、GLM、Kimi 等所有兼容 OpenAI API 的大模型。
针对 DeepSeek 的前缀缓存机制做了专门优化，提高缓存命中率。
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from openai import AsyncOpenAI, APIError, APITimeoutError, RateLimitError

from helixcode.config import LLMConfig
from helixcode.core.interfaces.llm import ChatProvider
from helixcode.core.exceptions import InfrastructureError, RateLimitExceededError

# 已知支持前缀缓存的模型前缀
_CACHE_AWARE_MODELS = (
    'deepseek',
    'glm',
)


class OpenAIChatProvider(ChatProvider):
    """兼容 OpenAI 协议的聊天补全 Provider。

    针对 DeepSeek 等模型的优化策略：
    1. system prompt 始终放在 messages[0]，作为固定前缀被缓存
    2. 同一场景复用相同的 system prompt 模板，避免频繁变动
    3. 使用 cache_prefix 机制预热常用上下文
    """

    def __init__(self, client: AsyncOpenAI, config: LLMConfig) -> None:
        self._client = client
        self._config = config
        # 缓存的固定前缀，用于提高 DeepSeek 等模型的缓存命中率
        self._cached_prefix: list[dict[str, str]] | None = None
        self._cache_key: str = ''

    def _is_cache_aware(self) -> bool:
        """判断当前模型是否支持前缀缓存。"""
        model_lower = self._config.chat_model.lower()
        return any(prefix in model_lower for prefix in _CACHE_AWARE_MODELS)

    def set_cache_prefix(
        self, messages: list[dict[str, str]], cache_key: str = ''
    ) -> None:
        """设置一个固定的消息前缀，在后续调用中复用。

        DeepSeek 等模型会对消息前缀进行缓存。如果多个请求共享相同的前缀
        （如 system prompt + 通用上下文），它们可以命中缓存，降低延迟和费用。

        Args:
            messages: 固定前缀消息列表
            cache_key: 缓存标识，用于区分不同前缀。留空则自动生成。
        """
        self._cached_prefix = list(messages)
        self._cache_key = cache_key or str(hash(str(messages)))
        # 预热缓存：发送一条最小请求让服务端缓存此前缀
        # 实际预热由调用方决定，这里只存储

    async def warmup_cache(self) -> None:
        """预热缓存：发送一个最小 token 的请求以触发服务端缓存前缀。

        仅在模型支持前缀缓存时调用，建议在应用启动时执行一次。
        """
        if not self._cached_prefix or not self._is_cache_aware():
            return

        try:
            warmup_msg = self._cached_prefix + [
                {'role': 'user', 'content': 'cache warmup — max_tokens=1'}
            ]
            await self._client.chat.completions.create(
                model=self._config.chat_model,
                messages=warmup_msg,
                max_tokens=1,
                temperature=0,
            )
        except Exception:
            pass  # 预热失败不影响正常使用

    async def chat(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        full_messages = self._build_messages(messages, system)
        temp = temperature if temperature is not None else self._config.temperature
        tokens = max_tokens if max_tokens is not None else self._config.max_tokens

        for attempt in range(1, self._config.max_retries + 2):
            try:
                response = await self._client.chat.completions.create(
                    model=self._config.chat_model,
                    messages=full_messages,
                    temperature=temp,
                    max_tokens=tokens,
                )
                return response.choices[0].message.content or ''

            except RateLimitError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise RateLimitExceededError(
                    f'超过速率限制，已重试 {self._config.max_retries} 次'
                ) from None

            except APITimeoutError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise InfrastructureError(
                    'LLM 请求超时',
                    detail=f'重试 {self._config.max_retries} 次后仍超时',
                ) from None

            except APIError as exc:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise InfrastructureError(
                    'LLM API 错误', detail=str(exc)
                ) from exc

        raise InfrastructureError('异常：耗尽重试次数但未抛出错误')

    async def chat_stream(
        self,
        messages: list[dict[str, str]],
        *,
        system: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        full_messages = self._build_messages(messages, system)
        temp = temperature if temperature is not None else self._config.temperature
        tokens = max_tokens if max_tokens is not None else self._config.max_tokens

        for attempt in range(1, self._config.max_retries + 2):
            try:
                stream = await self._client.chat.completions.create(
                    model=self._config.chat_model,
                    messages=full_messages,
                    temperature=temp,
                    max_tokens=tokens,
                    stream=True,
                )
                async for chunk in stream:
                    delta = chunk.choices[0].delta
                    if delta and delta.content:
                        yield delta.content
                return

            except RateLimitError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise RateLimitExceededError(
                    f'超过速率限制，已重试 {self._config.max_retries} 次'
                ) from None

            except APITimeoutError:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(2 ** attempt)
                    continue
                raise InfrastructureError(
                    'LLM 流式请求超时'
                ) from None

            except APIError as exc:
                if attempt <= self._config.max_retries:
                    await asyncio.sleep(max(1, 2 ** attempt))
                    continue
                raise InfrastructureError(
                    'LLM 流式 API 错误', detail=str(exc)
                ) from exc

    def _build_messages(
        self,
        messages: list[dict[str, str]],
        system: str | None,
    ) -> list[dict[str, str]]:
        """构建消息列表，固定前缀优化缓存命中率。

        DeepSeek 缓存策略：
        - system prompt 放第一位，作为缓存锚点
        - 如果设置了 cached_prefix 且 model 支持缓存，复用前缀
        - system prompt 之后按 role 分组排列，保持结构稳定
        """
        result: list[dict[str, str]] = []

        # 缓存前缀优先（DeepSeek/GLM 等模型会缓存此前缀）
        if self._is_cache_aware() and self._cached_prefix:
            result.extend(self._cached_prefix)

        # system prompt 必须放在消息列表最前面才能被缓存
        if system and not self._cached_prefix:
            result.append({'role': 'system', 'content': system})
        elif system:
            # 有缓存前缀时，system 追加到前缀后面（避免破坏缓存结构）
            result.append({'role': 'system', 'content': system})

        result.extend(messages)
        return result
