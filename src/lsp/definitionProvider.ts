import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class PlIsqlDefinitionProvider implements vscode.DefinitionProvider {
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.LocationLink[] | undefined> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) return undefined;

    const word = document.getText(range);
    if (!word || word.length < 2) return undefined;

    // 忽视通用关键字
    const keywords = ['BEGIN', 'END', 'DECLARE', 'PROCEDURE', 'FUNCTION', 'PACKAGE', 'BODY', 'VARCHAR2', 'NUMBER', 'IS', 'AS', 'IF', 'THEN'];
    if (keywords.includes(word.toUpperCase())) return undefined;

    // 1. 先在当前文档中查找该过程/函数/包的定义行
    const currentText = document.getText();
    const lines = currentText.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const procRegex = new RegExp(`(?:PROCEDURE|FUNCTION|PACKAGE(?:\\s+BODY)?)\\s+${word}\\b`, 'i');
      if (procRegex.test(line)) {
        return new vscode.Location(document.uri, new vscode.Position(i, line.indexOf(word)));
      }
    }

    // 2. 如果在当前文件中未找到，且当前是 .pkh / .pkb 文件，尝试在同名对应的包体/包头文件中寻找定义
    const ext = path.extname(document.fileName).toLowerCase();
    let targetExt = '';
    if (ext === '.pkh') targetExt = '.pkb';
    else if (ext === '.pkb') targetExt = '.pkh';

    if (targetExt) {
      const targetFilePath = document.fileName.substring(0, document.fileName.length - ext.length) + targetExt;
      if (fs.existsSync(targetFilePath)) {
        const targetUri = vscode.Uri.file(targetFilePath);
        const targetDoc = await vscode.workspace.openTextDocument(targetUri);
        const targetText = targetDoc.getText();
        const targetLines = targetText.split(/\r?\n/);

        for (let i = 0; i < targetLines.length; i++) {
          const line = targetLines[i];
          const procRegex = new RegExp(`(?:PROCEDURE|FUNCTION)\\s+${word}\\b`, 'i');
          if (procRegex.test(line)) {
            return new vscode.Location(targetUri, new vscode.Position(i, line.indexOf(word)));
          }
        }
        
        // 如果没有精准过程，退而求其次跳转到文件第一行
        return new vscode.Location(targetUri, new vscode.Position(0, 0));
      }
    }

    return undefined;
  }
}
