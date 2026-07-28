"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AnalysisProgressUpdate,
  AnalysisStageId,
  AnalysisRequest,
  DataMode,
  DecisionSide,
  EvidenceStatus,
  Market,
  PositionSide,
  ResearchReport,
  RiskTolerance,
} from "../lib/types";

type Props = {
  initialReport: ResearchReport;
};

type HealthState = {
  state: "checking" | "ready" | "limited" | "error";
  liveReady: boolean;
  disclosure: string;
};

type StreamEvent =
  | { type: "progress"; update: AnalysisProgressUpdate }
  | { type: "complete"; report: ResearchReport }
  | { type: "error"; message: string };

const analysisStages: Array<{ id: AnalysisStageId; label: string }> = [
  { id: "request", label: "校验请求" },
  { id: "route", label: "市场路由" },
  { id: "sources", label: "连接数据源" },
  { id: "evidence", label: "证据门槛" },
  { id: "scenarios", label: "情景与仓位" },
  { id: "complete", label: "生成报告" },
];

const marketOptions: Array<{ value: Market; label: string }> = [
  { value: "AUTO", label: "自动识别" },
  { value: "US", label: "美股" },
  { value: "HK", label: "港股" },
  { value: "CN", label: "A 股" },
];

const riskOptions: Array<{ value: RiskTolerance; label: string }> = [
  { value: "LOW", label: "保守" },
  { value: "MEDIUM", label: "均衡" },
  { value: "HIGH", label: "进取" },
];

const sideLabel: Record<DecisionSide, string> = {
  LONG: "LONG",
  WAIT: "WAIT",
  SHORT: "SHORT",
};

const evidenceLabel: Record<EvidenceStatus, string> = {
  verified: "公司事实",
  consensus: "一致预期",
  inference: "分析推断",
  assumption: "用户假设",
  missing: "证据缺失",
};

function ScoreRing({ value }: { value: number }) {
  return (
    <div
      className="score-ring"
      style={{
        background: `conic-gradient(var(--signal) ${value * 3.6}deg, rgba(255,255,255,.08) 0deg)`,
      }}
      aria-label={`置信度 ${value}%`}
    >
      <div>
        <strong>{value}</strong>
        <span>置信度</span>
      </div>
    </div>
  );
}

function MiniBars({
  values,
  tone = "signal",
}: {
  values: number[];
  tone?: "signal" | "risk";
}) {
  return (
    <span className={`mini-bars ${tone}`} aria-hidden="true">
      {values.map((value, index) => (
        <i key={`${value}-${index}`} style={{ height: `${value}%` }} />
      ))}
    </span>
  );
}

function SectionTitle({
  eyebrow,
  title,
  note,
}: {
  eyebrow: string;
  title: string;
  note?: string;
}) {
  return (
    <div className="section-title">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {note ? <p>{note}</p> : null}
    </div>
  );
}

