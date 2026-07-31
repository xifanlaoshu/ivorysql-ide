# IvorySQL PL/iSQL IDE Development & Feature Manual

## 1. 架构总览
本插件是专为 IvorySQL 数据库 (Oracle 兼容模式) 打造的高性能、功能丰富的 VS Code 拓展。旨在提供媲美 PL/SQL Developer 的图形化开发、调试与运维体验。

---

## 2. 核心功能矩阵

### 2.1 包与代码开发
- **Package 双向切换 (`Alt+O`)**：包头 `.pkh` 与包体 `.pkb` 快捷切换。
- **Git-First 编译部署 (`F8`)**：本地与 DB 代码漂移校验，强制 Commit 落地后方可编译。
- **快捷 Debug 脚手架 (`🐞 Debug Package`)**：右键一键生成 PL/iSQL 测试脚手架匿名块。

### 2.2 Schema 模式隔离与精确对象分类
- 侧边栏四层树状架构：Connection -> Schema -> Object Category (Packages, Procedures, Functions, Tables, Views, Sequences) -> Object Node.
- 物理级外键关联 (`pg_catalog.pg_package` 与 `pg_catalog.pg_package_body`)，实现真正的 Schema 隔离。

### 2.3 IvorySQL PL Debugger 官方物理调试器指南 (IvorySQL PL Debugger Specification)
- **调试器体系**：
  - IvorySQL 内核基于 PostgreSQL 扩展架构支持 **`pldbgapi` (PL/iSQL Debugger API)**。
- **双通道物理控制模型 (Dual-Connection Debugging Architecture)**：
  1. **Target Session (目标执行会话)**：运行待调试的 Package 过程或函数，由 `pldbg_wait_for_breakpoint` 挂起。
  2. **Controller Session (调试控制会话)**：IDE 通过调试 API 发送控制指令：
     - `pldbg_step_over()`：单步步过 (`F10`)
     - `pldbg_step_into()`：单步步入 (`F11`)
     - `pldbg_get_stack()`：获取堆栈与变量列表 (Watch Window)
- **IDE 快捷集成**：
  - 支持通过 **`🐞 Debug Package`** 生成测试脚手架窗口，并在编辑器中发起会话挂起与实时 `DBMS_OUTPUT` 日志抓取。

---

## 3. 安装与使用指引
1. 打开 VS Code，按下 `F5` 即可启动插件测试窗口。
2. 侧边栏添加 IvorySQL 连接（Host: localhost, Port: 1522, User: aurora, Database: postgres）。
3. 打开 Package 脚本按 `F8` 部署，按 `F9` 运行查询！
