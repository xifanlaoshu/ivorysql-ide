import * as vscode from 'vscode';
import { IvoryDbManager } from '../db/connectionManager';

export class PlIsqlHoverProvider implements vscode.HoverProvider {
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const range = document.getWordRangeAtPosition(position);
    if (!range) return null;

    const word = document.getText(range);
    if (!word || word.length < 2) return null;

    const db = IvoryDbManager.getInstance();
    if (!db.isConnected()) return null;

    try {
      // 1. 尝试作为表名/视图名获取实时结构列信息
      const columns = await db.getRealtimeColumns(word);
      if (columns.length > 0) {
        const mdTable = columns.map(c => `| \`${c.column_name}\` | \`${c.data_type.toUpperCase()}\` |`).join('\n');
        const contents = new vscode.MarkdownString();
        contents.appendMarkdown(`### 📊 IvorySQL Table: \`${word}\`\n\n`);
        contents.appendMarkdown(`| Column Name | Data Type |\n| :--- | :--- |\n${mdTable}`);
        return new vscode.Hover(contents, range);
      }

      // 2. 尝试作为 Package 查看过程列表
      const procedures = await db.getRealtimeProcedures(word);
      if (procedures.length > 0) {
        const procList = procedures.map(p => `- **${p.type}**: \`${p.name}\``).join('\n');
        const contents = new vscode.MarkdownString();
        contents.appendMarkdown(`### 📦 Package / Module: \`${word}\`\n\n${procList}`);
        return new vscode.Hover(contents, range);
      }
    } catch (e) {
      return null;
    }

    return null;
  }
}
