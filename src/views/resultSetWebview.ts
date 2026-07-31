import * as vscode from 'vscode';

export class ResultSetWebview {
  public static showQueryResult(title: string, columns: string[], rows: any[], rowCount: number, durationMs: number) {
    const panel = vscode.window.createWebviewPanel(
      'ivorysqlQueryResult',
      `Result: ${title}`,
      vscode.ViewColumn.Two,
      { enableScripts: true }
    );

    panel.webview.html = this.getHtmlContent(title, columns, rows, rowCount, durationMs);
  }

  private static getHtmlContent(title: string, columns: string[], rows: any[], rowCount: number, durationMs: number): string {
    const headers = columns.map(c => `<th>${c}</th>`).join('');
    const tableRows = rows.map(r => {
      const cells = columns.map(c => `<td>${r[c] !== null && r[c] !== undefined ? String(r[c]) : '<span class="null-val">NULL</span>'}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <style>
    body {
      background-color: #1e1e1e;
      color: #d4d4d4;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 16px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 8px;
      border-bottom: 1px solid #333;
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      color: #4ec9b0;
    }
    .meta {
      font-size: 12px;
      color: #858585;
    }
    .table-container {
      overflow-x: auto;
      border: 1px solid #3c3c3c;
      border-radius: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      background-color: #252526;
      color: #569cd6;
      text-align: left;
      padding: 8px 12px;
      border-bottom: 1px solid #3c3c3c;
      font-weight: 600;
      position: sticky;
      top: 0;
    }
    td {
      padding: 6px 12px;
      border-bottom: 1px solid #2d2d2d;
      white-space: nowrap;
    }
    tr:nth-child(even) {
      background-color: #1a1a1a;
    }
    tr:hover {
      background-color: #2a2d2e;
    }
    .null-val {
      color: #808080;
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">SQL Query Results: ${title}</div>
    <div class="meta">Rows: ${rowCount} | Execution Time: ${durationMs} ms</div>
  </div>
  <div class="table-container">
    <table>
      <thead>
        <tr>${headers}</tr>
      </thead>
      <tbody>
        ${tableRows.length > 0 ? tableRows : '<tr><td colspan="100%" style="text-align:center; color:#858585;">No rows returned</td></tr>'}
      </tbody>
    </table>
  </div>
</body>
</html>`;
  }
}
