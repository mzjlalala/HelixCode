"""Tests for GitUtils."""

from __future__ import annotations

from pathlib import Path

import pytest
from git import Repo

from helixcode.tools.git_utils import GitUtils


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Create a temporary git repository with one commit."""
    repo = Repo.init(tmp_path)
    repo.git.config('user.name', 'Test User')
    repo.git.config('user.email', 'test@test.com')

    (tmp_path / 'README.md').write_text('# Test\n')
    repo.index.add(['README.md'])
    repo.index.commit('Initial commit')
    return tmp_path


class TestGitUtils:
    def test_get_repo_returns_repo(self, git_repo: Path) -> None:
        utils = GitUtils(git_repo)
        repo = utils.get_repo()
        assert isinstance(repo, Repo)

    def test_get_log(self, git_repo: Path) -> None:
        utils = GitUtils(git_repo)
        log = utils.get_log(max_count=5)
        assert len(log) == 1
        assert log[0]['message'] == 'Initial commit'

    def test_get_diff_clean_repo(self, git_repo: Path) -> None:
        utils = GitUtils(git_repo)
        diff = utils.get_diff()
        assert diff == ''

    def test_get_diff_with_changes(self, git_repo: Path) -> None:
        (git_repo / 'README.md').write_text('# Changed\n')
        utils = GitUtils(git_repo)
        diff = utils.get_diff()
        assert '# Changed' in diff

    def test_get_changed_files(self, git_repo: Path) -> None:
        new_file = git_repo / 'new_file.py'
        new_file.write_text('x=1\n')
        repo = Repo(git_repo)
        repo.index.add(['new_file.py'])
        utils = GitUtils(git_repo)
        files = utils.get_changed_files()
        assert 'new_file.py' in files

    def test_repo_not_found(self, tmp_path: Path) -> None:
        from helixcode.core.exceptions import GitRepositoryNotFoundError
        utils = GitUtils(tmp_path / 'no_repo_here')
        with pytest.raises(GitRepositoryNotFoundError):
            utils.get_repo()
