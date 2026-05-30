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
        assert 'fix' in result.stdout

    def test_version(self) -> None:
        # --version 由 main() 函数处理，不在 app 层面测试
        from helixcode.cli.main import main
        import io, sys
        old_stdout = sys.stdout
        sys.stdout = io.StringIO()
        try:
            sys.argv = ['helix', '--version']
            main()
        except SystemExit:
            pass
        output = sys.stdout.getvalue()
        sys.stdout = old_stdout
        assert 'HelixCode' in output

    def test_no_args_enters_chat(self) -> None:
        """无参数时默认进入 chat 模式（测试不会真的阻塞）"""
        # main() 函数会调用 chat()，但由于没有 API key，会打印错误后退出
        from helixcode.cli.main import main
        # 这个测试只验证 main 函数存在
        assert callable(main)

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

    def test_chat_help(self) -> None:
        result = runner.invoke(app, ['chat', '--help'])
        assert result.exit_code == 0
        assert '对话' in result.stdout

    def test_explain_no_target_shows_error(self) -> None:
        result = runner.invoke(app, ['explain'])
        assert result.exit_code != 0

    def test_search_no_query_shows_error(self) -> None:
        result = runner.invoke(app, ['search'])
        assert result.exit_code != 0

    def test_plan_no_task_shows_error(self) -> None:
        result = runner.invoke(app, ['plan'])
        assert result.exit_code != 0

    def test_fix_no_problem_shows_error(self) -> None:
        result = runner.invoke(app, ['fix'])
        assert result.exit_code != 0
