import * as vscode from 'vscode';
import { ConnectionStore, SavedConnection } from '../db/connectionStore';
import { IvoryDbManager } from '../db/connectionManager';

export class ConnectionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly itemType: 'CONNECTION' | 'CATEGORY' | 'PACKAGE' | 'TABLE' | 'PROCEDURE',
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
    } else if (itemType === 'PROCEDURE') {
      this.iconPath = new vscode.ThemeIcon('symbol-method');
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
      // 根节点：渲染所有保存的连接
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
      // 展开连接：分类目录
      return [
        new ConnectionTreeItem('Packages (PL/iSQL)', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'PACKAGES' }),
        new ConnectionTreeItem('Tables', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'TABLES' }),
        new ConnectionTreeItem('Procedures & Functions', vscode.TreeItemCollapsibleState.Collapsed, 'CATEGORY', element.connection, { category: 'PROCEDURES' })
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
      } else if (category === 'PROCEDURES') {
        const procs = await dbManager.getRealtimeProcedures();
        return procs.map(p => new ConnectionTreeItem(p.name, vscode.TreeItemCollapsibleState.None, 'PROCEDURE', element.connection));
      }
    }

    return [];
  }
}
