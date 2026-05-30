"""Tests for file_utils."""

from __future__ import annotations

import tempfile
from pathlib import Path

from helixcode.tools.file_utils import find_files, get_project_structure, read_file, resolve_path


class TestResolvePath:
    def test_joins_relative_to_root(self) -> None:
        result = resolve_path('/project', 'src/main.py')
        assert str(result).endswith('project/src/main.py'.replace('/', '\\'))

    def test_resolves_dot_dot(self) -> None:
        result = resolve_path('/project/src', '../other/file.py')
        assert str(result).endswith('project/other/file.py'.replace('/', '\\'))


class TestReadFile:
    def test_full_read(self) -> None:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write('line 1\nline 2\nline 3\n')
            f.flush()
            content = read_file(f.name)

        assert content == 'line 1\nline 2\nline 3\n'
        Path(f.name).unlink()

    def test_line_range(self) -> None:
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write('a\nb\nc\nd\ne\n')
            f.flush()
            content = read_file(f.name, start_line=2, end_line=4)

        assert content == 'b\nc\nd'
        Path(f.name).unlink()

    def test_missing_file_raises(self) -> None:
        import pytest
        with pytest.raises(FileNotFoundError):
            read_file('/nonexistent/file.py')


class TestFindFiles:
    def test_finds_files_by_pattern(self, tmp_path: Path) -> None:
        (tmp_path / 'a.py').write_text('')
        (tmp_path / 'b.py').write_text('')
        (tmp_path / 'c.txt').write_text('')

        results = find_files(tmp_path, pattern='*.py')
        names = [r.name for r in results]
        assert names == ['a.py', 'b.py']

    def test_excludes_dirs(self, tmp_path: Path) -> None:
        (tmp_path / 'src').mkdir()
        (tmp_path / '__pycache__').mkdir()
        (tmp_path / 'src' / 'app.py').write_text('')
        (tmp_path / '__pycache__' / 'cached.py').write_text('')

        results = find_files(tmp_path, pattern='*.py', exclude_dirs=['__pycache__'])
        names = [r.name for r in results]
        assert names == ['app.py']


class TestGetProjectStructure:
    def test_returns_dict(self, tmp_path: Path) -> None:
        (tmp_path / 'main.py').write_text('')
        tree = get_project_structure(tmp_path)
        assert tree['type'] == 'directory'
        children_names = [c['name'] for c in tree['children']]
        assert 'main.py' in children_names
