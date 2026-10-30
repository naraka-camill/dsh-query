# DeepSeek Usage

在 VS Code 活动栏中查看 DeepSeek API 账户余额和当前可用模型。

## 开始使用

1. 在 `dsh` 目录运行 `npm install`。
2. 在 VS Code 中打开 `dsh` 目录并按 `F5`，启动 Extension Development Host。
3. 点击活动栏中的 **DeepSeek** 图标。
4. 点击视图标题栏中的钥匙图标，输入 DeepSeek API Key。
5. 使用刷新图标重新查询余额和模型。

API Key 使用 VS Code `SecretStorage` 保存，不会写入工作区配置或日志。

## API

- `GET https://api.deepseek.com/user/balance`
- `GET https://api.deepseek.com/models`

使用 `Authorization: Bearer <API Key>` 认证。余额会按货币显示总余额、赠金和充值余额；模型列表显示模型 ID、名称和所属组织。

## 每日消耗

“今日消耗（估算）”通过相邻余额快照中余额的下降额累计得出，按本地日期统计，并每 15 分钟采样一次。余额上涨不会抵扣消耗；这是本地估算，不是 DeepSeek 官方每日账单。扩展未运行期间不会采样，首次采样只建立基准。

## 开发

- `npm run compile`：编译扩展。
- `npm run watch`：监听并编译 TypeScript 变更。