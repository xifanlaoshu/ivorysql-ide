# IvorySQL 5.4 PL/iSQL 物理调试双通道控制模型配置与操作手册

## 1. 架构总览与双通道工作原理 (Dual-Session Debugging Architecture)

IvorySQL 5.4 继承并扩展了 PostgreSQL 的物理调试体系（基于 `pldbgapi` 扩展），采用 **双通道控制模型 (Dual-Session Model)**。

```
                       ┌──────────────────────────────────────────────┐
                       │               VS Code IDE / Client           │
                       └──────┬────────────────────────────────┬──────┘
                              │                                │
                    [通道 A: 目标执行会话]           [通道 B: 调试控制会话]
                    (Target Session)                (Controller Session)
                              │                                │
                              ▼                                ▼
                       ┌──────────────────────────────────────────────┐
                       │          IvorySQL 5.4 数据库服务内核          │
                       │     (Loaded: shared_preload_libraries)       │
                       └──────────────────────────────────────────────┘
```

---

## 2. 服务端配置三部曲 (Server Configuration)

### 第一步：在 postgresql.conf / ivorysql.conf 中预加载动态库
编辑数据目录下的 `postgresql.conf`：
```ini
# 配置 IvorySQL 5.4 动态预加载扩展库
shared_preload_libraries = 'pldbgapi, plugin_debugger'
```

### 第二步：重启 IvorySQL 数据库实例
```bash
su ivorysql -c "$(find / -name pg_ctl 2>/dev/null | head -n 1) restart -D /var/local/ivorysql/ivorysql-5/data"
```

### 第三步：在目标数据库激活 pldbgapi 扩展
在 `psql` 或 IDE 中运行：
```sql
CREATE EXTENSION IF NOT EXISTS pldbgapi;
```

---

## 3. 双通道控制模型标准 SQL 交互实操流程

### 步骤 A：调试控制会话 (Controller Session - 建立侦听与设置断点)
在 IDE 调试端会话（通道 B）中运行：
```sql
-- 1. 创建调试控制侦听器端口，返回唯一的 listener_port 句柄
SELECT pldbg_create_listener();

-- 2. 查出目标 Package 过程/函数的 OID
SELECT p.oid, p.proname 
FROM pg_proc p 
JOIN pg_namespace n ON p.pronamespace = n.oid 
WHERE n.nspname = 'public' AND p.proname = 'add_employee';

-- 3. 设置全局物理行断点 (函数 OID, 行号)
SELECT pldbg_set_global_breakpoint(1, 12345, 10, NULL);
```

### 步骤 B：目标业务会话 (Target Session - 触发执行并挂起)
在业务应用端会话（通道 A）中正常调用 Package 过程：
```sql
-- 当执行到设置断点的第 10 行时，该会话将被物理挂起等待
CALL emp_pkg.add_employee(1001, 'Test User', 8000);
```

### 步骤 C：调试控制会话 (Controller Session - 单步步过与变量 Watch 监视)
在 IDE 调试端会话（通道 B）中发送单步控制指令：

```sql
-- 1. 单步步过 (Step Over - F10)
SELECT pldbg_step_over(1);

-- 2. 单步步入 (Step Into - F11)
SELECT pldbg_step_into(1);

-- 3. 读取当前挂起位置的局部变量内存与调用栈 (Variables Watch)
SELECT * FROM pldbg_get_stack(1);

-- 4. 动态写入/修改局部变量值 (Deposit Variable Value)
SELECT pldbg_deposit_value(1, 'v_salary', 0, '9900');

-- 5. 继续恢复运行 (Continue - F5)
SELECT pldbg_continue(1);
```
