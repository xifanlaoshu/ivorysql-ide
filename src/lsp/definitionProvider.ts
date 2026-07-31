import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { DbTools } from '../db/ddlGenerator';

export class PlIsqlDefinitionProvider implements vscode.DefinitionProvider {
  public async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Definition | vscode.LocationLink[] | null> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) return null;

    const word = document.getText(range);
    if (!word || word.length < 2) return null;

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;

    const rootPath = workspaceFolders[0].uri.fsPath;

    // 1. 在本地 Git 工作区搜索匹配的包头/包体文件 (.pkh / .pkb)
    const possibleFiles = [
      path.join(rootPath, `${word}.pkh`),
      path.join(rootPath, `${word}.pkb`),
      path.join(rootPath, 'samples', `${word}.pkh`),
      path.join(rootPath, 'samples', `${word}.pkb`)
    ];

    for (const file of possibleFiles) {
      if (fs.existsSync(file)) {
        const uri = vscode.Uri.file(file);
        return new vscode.Location(uri, new vscode.Position(0, 0));
      }
    }

    // 2. 若本地无匹配文件，尝试反向提取 DDL 弹窗开窗展示
    try {
      const ddl = await DbTools.generateTableDdl(word);
      if (ddl && !ddl.includes('not found')) {
        const doc = await vscode.workspace.openTextDocument({ content: ddl, language: 'plisql' });
        await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
        return null;
      }
    } catch (e) {
      return null;
    }

    return null;
  }
}
