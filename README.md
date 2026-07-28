# SignalForge

SignalForge 是一个可运行的一键财报前研究系统：前端收集股票、市场、当前仓位、成本和风险偏好；后端用 Public Equity Investing 的财报前框架组织 `global-stock-data`、`a-stock-data` 与 `vibe_trading_dev0` 的证据，并输出 LONG / WAIT / SHORT、情景估值和条件化仓位动作。

系统只做研究与风险决策，不连接券商，不自动下单。

## 能力边界

- `NVDA + DEMO`：展示完整研究报告样例，所有数值明确标记为非实时。
- 其他股票或证据不足：自动降级为 `WAIT / screen-grade`，不会伪造一致预期或目标价。
- `OFFICIAL`：验证 SEC 等官方源和本机 MCP 的连接状态，不代表已经完成实时分析。
- `LOCAL_RESEARCH`：验证本机 SSH 隧道/MCP，并为个人研究数据保留适配位置；当前尚未接入可用于生产的实时一致预期。
- 页面会显示请求校验、市场路由、数据源、证据门槛、情景与报告生成的真实后端进度；演示模式会明确显示“未请求实时数据”。
- 做空必须补齐借券成本、利用率、拥挤度和挤压风险，缺一则不能标记为 `implementation-ready`。

## 本地启动

要求 Node.js `>=22.13.0`。

```bash
cp .env.example .env.local
npm install
npm run dev
```

访问 `http://localhost:3000`。接口：

- `POST /api/analyze`：生成结构化报告。
- `POST /api/analyze/stream`：以 NDJSON 推送分析阶段与最终报告。
- `GET /api/health`：检查服务与 `vibe_trading_dev0` 连接状态。

## 最安全的 dev0 连接

远端 HTTP MCP 应只监听 dev0 的 `127.0.0.1`，本机通过 SSH 本地端口转发访问：

```bash
VIBE_SSH_TARGET=dev0 ./scripts/start-vibe-tunnel.sh
```

等价命令：

```bash
ssh -N -T \
  -L 127.0.0.1:18789:127.0.0.1:8787 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o TCPKeepAlive=no \
  dev0
```

然后在 `.env.local` 中设置：

```dotenv
VIBE_MCP_URL=http://127.0.0.1:18789/mcp
```

安全设计：

- 隧道只绑定本机回环地址，不开放 LAN 或公网端口。
- MCP URL 和令牌只在服务端读取，绝不进入浏览器 bundle。
- 后端只允许调用研究所需的只读工具白名单。
- SSH 密钥交给系统 keychain / agent 管理，不写入项目。
- 公网部署不能访问用户本机的 `127.0.0.1`；完整私有数据模式应在本机运行，或使用带身份认证和网络访问控制的私有网关。

## 研究工作流

```mermaid
flowchart LR
  A["前端需求<br/>股票 / 仓位 / 风险"] --> B["市场路由<br/>US / HK / CN"]
  B --> C["证据采集<br/>官方源 + MCP"]
  C --> D["冻结与分级<br/>事实 / 一致预期 / 推断"]
  D --> E["财报前框架<br/>预期 / KPI / 毛利率"]
  E --> F["Bull / Base / Bear<br/>概率与估值"]
  F --> G["LONG / WAIT / SHORT"]
  G --> H["仓位规则<br/>加仓 / 减仓 / 退出"]
```

### 数据路由

| 市场 | 官方优先 | 本地个人研究补充 | 用途 |
|---|---|---|---|
| 美股 | SEC EDGAR | CBOE、FINRA、行情源、vibe MCP | Filing、财务、期权、空头、行情 |
| 港股 | 港交所公告 | 行情源、vibe MCP | 公告、财务、行情 |
| A 股 | 巨潮资讯 | 腾讯、同花顺、东财、mootdx | 公告、一致预期、资金、行情 |

其中 CBOE、FINRA 以及多数门户/行情站点存在许可或再分发限制。公网模式默认只使用可确认授权的数据；个人研究适配器只在本地模式启用。

## 报告结构

1. 证据冻结时间、数据状态和 GAAP / 非 GAAP 口径。
2. 一致预期表：t / t-1 / t-4 / t-8。
3. 3–6 个股价敏感 KPI 与各自财报门槛。
4. 毛利率 Bull / Bear 桥接与必须追问项。
5. Bull / Base / Bear 三情景，概率合计 100%。
6. 催化剂路径、管理层问题、证伪条件。
7. 结合用户当前仓位和风险偏好的条件化动作。
8. 数据源账本、证据缺口与 actionability 等级。

## 生产化下一步

- 接入有授权的一致预期源，并保存每次冻结快照。
- 为公司 KPI 建立可配置 schema，而不是用通用指标硬套。
- 加入用户认证、任务队列、报告历史和审计日志。
- 如需对外商业使用，先完成所有行情、期权、研报与门户数据的许可证核查。
