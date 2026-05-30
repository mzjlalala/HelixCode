"""Lightweight Dependency Injection container.

All services are lazily initialised via properties. Each module's factory
methods are added as the module is implemented. The container is driven by
a single :class:`~helixcode.config.Settings` instance.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from helixcode.config import Settings


@dataclass
class Container:
    """Holds singleton service instances wired from *settings*."""

    settings: Settings
