import * as vscode from 'vscode';
import { ConnectionStore, SavedConnection } from '../db/connectionStore';
import { IvoryDbManager } from '../db/connectionManager';

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'CONNECTION' | 'SCHEMA' | 'CATEGORY' | 'PACKAGE' | 'PACKAGE_HEADER' | 'PACKAGE_BODY' | 'PROCEDURE' | 'FUNCTION' | 'TABLE' | 'VIEW' | 'SEQUENCE' | 'REPORT',
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
    } else if (itemType === 'SCHEMA') {
      this.iconPath = new vscode.ThemeIcon('symbol-namespace');
      this.description = 'Schema';
      this.contextValue = 'schemaItem';
    } else if (itemType === 'CATEGORY') {
      this.iconPath = new vscode.ThemeIcon('folder');
      this.contextValue = 'categoryItem';
    } else if (itemType === 'PACKAGE') {
      this.iconPath = new vscode.ThemeIcon('archive');
      this.contextValue = 'packageItem';
    } else if (itemType === 'PACKAGE_HEADER') {
      this.iconPath = new vscode.ThemeIcon('file-code');
      this.contextValue = 'packageHeaderItem';
      this.command = {
        command: 'ivorysql.openPackageSource',
        title: 'Open Package Header Source',
        arguments: [extra?.schemaName, extra?.pkgName, 'PACKAGE']
      };
    } else if (itemType === 'PACKAGE_BODY') {
      this.iconPath = new vscode.ThemeIcon('file-binary');
      this.contextValue = 'packageBodyItem';
      this.command = {
        command: 'ivorysql.openPackageSource',
        title: 'Open Package Body Source',
        arguments: [extra?.schemaName, extra?.pkgName, 'PACKAGE BODY']
      };
    } else if (itemType === 'PROCEDURE') {
      this.iconPath = new vscode.ThemeIcon('symbol-event');
      this.contextValue = 'procedureItem';
      this.command = {
        command: 'ivorysql.openPackageSource',
        title: 'Open Procedure Source',
        arguments: [extra?.schemaName, label, 'PROCEDURE']
      };
    } else if (itemType === 'FUNCTION') {
      this.iconPath = new vscode.ThemeIcon('symbol-method');
      this.contextValue = 'functionItem';
      this.command = {
        command: 'ivorysql.openPackageSource',
        title: 'Open Function Source',
        arguments: [extra?.schemaName, label, 'FUNCTION']
      };
    } else if (itemType === 'TABLE') {
      this.iconPath = new vscode.ThemeIcon('symbol-property');
      this.contextValue = 'tableItem';
    } else if (itemType === 'VIEW') {
      this.iconPath = new vscode.ThemeIcon('preview');
      this.contextValue = 'viewItem';
    } else if (itemType === 'SEQUENCE') {
      this.iconPath = new vscode.ThemeIcon('symbol-numeric');
      this.contextValue = 'sequenceItem';
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
    const dbManager = IvoryDbManager.getInstance();

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
      if (!dbManager.isConnected() || !element.connection.isCurrent) {
        return [new ConnectionTreeItem('Click Plug icon to connect first', vscode.TreeItemCollapsibleState.None, 'CATEGORY')];
      }

      const schemas = await dbManager.getSchemas();
      return schemas.map(s =>
        new ConnectionTreeItem(
          s,
          vscode.TreeItemCollapsibleState.Collapsed,
          'SCHEMA',
          element.connection,
          { schemaName: s }
        )
      );
    }

    if (element.itemType === 'SCHEMA' && element.connection) {
      const schemaName = element.extra?.schemaName || 'public';
      return [
        new ConnectionTreeItem('Packages (PL/iSQL)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { schemaName, category: 'PACKAGES' }),
        new ConnectionTreeItem('Procedures (存储过程)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { schemaName, category: 'PROCEDURES' }),
        new ConnectionTreeItem('Functions (函数)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { schemaName, category: 'FUNCTIONS' }),
        new ConnectionTreeItem('Tables (数据表)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { schemaName, category: 'TABLES' }),
        new ConnectionTreeItem('Views (视图)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { schemaName, category: 'VIEWS' }),
        new ConnectionTreeItem('Sequences (序列)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { schemaName, category: 'SEQUENCES' }),
        new ConnectionTreeItem('DBA Diagnostic Reports', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { schemaName, category: 'REPORTS' })
      ];
    }

    if (element.itemType === 'CATEGORY' && element.connection) {
      const schemaName = element.extra?.schemaName || 'public';
      const category = element.extra?.category;

      if (category === 'PACKAGES') {
        const pkgs = await dbManager.getSchemaPackagesDetails(schemaName);
        return pkgs.map(p => new ConnectionTreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed, 'PACKAGE', element.connection, { schemaName, pkgDetails: p }));
      } else if (category === 'PROCEDURES') {
        const procs = await dbManager.getSchemaProcedures(schemaName);
        return procs.map(p => new ConnectionTreeItem(p, vscode.TreeItemCollapsibleState.None, 'PROCEDURE', element.connection, { schemaName }));
      } else if (category === 'FUNCTIONS') {
        const funcs = await dbManager.getSchemaFunctions(schemaName);
        return funcs.map(f => new ConnectionTreeItem(f, vscode.TreeItemCollapsibleState.None, 'FUNCTION', element.connection, { schemaName }));
      } else if (category === 'TABLES') {
        const tables = await dbManager.getSchemaTables(schemaName);
        return tables.map(t => new ConnectionTreeItem(t, vscode.TreeItemCollapsibleState.None, 'TABLE', element.connection, { schemaName }));
      } else if (category === 'VIEWS') {
        const views = await dbManager.getSchemaViews(schemaName);
        return views.map(v => new ConnectionTreeItem(v, vscode.TreeItemCollapsibleState.None, 'VIEW', element.connection, { schemaName }));
      } else if (category === 'SEQUENCES') {
        const seqs = await dbManager.getSchemaSequences(schemaName);
        return seqs.map(s => new ConnectionTreeItem(s, vscode.TreeItemCollapsibleState.None, 'SEQUENCE', element.connection, { schemaName }));
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

    if (element.itemType === 'PACKAGE' && element.connection) {
      const schemaName = element.extra?.schemaName || 'public';
      const pkgName = element.label;
      const details = element.extra?.pkgDetails;

      const children: ConnectionTreeItem[] = [];
      if (!details || details.hasHeader) {
        children.push(new ConnectionTreeItem('Specification (包头 .pkh)', vscode.TreeItemCollapsibleState.None, 'PACKAGE_HEADER', element.connection, { schemaName, pkgName }));
      }
      if (!details || details.hasBody) {
        children.push(new ConnectionTreeItem('Body (包体 .pkb)', vscode.TreeItemCollapsibleState.None, 'PACKAGE_BODY', element.connection, { schemaName, pkgName }));
      }
      return children;
    }

    return [];
  }
}
