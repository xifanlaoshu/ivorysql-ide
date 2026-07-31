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
        // 自动开启 IvorySQL Oracle 模式方言会话 (Oracle Compatibility Dialect)
        await client.query("SET db_dialect = 'oracle'");
      } catch (dialectErr) {
        console.warn('Set Oracle dialect query failed (Might be running standard pg mode):', dialectErr);
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

  public async query(text: string, params?: any[]): Promise<any> {
    if (!this.pool) {
      throw new Error('Not connected to IvorySQL database');
    }
    const client = await this.pool.connect();
    try {
      // 100% 安全自适应探针：独立隔离每个 SET 指令，绝不向外抛出任何 GUC 参数不存在错误
      try {
        await client.query("SET ivorysql.compatible_mode = 'oracle'");
      } catch (e) {}

      try {
        await client.query("SET db_dialect = 'oracle'");
      } catch (e) {}

      try {
        await client.query("SET search_path = sys, pg_catalog, public");
      } catch (e) {}

      const res = await client.query(text, params);
      return res;
    } catch (err) {
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * 从 IvorySQL 数据库中读取指定 Package / 存储过程的最新底层源码
   * 优先查询 all_source / user_source，降级至 pg_proc
   */
  public async getDbSourceCode(objectName: string, objectType: 'PACKAGE' | 'PACKAGE BODY' | 'PROCEDURE' | 'FUNCTION'): Promise<string | null> {
    if (!this.pool) {
      return null;
    }
    try {
      // 尝试查询 Oracle 兼容模式视图 all_source / user_source
      const res = await this.query(
        `SELECT text FROM all_source WHERE upper(name) = upper($1) AND upper(type) = upper($2) ORDER BY line`,
        [objectName, objectType]
      );
      if (res.rows && res.rows.length > 0) {
        return res.rows.map((r: any) => r.text).join('');
      }

      // Fallback: 查询 pg_proc / pg_get_functiondef
      const funcRes = await this.query(
        `SELECT pg_get_functiondef(p.oid) as src FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE upper(p.proname) = upper($1)`,
        [objectName]
      );
      if (funcRes.rows && funcRes.rows.length > 0) {
        return funcRes.rows[0].src;
      }

      return null;
    } catch (e) {
      console.warn('Failed to fetch DB source via all_source, attempting fallback query:', e);
      return null;
    }
  }

  /**
   * 实时获取 Schema 内的全部表名 (用于 Intellisense)
   */
  public async getRealtimeTables(): Promise<string[]> {
    if (!this.pool) return [];
    try {
      const res = await this.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY table_name`
      );
      return res.rows.map((r: any) => r.table_name);
    } catch (e) {
      return [];
    }
  }

  /**
   * 实时获取指定表名的列及数据类型 (用于 Intellisense)
   */
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

  /**
   * 实时获取包(Package)或 Schema 内的函数/过程定义 (用于 Intellisense)
   */
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
