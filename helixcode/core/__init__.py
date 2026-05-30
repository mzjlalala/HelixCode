"""Core domain layer — entities, value objects, exceptions, and interfaces."""

from helixcode.core.entities import CallChain, CodeDiff, CodeLocation, CodeSymbol, SymbolKind
from helixcode.core.exceptions import (
    AgentError,
    ConfigurationError,
    DomainError,
    GitRepositoryNotFoundError,
    HelixCodeError,
    InfrastructureError,
    InvalidSearchQueryError,
    PlanExecutionError,
    RateLimitExceededError,
    SymbolNotFoundError,
)
from helixcode.core.value_objects import (
    Problem,
    ProblemSeverity,
    SearchResult,
    TaskPlan,
    TaskStep,
)

__all__ = [
    # entities
    'CallChain',
    'CodeDiff',
    'CodeLocation',
    'CodeSymbol',
    'SymbolKind',
    # exceptions
    'AgentError',
    'ConfigurationError',
    'DomainError',
    'GitRepositoryNotFoundError',
    'HelixCodeError',
    'InfrastructureError',
    'InvalidSearchQueryError',
    'PlanExecutionError',
    'RateLimitExceededError',
    'SymbolNotFoundError',
    # value_objects
    'Problem',
    'ProblemSeverity',
    'SearchResult',
    'TaskPlan',
    'TaskStep',
]
