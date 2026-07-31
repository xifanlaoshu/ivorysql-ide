import * as vscode from 'vscode';

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  isCurrent?: boolean;
}

export class ConnectionStore {
  private static readonly STORAGE_KEY = 'ivorysql.savedConnections';

  constructor(private context: vscode.ExtensionContext) {}

  public getConnections(): SavedConnection[] {
    return this.context.globalState.get<SavedConnection[]>(ConnectionStore.STORAGE_KEY, []);
  }

  public async saveConnection(conn: Omit<SavedConnection, 'id'> & { id?: string }): Promise<SavedConnection> {
    const connections = this.getConnections();
    const id = conn.id || `conn_${Date.now()}`;
    const newConn: SavedConnection = { ...conn, id };

    const index = connections.findIndex(c => c.id === id);
    if (index >= 0) {
      connections[index] = newConn;
    } else {
      connections.push(newConn);
    }

    await this.context.globalState.update(ConnectionStore.STORAGE_KEY, connections);
    return newConn;
  }

  public async deleteConnection(id: string): Promise<void> {
    const connections = this.getConnections().filter(c => c.id !== id);
    await this.context.globalState.update(ConnectionStore.STORAGE_KEY, connections);
  }

  public async setCurrentConnection(id: string): Promise<SavedConnection | null> {
    const connections = this.getConnections();
    let selected: SavedConnection | null = null;
    connections.forEach(c => {
      if (c.id === id) {
        c.isCurrent = true;
        selected = c;
      } else {
        c.isCurrent = false;
      }
    });
    await this.context.globalState.update(ConnectionStore.STORAGE_KEY, connections);
    return selected;
  }

  public getCurrentConnection(): SavedConnection | undefined {
    return this.getConnections().find(c => c.isCurrent);
  }
}
