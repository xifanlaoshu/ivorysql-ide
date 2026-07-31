import * as vscode from 'vscode';
import { IvoryDbManager } from '../db/connectionManager';

export class PlIsqlCompletionItemProvider implements vscode.CompletionItemProvider {
  public async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): Promise<vscode.CompletionItem[] | vscode.CompletionList> {
    const items: vscode.CompletionItem[] = [];
    const linePrefix = document.lineAt(position).text.substring(0, position.character);

    const dbManager = IvoryDbManager.getInstance();

    // 1. 点号 '.' 后触发的智能补全
    if (linePrefix.endsWith('.')) {
      const match = linePrefix.match(/([a-zA-Z0-9_]+)\.$/);
      if (match) {
        const objectName = match[1];

        if (dbManager.isConnected()) {
          // A. 尝试作为表名，实时查询列结构
          const columns = await dbManager.getRealtimeColumns(objectName);
          if (columns.length > 0) {
            columns.forEach(col => {
              const item = new vscode.CompletionItem(col.column_name, vscode.CompletionItemKind.Field);
              item.detail = `${col.data_type} (Column of ${objectName})`;
              item.documentation = new vscode.MarkdownString(`Real-time database column from \`${objectName}\``);
              items.push(item);
            });
            return items;
          }

          // B. 尝试作为 Package 名，实时查询过程/函数
          const procedures = await dbManager.getRealtimeProcedures(objectName);
          if (procedures.length > 0) {
            procedures.forEach(proc => {
              const item = new vscode.CompletionItem(proc.name, vscode.CompletionItemKind.Method);
              item.detail = `${proc.type} of ${objectName}`;
              item.documentation = new vscode.MarkdownString(`Real-time Package method from \`${objectName}\``);
              items.push(item);
            });
            return items;
          }
        }

        // C. 特殊系统包硬编码补全 (DBMS_OUTPUT 等)
        if (objectName.toUpperCase() === 'DBMS_OUTPUT') {
          ['PUT_LINE', 'PUT', 'NEW_LINE', 'ENABLE', 'DISABLE', 'GET_LINE'].forEach(m => {
            const item = new vscode.CompletionItem(m, vscode.CompletionItemKind.Method);
            item.detail = 'DBMS_OUTPUT method';
            items.push(item);
          });
          return items;
        }
      }
    }

    // 2. 普通基础关键字与数据库表名/过程名实时补全
    if (dbManager.isConnected()) {
      const tables = await dbManager.getRealtimeTables();
      tables.forEach(t => {
        const item = new vscode.CompletionItem(t, vscode.CompletionItemKind.Class);
        item.detail = 'IvorySQL Table';
        items.push(item);
      });
    }

    // PL/iSQL 核心关键字补全
    const keywords = [
      'PACKAGE', 'PACKAGE BODY', 'PROCEDURE', 'FUNCTION', 'BEGIN', 'END', 'IF', 'THEN', 'ELSIF', 'ELSE',
      'LOOP', 'WHILE', 'FOR', 'CURSOR', 'EXCEPTION', 'WHEN', 'RAISE', 'PRAGMA', 'VARCHAR2', 'NUMBER', 'DATE'
    ];

    keywords.forEach(k => {
      const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Keyword);
      items.push(item);
    });

    return items;
  }
}
