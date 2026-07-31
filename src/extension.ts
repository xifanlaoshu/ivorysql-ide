import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { IvoryDbManager } from './db/connectionManager';
import { GitDbSyncManager } from './versionControl/syncManager';
import { PlIsqlCompletionItemProvider } from './lsp/completionProvider';

let diagnosticsCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log('IvorySQL PL/iSQL Developer Extension is now active!');

  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
  const syncManager = new GitDbSyncManager(workspacePath);
  diagnosticsCollection = vscode.languages.createDiagnosticCollection('plisql');

  // 1. 注册连接数据库命令
  const connectCmd = vscode.commands.registerCommand('ivorysql.connect', async () => {
    const config = vscode.workspace.getConfiguration('ivorysql.connection');
    const host = await vscode.window.showInputBox({ prompt: 'IvorySQL Host', value: config.get('host', 'localhost') });
    if (!host) return;
    const portStr = await vscode.window.showInputBox({ prompt: 'IvorySQL Port', value: String(config.get('port', 5432)) });
    if (!portStr) return;
    const database = await vscode.window.showInputBox({ prompt: 'Database Name', value: config.get('database', 'ivorysql') });
    if (!database) return;
    const user = await vscode.window.showInputBox({ prompt: 'Database User', value: config.get('user', 'ivorysql') });
    if (!user) return;
    const password = await vscode.window.showInputBox({ prompt: 'Database Password', password: true });

    await IvoryDbManager.getInstance().connect({
      host,
      port: parseInt(portStr, 10),
      database,
      user,
      password: password || ''
    });
  });

  // 2. 注册 Package Header 与 Body 双向一键切换快捷键 (Alt + O)
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

  // 3. 注册 Git-First 部署与编译命令 (F8)
  const deployCmd = vscode.commands.registerCommand('ivorysql.deployToDb', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage('没有打开的可编辑 PL/iSQL 文件');
      return;
    }

    const document = editor.document;
    const content = document.getText();

    // 解析当前文件的对象名称与类型
    const match = content.match(/CREATE\s+(?:OR\s+REPLACE\s+)?(PACKAGE(?:\s+BODY)?|PROCEDURE|FUNCTION)\s+([a-zA-Z0-9_"\.]+)/i);
    const objectType = match ? (match[1].toUpperCase() as any) : 'PACKAGE';
    const objectName = match ? match[2] : path.basename(document.fileName, path.extname(document.fileName));

    // A. 校验与 DB 的 Diff，防止覆盖不一致的代码 (Lock Check)
    const syncStatus = await syncManager.verifySyncState(document, objectName, objectType);
    if (!syncStatus.isSynced) {
      vscode.window.showErrorMessage(syncStatus.reason || 'Database and Local Git code drift detected!');
      return;
    }

    // B. 执行 Git-First 强制落盘与 Commit 检查
    const committed = await syncManager.ensureGitCommitted(document);
    if (!committed) {
      vscode.window.showWarningMessage('编译中断：必须先将修改落地提交到 Git 仓库，方可部署至数据库！');
      return;
    }

    // C. 执行数据库编译
    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) {
      vscode.window.showErrorMessage('未连接到 IvorySQL 数据库！请先运行 "IvorySQL: Connect to Database"');
      return;
    }

    try {
      diagnosticsCollection.clear();
      await dbManager.query(content);
      vscode.window.showInformationMessage(`[IvorySQL] 成功编译并部署 ${objectType} "${objectName}" 到数据库！`);
    } catch (err: any) {
      // 提取编译错误位置并展示 Diagnostics 标红
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

  // 4. 注册动态 Intellisense 智能补全器 (针对 plisql 语言)
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    'plisql',
    new PlIsqlCompletionItemProvider(),
    '.' // 绑定点号触发
  );

  context.subscriptions.push(connectCmd, switchCmd, deployCmd, completionProvider, diagnosticsCollection);
}

export function deactivate() {
  if (diagnosticsCollection) {
    diagnosticsCollection.clear();
  }
}
