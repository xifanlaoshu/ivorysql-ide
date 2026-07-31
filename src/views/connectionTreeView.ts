import * as vscode from 'vscode';
import { ConnectionStore, SavedConnection } from '../db/connectionStore';
import { IvoryDbManager } from '../db/connectionManager';

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'CONNECTION' | 'CATEGORY' | 'PACKAGE' | 'TABLE' | 'VIEW' | 'SEQUENCE' | 'PROCEDURE' | 'REPORT',
    public readonly connection?: SavedConnection,
    public readonly extra?: any
  ) {
    super(label, collapsibleState);

    if (itemType === 'CONNECTION') {
      const isConnected = connection?.isCurrent && IvoryDbManager.getInstance().isConnected();
      this.iconPath = new vscode.ThemeIcon(
        isConnected ? 'plug' : 'remote',
        isConnected ? new vscode.ThemeColor('testing.iconPassed') : undefined
      );
      this.contextValue = 'connectionItem';
      this.description = `${connection?.host}:${connection?.port}/${connection?.database}${connection?.isCurrent ? ' (Active)' : ''}`;
    } else if (itemType === 'CATEGORY') {
      this.iconPath = new vscode.ThemeIcon('folder');
    } else if (itemType === 'PACKAGE') {
      this.iconPath = new vscode.ThemeIcon('archive');
    } else if (itemType === 'TABLE') {
      this.iconPath = new vscode.ThemeIcon('symbol-property');
      this.contextValue = 'tableItem';
    } else if (itemType === 'VIEW') {
      this.iconPath = new vscode.ThemeIcon('preview');
    } else if (itemType === 'SEQUENCE') {
      this.iconPath = new vscode.ThemeIcon('symbol-numeric');
    } else if (itemType === 'PROCEDURE') {
      this.iconPath = new vscode.ThemeIcon('symbol-method');
    } else if (itemType === 'REPORT') {
      this.iconPath = new vscode.ThemeIcon('graph');
      this.contextValue = 'reportItem';
      this.command = {
        command: extra?.commandId || '',
        title: label
      };
    }
  }
}

export class ConnectionTreeProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<ConnectionTreeItem | undefined | null | void> = new vscode.EventEmitter<ConnectionTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<ConnectionTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

  constructor(private store: ConnectionStore) {}

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
    return element;
  }

  public async getChildren(element?: ConnectionTreeItem): Promise<ConnectionTreeItem[]> {
    if (!element) {
      const connections = this.store.getConnections();
      if (connections.length === 0) {
        return [];
      }
      return connections.map(conn =>
        new ConnectionTreeItem(
          conn.name,
          vscode.TreeItemCollapsibleState.Collapsed,
          'CONNECTION',
          conn
        )
      );
    }

    if (element.itemType === 'CONNECTION' && element.connection) {
      return [
        new ConnectionTreeItem('Packages (PL/iSQL)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'PACKAGES' }),
        new ConnectionTreeItem('Tables', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'TABLES' }),
        new ConnectionTreeItem('Views', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'VIEWS' }),
        new ConnectionTreeItem('Sequences', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'SEQUENCES' }),
        new ConnectionTreeItem('Procedures & Functions', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'PROCEDURES' }),
        new ConnectionTreeItem('DBA Diagnostic Reports (固化查询)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'REPORTS' })
      ];
    }

    if (element.itemType === 'CATEGORY' && element.connection) {
      const dbManager = IvoryDbManager.getInstance();
      if (!dbManager.isConnected() || !element.connection.isCurrent) {
        return [new ConnectionTreeItem('Please connect to this database first', vscode.TreeItemCollapsibleState.None, 'CATEGORY')];
      }

      const category = element.extra?.category;
      if (category === 'PACKAGES') {
        const pkgs = await dbManager.getRealtimeProcedures();
        const pkgNames = Array.from(new Set(pkgs.map(p => p.name)));
        return pkgNames.map(p => new ConnectionTreeItem(p, vscode.TreeItemCollapsibleState.None, 'PACKAGE', element.connection));
      } else if (category === 'TABLES') {
        const tables = await dbManager.getRealtimeTables();
        return tables.map(t => new ConnectionTreeItem(t, vscode.TreeItemCollapsibleState.None, 'TABLE', element.connection));
      } else if (category === 'VIEWS') {
        const res = await dbManager.query("SELECT table_name FROM information_schema.views WHERE table_schema NOT IN ('pg_catalog', 'information_schema')");
        return res.rows.map((r: any) => new ConnectionTreeItem(r.table_name, vscode.TreeItemCollapsibleState.None, 'VIEW', element.connection));
      } else if (category === 'SEQUENCES') {
        const res = await dbManager.query("SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema NOT IN ('pg_catalog', 'information_schema')");
        return res.rows.map((r: any) => new ConnectionTreeItem(r.sequence_name, vscode.TreeItemCollapsibleState.None, 'SEQUENCE', element.connection));
      } else if (category === 'PROCEDURES') {
        const procs = await dbManager.getRealtimeProcedures();
        return procs.map(p => new ConnectionTreeItem(p.name, vscode.TreeItemCollapsibleState.None, 'PROCEDURE', element.connection));
      } else if (category === 'REPORTS') {
        return [
          new ConnectionTreeItem('表空间与存储占用 (Tablespace Report)', vscode.TreeItemCollapsibleState.None, 'REPORT', element.connection, { commandId: 'ivorysql.reportTablespaces' }),
          new ConnectionTreeItem('死锁与锁等待监控 (Lock Monitor)', vscode.TreeItemCollapsibleState.None, 'REPORT', element.connection, { commandId: 'ivorysql.reportLocks' }),
          new ConnectionTreeItem('慢查询 Top 10 (Slow Queries)', vscode.TreeItemCollapsibleState.None, 'REPORT', element.connection, { commandId: 'ivorysql.reportSlowQueries' }),
          new ConnectionTreeItem('失效对象与编译诊断 (Invalid Objects)', vscode.TreeItemCollapsibleState.None, 'REPORT', element.connection, { commandId: 'ivorysql.reportInvalidObjects' }),
          new ConnectionTreeItem('会话与客户端统计 (Session Stats)', vscode.TreeItemCollapsibleState.None, 'REPORT', element.connection, { commandId: 'ivorysql.reportSessions' }),
          new ConnectionTreeItem('缓存与索引命中率 (Hit Ratio)', vscode.TreeItemCollapsibleState.None, 'REPORT', element.connection, { commandId: 'ivorysql.reportHitRatio' })
        ];
      }
    }

    return [];
  }
}