export function ResearchDashboard({ initialReport }: Props) {
  const [report, setReport] = useState(initialReport);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [runSymbol, setRunSymbol] = useState("");
  const [progress, setProgress] = useState<
    Partial<Record<AnalysisStageId, AnalysisProgressUpdate>>
  >({});
  const [health, setHealth] = useState<HealthState>({
    state: "checking",
    liveReady: false,
    disclosure: "正在检查实时数据链路…",
  });
  const [request, setRequest] = useState<AnalysisRequest>({
    symbol: "NVDA",
    companyName: "NVIDIA",
    market: "AUTO",
    positionSide: "LONG",
    positionWeight: 5,
    costBasis: undefined,
    horizon: "EVENT",
    riskTolerance: "MEDIUM",
    dataMode: "DEMO",
    thesis: "",
  });

  const weightedReturn = useMemo(
    () =>
      report.scenarios.reduce(
        (sum, scenario) =>
          sum + (scenario.probability / 100) * scenario.returnPct,
        0,
      ),
    [report],
  );
  const generatedAtLabel = `${report.meta.generatedAt
    .replace("T", " ")
    .slice(0, 19)} UTC`;
  const expectationPeriodLabels = report.meta.liveDataReady
    ? ["本季", "下季", "FY1", "FY2"]
    : ["本期 t", "上季 t-1", "去年 t-4", "两年前 t-8"];
  const progressPercent = Math.round(
    (Object.keys(progress).length / analysisStages.length) * 100,
  );
  const selectedModeDisclosure =
    request.dataMode === "DEMO"
      ? "演示模式不会请求当前行情或实时一致预期；输出仅用于查看系统结构。"
      : request.dataMode === "LOCAL_RESEARCH"
        ? health.liveReady
          ? "本机实施链路已就绪：SSH 隧道、dev0 MCP 与 EPS 一致预期均可达；仍会按证据完整性决定是否输出方向。"
          : "本机实施链路尚未全部就绪；缺失连接会明确显示，结果会安全降级为 WAIT。"
        : health.liveReady
          ? "公开数据源与私有 MCP 实施链路均已连接；系统会冻结证据并按门槛决定方向。"
          : "公开源或私有 MCP 尚有缺口；系统会显示连接证据并安全降级为 WAIT。";

  useEffect(() => {
    let active = true;
    fetch("/api/health", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("健康检查失败");
        return (await response.json()) as {
          capabilities?: { liveReady?: boolean };
          disclosure?: string;
        };
      })
      .then((payload) => {
        if (!active) return;
        const liveReady = Boolean(payload.capabilities?.liveReady);
        setHealth({
          state: liveReady ? "ready" : "limited",
          liveReady,
          disclosure:
            payload.disclosure ||
            (liveReady ? "实时链路已就绪。" : "实时链路未就绪。"),
        });
      })
      .catch(() => {
        if (!active) return;
        setHealth({
          state: "error",
          liveReady: false,
          disclosure: "无法确认实时数据链路，系统将按非实时模式处理。",
        });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsedMs(Date.now() - startedAt),
      100,
    );
    return () => window.clearInterval(timer);
  }, [loading]);

  function update<K extends keyof AnalysisRequest>(
    key: K,
    value: AnalysisRequest[K],
  ) {
    setRequest((current) => ({ ...current, [key]: value }));
  }

  function adjustPositionWeight(delta: number) {
    update(
      "positionWeight",
      Math.min(100, Math.max(0, request.positionWeight + delta)),
    );
  }

  async function runAnalysis(event: FormEvent) {
    event.preventDefault();
    const startedAt = Date.now();
    setLoading(true);
    setError("");
    setElapsedMs(0);
    setRunSymbol(request.symbol.trim().toUpperCase());
    setProgress({});
    try {
      const response = await fetch("/api/analyze/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error || "分析失败");
      }
      if (!response.body) {
        throw new Error("浏览器不支持流式分析状态");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let completedReport: ResearchReport | null = null;

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const eventPayload = JSON.parse(line) as StreamEvent;
          if (eventPayload.type === "progress") {
            setProgress((current) => ({
              ...current,
              [eventPayload.update.stage]: eventPayload.update,
            }));
          } else if (eventPayload.type === "complete") {
            completedReport = eventPayload.report;
          } else if (eventPayload.type === "error") {
            throw new Error(eventPayload.message);
          }
        }
        if (done) break;
      }

      if (!completedReport) {
        throw new Error("分析完成，但未收到报告");
      }
      const remaining = Math.max(0, 900 - (Date.now() - startedAt));
      if (remaining > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, remaining));
      }
      setReport(completedReport);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分析任务失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="SignalForge 首页">
          <span className="brand-mark">
            <i />
            <i />
            <i />
          </span>
          <span>
            <strong>SignalForge</strong>
            <small>PRE-EARNINGS INTELLIGENCE</small>
          </span>
        </a>
        <nav aria-label="产品状态">
          <span
            className={`status-dot ${health.state}`}
            title={health.disclosure}
          >
            {health.state === "checking"
              ? "正在检测数据源"
              : health.liveReady
                ? "实施链路已就绪"
                : "实施链路未就绪"}
          </span>
          <span className="topbar-divider" />
          <span>只读 · 不自动下单</span>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <span className="eyebrow">EVIDENCE → SCENARIO → ACTION</span>
          <h1>
            把财报噪音，
            <br />
            锻造成<span>可审计的决策。</span>
          </h1>
          <p>
            一致预期、核心 KPI、毛利率争议、催化剂与仓位风险，
            在同一个冻结时间和证据框架下完成。
          </p>
        </div>
        <div className="hero-visual" aria-hidden="true">
          <div className="signal-orbit orbit-one" />
          <div className="signal-orbit orbit-two" />
          <div className="signal-center">SF</div>
          <span className="axis axis-up">BULL</span>
          <span className="axis axis-mid">BASE</span>
          <span className="axis axis-down">BEAR</span>
          <svg viewBox="0 0 500 210" role="presentation">
            <path
              className="path-grid"
              d="M5 162 C72 150 88 174 145 140 S230 107 278 113 S358 69 495 43"
            />
            <path
              className="path-main"
              d="M5 162 C72 150 88 174 145 140 S230 107 278 113 S358 69 495 43"
            />
            <path
              className="path-risk"
              d="M5 155 C84 145 116 124 168 137 S251 155 301 144 S393 165 495 176"
            />
          </svg>
        </div>
      </section>

      <div className="workflow-strip">
        {["采集需求", "冻结证据", "财报框架", "情景估值", "仓位动作"].map(
          (step, index) => (
            <div key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
              {index < 4 ? <i>→</i> : null}
            </div>
          ),
        )}
      </div>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-heading">
            <div>
              <span>RESEARCH BRIEF</span>
              <h2>创建分析任务</h2>
            </div>
            <span className="panel-index">01</span>
          </div>

          <form onSubmit={runAnalysis} noValidate>
            <label className="field">
              <span>股票代码 / 名称</span>
              <div className="symbol-input">
                <b>⌕</b>
                <input
                  value={request.symbol}
                  onChange={(event) => update("symbol", event.target.value)}
                  placeholder="例如 NVDA / 00700 / 600519"
                  required
                />
              </div>
            </label>

            <label className="field">
              <span>公司名称（可选）</span>
              <input
                value={request.companyName || ""}
                onChange={(event) =>
                  update("companyName", event.target.value)
                }
                placeholder="用于报告标题"
              />
            </label>

            <div className="field">
              <span>市场</span>
              <div className="segmented four">
                {marketOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={
                      request.market === option.value ? "selected" : ""
                    }
                    onClick={() => update("market", option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span>当前持仓</span>
              <div className="segmented three">
                {(
                  [
                    ["NONE", "空仓"],
                    ["LONG", "多头"],
                    ["SHORT", "空头"],
                  ] as Array<[PositionSide, string]>
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={
                      request.positionSide === value ? "selected" : ""
                    }
                    onClick={() => update("positionSide", value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="position-weight">仓位比例</label>
                <div className="suffix-input position-weight-input">
                  <input
                    id="position-weight"
                    type="number"
                    aria-label="仓位比例 %"
                    min="0"
                    max="100"
                    step="5"
                    value={request.positionWeight}
                    onChange={(event) =>
                      update(
                        "positionWeight",
                        Math.min(
                          100,
                          Math.max(0, Number(event.target.value) || 0),
                        ),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        adjustPositionWeight(5);
                      } else if (event.key === "ArrowDown") {
                        event.preventDefault();
                        adjustPositionWeight(-5);
                      }
                    }}
                  />
                  <span className="percent-suffix" aria-hidden="true">
                    %
                  </span>
                  <div
                    className="position-weight-stepper"
                    aria-label="调整仓位比例"
                  >
                    <button
                      type="button"
                      aria-label="仓位比例增加 5%"
                      onClick={() => adjustPositionWeight(5)}
                      disabled={request.positionWeight >= 100}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label="仓位比例减少 5%"
                      onClick={() => adjustPositionWeight(-5)}
                      disabled={request.positionWeight <= 0}
                    >
                      ▼
                    </button>
                  </div>
                </div>
              </div>
              <label className="field">
                <span>持仓成本</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={request.costBasis ?? ""}
                  onChange={(event) =>
                    update(
                      "costBasis",
                      event.target.value
                        ? Number(event.target.value)
                        : undefined,
                    )
                  }
                  placeholder="可选"
                />
              </label>
            </div>

            <div className="field">
              <span>风险偏好</span>
              <div className="segmented three">
                {riskOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={
                      request.riskTolerance === option.value ? "selected" : ""
                    }
                    onClick={() => update("riskTolerance", option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="field">
              <span>已有观点（可选）</span>
              <textarea
                value={request.thesis || ""}
                onChange={(event) => update("thesis", event.target.value)}
                placeholder="例如：担心毛利率谷底后移，希望重点验证..."
                rows={3}
              />
            </label>

            <label className="field">
              <span>数据模式</span>
              <select
                value={request.dataMode}
                onChange={(event) =>
                  update("dataMode", event.target.value as DataMode)
                }
              >
                <option value="DEMO">演示报告（不获取实时数据）</option>
                <option value="OFFICIAL">
                  实施链路分析（不足则 WAIT）
                </option>
                <option value="LOCAL_RESEARCH">
                  本机实施链路（SSH + HTTP MCP）
                </option>
              </select>
            </label>

            <div
              className={`mode-disclosure ${
                request.dataMode === "DEMO" || !health.liveReady
                  ? "limited"
                  : "ready"
              }`}
            >
              <strong>
                {request.dataMode === "DEMO"
                  ? "非实时"
                  : health.liveReady
                    ? "实施链路已就绪"
                    : "实施链路未就绪"}
              </strong>
              <p>{selectedModeDisclosure}</p>
            </div>

            {error ? <div className="form-error">{error}</div> : null}

            <button className="run-button" type="submit" disabled={loading}>
              <span>
                {loading
                  ? `正在分析 ${runSymbol} · ${(elapsedMs / 1000).toFixed(1)}s`
                  : request.dataMode === "DEMO"
                    ? "生成演示报告"
                    : "运行实时证据分析"}
              </span>
              <b className={loading ? "button-spinner" : ""}>
                {loading ? "◌" : "→"}
              </b>
            </button>
            <p className="form-footnote">
              系统只生成研究与风险建议，不连接券商、不自动下单。
            </p>
          </form>
        </aside>

        <div className={`report-column ${loading ? "is-running" : ""}`}>
          {loading ? (
            <section
              className="progress-panel"
              aria-live="polite"
              aria-label="分析进度"
            >
              <header>
                <div>
                  <span>LIVE TASK STATUS</span>
                  <h2>正在分析 {runSymbol}</h2>
                  <p>
                    后端正在逐步返回真实状态；演示模式会明确跳过实时数据源。
                  </p>
                </div>
                <strong>{(elapsedMs / 1000).toFixed(1)}s</strong>
              </header>
              <div className="progress-track">
                <i style={{ width: `${progressPercent}%` }} />
              </div>
              <div className="progress-steps">
                {analysisStages.map((stage, index) => {
                  const updateState = progress[stage.id];
                  return (
                    <article
                      key={stage.id}
                      className={updateState?.status || "pending"}
                    >
                      <span>
                        {updateState?.status === "done"
                          ? "✓"
                          : updateState?.status === "warning"
                            ? "!"
                            : updateState?.status === "skipped"
                              ? "—"
                              : updateState?.status === "running"
                                ? "◌"
                                : String(index + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <strong>{stage.label}</strong>
                        <p>{updateState?.message || "等待上一阶段"}</p>
                        {updateState?.detail ? (
                          <small>{updateState.detail}</small>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section
            className={`report-disclosure ${
              report.meta.liveDataReady ? "ready" : "limited"
            }`}
            aria-live="polite"
          >
            <strong>
              {loading
                ? "以下为上一次报告"
                : report.meta.isDemo
                  ? "演示报告 · 非实时 · 不可据此交易"
                  : report.meta.liveDataReady
                    ? "实时证据报告"
                    : "实时证据不完整 · 已降级"}
            </strong>
            <p>
              {loading
                ? `新的 ${runSymbol} 分析仍在进行，完成前不会覆盖当前内容。`
                : report.meta.dataDisclosure}
            </p>
          </section>

          <section className={`decision-card decision-${report.decision.side}`}>
            <div className="decision-head">
              <div>
                <div className="report-kicker">
                  <span>{report.meta.symbol}</span>
                  <i />
                  <span>{report.meta.company}</span>
                  <i />
                  <span>{report.meta.market}</span>
                </div>
                <h2>财报前决策摘要</h2>
              </div>
              <div className="freeze">
                <span>证据冻结</span>
                <strong>{report.meta.asOf}</strong>
              </div>
            </div>

            <div className="decision-body">
              <div className="direction">
                <span>系统方向</span>
                <strong>{sideLabel[report.decision.side]}</strong>
                <small>{report.decision.actionability}</small>
              </div>
              <ScoreRing value={report.decision.confidence} />
              <div className="decision-copy">
                <p>{report.decision.oneLine}</p>
                <div>
                  <span>VARIANT VIEW</span>
                  <strong>{report.decision.variantView}</strong>
                </div>
              </div>
            </div>

            <div className="decision-footer">
              <div>
                <span>市场已计价</span>
                <p>{report.decision.pricedIn}</p>
              </div>
              <div>
                <span>仓位动作</span>
                <p>{report.decision.sizing}</p>
              </div>
              <div>
                <span>证伪条件</span>
                <p>{report.decision.invalidation}</p>
              </div>
            </div>
          </section>

          <div className="tape-grid">
            {report.tape.map((item, index) => (
              <article key={item.label}>
                <div>
                  <span>{item.label}</span>
                  <MiniBars
                    values={[34 + index * 5, 55, 43 + index * 8, 76, 65]}
                    tone={item.tone === "negative" ? "risk" : "signal"}
                  />
                </div>
                <strong>{item.value}</strong>
                <small className={item.tone}>{item.change}</small>
              </article>
            ))}
          </div>

          <section className="report-card">
            <SectionTitle
              eyebrow="EXPECTATIONS MAP"
              title="一致预期与财报门槛"
              note={
                report.meta.liveDataReady
                  ? "本季 / 下季 / FY1 / FY2"
                  : "t / t-1 / t-4 / t-8"
              }
            />
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>指标</th>
                    {expectationPeriodLabels.map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                    <th>证据</th>
                    <th>争议焦点</th>
                  </tr>
                </thead>
                <tbody>
                  {report.expectations.map((row) => (
                    <tr key={row.metric}>
                      <td>
                        <strong>{row.metric}</strong>
                      </td>
                      <td className="mono">{row.t}</td>
                      <td className="mono muted">{row.t1}</td>
                      <td className="mono muted">{row.t4}</td>
                      <td className="mono muted">{row.t8}</td>
                      <td>
                        <span className={`evidence ${row.evidence}`}>
                          {evidenceLabel[row.evidence]}
                        </span>
                      </td>
                      <td>{row.debate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="gaap-note">
              <b>口径提醒</b>
              <span>
                收入使用公司披露口径；EPS 与毛利率必须标记 GAAP / 非 GAAP，
                并单独核查股权激励、税率和一次性调整。
              </span>
            </div>
          </section>

          <section className="report-card">
            <SectionTitle
              eyebrow="KPI SCOREBOARD"
              title="最可能推动股价的核心 KPI"
              note="权重合计 100%"
            />
            <div className="kpi-grid">
              {report.kpis.map((kpi) => (
                <article key={kpi.name}>
                  <div className="kpi-top">
                    <span className={`trend ${kpi.trend}`}>
                      {kpi.trend === "up"
                        ? "↗"
                        : kpi.trend === "down"
                          ? "↘"
                          : "→"}
                    </span>
                    <div>
                      <h3>{kpi.name}</h3>
                      <p>{kpi.current}</p>
                    </div>
                    <b>{kpi.weight}%</b>
                  </div>
                  <div className="kpi-bar">
                    <i style={{ width: `${kpi.weight * 2.7}%` }} />
                  </div>
                  <small>财报门槛</small>
                  <strong>{kpi.bar}</strong>
                  <p>{kpi.readThrough}</p>
                </article>
              ))}
            </div>
          </section>

          <section className="report-card">
            <SectionTitle
              eyebrow="MARGIN DEBATE"
              title="毛利率争议：暂时阵痛，还是结构下移？"
              note="最重要的盈利质量辩论"
            />
            <div className="debate-grid">
              <article className="bull-case">
                <header>
                  <span>01</span>
                  <div>
                    <small>BULL CASE</small>
                    <h3>利润率可恢复</h3>
                  </div>
                </header>
                <ul>
                  {report.marginDebate.bull.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article className="bear-case">
                <header>
                  <span>02</span>
                  <div>
                    <small>BEAR CASE</small>
                    <h3>压力比预期持久</h3>
                  </div>
                </header>
                <ul>
                  {report.marginDebate.bear.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
              <article className="watch-case">
                <header>
                  <span>03</span>
                  <div>
                    <small>BRIDGE CHECK</small>
                    <h3>必须逐项追问</h3>
                  </div>
                </header>
                <ul>
                  {report.marginDebate.watch.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            </div>
          </section>

          <section className="report-card scenario-card">
            <SectionTitle
              eyebrow="SCENARIO ENGINE"
              title="情景估值与概率偏度"
              note={`概率加权回报 ${weightedReturn >= 0 ? "+" : ""}${weightedReturn.toFixed(1)}%`}
            />
            <div className="scenario-summary">
              <div className="scenario-prob">
                {report.scenarios.map((scenario) => (
                  <i
                    key={scenario.name}
                    className={scenario.name.toLowerCase()}
                    style={{ width: `${scenario.probability}%` }}
                    title={`${scenario.name} ${scenario.probability}%`}
                  />
                ))}
              </div>
              <div className="scenario-legend">
                {report.scenarios.map((scenario) => (
                  <span key={scenario.name}>
                    <i className={scenario.name.toLowerCase()} />
                    {scenario.name} {scenario.probability}%
                  </span>
                ))}
              </div>
            </div>
            <div className="scenario-grid">
              {report.scenarios.map((scenario) => (
                <article
                  key={scenario.name}
                  className={scenario.name.toLowerCase()}
                >
                  <header>
                    <span>{scenario.name}</span>
                    <strong>
                      {scenario.returnPct > 0 ? "+" : ""}
                      {scenario.returnPct}%
                    </strong>
                  </header>
                  <dl>
                    <div>
                      <dt>收入</dt>
                      <dd>{scenario.revenue}</dd>
                    </div>
                    <div>
                      <dt>毛利率</dt>
                      <dd>{scenario.grossMargin}</dd>
                    </div>
                    <div>
                      <dt>EPS</dt>
                      <dd>{scenario.eps}</dd>
                    </div>
                    <div>
                      <dt>估值</dt>
                      <dd>{scenario.multiple}</dd>
                    </div>
                  </dl>
                  <div className="target">
                    <span>情景目标</span>
                    <strong>{scenario.target}</strong>
                  </div>
                  <p>{scenario.trigger}</p>
                </article>
              ))}
            </div>
          </section>

          <div className="two-column">
            <section className="report-card">
              <SectionTitle
                eyebrow="CATALYST PATH"
                title="催化剂时间轴"
              />
              <div className="timeline">
                {report.catalysts.map((item) => (
                  <article key={`${item.timing}-${item.event}`}>
                    <div className={`timeline-dot ${item.impact}`} />
                    <div>
                      <span>{item.timing}</span>
                      <h3>{item.event}</h3>
                      <p>{item.watch}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="report-card">
              <SectionTitle
                eyebrow="MANAGEMENT CHECK"
                title="管理层必问问题"
              />
              <div className="question-list">
                {report.managementQuestions.map((item, index) => (
                  <details key={item.question} open={index === 0}>
                    <summary>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{item.topic}</strong>
                      <i>+</i>
                    </summary>
                    <p>{item.question}</p>
                    <small>{item.whyItMatters}</small>
                  </details>
                ))}
              </div>
            </section>
          </div>

          <section className="report-card action-card">
            <SectionTitle
              eyebrow="POSITION PLAYBOOK"
              title="财报前后操作规则"
              note="条件触发，不自动执行"
            />
            <div className="action-grid">
              <article>
                <span>财报前</span>
                <p>{report.actionPlan.preEvent}</p>
              </article>
              <article className="positive">
                <span>超预期</span>
                <p>{report.actionPlan.beat}</p>
              </article>
              <article>
                <span>符合预期</span>
                <p>{report.actionPlan.inline}</p>
              </article>
              <article className="negative">
                <span>低于预期</span>
                <p>{report.actionPlan.miss}</p>
              </article>
            </div>
            <div className="risk-rules">
              <strong>风险护栏</strong>
              {report.actionPlan.riskControls.map((rule) => (
                <span key={rule}>✓ {rule}</span>
              ))}
            </div>
          </section>

          <section className="evidence-panel">
            <div>
              <SectionTitle
                eyebrow="EVIDENCE LEDGER"
                title="数据源与缺口"
              />
              <div className="source-list">
                {report.sources.map((source) => (
                  <article key={`${source.name}-${source.provider}`}>
                    <span className={`source-state ${source.status}`} />
                    <div>
                      <strong>{source.name}</strong>
                      <small>
                        {source.provider} · {source.tier} 级
                      </small>
                      <p>{source.note}</p>
                    </div>
                    <time>{source.status}</time>
                  </article>
                ))}
              </div>
            </div>
            <div className="gap-list">
              <span>仍需补齐</span>
              {report.evidenceGaps.map((gap, index) => (
                <p key={gap}>
                  <b>{String(index + 1).padStart(2, "0")}</b>
                  {gap}
                </p>
              ))}
            </div>
          </section>

          <footer>
            <div>
              <strong>SignalForge</strong>
              <span>Public Equity Investing workflow</span>
            </div>
            <p>{report.disclaimer}</p>
            <span>生成于 {generatedAtLabel}</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
