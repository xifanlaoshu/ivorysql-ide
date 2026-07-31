import { Pool, PoolClient } from 'pg';
import * as vscode from 'vscode';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
}

export class IvoryDbManager {
  private pool: Pool | null = null;
  private currentConfig: DbConfig | null = null;

  public static getInstance(): IvoryDbManager {
    if (!IvoryDbManager.instance) {
      IvoryDbManager.instance = new IvoryDbManager();
    }
    return IvoryDbManager.instance;
  }
  private static instance: IvoryDbManager;

  public async connect(config: DbConfig): Promise<boolean> {
    try {
      if (this.pool) {
        await this.pool.end();
      }
      this.pool = new Pool({
        host: config.host,
        port: config.port,
        database: config.database,
        user: config.user,
        password: config.password,
        connectionTimeoutMillis: 5000
      });

      const client = await this.pool.connect();
      try {
        await client.query("SET ivorysql.compatible_mode = 'oracle'");
      } catch (dialectErr) {
        console.warn('Set Oracle dialect query failed:', dialectErr);
      } finally {
        client.release();
      }

      this.currentConfig = config;
      vscode.window.showInformationMessage(`Successfully connected to IvorySQL Oracle Mode (${config.host}:${config.port}/${config.database})`);
      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`IvorySQL Connection Error: ${err.message}`);
      this.pool = null;
      return false;
    }
  }

  public isConnected(): boolean {
    return this.pool !== null;
  }

  public async query(sql: string, params?: any[]): Promise<any> {
    if (!this.pool) {
      throw new Error('Not connected to IvorySQL database');
    }
    const client = await this.pool.connect();
    
    // 绑定 notice 实时调试日志监听
    client.removeAllListeners('notice');
    client.on('notice', (msg: any) => {
      const outputChannel = vscode.window.createOutputChannel('IvorySQL Debug Console');
      outputChannel.show(true);
      outputChannel.appendLine(`🐞 [IvorySQL NOTICE Log] ${msg.message || msg}`);
    });

    try {
      // 强制每一次底层 Session 查询前开启 Oracle 兼容模式，保证 Package 调用语法正确解析
      try {
        await client.query("SET ivorysql.compatible_mode = 'oracle'");
      } catch (e) {}

      // 100% 安全自适应探针：独立隔离每个 SET 指令与按需补全 DBMS_OUTPUT 系统包
      try {
        await client.query(`
          CREATE OR REPLACE PACKAGE dbms_output IS
            PROCEDURE enable(buffer_size IN NUMBER DEFAULT 20000);
            PROCEDURE disable;
            PROCEDURE put_line(a IN VARCHAR2);
          END dbms_output;
        `);
        await client.query(`
          CREATE OR REPLACE PACKAGE BODY dbms_output IS
            PROCEDURE enable(buffer_size IN NUMBER DEFAULT 20000) IS
            BEGIN NULL; END enable;
            PROCEDURE disable IS
            BEGIN NULL; END disable;
            PROCEDURE put_line(a IN VARCHAR2) IS
            BEGIN RAISE NOTICE '%', a; END put_line;
          END dbms_output;
        `);
      } catch (e) {}

        try {
        await client.query(`
          CREATE OR REPLACE PROCEDURE raise_application_error(
            p_code IN NUMBER,
            p_msg  IN VARCHAR2
          ) AS
          BEGIN
            RAISE EXCEPTION 'Oracle Exception [%]: %', p_code, p_msg;
          END;
        `);
      } catch (e) {}

      try {
        await client.query("SET db_dialect = 'oracle'");
      } catch (e) {}

      try {
        await client.query("SET search_path = sys, pg_catalog, public");
      } catch (e) {}

      const res = await client.query(sql, params);
      return res;
    } catch (err) {
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 从 IvorySQL 数据库中读取指定 Package / 存储过程的最新底层源码 DDL
   */
  public async getDbSourceCode(schemaName: string, objectName: string, objectType: 'PACKAGE' | 'PACKAGE BODY' | 'PROCEDURE' | 'FUNCTION'): Promise<string | null> {
    if (!this.pool) {
      return null;
    }
    try {
      if (objectType === 'PACKAGE') {
        const res = await this.query(
          `SELECT ('CREATE OR REPLACE PACKAGE ' || p.pkgname::text || ' IS\n' || p.pkgsrc::text) AS text
           FROM pg_catalog.pg_package p
           JOIN pg_namespace n ON p.pkgnamespace = n.oid
           WHERE upper(n.nspname::text) = upper($1) AND upper(p.pkgname::text) = upper($2)`,
          [schemaName, objectName]
        );
        if (res.rows && res.rows.length > 0) return res.rows[0].text;
      } else if (objectType === 'PACKAGE BODY') {
        const res = await this.query(
          `SELECT ('CREATE OR REPLACE PACKAGE BODY ' || p.pkgname::text || ' IS\n' || b.bodysrc::text) AS text
           FROM pg_catalog.pg_package_body b
           JOIN pg_catalog.pg_package p ON b.pkgoid = p.oid
           JOIN pg_namespace n ON p.pkgnamespace = n.oid
           WHERE upper(n.nspname::text) = upper($1) AND upper(p.pkgname::text) = upper($2)`,
          [schemaName, objectName]
        );
        if (res.rows && res.rows.length > 0) return res.rows[0].text;
      }

      // 降级：从 sys.all_source 提取源码
      const res = await this.query(
        `SELECT text::text FROM sys.all_source WHERE upper(owner::text) = upper($1) AND upper(name::text) = upper($2) AND upper(type::text) = upper($3) ORDER BY line`,
        [schemaName, objectName, objectType]
      );
      if (res.rows && res.rows.length > 0) {
        return res.rows.map((r: any) => r.text).join('');
      }

      // 从 pg_proc 系统表提取函数定义
      const funcRes = await this.query(
        `SELECT pg_get_functiondef(p.oid) as src FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE upper(n.nspname::text) = upper($1) AND upper(p.proname::text) = upper($2)`,
        [schemaName, objectName]
      );
      if (funcRes.rows && funcRes.rows.length > 0) {
        return funcRes.rows[0].src;
      }

      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * 1. 动态获取所有 Schemas 模式列表
   */
  public async getSchemas(): Promise<string[]> {
    if (!this.pool) return [];
    try {
      const res = await this.query(
        `SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_toast', 'pg_temp_1') ORDER BY schema_name`
      );
      return res.rows.map((r: any) => r.schema_name);
    } catch (e) {
      return ['public'];
    }
  }

  /**
   * 2. 动态获取指定 Schema 下的 Packages (区分包头与包体标志，严格按 Schema 物理隔离)
   */
  public async getSchemaPackagesDetails(schemaName: string): Promise<{ name: string; hasHeader: boolean; hasBody: boolean }[]> {
    if (!this.pool) return [];
    try {
      // 实测验证：基于 p.oid = b.pkgoid 外键物理关联，精确提取特定 Schema 下的包头与包体结构
      const sql = `
        SELECT p.pkgname::text AS pkg_name,
               true AS has_header,
               (b.oid IS NOT NULL) AS has_body
        FROM pg_catalog.pg_package p
        JOIN pg_namespace n ON p.pkgnamespace = n.oid
        LEFT JOIN pg_catalog.pg_package_body b ON p.oid = b.pkgoid
        WHERE upper(n.nspname::text) = upper($1)
        ORDER BY p.pkgname
      `;
      const res = await this.query(sql, [schemaName]);
      if (res.rows && res.rows.length > 0) {
        return res.rows.map((r: any) => ({
          name: r.pkg_name,
          hasHeader: !!r.has_header,
          hasBody: !!r.has_body
        }));
      }

      // 降级备用：从 sys.all_source 中提取
      const fallbackSql = `
        SELECT name::text AS pkg_name, 
               BOOL_OR(type::text = 'PACKAGE') AS has_header, 
               BOOL_OR(type::text = 'PACKAGE BODY') AS has_body
        FROM sys.all_source
        WHERE upper(owner::text) = upper($1) AND type IN ('PACKAGE', 'PACKAGE BODY')
        GROUP BY name ORDER BY name
      `;
      const fallbackRes = await this.query(fallbackSql, [schemaName]);
      return fallbackRes.rows.map((r: any) => ({
        name: r.pkg_name,
        hasHeader: !!r.has_header,
        hasBody: !!r.has_body
      }));
    } catch (e) {
      return [];
    }
  }

  /**
   * 3. 动态获取指定 Schema 下的 Procedures (存储过程)
   */
  public async getSchemaProcedures(schemaName: string): Promise<string[]> {
    if (!this.pool) return [];
    try {
      const res = await this.query(
        `SELECT p.proname 
         FROM pg_proc p 
         JOIN pg_namespace n ON p.pronamespace = n.oid 
         WHERE n.nspname = $1 AND p.prokind = 'p' 
         ORDER BY p.proname`,
        [schemaName]
      );
      return res.rows.map((r: any) => r.proname);
    } catch (e) {
      return [];
    }
  }

  /**
   * 4. 动态获取指定 Schema 下的 Functions (函数)
   */
  public async getSchemaFunctions(schemaName: string): Promise<string[]> {
    if (!this.pool) return [];
    try {
      const res = await this.query(
        `SELECT p.proname 
         FROM pg_proc p 
         JOIN pg_namespace n ON p.pronamespace = n.oid 
         WHERE n.nspname = $1 AND p.prokind = 'f' 
         ORDER BY p.proname`,
        [schemaName]
      );
      return res.rows.map((r: any) => r.proname);
    } catch (e) {
      return [];
    }
  }

  /**
   * 5. 动态获取指定 Schema 下的数据表 (Tables)
   */
  public async getSchemaTables(schemaName: string): Promise<string[]> {
    if (!this.pool) return [];
    try {
      const res = await this.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name`,
        [schemaName]
      );
      return res.rows.map((r: any) => r.table_name);
    } catch (e) {
      return [];
    }
  }

  /**
   * 6. 动态获取指定 Schema 下的视图 (Views)
   */
  public async getSchemaViews(schemaName: string): Promise<string[]> {
    if (!this.pool) return [];
    try {
      const res = await this.query(
        `SELECT table_name FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name`,
        [schemaName]
      );
      return res.rows.map((r: any) => r.table_name);
    } catch (e) {
      return [];
    }
  }

  /**
   * 7. 动态获取指定 Schema 下的序列 (Sequences)
   */
  public async getSchemaSequences(schemaName: string): Promise<string[]> {
    if (!this.pool) return [];
    try {
      const res = await this.query(
        `SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY sequence_name`,
        [schemaName]
      );
      return res.rows.map((r: any) => r.sequence_name);
    } catch (e) {
      return [];
    }
  }

  public async getRealtimeTables(): Promise<string[]> {
    return this.getSchemaTables('public');
  }

  public async getRealtimeColumns(tableName: string): Promise<{ column_name: string; data_type: string }[]> {
    if (!this.pool) return [];
    try {
      const res = await this.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE upper(table_name) = upper($1) ORDER BY ordinal_position`,
        [tableName]
      );
      return res.rows;
    } catch (e) {
      return [];
    }
  }

  public async getRealtimeProcedures(packageName?: string): Promise<{ name: string; type: string }[]> {
    if (!this.pool) return [];
    try {
      if (packageName) {
        const res = await this.query(
          `SELECT DISTINCT name, type FROM all_source WHERE upper(name) = upper($1) AND type IN ('PROCEDURE', 'FUNCTION')`,
          [packageName]
        );
        return res.rows.map((r: any) => ({ name: r.name, type: r.type }));
      } else {
        const res = await this.query(
          `SELECT proname as name, 'FUNCTION' as type FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid WHERE nspname NOT LIKE 'pg_%' AND nspname != 'information_schema' LIMIT 500`
        );
        return res.rows;
      }
    } catch (e) {
      return [];
    }
  }
}
