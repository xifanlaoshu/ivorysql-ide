import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PlIsqlDefinitionProvider implements vscode.DefinitionProvider {
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
    // 1. 获取光标处的完整点号连接表达式 (例如 aurora_admin.admin_user_pkg.change_user_status)
    const lineText = document.lineAt(position.line).text;
    const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_\.]+/);
    if (!wordRange) return undefined;

    const expr = document.getText(wordRange).trim();
    if (!expr || expr.length < 2) return undefined;

    // 拆解多段点号表达式
    const parts = expr.split('.');
    let targetPkgName = '';
    let targetProcName = '';

    if (parts.length === 3) {
      // aurora_admin.admin_user_pkg.change_user_status
      targetPkgName = parts[1];
      targetProcName = parts[2];
    } else if (parts.length === 2) {
      // admin_user_pkg.change_user_status
      targetPkgName = parts[0];
      targetProcName = parts[1];
    } else if (parts.length === 1) {
      targetProcName = parts[0];
    }

    // 2. 如果解析出了特定的包名 (例如 admin_user_pkg)，优先搜寻匹配文件
    if (targetPkgName) {
      const cleanPkgName = targetPkgName.replace(/"/g, '');
      const files = await vscode.workspace.findFiles(`**/*${cleanPkgName}*.{pkb,pkh,sql}`);
      
      for (const file of files) {
        const targetDoc = await vscode.workspace.openTextDocument(file);
        const targetText = targetDoc.getText();
        const targetLines = targetText.split(/\r?\n/);

        if (targetProcName) {
          for (let i = 0; i < targetLines.length; i++) {
            const line = targetLines[i];
            const procRegex = new RegExp(`PROCEDURE\\s+${targetProcName}\\b`, 'i');
            if (procRegex.test(line)) {
              return new vscode.Location(file, new vscode.Position(i, line.search(new RegExp(targetProcName, 'i'))));
            }
          }
        } else {
          return new vscode.Location(file, new vscode.Position(0, 0));
        }
      }
    }

    // 3. 工作区全文 AST 强力搜寻 (在所有工作区 .pkb, .pkh, .sql 文件内搜寻 PROCEDURE/FUNCTION targetProcName)
    if (targetProcName) {
      const allFiles = await vscode.workspace.findFiles(`**/*.{pkb,pkh,sql}`);
      for (const file of allFiles) {
        const targetDoc = await vscode.workspace.openTextDocument(file);
        const targetText = targetDoc.getText();
        const targetLines = targetText.split(/\r?\n/);

        for (let i = 0; i < targetLines.length; i++) {
          const line = targetLines[i];
          const procRegex = new RegExp(`(?:PROCEDURE|FUNCTION)\\s+${targetProcName}\\b`, 'i');
          if (procRegex.test(line)) {
            return new vscode.Location(file, new vscode.Position(i, line.search(new RegExp(targetProcName, 'i'))));
          }
        }
      }
    }

    // 4. 尝试根据当前文件名寻找对应的同名包体/包头文件
    const ext = path.extname(document.fileName).toLowerCase();
    let targetExt = '';
    if (ext === '.pkh') targetExt = '.pkb';
    else if (ext === '.pkb') targetExt = '.pkh';

    if (targetExt && targetProcName) {
      const targetFilePath = document.fileName.substring(0, document.fileName.length - ext.length) + targetExt;
      if (fs.existsSync(targetFilePath)) {
        const targetUri = vscode.Uri.file(targetFilePath);
        const targetDoc = await vscode.workspace.openTextDocument(targetUri);
        const targetText = targetDoc.getText();
        const targetLines = targetText.split(/\r?\n/);

        for (let i = 0; i < targetLines.length; i++) {
          const line = targetLines[i];
          const procRegex = new RegExp(`PROCEDURE\\s+${targetProcName}\\b`, 'i');
          if (procRegex.test(line)) {
            return new vscode.Location(targetUri, new vscode.Position(i, line.search(new RegExp(targetProcName, 'i'))));
          }
        }
      }
    }

    return undefined;
  }
}
