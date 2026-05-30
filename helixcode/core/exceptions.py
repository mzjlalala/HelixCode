"""Domain exception hierarchy.

Every exception raised in HelixCode inherits from :exc:`HelixCodeError`.
This allows the CLI to catch a single root type and format user-friendly
messages regardless of which layer produced the error.
"""

from __future__ import annotations


class HelixCodeError(Exception):
    """Root of the HelixCode exception hierarchy."""

    def __init__(self, message: str, *, detail: str | None = None) -> None:
        super().__init__(message)
        self.detail = detail


class DomainError(HelixCodeError):
    """Raised when a business rule or domain invariant is violated."""


class InfrastructureError(HelixCodeError):
    """Raised by infrastructure adapters (database, network, file system)."""


class AgentError(HelixCodeError):
    """Raised when the agent pipeline encounters an unrecoverable error."""


# --- Domain-specific errors ---


class SymbolNotFoundError(DomainError):
    """The requested code symbol could not be found in the index."""

    def __init__(self, symbol_name: str) -> None:
        super().__init__(f'Symbol not found: {symbol_name}')
        self.symbol_name = symbol_name


class InvalidSearchQueryError(DomainError):
    """The search query is malformed or empty."""


class PlanExecutionError(AgentError):
    """The agent failed to execute a plan step."""


class GitRepositoryNotFoundError(InfrastructureError):
    """No git repository was found at the given path."""

    def __init__(self, path: str) -> None:
        super().__init__(f'No git repository found at: {path}')
        self.path = path


class ConfigurationError(HelixCodeError):
    """Raised when the configuration is invalid (missing API key, bad URL, etc.)."""


class RateLimitExceededError(InfrastructureError):
    """Raised when the LLM rate limit is exceeded and retries have been exhausted."""
