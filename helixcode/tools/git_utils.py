"""Git operations via GitPython."""

from __future__ import annotations

from pathlib import Path

from git import InvalidGitRepositoryError, NoSuchPathError, Repo


class GitUtils:
    """Wraps common GitPython operations for use by the agent pipeline."""

    def __init__(self, project_root: str | Path = '.') -> None:
        self._project_root = Path(project_root)

    def get_repo(self) -> Repo:
        """Return the :class:`~git.Repo` for the project root.

        Raises:
            GitRepositoryNotFoundError: If no git repository is found.
        """
        from helixcode.core.exceptions import GitRepositoryNotFoundError

        try:
            return Repo(self._project_root, search_parent_directories=True)
        except (InvalidGitRepositoryError, NoSuchPathError):
            raise GitRepositoryNotFoundError(str(self._project_root))

    def get_diff(self, *, staged_only: bool = False) -> str:
        """Return the current working tree diff.

        Args:
            staged_only: When ``True``, only show staged changes.
        """
        repo = self.get_repo()
        if staged_only:
            return repo.git.diff('--cached')
        return repo.git.diff()

    def get_changed_files(self, *, staged_only: bool = False) -> list[str]:
        """Return a list of changed file paths (relative to repo root)."""
        repo = self.get_repo()
        if staged_only:
            # Staged + unstaged would need different logic;
            # for simplicity we return both for now when not staged_only
            diff_index = repo.index.diff(None)
        else:
            diff_index = repo.index.diff(None) + repo.index.diff(repo.head.commit)

        files: set[str] = set()
        for diff in diff_index:
            if diff.a_path:
                files.add(diff.a_path)
            if diff.b_path:
                files.add(diff.b_path)
        return sorted(files)

    def get_log(
        self,
        *,
        max_count: int = 10,
        author: str | None = None,
        since: str | None = None,
    ) -> list[dict[str, str]]:
        """Return recent commits as a list of dicts.

        Args:
            max_count: Maximum number of commits.
            author: Filter by author name.
            since: Date string (e.g. ``'2024-01-01'``).
        """
        repo = self.get_repo()
        kwargs = {'max_count': max_count}
        if author:
            kwargs['author'] = author
        if since:
            kwargs['since'] = since

        commits = list(repo.iter_commits(**kwargs))
        return [
            {
                'hash': c.hexsha,
                'author': str(c.author),
                'date': c.committed_datetime.isoformat(),
                'message': c.message.strip(),
            }
            for c in commits
        ]

    def get_file_diff(self, file_path: str) -> str:
        """Return the diff for a single file."""
        repo = self.get_repo()
        return repo.git.diff('--', file_path)
