import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { IvoryDbManager } from '../db/connectionManager';

export class PlIsqlDefinitionProvider implements vscode.DefinitionProvider {
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
    try {
      // 1. 获取光标所在位置的单词
      const wordRange = document.getWordRangeAtPosition(position, /[a-zA-Z0-9_]+/);
      if (!wordRange) return undefined;

      const wordAtCursor = document.getText(wordRange).trim();
      if (!wordAtCursor || wordAtCursor.length < 2) return undefined;

      // 忽视常规通用关键字
      const keywords = ['BEGIN', 'END', 'DECLARE', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'BODY', 'VARCHAR2', 'NUMBER', 'IS', 'AS', 'IF', 'THEN', 'SET', 'SELECT', 'FROM', 'WHERE'];
      if (keywords.includes(wordAtCursor.toUpperCase())) return undefined;

      // 2. 向前/向后提取完整表达语句，分析 Schema.Package.Procedure 结构
      const lineText = document.lineAt(position.line).text;
      const exprRegex = new RegExp(`([a-zA-Z0-9_"]+(?:\\.[a-zA-Z0-9_"]+)*\\.${wordAtCursor}|${wordAtCursor}(?:\\.[a-zA-Z0-9_"]+)*)`, 'i');
      const match = lineText.match(exprRegex);
      const fullExpr = match ? match[0].replace(/"/g, '') : wordAtCursor;

      const parts = fullExpr.split('.');
      let targetPkgName = '';
      let targetProcName = wordAtCursor;

      if (parts.length >= 2) {
        targetProcName = parts[parts.length - 1];
        targetPkgName = parts[parts.length - 2];
      }

      // 3. 【策略 A】：若提取出特定包名 (如 admin_user_pkg)，搜索包含该包名的源代码文件
      if (targetPkgName) {
        const cleanPkgName = targetPkgName.toLowerCase();
        const files = await vscode.workspace.findFiles(`**/*${cleanPkgName}*.{pkb,pkh,sql}`);
        
        for (const file of files) {
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

      // 4. 【策略 B】：工作区全量文件 AST 深度扫描 (搜寻 PROCEDURE/FUNCTION targetProcName)
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

      // 5. 【策略 C】：当前文档内部同行/同页搜索
      const currentText = document.getText();
      const lines = currentText.split(/\r?\n/);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const procRegex = new RegExp(`(?:PROCEDURE|FUNCTION|PACKAGE(?:\\s+BODY)?)\\s+${targetProcName}\\b`, 'i');
        if (procRegex.test(line)) {
          return new vscode.Location(document.uri, new vscode.Position(i, line.search(new RegExp(targetProcName, 'i'))));
        }
      }

      // 6. 【策略 D】：同名包头/包体关联关联导航 (.pkh ↔ .pkb)
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
            const procRegex = new RegExp(`(?:PROCEDURE|FUNCTION)\\s+${targetProcName}\\b`, 'i');
            if (procRegex.test(line)) {
              return new vscode.Location(targetUri, new vscode.Position(i, line.search(new RegExp(targetProcName, 'i'))));
            }
          }
        }
      }

      // 7. 【策略 E】：如果本地文件均未命中且提供了包名，自动连库从数据库实时拉取 DDL 源代码并定位！
      if (targetPkgName) {
        const dbManager = IvoryDbManager.getInstance();
        if (dbManager.isConnected()) {
          try {
            const res = await dbManager.query(`
              SELECT dbms_metadata.get_ddl('PACKAGE_BODY', upper('${targetPkgName}')) AS ddl
            `);
            if (res && res.rows && res.rows.length > 0 && res.rows[0].ddl) {
              const ddlText = res.rows[0].ddl;
              const tempFilePath = path.join(os.tmpdir(), `${targetPkgName}_live.pkb`);
              fs.writeFileSync(tempFilePath, ddlText, 'utf-8');

              const liveUri = vscode.Uri.file(tempFilePath);
              const liveDoc = await vscode.workspace.openTextDocument(liveUri);
              const liveLines = ddlText.split(/\r?\n/);

              for (let i = 0; i < liveLines.length; i++) {
                const line = liveLines[i];
                const procRegex = new RegExp(`(?:PROCEDURE|FUNCTION)\\s+${targetProcName}\\b`, 'i');
                if (procRegex.test(line)) {
                  return new vscode.Location(liveUri, new vscode.Position(i, line.search(new RegExp(targetProcName, 'i'))));
                }
              }
              return new vscode.Location(liveUri, new vscode.Position(0, 0));
            }
          } catch(e) {}
        }
      }

    } catch (err) {
      console.error('Error in PlIsqlDefinitionProvider:', err);
    }

    return undefined;
  }
}
