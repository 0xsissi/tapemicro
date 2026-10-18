# TapeMicro

[正式网站 / App](https://tapemicro.top/) · [使用指南](https://tapemicro.top/guide.html) · [User guide](https://tapemicro.top/guide-en.html) · [离线演示 / Demo](https://tapemicro.top/demo/index.html#market) · [合约部署 / Deployments](deployments/bsc-mainnet.json)

TapeMicro 将 BSC 上合格的 TapeOut 原矿机拆成 ERC-1155 微矿机，提供拆分、双边交易、BEM 领取及交易/邀请积分四个功能。源码采用 [MIT License](LICENSE)。这是第三方集成，未获得 TapeOut 官方背书。

TapeMicro is an open-source ERC-1155 fractional miner vault and two-sided BNB order book for TapeOut on BNB Smart Chain. Each original miner has its own custody contract, token ID and BEM accounting. It is an independent integration.

## 钱包连接与页面更新

网页固定使用内置 BSC 配置，不提供 RPC/合约地址编辑入口，也不读取旧浏览器连接覆盖配置。页脚在短页面贴底、长页面跟随正文。新增标准多钱包发现及选择，兼容 EIP-6963 和 legacy EIP-1193 注入；连接时请求切换/添加 BSC。手机请使用钱包 App 的内置浏览器，当前没有 WalletConnect 扫码连接。本轮 131 项前端/工具测试通过；合约源码未变，保留原 60 项与 3,200 步对账证据。[说明与兼容边界](docs/footer-wallets.zh-CN.md) · [本轮验收](verification/wallet-layout-release.json)

## 当前部署

版本 `1.0.0-rc.4`，金库协议 `2`，市场 `MARKET_VERSION = 4`。合约源文件名 `TapeMicroMarketV2.sol`，不代表市场版本为 2。

| 合约 | BSC 主网地址 | 公开源码验证 |
| --- | --- | --- |
| Vault | [0x8c0D89E24fb48a7Db7ECf4849aed9a4ac92ab0E7](https://bscscan.com/address/0x8c0D89E24fb48a7Db7ECf4849aed9a4ac92ab0E7#code) | [Sourcify exact match](https://repo.sourcify.dev/56/0x8c0D89E24fb48a7Db7ECf4849aed9a4ac92ab0E7) |
| Market | [0xbc1Ec4D96b005aFbe5a575c490cE11dA44163805](https://bscscan.com/address/0xbc1Ec4D96b005aFbe5a575c490cE11dA44163805#code) | [Sourcify exact match](https://repo.sourcify.dev/56/0xbc1Ec4D96b005aFbe5a575c490cE11dA44163805) |
| Custody implementation | [0x74950c5Df375844436C450f8D4C81F8a5612ec77](https://bscscan.com/address/0x74950c5Df375844436C450f8D4C81F8a5612ec77#code) | [Sourcify exact match](https://repo.sourcify.dev/56/0x74950c5Df375844436C450f8D4C81F8a5612ec77) |

Sourcify 的创建字节码及运行字节码精确匹配结果保存在 [verification/](verification/)。BscScan 提交由 Sourcify 转交，发布时尚未独立确认 BscScan 的验证结果。旧市场保留在 `src/config.json` 的 `legacyMarkets`，用于撤单退款、余额提取和历史积分读取。

## 本机运行 / Quick start

需要 Node.js 22+ 和 npm。依赖版本锁定在 package-lock.json。

```sh
npm ci --ignore-scripts --no-fund --no-audit
npm run build
npm run build:cache
npm run dev
```

正式页面：<http://127.0.0.1:4176/>。虚拟数据演示：<http://127.0.0.1:4176/demo/index.html#market>。正式配置连接 BSC 主网；演示不连接钱包、不发送交易。字体、脚本、样式和 ABI 随静态资源打包，可迁移到普通静态主机或 DeWEB；钱包和 RPC 仍是链上操作的依赖。

## 规则

- 每份对应入库时 1H 基础算力，最小 1 份。每台原矿机独立 ID；不同 ID 不能相互替代赎回。
- BEM 按各台矿机托管实际收到的数量与持仓分配，日产不固定。卖出前已结算的 BEM 保留给卖方；上游领取失败时尚未收回的收益可能随份额转移。
- 卖单不托管份额，买单托管 BNB 本金。空 `assetIds` 表示任意当前/未来可交易矿机，也可指定 1–32 台。单笔最多 16 个成交项。
- 固定吃单费 1%：买入卖单加付，卖给买单从卖款扣除。挂单、拆分、赎回和领取不收协议费，链上操作仍支付 Gas。
- 基础交易积分：每 1 BNB 成交本金，买卖双方各记 1,000 分。合格受邀用户额外 +10%，邀请人另获基础积分的 10%；邀请奖励由公开链上记录索引重建，显示截止区块，暂不兑换。
- 金库不可升级、没有资产管理权限。市场不可升级；owner 仅管理手续费收款人及该管理权的两步移交/永久弃权，不能修改 1% 费率或提取用户资产。

## 验证 / Tests

先完成上面的两个 build，再运行：

```sh
npm test
npm run verify:contracts
```

当前发布包含 139 项前端/工具/本地链测试、60 项合约测试及 8×400 步独立随机对账。测试使用隔离的本机 Anvil；这不等同于主网双钱包验收或独立第三方审计。`verification/` 保留发布证据；公开快照的全新构建与测试结果另列在公开验收记录中。历史 `verify:*`/`package:*` 发布工具依赖未公开的本地历史证据目录，不是全新克隆的必需步骤。

## 目录

| 路径 | 内容 |
| --- | --- |
| `contracts/` | 金库、市场、托管、接口与 Mock |
| `src/` | 中英前端、钱包交互、链上读取、积分与恢复逻辑 |
| `server/` | 可选的只读缓存、公开邀请积分索引 |
| `test/` | 单元、实际本地链、随机账本测试 |
| `deploy/`、`kol/` | 公共配置和服务模板 |
| `verification/` | 标准编译输入、元数据、精确匹配与测试记录 |

[部署说明](DEPLOYMENT.md) · [安全边界](SECURITY.md) · [第三方许可证](THIRD_PARTY_NOTICES.txt)

本仓库不包含生产钱包私钥、服务器登录凭据、个人部署脚本或本机运行状态，也没有导入本机工作区的历史 Git 提交。公开代码应由读者自行核验，不构成收益保证。
