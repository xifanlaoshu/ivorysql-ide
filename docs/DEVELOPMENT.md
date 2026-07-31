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

### 2.3 单步断点调试与变量监控 (Step Debugging & Variable Watch)
- **技术原理**：
  - 基于 PostgreSQL / IvorySQL 服务端 **`pldbgapi` (PL/pgSQL Debugger API)** 物理调试扩展。
  - VS Code 端通过注册 **`DebugAdapterDescriptorFactory`** 实现 **DAP (Debug Adapter Protocol)** 协议对接。
- **调试特性支持**：
  - **物理行断点 (Line Breakpoints)**：在 `.pkh` / `.pkb` 代码行左侧打红点断点。
  * **单步控制 (Step Control)**：`F10` 单步步过 (Step Over)、`F11` 单步步入 (Step Into)、`Shift+F11` 单步步出 (Step Out)。
  * **变量监视 (Variables & Watch Window)**：在 VS Code 调试侧边栏的 `Variables` 窗口实时监视局部变量内存值。

---

## 3. 安装与使用指引
1. 打开 VS Code，按下 `F5` 即可启动插件测试窗口。
2. 侧边栏添加 IvorySQL 连接（Host: localhost, Port: 1522, User: aurora, Database: postgres）。
3. 打开 Package 脚本按 `F8` 部署，按 `F9` 运行查询！
