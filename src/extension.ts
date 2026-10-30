import * as vscode from 'vscode';

const API_KEY_SECRET = 'deepseekBalance.apiKey';
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const MODELS_URL = 'https://api.deepseek.com/models';

interface BalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

interface BalanceResponse {
  is_available: boolean;
  balance_infos: BalanceInfo[];
}

interface ModelInfo {
  id: string;
  name?: string;
  owned_by: string;
}

interface ModelsResponse {
  data: ModelInfo[];
}

function isBalanceResponse(value: unknown): value is BalanceResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const response = value as Partial<BalanceResponse>;
  return typeof response.is_available === 'boolean'
    && Array.isArray(response.balance_infos)
    && response.balance_infos.every((info: unknown) => {
      if (typeof info !== 'object' || info === null) {
        return false;
      }

      const balance = info as Partial<BalanceInfo>;
      return typeof balance.currency === 'string'
        && typeof balance.total_balance === 'string'
        && typeof balance.granted_balance === 'string'
        && typeof balance.topped_up_balance === 'string';
    });
}

function isModelsResponse(value: unknown): value is ModelsResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const response = value as Partial<ModelsResponse>;
  return Array.isArray(response.data)
    && response.data.every((model: unknown) => {
      if (typeof model !== 'object' || model === null) {
        return false;
      }

      const entry = model as Partial<ModelInfo>;
      return typeof entry.id === 'string'
        && typeof entry.owned_by === 'string'
        && (entry.name === undefined || typeof entry.name === 'string');
    });
}

async function requestJson<T>(url: string, apiKey: string, isExpected: (value: unknown) => value is T): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let statusCode = 0;
  let body: string;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });
    statusCode = response.status;
    body = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('连接 DeepSeek API 超时。');
    }
    throw new Error(`DeepSeek API 响应读取失败：${errorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (statusCode < 200 || statusCode >= 300) {
    const detail = body.trim().slice(0, 300);
    throw new Error(`DeepSeek API 请求失败（HTTP ${statusCode}）${detail ? `：${detail}` : '。'}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('DeepSeek API 返回了无效的 JSON。');
  }

  if (!isExpected(parsed)) {
    throw new Error('DeepSeek API 返回的数据格式不符合预期。');
  }
  return parsed;
}

class BalanceTreeItem extends vscode.TreeItem {
  constructor(
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    readonly section?: 'balance' | 'models'
  ) {
    super(label, collapsibleState);
  }
}

