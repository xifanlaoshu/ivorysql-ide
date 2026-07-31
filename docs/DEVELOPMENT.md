# IvorySQL PL/iSQL Developer VS Code 插件开发文档与 PL/SQL Developer 功能对比分析

---

## 概述

本文档旨在梳理经典 Oracle **PL/SQL Developer** 工具在**代码开发**、**数据库维护**、**版本控制**及**调试运维**方面的优秀功能矩阵，并详细对照本插件（**IvorySQL PL/iSQL Developer IDE for VS Code**）的技术实现方案与功能支持状态。

---

## 一、 PL/SQL Developer 与 IvorySQL IDE 功能对照矩阵

| 核心领域 | PL/SQL Developer 经典功能 | IvorySQL IDE 插件实现方案 | 插件支持状态 | 快捷键 / 触发方式 |
| :--- | :--- | :--- | :---: | :--- |
| **代码高亮** | Syntax Highlighting (Oracle PL/SQL) | TextMate Grammar + Semantic Tokens (`plisql.tmLanguage.json`) | ✅ 完全支持 | 打开 `.pkh` / `.pkb` / `.pls` / `.sql` 自动激活 |
| **包协同开发** | Header & Body Toggle (Alt+O) | 自动解析包头 `.pkh` 与包体 `.pkb` 双向配对 | ✅ 完全支持 | `Alt + O` (Mac: `Option + O`) |
| **代码美化** | PL/SQL Beautifier | 原生 `DocumentFormattingEditProvider` (大写转换 + 块缩进) | ✅ 完全支持 | `Shift + Alt + F` |
| **智能补全** | Code Assistant (Intellisense) | 基于真实 DB 元数据的动态 `CompletionItemProvider` (点号 `.` 触发) | ✅ 完全支持 | 输入 `table_name.` 或 `package_name.` |
| **悬停表结构** | Object Info Tooltip | 鼠标悬停 `HoverProvider` 动态提取 Markdown 列名与类型表 | ✅ 完全支持 | 鼠标光标悬停在表名/视图名上 |
| **跳转定义** | Go to Definition (F12) | 本地工作区包文件匹配寻路或反向提取 DDL 弹窗开窗 | ✅ 完全支持 | `F12` 或 `Ctrl + Click` |
| **代码编译** | Execute & Compile to DB | 执行 `CREATE OR REPLACE PACKAGE`，捕获异常行号红线标红 (Diagnostics) | ✅ 完全支持 | `F8` |
| **SQL 执行** | SQL Window & Result Grid | 选中文本运行，结果集自动以暗黑风 Webview 表格呈现 | ✅ 完全支持 | `F9` 或 `Ctrl + Enter` |
| **数据在线编辑** | Grid Data Editor (Inline Edit) | Webview 可编辑表格、变更黄色高亮、一键生成 `UPDATE` 事例 Commit | ✅ 完全支持 | 侧边栏右键 `Select Top 100 Rows` |
| **反向工程** | DDL Generator | 动态生成标准 `CREATE TABLE` / 索引 DDL 语句开窗展示 | ✅ 完全支持 | 侧边栏右键表选择 `View Table DDL` |
| **对象浏览器** | Object Browser (TreeView) | 左侧活动栏专有面板：Packages, Tables, Views, Sequences, Procedures | ✅ Completely Supported | 左侧活动栏 数据库图标 |
| **连接管理** | Connection List & Multi-Environment | 支持保存 Local Dev, QA DB, Prod DB 等多个连接配置与一键激活 | ✅ Completely Supported | 侧边栏 `+ (Add Connection)` |
| **死锁/锁监控** | Lock Monitor / Session Browser | 内置固化 SQL 查询 `pg_locks` 与 `pg_stat_activity` 阻塞依赖关系 | ✅ Completely Supported | 侧边栏 `DBA Reports -> 死锁与锁等待监控` |
| **活跃会话管理** | Active Session Monitor / Session Killer | 查询 `pg_stat_activity` 进程，支持终止异常会话 (`pg_terminate_backend`) | ✅ Completely Supported | 命令面板 `IvorySQL: Show Active Database Sessions` |
| **表空间诊断** | Tablespace Storage Usage | 统计分析物理磁盘空间占用与表空间大小报告 | ✅ Completely Supported | 侧边栏 `DBA Reports -> 表空间与存储占用` |
| **慢查询诊断** | Top Slow Queries Report | 抓取耗时较大、在行的慢 SQL 列表 | ✅ Completely Supported | 侧边栏 `DBA Reports -> 慢查询 Top 10` |
| **失效对象诊断** | Invalid Objects Compiler & Inventory | 扫描编译报错、状态异常的对象与函数 | ✅ Completely Supported | 侧边栏 `DBA Reports -> 失效对象与编译诊断` |
| **版本比对锁** | Database Source Sync & Diff Lock | 部署前自动与 DB 源码比对，阻断覆盖直接在数据库修改的代码 | ✅ 独创增效功能 | 部署 `F8` 时自动校验 |
| **Git-Ops 工作流**| Commit-Before-Deploy | 强制要求保存并提交 Git commit 后方可发送数据库编译，留存轨迹 | ✅ 独创增效功能 | 部署 `F8` 时自动拦截并提交 |
| **过程代码调试** | Target Session Debugger (DAP) | 基于 PostgreSQL / IvorySQL `pldbgapi` 扩展对接 VS Code 原生调试面板 | 🛠️ DAP 适配层已就绪 | 复用 5432 数据库标准连接端口 |

