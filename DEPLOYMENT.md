# 构建与部署

## 现有主网

见 [deployments/bsc-mainnet.json](deployments/bsc-mainnet.json)。金库未因新市场更换而改变。`feeManager` 配置保存不可变的初始部署身份；当前管理权限和收款人分别读取市场 owner()、feeRecipient()，不要把历史快照当作实时权限。

## 静态网页

按 README 安装依赖并运行 npm run build。生成的 dist/ 可由 HTTPS 静态主机或 DeWEB 提供。发布整个目录并保留相对路径，检查 dist/config.json 的链、金库、当前市场及 legacyMarkets。不要发布 config.local.json、私钥、.env 或本地状态。

## 可选缓存

npm run build:cache 生成 dist-server/cache-server.mjs 和 kol-worker.mjs。deploy/ 是通用 systemd/nginx 模板，需按主机实际目录、非登录服务用户和端口调整；缓存只监听 127.0.0.1，通过现有 HTTPS 反代 /api/。

参考 deploy/cache-server.example.json，将 siteConfig 指向主网 config.json，protocol 指向构建生成的 src/generated-protocol.json。referralPointsPath 可指向索引程序输出；没有邀请输出时核心交易仍可运行。静态前端 src/config.json 的 cacheApi 指向同域 /api。缓存故障或过期会回退 RPC，缓存不参与签名。

## 邀请索引

复制 kol/kol-config.example.json 到本机 kol/kol-config.json，填公开金库、当前和历史市场地址、金库部署起始区块及本机状态/输出路径。保持双方奖励各 1000 bps，使用 --full 重算；规则指纹变化必须全量重算，不能套用旧状态。查询只读链数据，不需要任何私钥。持续服务可运行 server/kol-worker.mjs 并传入配置路径。

## 独立部署

编译器 0.8.24+commit.e11b9ed9，优化 200 次，EVM cancun。精确编译输入保存在 verification/compiler-input.json；构建输出 artifacts/ 含 ABI、bytecode、metadata。构造参数请查看合约，使用自己的安全签名流程，不要使用现有项目管理员身份。

网页 deploy.html 和 npm run deploy:prepare 生成未签名部署材料。发布快照保留当前不可升级结构；部署工具或收款权限的修改不构成已有合约升级。独立部署必须自行核对依赖、源码验证和小额验收。

## 发布材料

verification/ 的原始记录对应生产发布时的输入；contracts/ 与 src/ 保持该发布版本。公开快照的 README、文档、忽略规则及收录文件范围经过整理，个人主网签名脚本不公开。历史发布工具需要本机证据目录；不应为了让其通过而重写历史测试结果。
