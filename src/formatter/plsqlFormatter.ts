import * as vscode from 'vscode';

export class PlIsqlFormatter implements vscode.DocumentFormattingEditProvider {
  private keywords = new Set([
    'CREATE', 'OR', 'REPLACE', 'PACKAGE', 'BODY', 'PROCEDURE', 'FUNCTION', 'IS', 'AS',
    'BEGIN', 'END', 'IF', 'THEN', 'ELSIF', 'ELSE', 'CASE', 'WHEN', 'LOOP', 'WHILE', 'FOR',
    'IN', 'REVERSE', 'EXIT', 'CONTINUE', 'RETURN', 'EXCEPTION', 'RAISE', 'PRAGMA',
    'DECLARE', 'TYPE', 'RECORD', 'TABLE', 'VARRAY', 'CURSOR', 'OPEN', 'FETCH', 'CLOSE',
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'INTO', 'FROM', 'WHERE', 'GROUP', 'BY',
    'HAVING', 'ORDER', 'ASC', 'DESC', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON',
    'UNION', 'ALL', 'VARCHAR2', 'NUMBER', 'DATE', 'BOOLEAN', 'INTEGER', 'VARCHAR'
  ]);

  public provideDocumentFormattingEdits(
    document: vscode.TextDocument,
    options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.TextEdit[] {
    const config = vscode.workspace.getConfiguration('ivorysql.format');
    const keywordCase = config.get<string>('keywordCase', 'Uppercase');
    const customTabSize = config.get<number>('tabSize', options.tabSize || 2);

    const edits: vscode.TextEdit[] = [];
    const lineCount = document.lineCount;

    let currentIndent = 0;
    const indentStr = options.insertSpaces ? ' '.repeat(customTabSize) : '\t';

    for (let i = 0; i < lineCount; i++) {
      const line = document.lineAt(i);
      let text = line.text.trim();

      if (text.length === 0) continue;

      // 遵循用户设置的关键字大小写偏好 (Uppercase / Lowercase / Preserve)
      if (keywordCase !== 'Preserve') {
        text = text.replace(/\b([a-zA-Z_]+)\b/g, (match) => {
          if (this.keywords.has(match.toUpperCase())) {
            return keywordCase === 'Lowercase' ? match.toLowerCase() : match.toUpperCase();
          }
          return match;
        });
      }

      const upperText = text.toUpperCase();
      if (/^\s*(END|ELSIF|ELSE|WHEN)\b/.test(upperText)) {
        currentIndent = Math.max(0, currentIndent - 1);
      }

      const formattedLine = indentStr.repeat(currentIndent) + text;
      if (formattedLine !== line.text) {
        edits.push(vscode.TextEdit.replace(line.range, formattedLine));
      }

      if (/^\s*(BEGIN|IF|ELSIF|ELSE|LOOP|WHILE|FOR|PACKAGE(\s+BODY)?|PROCEDURE|FUNCTION|DECLARE|CASE|WHEN)\b/.test(upperText)) {
        currentIndent++;
      }
    }

    return edits;
  }
}