---

## 二、 架构设计与关键模块实现说明

### 1. 语法高亮与词法解析 (Grammar Subsystem)
* **文件路径**：`syntaxes/plisql.tmLanguage.json`
* **设计原理**：采用 TextMate 语法树描述，涵盖 Oracle 兼容模式 PL/iSQL 的特有关键字（`PACKAGE`, `PACKAGE BODY`, `PRAGMA`, `REF CURSOR`, `RECORD`, `%TYPE`, `%ROWTYPE` 等）以及系统内置包（`DBMS_OUTPUT`, `UTL_FILE`）。

### 2. 动态实时数据库 Intellisense 与 Hover 悬停 (LSP Subsystem)
* **文件路径**：`src/lsp/completionProvider.ts`, `src/lsp/hoverProvider.ts`, `src/lsp/definitionProvider.ts`
* **设计原理**：
  * 当用户输入 `.` 或按下快捷键时，Language Server 异步发起针对 IvorySQL 数据库元数据表（`information_schema.columns`, `pg_attribute`, `all_procedures`）的缓存查询。
  * 悬停在对象名上时，自动拼接生成带有字段名与类型清单的 Markdown 数据表格。

### 3. 可视化交互式数据编辑网格 (Data Grid Subsystem)
* **文件路径**：`src/views/resultSetWebview.ts`
* **设计原理**：
  * 利用 VS Code Webview API 构建独立渲染通道。
  * 单元格支持双击编辑与增量变更跟踪（原本值与更新值对）。点击 `Commit Changes to DB` 按钮后，通过消息总线 (`vscode.postMessage`) 传回插件 Node 端，自动开辟 `BEGIN; UPDATE ... WHERE ...; COMMIT;` 事务更新 IvorySQL 数据库。

### 4. Git-First 数据库防覆盖版本锁 (DevOps & Version Governance)
* **文件路径**：`src/versionControl/syncManager.ts`
* **设计原理**：
  * 在触发 `F8` 部署前，插件首先从数据库提取 `all_source` / `pg_proc` 运行期最新定义，与本地 Git 仓库中的代码进行标准化 Text Diff 比对。如果发现“代码漂移 (Drift Detected)”，直接阻断部署并提示合并。
  * 检查本地 Git 暂存区，无未提交变更或完成自动 Commit 后，才执行最终的 `CREATE OR REPLACE` SQL 命令。

---

## 三、 开发与扩展路线指南 (Developer Guide)

### 1. 本地编译构建与测试
```bash
# 1. 安装依赖
npm install

# 2. 编译 TypeScript
npm run compile

# 3. 按 F5 启动 Extension Development Host 调试宿主环境
```

### 2. 打包与发布 VSIX
```bash
# 打包生成本地可直接安装的 vsix 文件
npx vsce package
```
打包成功后，将在根目录下生成 `ivorysql-ide-0.1.0.vsix`，可在任意 VS Code 中一键安装。
