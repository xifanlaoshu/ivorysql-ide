import * as vscode from 'vscode';
import { IvoryDbManager } from '../db/connectionManager';

export class PlIsqlHoverProvider implements vscode.HoverProvider {
  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | null> {
    const config = vscode.workspace.getConfiguration('ivorysql.editor');
    const enableHover = config.get<boolean>('enableHoverSchema', true);
    if (!enableHover) return null;

    const range = document.getWordRangeAtPosition(position);
    if (!range) return null;

    const word = document.getText(range);
    if (!word || word.length < 2) return null;

    const db = IvoryDbManager.getInstance();
    if (!db.isConnected()) return null;

    try {
      const columns = await db.getRealtimeColumns(word);
      if (columns.length > 0) {
        const mdTable = columns.map(c => `| \`${c.column_name}\` | \`${c.data_type.toUpperCase()}\` |`).join('\n');
        const contents = new vscode.MarkdownString();
        contents.appendMarkdown(`### 📊 IvorySQL Table: \`${word}\`\n\n`);
        contents.appendMarkdown(`| Column Name | Data Type |\n| :--- | :--- |\n${mdTable}`);
        return new vscode.Hover(contents, range);
      }

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
