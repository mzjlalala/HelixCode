"""CLI 入口和命令的测试。"""

from __future__ import annotations

from typer.testing import CliRunner

from helixcode.cli.main import app

runner = CliRunner()


class TestCLI:
    def test_help(self) -> None:
        result = runner.invoke(app, ['--help'])
        assert result.exit_code == 0
        assert 'explain' in result.stdout
        assert 'review' in result.stdout
        assert 'search' in result.stdout
        assert 'plan' in result.stdout
        assert 'fix' in result.stdout

    def test_version(self) -> None:
        result = runner.invoke(app, ['--version'])
        assert result.exit_code == 0
        assert 'HelixCode' in result.stdout

    def test_no_args_shows_help(self) -> None:
        result = runner.invoke(app, [])
        # Typer 的 no_args_is_help=True 会显示帮助并返回 exit code 2
        assert result.exit_code == 2
        assert 'Commands' in result.stdout

    def test_explain_help(self) -> None:
        result = runner.invoke(app, ['explain', '--help'])
        assert result.exit_code == 0
        assert 'TARGET' in result.stdout

    def test_review_help(self) -> None:
        result = runner.invoke(app, ['review', '--help'])
        assert result.exit_code == 0
        assert 'staged' in result.stdout

    def test_search_help(self) -> None:
        result = runner.invoke(app, ['search', '--help'])
        assert result.exit_code == 0
        assert 'QUERY' in result.stdout

    def test_plan_help(self) -> None:
        result = runner.invoke(app, ['plan', '--help'])
        assert result.exit_code == 0
        assert 'TASK' in result.stdout

    def test_fix_help(self) -> None:
        result = runner.invoke(app, ['fix', '--help'])
        assert result.exit_code == 0
        assert 'PROBLEM' in result.stdout

    def test_explain_no_target_shows_error(self) -> None:
        result = runner.invoke(app, ['explain'])
        assert result.exit_code != 0  # 缺少必需参数

    def test_search_no_query_shows_error(self) -> None:
        result = runner.invoke(app, ['search'])
        assert result.exit_code != 0

    def test_plan_no_task_shows_error(self) -> None:
        result = runner.invoke(app, ['plan'])
        assert result.exit_code != 0

    def test_fix_no_problem_shows_error(self) -> None:
        result = runner.invoke(app, ['fix'])
        assert result.exit_code != 0
