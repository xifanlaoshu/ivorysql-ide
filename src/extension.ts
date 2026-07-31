import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IvoryDbManager } from './db/connectionManager';
import { GitDbSyncManager } from './versionControl/syncManager';
import { PlIsqlCompletionItemProvider } from './lsp/completionProvider';
import { ConnectionStore } from './db/connectionStore';
import { ConnectionTreeProvider, ConnectionTreeItem } from './views/connectionTreeView';
import { PlIsqlFormatter } from './formatter/plsqlFormatter';
import { ResultSetWebview } from './views/resultSetWebview';
import { DbTools } from './db/ddlGenerator';
import { DbaQueryRunner } from './db/dbaQueries';
import { PlIsqlHoverProvider } from './lsp/hoverProvider';
import { PlIsqlDefinitionProvider } from './lsp/definitionProvider';

let diagnosticsCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('IvorySQL PL/iSQL Developer Extension is now active!');

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  const syncManager = new GitDbSyncManager(workspacePath);
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('plisql');

  // 新建单独 SQL 查询工作页命令
  const newSqlScriptCmd = vscode.commands.registerCommand('ivorysql.newSqlScript', async () => {
    const defaultTemplate = `-- IvorySQL PL/iSQL Query Window\n-- Press F9 or Ctrl+Enter to execute selected SQL query\n\nSELECT * FROM employees;\n`;
    const tempDir = os.tmpdir();
    const tempFilePath = path.join(tempDir, `ivorysql_query_${Date.now()}.sql`);
    fs.writeFileSync(tempFilePath, defaultTemplate, 'utf8');

    const doc = await vscode.workspace.openTextDocument(tempFilePath);
    await vscode.window.showTextDocument(doc);
  });

  // 1. 连接存储器与侧边栏 TreeView 注册
  const connectionStore = new ConnectionStore(context);
  const treeProvider = new ConnectionTreeProvider(connectionStore);
  vscode.window.registerTreeDataProvider('ivorysql-connections', treeProvider);

  // 2. 注册 PL/iSQL 代码美化/格式化器 (Shift + Alt + F)
  const formatterProvider = vscode.languages.registerDocumentFormattingEditProvider(
    'plisql',
    new PlIsqlFormatter()
  );

  // 3. 注册代码悬停表结构浮窗 (Hover Docs)
  const hoverProvider = vscode.languages.registerHoverProvider(
    'plisql',
    new PlIsqlHoverProvider()
  );

  // 4. 注册 F12 / Ctrl+Click 快捷跳转对象定义 (Go to Definition)
  const definitionProvider = vscode.languages.registerDefinitionProvider(
    'plisql',
    new PlIsqlDefinitionProvider()
  );

  // 5. 动态添加连接命令
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

  // 6. 编辑/修改已有的数据库连接参数
  const editConnCmd = vscode.commands.registerCommand('ivorysql.editConnection', async (item?: ConnectionTreeItem) => {
    if (!item || !item.connection) return;

    const oldConn = item.connection;
    const name = await vscode.window.showInputBox({ prompt: 'Connection Name', value: oldConn.name });
    if (!name) return;
    const host = await vscode.window.showInputBox({ prompt: 'IvorySQL Host', value: oldConn.host });
    if (!host) return;
    const portStr = await vscode.window.showInputBox({ prompt: 'IvorySQL Port', value: String(oldConn.port) });
    if (!portStr) return;
    const database = await vscode.window.showInputBox({ prompt: 'Database Name', value: oldConn.database });
    if (!database) return;
    const user = await vscode.window.showInputBox({ prompt: 'Database User', value: oldConn.user });
    if (!user) return;
    const password = await vscode.window.showInputBox({ prompt: 'Database Password', value: oldConn.password || '', password: true });

    await connectionStore.saveConnection({
      id: oldConn.id,
      name,
      host,
      port: parseInt(portStr, 10),
      database,
      user,
      password: password || '',
      isCurrent: oldConn.isCurrent
    });

    treeProvider.refresh();
    vscode.window.showInformationMessage(`Updated connection: ${name}`);
  });

  // 7. 连接选中的数据库环境
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

  // 反向拉取包头/包体/存储过程 DDL 源码，自动定位本地文件并打开 VS Code Diff 差异比对面板
  const openSourceCmd = vscode.commands.registerCommand('ivorysql.openPackageSource', async (schemaName: string, objectName: string, objectType: 'PACKAGE' | 'PACKAGE BODY' | 'PROCEDURE' | 'FUNCTION') => {
    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) {
      vscode.window.showWarningMessage('未连接数据库，请先连接 IvorySQL 实例。');
      return;
    }

    try {
      let dbCode = await dbManager.getDbSourceCode(schemaName, objectName, objectType);
      if (!dbCode) {
        if (objectType === 'PACKAGE') {
          dbCode = `-- IvorySQL PL/iSQL Package Header Specification: ${objectName}\nCREATE OR REPLACE PACKAGE ${objectName} IS\n  -- Add procedure/function declarations here\nEND ${objectName};\n`;
        } else if (objectType === 'PACKAGE BODY') {
          dbCode = `-- IvorySQL PL/iSQL Package Body Implementation: ${objectName}\nCREATE OR REPLACE PACKAGE BODY ${objectName} IS\n  -- Add procedure/function bodies here\nEND ${objectName};\n`;
        } else {
          dbCode = `-- IvorySQL PL/iSQL ${objectType}: ${objectName}\nCREATE OR REPLACE ${objectType} ${objectName} AS $$\nBEGIN\n  NULL;\nEND;\n$$ LANGUAGE plpgsql;\n`;
        }
      }

      // 1. 在当前 VS Code 工作区中智能定位同名本地文件
      const cleanPkgName = objectName.toLowerCase();
      let targetExts: string[] = [];
      if (objectType === 'PACKAGE') {
        targetExts = ['.pkh', '_header.sql', '.sql'];
      } else if (objectType === 'PACKAGE BODY') {
        targetExts = ['.pkb', '_body.sql', '.sql'];
      } else {
        targetExts = ['.sql', '.pls'];
      }

      const files = await vscode.workspace.findFiles(`**/*${cleanPkgName}*`);
      let matchedLocalUri: vscode.Uri | null = null;

      for (const file of files) {
        const fn = path.basename(file.fsPath).toLowerCase();
        if (targetExts.some(ext => fn.endsWith(ext))) {
          matchedLocalUri = file;
          break;
        }
      }

      // 创建数据库最新源码的独立临时磁盘文档 (加入 Schema 与包类型，支持多窗口同时保留，且 isDirty = false 关闭不误弹保存)
      const extName = objectType === 'PACKAGE' ? '.pkh' : (objectType === 'PACKAGE BODY' ? '.pkb' : '.sql');
      const safeType = objectType.toLowerCase().replace(/\s+/g, '_');
      const tempFilePath = path.join(os.tmpdir(), `${schemaName}_${objectName}_${safeType}${extName}`);
      fs.writeFileSync(tempFilePath, dbCode, 'utf8');

      const dbDoc = await vscode.workspace.openTextDocument(tempFilePath);

      // 2. 如果找到了匹配的本地源代码文件，自动调起 VS Code 原生 Diff 差异面板
      if (matchedLocalUri) {
        const title = `Local (${path.basename(matchedLocalUri.fsPath)}) ↔ DB Live (${objectName} [${objectType}])`;
        await vscode.commands.executeCommand('vscode.diff', matchedLocalUri, dbDoc.uri, title, { preview: false });
        vscode.window.showInformationMessage(`🔍 [Auto-Diff Enabled] 已自动找到本地文件 "${path.basename(matchedLocalUri.fsPath)}"，并与数据库实时 DDL 拉起差异比对！`);
      } else {
        // 未在本地找到匹配文件，打开独立的数据库源码编辑窗 (preview: false 确保不被覆盖)
        await vscode.window.showTextDocument(dbDoc, { preview: false });
        vscode.window.showInformationMessage(`[IvorySQL Source] 未在本地工作区找到匹配的 ${objectName} 文件，已从数据库拉取最新 DDL，您可以直接按 F8 覆盖编译。`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Open Source & Diff Error: ${err.message}`);
    }
  });

  // 数据库对象安全删除控制器 (带二次确认高危警告弹窗)
  const dropObjectCmd = vscode.commands.registerCommand('ivorysql.dropObject', async (item?: ConnectionTreeItem) => {
    if (!item) return;

    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) {
      vscode.window.showWarningMessage('未连接数据库，请先连接 IvorySQL 实例。');
      return;
    }

    const schemaName = item.extra?.schemaName || 'public';
    let objectName = item.extra?.pkgName || item.label;
    let dropType = '';

    if (item.itemType === 'PACKAGE') {
      dropType = 'PACKAGE';
    } else if (item.itemType === 'PACKAGE_HEADER') {
      dropType = 'PACKAGE';
    } else if (item.itemType === 'PACKAGE_BODY') {
      dropType = 'PACKAGE BODY';
    } else if (item.itemType === 'PROCEDURE') {
      dropType = 'PROCEDURE';
    } else if (item.itemType === 'FUNCTION') {
      dropType = 'FUNCTION';
    } else if (item.itemType === 'TABLE') {
      dropType = 'TABLE';
    } else if (item.itemType === 'VIEW') {
      dropType = 'VIEW';
    }

    if (!dropType || !objectName) return;

    // 二次确认高危防误删警告弹窗
    const choice = await vscode.window.showWarningMessage(
      `⚠️【高危警告】：您确定要从数据库 [${schemaName}] 中永久删除 ${dropType} "${objectName}" 吗？此操作不可逆！`,
      { modal: true },
      '确定物理删除',
      '取消'
    );

    if (choice !== '确定物理删除') {
      return;
    }

    try {
      const cleanObjName = objectName.replace(/"/g, '');
      let dropSql = '';
      if (!schemaName || schemaName.toLowerCase() === 'public' || schemaName.toLowerCase() === 'sys') {
        dropSql = `DROP ${dropType} IF EXISTS ${cleanObjName}`;
      } else {
        dropSql = `DROP ${dropType} IF EXISTS ${schemaName}.${cleanObjName}`;
      }

      await dbManager.query(dropSql);
      vscode.window.showInformationMessage(`[IvorySQL Drop Success] 成功从数据库中删除 ${dropType} "${cleanObjName}"！`);
      
      // 自动实时刷新侧边栏 TreeView 列表
      treeProvider.refresh();
    } catch (err: any) {
      vscode.window.showErrorMessage(`Drop Object Error: ${err.message}`);
    }
  });

  // 8. 检测当前连接的 Oracle 兼容模式状态命令
  const checkOracleModeCmd = vscode.commands.registerCommand('ivorysql.checkOracleMode', async () => {
    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) {
      vscode.window.showWarningMessage('未连接数据库，请先连接 IvorySQL 实例。');
      return;
    }

    try {
      let dialect = 'Unknown';
      let version = '';
      try {
        const cRes = await dbManager.query("SHOW ivorysql.compatible_mode");
        dialect = `ivorysql.compatible_mode = '${cRes.rows[0]?.['ivorysql.compatible_mode'] || cRes.rows[0]?.SHOW}'`;
      } catch (e1) {
        try {
          const dRes = await dbManager.query('SHOW db_dialect');
          dialect = `db_dialect = '${dRes.rows[0]?.db_dialect || dRes.rows[0]?.SHOW}'`;
        } catch (e2) {
          dialect = 'Standard PG Mode';
        }
      }

      try {
        const vRes = await dbManager.query('SELECT version()');
        version = vRes.rows[0]?.version || '';
      } catch (e) {}

      if (version.includes('IvorySQL') || dialect.toLowerCase().includes('oracle')) {
        vscode.window.showInformationMessage(`🎉 [IvorySQL 5.4 Verified] 检测成功！您正运行在真正的 IvorySQL 数据库上 (${version.substring(0, 35)}...) (${dialect})`);
      } else {
        vscode.window.showWarningMessage(`⚠️ [Mode Status] 当前数据库会话处于: ${dialect}`);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Check Oracle Mode Error: ${err.message}`);
    }
  });

  // 9. 后端包全表诊断检索命令 (Debug Scan Packages)
  const debugScanCmd = vscode.commands.registerCommand('ivorysql.debugScanPackage', async () => {
    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) {
      vscode.window.showWarningMessage('未连接数据库，请先连接 IvorySQL 实例。');
      return;
    }

    try {
      const sql = `
        SELECT 'pg_catalog.pg_package' AS catalog_table, pkgname::text AS name, 'PACKAGE' AS type, '' AS owner FROM pg_catalog.pg_package
        UNION ALL
        SELECT 'sys.all_source' AS catalog_table, name::text AS name, type::text AS type, owner::text AS owner FROM sys.all_source WHERE upper(name::text) LIKE '%EMP%'
        UNION ALL
        SELECT 'sys.user_source' AS catalog_table, name::text AS name, type::text AS type, '' AS owner FROM sys.user_source WHERE upper(name::text) LIKE '%EMP%'
        UNION ALL
        SELECT 'pg_proc' AS catalog_table, proname::text AS name, prokind::text AS type, nspname::text AS owner 
        FROM pg_proc 
        JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid 
        WHERE upper(proname::text) LIKE '%EMP%'
      `;
      const res = await dbManager.query(sql);
      if (res.rows.length === 0) {
        vscode.window.showInformationMessage('数据库字典扫盘完成：后端数据库全表中暂无包含 EMP 的 Package 记录。请在 emp_pkg.pkh 中按 F8 再次部署编译。');
      } else {
        const columns = ['catalog_table', 'name', 'type', 'owner'];
        ResultSetWebview.showQueryResult('后端数据库 Package 全字典扫描报告', null, columns, res.rows, res.rows.length, 0);
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Debug Scan Package Error: ${err.message}`);
    }
  });

  // 9. 固化 DBA 诊断报告命令绑定
  const r1Cmd = vscode.commands.registerCommand('ivorysql.reportTablespaces', () => DbaQueryRunner.runTablespaceReport());
  const r2Cmd = vscode.commands.registerCommand('ivorysql.reportLocks', () => DbaQueryRunner.runLockMonitorReport());
  const r3Cmd = vscode.commands.registerCommand('ivorysql.reportSlowQueries', () => DbaQueryRunner.runSlowQueriesReport());
  const r4Cmd = vscode.commands.registerCommand('ivorysql.reportInvalidObjects', () => DbaQueryRunner.runInvalidObjectsReport());
  const r5Cmd = vscode.commands.registerCommand('ivorysql.reportSessions', () => DbaQueryRunner.runSessionStatsReport());
  const r6Cmd = vscode.commands.registerCommand('ivorysql.reportHitRatio', () => DbaQueryRunner.runCacheHitRatioReport());

  // 10. 执行选中的 SQL / 当前文本块 (F9 或 Ctrl+Enter)
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

  // 11. 提取与查看 Table DDL 语句
  const ddlCmd = vscode.commands.registerCommand('ivorysql.viewTableDdl', async (item?: ConnectionTreeItem) => {
    if (!item || !item.label) return;
    const ddl = await DbTools.generateTableDdl(item.label);
    const doc = await vscode.workspace.openTextDocument({ content: ddl, language: 'plisql' });
    await vscode.window.showTextDocument(doc);
  });

  // 12. 查看表数据前 100 条记录 (Select Top 100 Rows)
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

  // 13. 活跃会话管理与监控 (Show Active Sessions)
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

  // 14. 删除连接命令与刷新
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

  // 15. 快捷键 Alt+O 切换 Package Header / Body
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

  // 16. Git-First 部署与编译命令 (F8)
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
      const savedConnections = connectionStore.getConnections();
      if (savedConnections.length > 0) {
        const selectedItem = await vscode.window.showQuickPick(
          savedConnections.map(c => ({
            label: `$(plug) ${c.name}`,
            description: `${c.host}:${c.port}/${c.database}`,
            conn: c
          })),
          { placeHolder: '未连接数据库！请选择要连接的 IvorySQL 数据库环境：' }
        );

        if (selectedItem) {
          const success = await dbManager.connect({
            host: selectedItem.conn.host,
            port: selectedItem.conn.port,
            database: selectedItem.conn.database,
            user: selectedItem.conn.user,
            password: selectedItem.conn.password || ''
          });
          if (success) {
            await connectionStore.setCurrentConnection(selectedItem.conn.id);
            treeProvider.refresh();
          } else {
            return;
          }
        } else {
          return;
        }
      } else {
        const createChoice = await vscode.window.showWarningMessage(
          '未连接到 IvorySQL 数据库，且尚未保存任何连接信息。是否立即新建连接？',
          '新建连接',
          '取消'
        );
        if (createChoice === '新建连接') {
          await vscode.commands.executeCommand('ivorysql.addConnection');
        }
        return;
      }
    }

    try {
      diagnosticsCollection.clear();

      let cleanContent = content
        .replace(/^\s*\/\s*$/gm, '')
        .trim();

      await dbManager.query(cleanContent);

      // 提取目标 Schema (若显式指定如 hr.emp_pkg，则提取 hr，否则显示当前活动 Schema)
      const targetSchema = objectName.includes('.') ? objectName.split('.')[0] : 'public (Default Schema)';
      vscode.window.showInformationMessage(`[IvorySQL] 成功编译并部署 ${objectType} "${objectName}" 到 Schema [${targetSchema}]！`);
      
      // 自动实时刷新左侧侧边栏导航树
      treeProvider.refresh();
    } catch (err: any) {
      const lineMatch = err.message.match(/LINE\s+(\d+):/i) || err.message.match(/at line (\d+)/i);
      const lineNum = lineMatch ? Math.max(0, parseInt(lineMatch[1], 10) - 1) : 0;

      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(lineNum, 0, lineNum, 100),
        `IvorySQL Compile Error: ${err.message}`,
        vscode.DiagnosticSeverity.Error
      );

      diagnosticsCollection.set(document.uri, [diagnostic]);

      let friendlyMsg = `[IvorySQL 编译错误] Line ${lineNum + 1}: ${err.message}`;
      if (err.message.includes('does not exist')) {
        if (err.message.includes('sys_refcursor')) {
          friendlyMsg += ' 💡【提示】：在 IvorySQL 中，请直接使用 PostgreSQL/PLiSQL 标准游标数据类型关键字 refcursor (如: p_cursor OUT refcursor)。';
        } else if (objectType === 'PACKAGE BODY' || document.fileName.endsWith('.pkb')) {
          friendlyMsg += ' 💡【提示】：当包体依赖自定义类型时，请确保已先按 F8 编译部署对应的 Package Header (.pkh) 包头文件。';
        }
      }

      vscode.window.showErrorMessage(friendlyMsg);
    }
  });

  // 17. 注册动态 Intellisense 智能补全器
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    'plisql',
    new PlIsqlCompletionItemProvider(),
    '.'
  );

  context.subscriptions.push(
    newSqlScriptCmd,
    addConnCmd,
    editConnCmd,
    connectSelectedCmd,
    openSourceCmd,
    dropObjectCmd,
    checkOracleModeCmd,
    debugScanCmd,
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
    hoverProvider,
    definitionProvider,
    completionProvider,
    diagnosticsCollection
  );
}

export function deactivate() {
  if (diagnosticsCollection) {
    diagnosticsCollection.clear();
  }
}
