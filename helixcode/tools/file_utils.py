"""File system utilities: discovery, reading, path resolution."""

from __future__ import annotations

from pathlib import Path


def resolve_path(root: str | Path, relative: str) -> Path:
    """Join *root* and *relative*, resolving ``..`` and symlinks."""
    return (Path(root) / relative).resolve()


def find_files(
    root: str | Path,
    *,
    pattern: str = '*',
    exclude_dirs: list[str] | None = None,
) -> list[Path]:
    """Recursively find files matching *pattern* under *root*.

    Directories listed in *exclude_dirs* are skipped entirely.
    """
    root = Path(root)
    exclude = set(exclude_dirs or [])
    results: list[Path] = []

    for entry in root.rglob(pattern):
        if entry.is_file() and not any(
            d in entry.parts for d in exclude
        ):
            results.append(entry)

    return sorted(results)


def read_file(
    path: str | Path,
    start_line: int | None = None,
    end_line: int | None = None,
) -> str:
    """Read the contents of *path*, optionally sliced by line range.

    Line numbers are 1-indexed, matching :class:`~helixcode.core.entities.CodeLocation`.
    """
    file_path = Path(path)
    if not file_path.exists():
        raise FileNotFoundError(f'File not found: {path}')

    text = file_path.read_text(encoding='utf-8')

    if start_line is not None or end_line is not None:
        lines = text.splitlines()
        start = max(0, (start_line or 1) - 1)
        end = len(lines) if end_line is None else min(len(lines), end_line)
        return '\n'.join(lines[start:end])

    return text


def get_project_structure(root: str | Path, max_depth: int = 4) -> dict:
    """Return a nested dict representing the project directory tree.

    Hidden directories and ``__pycache__`` are excluded.
    """
    root = Path(root)
    tree: dict = {'name': root.name, 'type': 'directory', 'children': []}

    def _walk(current: Path, depth: int) -> list[dict]:
        if depth > max_depth:
            return []
        entries: list[dict] = []
        try:
            for child in sorted(current.iterdir()):
                name = child.name
                if name.startswith('.') or name == '__pycache__':
                    continue
                if child.is_dir():
                    entries.append({
                        'name': name,
                        'type': 'directory',
                        'children': _walk(child, depth + 1),
                    })
                elif child.is_file():
                    entries.append({
                        'name': name,
                        'type': 'file',
                    })
        except PermissionError:
            pass
        return entries

    tree['children'] = _walk(root, 1)
    return tree
