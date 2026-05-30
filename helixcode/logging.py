"""Logging setup via Loguru."""

from __future__ import annotations

import sys

from loguru import logger


def setup_logging(level: str = 'INFO') -> None:
    """Initialize Loguru with a standardized format and the requested level.

    Removes the default handler and installs a new one writing to stderr
    with colorized, structured output.
    """
    logger.remove()

    logger.add(
        sys.stderr,
        level=level,
        format=(
            '<green>{time:HH:mm:ss}</green> | '
            '<level>{level: <8}</level> | '
            '<cyan>{extra[module]: <12}</cyan> | '
            '<level>{message}</level>'
        ),
        colorize=True,
    )


def get_logger(module: str):
    """Return a logger instance bound to *module* for structured log filtering."""
    return logger.bind(module=module)