class DeepSeekTreeProvider implements vscode.TreeDataProvider<BalanceTreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<BalanceTreeItem | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private apiKeyConfigured = false;
  private loading = false;
  private balance?: BalanceResponse;
  private models?: ModelInfo[];
  private balanceError?: string;
  private modelsError?: string;

  getTreeItem(element: BalanceTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BalanceTreeItem): BalanceTreeItem[] {
    if (!element) {
      if (!this.apiKeyConfigured) {
        return [];
      }
      return [
        new BalanceTreeItem('余额', vscode.TreeItemCollapsibleState.Expanded, 'balance'),
        new BalanceTreeItem('可用模型', vscode.TreeItemCollapsibleState.Expanded, 'models')
      ];
    }

    if (!element.section) {
      return [];
    }

    if (!this.apiKeyConfigured) {
      return [new BalanceTreeItem('请先设置 DeepSeek API Key', vscode.TreeItemCollapsibleState.None)];
    }

    if (this.loading) {
      return [new BalanceTreeItem('正在加载…', vscode.TreeItemCollapsibleState.None)];
    }

    if (element.section === 'balance') {
      if (this.balanceError) {
        return [new BalanceTreeItem(`加载失败：${this.balanceError}`, vscode.TreeItemCollapsibleState.None)];
      }
      if (!this.balance) {
        return [new BalanceTreeItem('点击刷新以加载余额', vscode.TreeItemCollapsibleState.None)];
      }
      const balance = this.balance;
      if (balance.balance_infos.length === 0) {
        return [new BalanceTreeItem('暂无余额信息', vscode.TreeItemCollapsibleState.None)];
      }

      return balance.balance_infos.map(info => {
        const item = new BalanceTreeItem(
          `${info.currency} ${info.total_balance}`,
          vscode.TreeItemCollapsibleState.None
        );
        item.description = `${balance.is_available ? '可调用' : '不可调用'} · 赠金 ${info.granted_balance} · 充值 ${info.topped_up_balance}`;
        item.tooltip = `余额可用：${balance.is_available ? '是' : '否'}`;
        return item;
      });
    }

    if (this.modelsError) {
      return [new BalanceTreeItem(`加载失败：${this.modelsError}`, vscode.TreeItemCollapsibleState.None)];
    }
    if (!this.models) {
      return [new BalanceTreeItem('点击刷新以加载模型', vscode.TreeItemCollapsibleState.None)];
    }
    if (this.models.length === 0) {
      return [new BalanceTreeItem('暂无可用模型', vscode.TreeItemCollapsibleState.None)];
    }

    return this.models.map(model => {
      const item = new BalanceTreeItem(model.id, vscode.TreeItemCollapsibleState.None);
      item.description = model.name ? `${model.name} · ${model.owned_by}` : model.owned_by;
      item.tooltip = model.name ?? model.id;
      return item;
    });
  }

  setApiKeyConfigured(configured: boolean): void {
    this.apiKeyConfigured = configured;
    this.changeEmitter.fire(undefined);
  }

  async refresh(apiKey: string): Promise<string[]> {
    this.loading = true;
    this.balance = undefined;
    this.models = undefined;
    this.balanceError = undefined;
    this.modelsError = undefined;
    this.changeEmitter.fire(undefined);

    try {
      const [balanceResult, modelsResult] = await Promise.allSettled([
        requestJson(BALANCE_URL, apiKey, isBalanceResponse),
        requestJson(MODELS_URL, apiKey, isModelsResponse)
      ]);

      if (balanceResult.status === 'fulfilled') {
        this.balance = balanceResult.value;
      } else {
        this.balanceError = errorMessage(balanceResult.reason);
      }

      if (modelsResult.status === 'fulfilled') {
        this.models = modelsResult.value.data;
      } else {
        this.modelsError = errorMessage(modelsResult.reason);
      }

      return [this.balanceError, this.modelsError].filter((error): error is string => Boolean(error));
    } finally {
      this.loading = false;
      this.changeEmitter.fire(undefined);
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const provider = new DeepSeekTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('deepseekBalance.view', provider)
  );

  const refresh = async (showNotification: boolean): Promise<void> => {
    const apiKey = await context.secrets.get(API_KEY_SECRET);
    provider.setApiKeyConfigured(Boolean(apiKey));
    if (!apiKey) {
      if (showNotification) {
        const action = '设置 API Key';
        const selection = await vscode.window.showWarningMessage('请先设置 DeepSeek API Key。', action);
        if (selection === action) {
          await vscode.commands.executeCommand('deepseekBalance.setApiKey');
        }
      }
      return;
    }

    const errors = await provider.refresh(apiKey);
    if (showNotification) {
      if (errors.length > 0) {
        await vscode.window.showErrorMessage(errors.join('；'));
      } else {
        await vscode.window.showInformationMessage('DeepSeek 余额和模型已更新。');
      }
    }
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('deepseekBalance.refresh', () => refresh(true)),
    vscode.commands.registerCommand('deepseekBalance.setApiKey', async () => {
      const apiKey = await vscode.window.showInputBox({
        title: '设置 DeepSeek API Key',
        prompt: 'API Key 将安全保存在 VS Code SecretStorage 中。',
        password: true,
        ignoreFocusOut: true,
        placeHolder: 'sk-...'
      });
      if (apiKey === undefined) {
        return;
      }
      if (!apiKey.trim()) {
        await vscode.window.showErrorMessage('API Key 不能为空。');
        return;
      }

      await context.secrets.store(API_KEY_SECRET, apiKey.trim());
      await refresh(false);
    })
  );

  if (await context.secrets.get(API_KEY_SECRET)) {
    await refresh(false);
  } else {
    provider.setApiKeyConfigured(false);
  }
}

export function deactivate(): void {}
