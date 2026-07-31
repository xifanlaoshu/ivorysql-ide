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

    // 2. 如果解析出了特定的包名 (例如 admin_user_pkg)，在工作区搜寻对应的 .pkb 或 .pkh 文件
    if (targetPkgName) {
      const files = await vscode.workspace.findFiles(`**/${targetPkgName}.{pkb,pkh,sql}`);
      if (files.length > 0) {
        // 优先搜寻包体 .pkb，其次包头 .pkh
        const pkbFile = files.find(f => f.fsPath.endsWith('.pkb')) || files[0];
        const targetDoc = await vscode.workspace.openTextDocument(pkbFile);
        const targetText = targetDoc.getText();
        const targetLines = targetText.split(/\r?\n/);

        if (targetProcName) {
          for (let i = 0; i < targetLines.length; i++) {
            const line = targetLines[i];
            const procRegex = new RegExp(`PROCEDURE\\s+${targetProcName}\\b`, 'i');
            if (procRegex.test(line)) {
              return new vscode.Location(pkbFile, new vscode.Position(i, line.search(new RegExp(targetProcName, 'i'))));
            }
          }
        }

        // 如果没有精准过程定位，打开目标包文件首行
        return new vscode.Location(pkbFile, new vscode.Position(0, 0));
      }
    }

    // 3. 在当前文档中按过程名直接搜寻定义
    if (targetProcName) {
      const currentText = document.getText();
      const lines = currentText.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const procRegex = new RegExp(`PROCEDURE\\s+${targetProcName}\\b`, 'i');
        if (procRegex.test(line)) {
          return new vscode.Location(document.uri, new vscode.Position(i, line.search(new RegExp(targetProcName, 'i'))));
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
