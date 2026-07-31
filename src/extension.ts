import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IvoryDbManager } from './db/connectionManager';
import { GitDbSyncManager } from './versionControl/syncManager';
import { PlIsqlCompletionItemProvider } from './lsp/completionProvider';
import { ConnectionStore } from './db/connectionStore';
import { ConnectionTreeProvider, ConnectionTreeItem } from './views/connectionTreeView';
import { PlIsqlFormatter } from './formatter/plsqlFormatter';
import { ResultSetWebview } from './views/resultSetWebview';
import { DbTools } from './db/ddlGenerator';
import { DbaQueryRunner } from './db/dbaQueries';

let diagnosticsCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('IvorySQL PL/iSQL Developer Extension is now active!');

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  const syncManager = new GitDbSyncManager(workspacePath);
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('plisql');

  // 1. 连接存储器与侧边栏 TreeView 注册
  const connectionStore = new ConnectionStore(context);
  const treeProvider = new ConnectionTreeProvider(connectionStore);
  vscode.window.registerTreeDataProvider('ivorysql-connections', treeProvider);

  // 2. 注册 PL/iSQL 代码美化/格式化器 (Shift + Alt + F)
  const formatterProvider = vscode.languages.registerDocumentFormattingEditProvider(
    'plisql',
    new PlIsqlFormatter()
  );

  // 3. 动态添加连接命令
  const addConnCmd = vscode.commands.registerCommand('ivorysql.addConnection', async () => {
    const name = await vscode.window.showInputBox({ prompt: 'Connection Name', value: 'Local IvorySQL' });
    if (!name) return;
    const host = await vscode.window.showInputBox({ prompt: 'IvorySQL Host', value: 'localhost' });
    if (!host) return;
    const portStr = await vscode.window.showInputBox({ prompt: 'IvorySQL Port', value: '5432' });
    if (!portStr) return;
    const database = await vscode.window.showInputBox({ prompt: 'Database Name', value: 'ivorysql' });
    if (!database) return;
    const user = await vscode.window.showInputBox({ prompt: 'Database User', value: 'ivorysql' });
    if (!user) return;
    const password = await vscode.window.showInputBox({ prompt: 'Database Password', password: true });

    await connectionStore.saveConnection({
      name,
      host,
      port: parseInt(portStr, 10),
      database,
      user,
      password: password || ''
    });

    treeProvider.refresh();
    vscode.window.showInformationMessage(`Saved connection: ${name}`);
  });

  // 4. 连接选中的数据库环境
  const connectSelectedCmd = vscode.commands.registerCommand('ivorysql.connectSelected', async (item?: ConnectionTreeItem) => {
    const targetConn = item?.connection || connectionStore.getCurrentConnection();
    if (!targetConn) {
      vscode.window.showWarningMessage('Please select a database connection first.');
      return;
    }

    const success = await IvoryDbManager.getInstance().connect({
      host: targetConn.host,
      port: targetConn.port,
      database: targetConn.database,
      user: targetConn.user,
      password: targetConn.password || ''
    });

    if (success) {
      await connectionStore.setCurrentConnection(targetConn.id);
      treeProvider.refresh();
    }
  });

  // 5. 固化 DBA 诊断报告命令绑定
  const r1Cmd = vscode.commands.registerCommand('ivorysql.reportTablespaces', () => DbaQueryRunner.runTablespaceReport());
  const r2Cmd = vscode.commands.registerCommand('ivorysql.reportLocks', () => DbaQueryRunner.runLockMonitorReport());
  const r3Cmd = vscode.commands.registerCommand('ivorysql.reportSlowQueries', () => DbaQueryRunner.runSlowQueriesReport());
  const r4Cmd = vscode.commands.registerCommand('ivorysql.reportInvalidObjects', () => DbaQueryRunner.runInvalidObjectsReport());
  const r5Cmd = vscode.commands.registerCommand('ivorysql.reportSessions', () => DbaQueryRunner.runSessionStatsReport());
  const r6Cmd = vscode.commands.registerCommand('ivorysql.reportHitRatio', () => DbaQueryRunner.runCacheHitRatioReport());

  // 6. 执行选中的 SQL / 当前文本块 (F9 或 Ctrl+Enter)
  const queryCmd = vscode.commands.registerCommand('ivorysql.executeQuery', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) {
      vscode.window.showErrorMessage('未连接到 IvorySQL 数据库！请先在侧边栏选中并连接数据库。');
      return;
    }

    let sql = editor.selection.isEmpty
      ? editor.document.lineAt(editor.selection.active.line).text
      : editor.document.getText(editor.selection);

    sql = sql.trim();
    if (!sql) return;

    try {
      const startTime = Date.now();
      const res = await dbManager.query(sql);
      const durationMs = Date.now() - startTime;

      if (res.fields && res.fields.length > 0) {
        const columns = res.fields.map((f: any) => f.name);
        ResultSetWebview.showQueryResult(sql.substring(0, 30) + '...', null, columns, res.rows, res.rowCount, durationMs);
      } else {
        vscode.window.showInformationMessage(`[SQL Executed Successfully] Command completed in ${durationMs} ms. Rows affected: ${res.rowCount}`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`SQL Query Error: ${err.message}`);
    }
  });

  // 7. 提取与查看 Table DDL 语句
  const ddlCmd = vscode.commands.registerCommand('ivorysql.viewTableDdl', async (item?: ConnectionTreeItem) => {
    if (!item || !item.label) return;
    const ddl = await DbTools.generateTableDdl(item.label);
    const doc = await vscode.workspace.openTextDocument({ content: ddl, language: 'plisql' });
    await vscode.window.showTextDocument(doc);
  });

  // 8. 查看表数据前 100 条记录 (Select Top 100 Rows)
  const selectTopCmd = vscode.commands.registerCommand('ivorysql.selectTop100', async (item?: ConnectionTreeItem) => {
    if (!item || !item.label) return;
    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) return;

    try {
      const startTime = Date.now();
      const res = await dbManager.query(`SELECT * FROM ${item.label} LIMIT 100`);
      const durationMs = Date.now() - startTime;
      const columns = res.fields.map((f: any) => f.name);

      ResultSetWebview.showQueryResult(`SELECT * FROM ${item.label}`, item.label, columns, res.rows, res.rowCount, durationMs);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Select Top 100 Error: ${err.message}`);
    }
  });

  // 9. 活跃会话管理与监控 (Show Active Sessions)
  const activeSessionsCmd = vscode.commands.registerCommand('ivorysql.showActiveSessions', async () => {
    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) return;

    try {
      const sessions = await DbTools.getActiveSessions();
      if (sessions.length === 0) {
        vscode.window.showInformationMessage('当前无活跃阻塞的数据库会话 (No Active Non-Idle Sessions)');
        return;
      }
      const columns = ['pid', 'usename', 'datname', 'client_addr', 'state', 'query'];
      ResultSetWebview.showQueryResult('Active Database Sessions', null, columns, sessions, sessions.length, 0);
    } catch (err: any) {
      vscode.window.showErrorMessage(`Show Active Sessions Error: ${err.message}`);
    }
  });

  // 10. 删除连接命令与刷新
  const deleteConnCmd = vscode.commands.registerCommand('ivorysql.deleteConnection', async (item?: ConnectionTreeItem) => {
    if (item && item.connection) {
      await connectionStore.deleteConnection(item.connection.id);
      treeProvider.refresh();
      vscode.window.showInformationMessage(`Deleted connection: ${item.connection.name}`);
    }
  });

  const refreshTreeCmd = vscode.commands.registerCommand('ivorysql.refreshConnections', () => {
    treeProvider.refresh();
  });

  // 11. 快捷键 Alt+O 切换 Package Header / Body
  const switchCmd = vscode.commands.registerCommand('ivorysql.switchHeaderBody', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const currentFile = editor.document.fileName;
    const ext = path.extname(currentFile).toLowerCase();
    let targetFile = '';

    if (ext === '.pkh') {
      targetFile = currentFile.substring(0, currentFile.length - 4) + '.pkb';
    } else if (ext === '.pkb') {
      targetFile = currentFile.substring(0, currentFile.length - 4) + '.pkh';
    } else if (currentFile.toLowerCase().endsWith('_header.sql')) {
      targetFile = currentFile.substring(0, currentFile.length - 11) + '_body.sql';
    } else if (currentFile.toLowerCase().endsWith('_body.sql')) {
      targetFile = currentFile.substring(0, currentFile.length - 9) + '_header.sql';
    }

    if (targetFile && fs.existsSync(targetFile)) {
      const doc = await vscode.workspace.openTextDocument(targetFile);
      await vscode.window.showTextDocument(doc);
    } else if (targetFile) {
      vscode.window.showWarningMessage(`对应的 Package 配对文件不存在: ${path.basename(targetFile)}`);
    } else {
      vscode.window.showInformationMessage('当前文件不是标准的 Package Header/Body 文件 (.pkh/.pkb)');
    }
  });

  // 12. Git-First 部署与编译命令 (F8)
  const deployCmd = vscode.commands.registerCommand('ivorysql.deployToDb', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('没有打开的可编辑 PL/iSQL 文件');
      return;
    }

    const document = editor.document;
    const content = document.getText();

    const match = content.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(PACKAGE(?:\s+BODY)?|PROCEDURE|FUNCTION)\s+([a-zA-Z0-9_"\.]+)/i);
    const objectType = match ? (match[1].toUpperCase() as any) : 'PACKAGE';
    const objectName = match ? match[2] : path.basename(document.fileName, path.extname(document.fileName));

    const syncStatus = await syncManager.verifySyncState(document, objectName, objectType);
    if (!syncStatus.isSynced) {
      vscode.window.showErrorMessage(syncStatus.reason || 'Database and Local Git code drift detected!');
      return;
    }

    const committed = await syncManager.ensureGitCommitted(document);
    if (!committed) {
      vscode.window.showWarningMessage('编译中断：必须先将修改落地提交到 Git 仓库，方可部署至数据库！');
      return;
    }

    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) {
      vscode.window.showErrorMessage('未连接到 IvorySQL 数据库！请在左侧 IvorySQL 侧边栏面板中选择并连接数据库。');
      return;
    }

    try {
      diagnosticsCollection.clear();
      await dbManager.query(content);
      vscode.window.showInformationMessage(`[IvorySQL] 成功编译并部署 ${objectType} "${objectName}" 到数据库！`);
    } catch (err: any) {
      const lineMatch = err.message.match(/LINE\s+(\d+):/i) || err.message.match(/at line (\d+)/i);
      const lineNum = lineMatch ? Math.max(0, parseInt(lineMatch[1], 10) - 1) : 0;

      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(lineNum, 0, lineNum, 100),
        `IvorySQL Compile Error: ${err.message}`,
        vscode.DiagnosticSeverity.Error
      );

      diagnosticsCollection.set(document.uri, [diagnostic]);
      vscode.window.showErrorMessage(`[IvorySQL 编译错误] Line ${lineNum + 1}: ${err.message}`);
    }
  });

  // 13. 注册动态 Intellisense 智能补全器
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    'plisql',
    new PlIsqlCompletionItemProvider(),
    '.'
  );

  context.subscriptions.push(
    addConnCmd,
    connectSelectedCmd,
    r1Cmd, r2Cmd, r3Cmd, r4Cmd, r5Cmd, r6Cmd,
    queryCmd,
    ddlCmd,
    selectTopCmd,
    activeSessionsCmd,
    deleteConnCmd,
    refreshTreeCmd,
    switchCmd,
    deployCmd,
    formatterProvider,
    completionProvider,
    diagnosticsCollection
  );
}

export function deactivate() {
  if (diagnosticsCollection) {
    diagnosticsCollection.clear();
  }
}
