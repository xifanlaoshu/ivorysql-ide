import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import { IvoryDbManager } from '../db/connectionManager';

export class GitDbSyncManager {
  private git: SimpleGit | null = null;

  constructor(private workspacePath: string) {
    if (workspacePath) {
      this.git = simpleGit(workspacePath);
    }
  }

  /**
   * 清理代码中的空白与换行符，以便做准确实体内容 Diff 比对
   */
  private normalizeCode(code: string): string {
    return code
      .replace(/\r\n/g, '\n')
      .replace(/\s+$/gm, '')
      .trim();
  }

  /**
   * 校验本地 Git 仓库中的文件与 IvorySQL 数据库中的代码是否完备一致
   */
  public async verifySyncState(document: vscode.TextDocument, objectName: string, objectType: 'PACKAGE' | 'PACKAGE BODY' | 'PROCEDURE' | 'FUNCTION'): Promise<{ isSynced: boolean; reason?: string }> {
    const dbManager = IvoryDbManager.getInstance();
    if (!dbManager.isConnected()) {
      return { isSynced: true }; // 若未连接 DB，暂不做强阻断，仅在部署时校验
    }

    const dbSource = await dbManager.getDbSourceCode('public', objectName, objectType);
    if (dbSource === null) {
      // 数据库中尚无此 Package/Procedure (第一次创建)
      return { isSynced: true };
    }

    const localCode = this.normalizeCode(document.getText());
    const remoteCode = this.normalizeCode(dbSource);

    if (localCode !== remoteCode) {
      return {
        isSynced: false,
        reason: `[Database Drift] 数据库中的 ${objectType} "${objectName}" 代码与本地 Git 仓库文件不一致！为防止误覆盖他人数据库代码，已开启修改防护。请先合并或更新数据库最新代码。`
      };
    }

    return { isSynced: true };
  }

  /**
   * Git-First 部署流程：在发送 CREATE OR REPLACE 到数据库前，必须确保本地代码已经 Save & Commit 到 Git 仓库
   */
  public async ensureGitCommitted(document: vscode.TextDocument): Promise<boolean> {
    if (!this.git) {
      return true; // 不在 Git 仓库目录中，直接允许
    }

    try {
      // 1. 确保文档已保存到磁盘
      if (document.isDirty) {
        await document.save();
      }

      // 2. 检查 Git 状态
      const status = await this.git.status();
      const relativeFilePath = path.relative(this.workspacePath, document.fileName);

      const isModified = status.files.some(f => f.path === relativeFilePath || f.path === relativeFilePath.replace(/\\/g, '/'));

      if (isModified) {
        const config = vscode.workspace.getConfiguration('ivorysql.versionControl');
        const autoCommit = config.get<boolean>('autoCommitBeforeDeploy', true);

        if (autoCommit) {
          const commitMsg = `[IvorySQL Deploy] Auto-commit ${path.basename(document.fileName)} before deploying to DB at ${new Date().toISOString()}`;
          await this.git.add(document.fileName);
          await this.git.commit(commitMsg);
          vscode.window.showInformationMessage(`[Git-First] Successfully committed changes to Git before DB compilation: "${commitMsg}"`);
          return true;
        } else {
          const choice = await vscode.window.showWarningMessage(
            `当前文件 ${path.basename(document.fileName)} 存在未提交的 Git 变更。必须先提交到 Git 落地后才可以编译部署至数据库！`,
            '立即提交 (Commit)',
            '取消'
          );
          if (choice === '立即提交 (Commit)') {
            await this.git.add(document.fileName);
            await this.git.commit(`[IvorySQL Deploy] Commit ${path.basename(document.fileName)}`);
            return true;
          }
          return false;
        }
      }

      return true;
    } catch (err: any) {
      vscode.window.showErrorMessage(`Git Version Control Error: ${err.message}`);
      return false;
    }
  }
}
