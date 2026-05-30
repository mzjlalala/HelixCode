你是一名资深 AI Agent 架构师、Python 工程师和开源项目设计专家。

请帮助我开发一个开源项目：

项目名称：HelixCode

项目定位：

HelixCode 是一个类似 Claude Code、Codex CLI、Aider 的 AI Software Engineering Agent。

目标用户：

软件开发工程师

核心目标：

让用户能够通过 CLI 与 AI Agent 交互，对本地代码仓库进行分析、理解、修改、测试和提交。

--------------------------------------------------

# 技术要求

编程语言：

Python 3.13+

技术栈：

- Typer
- LangGraph
- OpenAI SDK
- MCP
- TreeSitter
- Qdrant
- SQLite
- GitPython
- Loguru
- Pydantic

遵循：

- Clean Architecture
- Domain Driven Design
- SOLID
- Dependency Injection

--------------------------------------------------

# 第一阶段功能

实现以下命令：

helix explain

helix review

helix search

helix plan

helix fix

--------------------------------------------------

# explain

示例：

helix explain OrderService

功能：

- 搜索代码
- 定位目标
- 分析调用链
- 生成解释

--------------------------------------------------

# review

示例：

helix review

功能：

- 获取 git diff
- 审查变更代码
- 输出问题

问题级别：

CRITICAL

WARNING

SUGGESTION

--------------------------------------------------

# search

示例：

helix search "订单超时"

功能：

- 基于代码索引进行语义检索
- 返回相关文件
- 返回相关方法

--------------------------------------------------

# plan

示例：

helix plan "增加导出功能"

功能：

Agent 自动拆解任务：

1. Controller

2. Service

3. Repository

4. DTO

5. Test

生成任务执行计划

--------------------------------------------------

# fix

示例：

helix fix "修复订单超时问题"

功能：

- 分析代码
- 找到修改点
- 生成 diff
- 不直接覆盖文件

--------------------------------------------------

# Agent架构

采用 LangGraph

节点：

Planner

Searcher

Analyzer

Executor

Reviewer

Memory

工作流：

User Request

↓

Planner

↓

Searcher

↓

Analyzer

↓

Executor

↓

Reviewer

↓

Result

--------------------------------------------------

# MCP要求

支持：

filesystem

git

terminal

docker

未来支持：

playwright

mysql

postgres

redis

--------------------------------------------------

# RAG要求

代码索引：

TreeSitter

Embedding：

OpenAI Embedding

向量库：

Qdrant

索引内容：

- 文件
- 类
- 方法
- 注释

--------------------------------------------------

# Memory要求

Session Memory

Repository Memory

Long-term Memory

Repository Memory示例：

技术栈

项目结构

数据库信息

中间件信息

--------------------------------------------------

# 项目目录结构

请设计完整目录结构：

src/

core/

agent/

memory/

rag/

mcp/

cli/

llm/

tools/

storage/

tests/

docs/

要求说明每个目录职责。

--------------------------------------------------

# 编码要求

生成代码时：

1. 优先生成完整实现

2. 不要伪代码

3. 不要省略 import

4. 不要使用 TODO 占位

5. 所有代码可运行

6. 每个模块附带说明

7. 遵循生产级代码规范

--------------------------------------------------

# 输出要求

每次只生成一个模块。

输出顺序：

1. 模块设计说明

2. 文件结构

3. 完整代码

4. 单元测试

5. 下一步开发建议

不要一次生成整个项目。