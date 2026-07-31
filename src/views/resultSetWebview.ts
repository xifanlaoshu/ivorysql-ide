import * as vscode from 'vscode';
import { IvoryDbManager } from '../db/connectionManager';

export class ResultSetWebview {
  public static showQueryResult(title: string, tableName: string | null, columns: string[], rows: any[], rowCount: number, durationMs: number) {
    const panel = vscode.window.createWebviewPanel(
      'ivorysqlQueryResult',
      `Result: ${title}`,
      vscode.ViewColumn.Two,
      { enableScripts: true }
    );

    panel.webview.html = this.getHtmlContent(title, tableName, columns, rows, rowCount, durationMs);

    // 监听 Webview 中用户对数据修改后点击 "Save / Commit Changes" 消息
    panel.webview.onDidReceiveMessage(async (message) => {
      if (message.command === 'saveDataChanges') {
        const { targetTable, changes } = message;
        if (!targetTable || !changes || changes.length === 0) {
          vscode.window.showWarningMessage('No data changes to commit.');
          return;
        }

        const db = IvoryDbManager.getInstance();
        if (!db.isConnected()) {
          vscode.window.showErrorMessage('Not connected to IvorySQL database.');
          return;
        }

        try {
          await db.query('BEGIN');
          for (const change of changes) {
            const { original, updated } = change;
            const setClause = Object.keys(updated)
              .map((col, idx) => `${col} = $${idx + 1}`)
              .join(', ');
            const setValues = Object.values(updated);

            const whereClause = Object.keys(original)
              .map((col, idx) => `${col} = $${setValues.length + idx + 1}`)
              .join(' AND ');
            const whereValues = Object.values(original);

            const updateSql = `UPDATE ${targetTable} SET ${setClause} WHERE ${whereClause}`;
            await db.query(updateSql, [...setValues, ...whereValues]);
          }
          await db.query('COMMIT');
          vscode.window.showInformationMessage(`[IvorySQL] 成功更新并提交 ${changes.length} 行数据修改！`);
        } catch (err: any) {
          await db.query('ROLLBACK');
          vscode.window.showErrorMessage(`Data Update Failed: ${err.message}`);
        }
      }
    });
  }

  private static getHtmlContent(title: string, tableName: string | null, columns: string[], rows: any[], rowCount: number, durationMs: number): string {
    const isEditable = tableName !== null;
    const headers = columns.map(c => `<th>${c}</th>`).join('');
    
    const tableRows = rows.map((r, rowIndex) => {
      const cells = columns.map(c => {
        const val = r[c] !== null && r[c] !== undefined ? String(r[c]) : '';
        const displayVal = val === '' ? '<span class="null-val">NULL</span>' : val;
        return `<td contenteditable="${isEditable}" data-col="${c}" data-row="${rowIndex}" data-original="${val}">${displayVal}</td>`;
      }).join('');
      return `<tr data-row-index="${rowIndex}">${cells}</tr>`;
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
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .btn {
      background-color: #0e639c;
      color: #ffffff;
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 500;
    }
    .btn:hover {
      background-color: #1177bb;
    }
    .btn-disabled {
      background-color: #444;
      cursor: not-allowed;
      opacity: 0.6;
    }
    .table-container {
      overflow-x: auto;
      max-height: calc(100vh - 80px);
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
      z-index: 10;
    }
    td {
      padding: 6px 12px;
      border-bottom: 1px solid #2d2d2d;
      white-space: nowrap;
      outline: none;
    }
    td[contenteditable="true"]:focus {
      background-color: #264f78 !important;
      border: 1px solid #007acc;
    }
    td.modified {
      background-color: #5a4f1e !important;
      color: #ffe066;
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
    <div class="title">${isEditable ? '✏️ Editable Data Grid: ' + tableName : '🔍 SQL Query Results: ' + title}</div>
    <div class="meta">
      <span>Rows: ${rowCount} | Time: ${durationMs} ms</span>
      ${isEditable ? '<button id="saveBtn" class="btn">💾 Commit Changes to DB</button>' : ''}
    </div>
  </div>
  <div class="table-container">
    <table>
      <thead>
        <tr>${headers}</tr>
      </thead>
      <tbody id="tbody">
        ${tableRows.length > 0 ? tableRows : '<tr><td colspan="100%" style="text-align:center; color:#858585;">No rows returned</td></tr>'}
      </tbody>
    </table>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const isEditable = ${isEditable};
    const tableName = ${JSON.stringify(tableName)};
    const rowsData = ${JSON.stringify(rows)};
    const modifiedChanges = {};

    if (isEditable) {
      const tbody = document.getElementById('tbody');
      tbody.addEventListener('input', (e) => {
        const td = e.target;
        if (td.tagName === 'TD') {
          const col = td.getAttribute('data-col');
          const rowIndex = parseInt(td.getAttribute('data-row'), 10);
          const originalVal = td.getAttribute('data-original');
          const newVal = td.innerText.trim();

          if (newVal !== originalVal) {
            td.classList.add('modified');
            if (!modifiedChanges[rowIndex]) {
              modifiedChanges[rowIndex] = {
                original: { ...rowsData[rowIndex] },
                updated: {}
              };
            }
            modifiedChanges[rowIndex].updated[col] = newVal;
          } else {
            td.classList.remove('modified');
            if (modifiedChanges[rowIndex]) {
              delete modifiedChanges[rowIndex].updated[col];
              if (Object.keys(modifiedChanges[rowIndex].updated).length === 0) {
                delete modifiedChanges[rowIndex];
              }
            }
          }
        }
      });

      document.getElementById('saveBtn').addEventListener('click', () => {
        const changesArray = Object.values(modifiedChanges);
        if (changesArray.length === 0) {
          alert('No data modified!');
          return;
        }
        vscode.postMessage({
          command: 'saveDataChanges',
          targetTable: tableName,
          changes: changesArray
        });
      });
    }
  </script>
</body>
</html>`;
  }
}
