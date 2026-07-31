import { IvoryDbManager } from './connectionManager';
import { ResultSetWebview } from '../views/resultSetWebview';

export class DbaQueryRunner {
  /**
   * 1. 固化查询：表空间与空间占用报告
   */
  public static async runTablespaceReport() {
    const db = IvoryDbManager.getInstance();
    const sql = `
      SELECT 
        spcname AS tablespace_name,
        pg_size_pretty(pg_tablespace_size(spcname)) AS used_size
      FROM pg_tablespace
      UNION ALL
      SELECT 
        'CURRENT_DATABASE (' || current_database() || ')' AS tablespace_name,
        pg_size_pretty(pg_database_size(current_database())) AS used_size;
    `;
    const res = await db.query(sql);
    ResultSetWebview.showQueryResult('Tablespace & Disk Storage Report', ['tablespace_name', 'used_size'], res.rows, res.rowCount, 0);
  }

  /**
   * 2. 固化查询：数据库锁与阻塞等待监控
   */
  public static async runLockMonitorReport() {
    const db = IvoryDbManager.getInstance();
    const sql = `
      SELECT 
        blocked_locks.pid AS blocked_pid,
        blocked_activity.usename AS blocked_user,
        blocking_locks.pid AS blocking_pid,
        blocking_activity.usename AS blocking_user,
        blocked_activity.query AS blocked_statement,
        blocking_activity.query AS current_statement_in_blocking_process
      FROM pg_catalog.pg_locks blocked_locks
      JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
      JOIN pg_catalog.pg_locks blocking_locks 
        ON blocking_locks.locktype = blocked_locks.locktype
        AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
        AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
        AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
        AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
        AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
        AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
        AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
        AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
        AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
        AND blocking_locks.pid != blocked_locks.pid
      JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
      WHERE NOT blocked_locks.granted;
    `;
    const res = await db.query(sql);
    ResultSetWebview.showQueryResult('Lock & Deadlock Monitor Report', ['blocked_pid', 'blocked_user', 'blocking_pid', 'blocking_user', 'blocked_statement', 'current_statement_in_blocking_process'], res.rows, res.rowCount, 0);
  }

  /**
   * 3. 固化查询：慢查询 Top 10 报告
   */
  public static async runSlowQueriesReport() {
    const db = IvoryDbManager.getInstance();
    const sql = `
      SELECT 
        pid,
        usename,
        client_addr,
        now() - query_start AS duration,
        state,
        query
      FROM pg_stat_activity
      WHERE state <> 'idle' AND (now() - query_start) > interval '1 seconds'
      ORDER BY duration DESC
      LIMIT 10;
    `;
    const res = await db.query(sql);
    ResultSetWebview.showQueryResult('Top Slow Queries Report', ['pid', 'usename', 'client_addr', 'duration', 'state', 'query'], res.rows, res.rowCount, 0);
  }

  /**
   * 4. 固化查询：失效与编译失败的对象报告 (Invalid Objects)
   */
  public static async runInvalidObjectsReport() {
    const db = IvoryDbManager.getInstance();
    const sql = `
      SELECT 
        n.nspname AS schema_name,
        p.proname AS object_name,
        'FUNCTION / PROCEDURE' AS object_type
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      ORDER BY schema_name, object_name;
    `;
    const res = await db.query(sql);
    ResultSetWebview.showQueryResult('Database Objects Inventory Report', ['schema_name', 'object_name', 'object_type'], res.rows, res.rowCount, 0);
  }

  /**
   * 5. 固化查询：会话分布与客户端连接统计
   */
  public static async runSessionStatsReport() {
    const db = IvoryDbManager.getInstance();
    const sql = `
      SELECT 
        coalesce(client_addr::text, 'local') AS client_ip,
        usename,
        state,
        count(*) AS connection_count
      FROM pg_stat_activity
      GROUP BY client_addr, usename, state
      ORDER BY connection_count DESC;
    `;
    const res = await db.query(sql);
    ResultSetWebview.showQueryResult('Session & Client Distribution Report', ['client_ip', 'usename', 'state', 'connection_count'], res.rows, res.rowCount, 0);
  }

  /**
   * 6. 固化查询：缓存与索引命中率 (Index & Buffer Cache Hit Ratio)
   */
  public static async runCacheHitRatioReport() {
    const db = IvoryDbManager.getInstance();
    const sql = `
      SELECT 
        'Buffer Cache Hit Ratio' AS metric_name,
        round(sum(heap_blks_hit) / nullif(sum(heap_blks_hit + heap_blks_read), 0) * 100, 2) || '%' AS ratio
      FROM pg_statio_user_tables
      UNION ALL
      SELECT 
        'Index Hit Ratio' AS metric_name,
        round(sum(idx_blks_hit) / nullif(sum(idx_blks_hit + idx_blks_read), 0) * 100, 2) || '%' AS ratio
      FROM pg_statio_user_indexes;
    `;
    const res = await db.query(sql);
    ResultSetWebview.showQueryResult('Cache & Index Hit Ratio Report', ['metric_name', 'ratio'], res.rows, res.rowCount, 0);
  }
}
