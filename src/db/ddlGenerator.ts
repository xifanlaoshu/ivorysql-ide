import { IvoryDbManager } from './connectionManager';

export class DbTools {
  /**
   * 自动反向提取建表语句 (CREATE TABLE DDL)
   */
  public static async generateTableDdl(tableName: string): Promise<string> {
    const db = IvoryDbManager.getInstance();
    const cols = await db.getRealtimeColumns(tableName);

    if (cols.length === 0) {
      return `-- Table ${tableName} not found or no columns available`;
    }

    const colDefs = cols.map(c => `  ${c.column_name.padEnd(20)} ${c.data_type.toUpperCase()}`).join(',\n');
    return `CREATE TABLE ${tableName} (\n${colDefs}\n);`;
  }

  /**
   * 查看活跃会话进程
   */
  public static async getActiveSessions(): Promise<any[]> {
    const db = IvoryDbManager.getInstance();
    const res = await db.query(
      `SELECT pid, usename, datname, client_addr, state, query_start, query 
       FROM pg_stat_activity 
       WHERE pid <> pg_backend_pid() AND state <> 'idle'
       ORDER BY query_start DESC`
    );
    return res.rows;
  }

  /**
   * 终止特定 PID 进程会话
   */
  public static async killSession(pid: number): Promise<boolean> {
    const db = IvoryDbManager.getInstance();
    const res = await db.query(`SELECT pg_terminate_backend($1) as killed`, [pid]);
    return res.rows?.[0]?.killed || false;
  }
}
