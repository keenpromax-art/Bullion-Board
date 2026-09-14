// Complete module catalog — 1:1 mapping of get_module_dispatch() in special.py.
// Nothing is dropped: every run_* Python entrypoint has a ModuleInfo here and a
// corresponding /module/[id] web page + /api/analysis/[id] endpoint.

import type { ModuleInfo } from "./types";

// Nexus Chat (Keenjio/nexus-chat) — CFA study chat app with book + PDF
// library, modes and notes. Static build deployed to Cloudflare Pages;
// embedded inside terminal panels + deep-link page via iframe.
export const NEXUS_CHAT_URL = "https://nexus-chat-473.pages.dev/";

function m(id: string, pyFn: string, label: string, category: string, description: string, hidden = false): ModuleInfo {
  return { id, pyFn, label, category, description, route: `/module/${id}`, hidden };
}

export const MODULES: ModuleInfo[] = [
  m("1", "run_tech_indicators", "Technical Indicators", "Technical", "RSI, MACD, ADX, Stochastic, Bollinger, ATR, MFI, Williams %R, confluence scoring, divergences, multi-timeframe."),
  m("2", "run_master_chart", "Master Chart Suite", "Technical", "Institutional multi-panel chart dashboard: price, Bollinger, RSI, MACD, volume, Stochastic, ATR, ADX, CCI, pivots."),
  m("3", "run_historical_analysis", "Historical Returns & Monte Carlo", "Risk", "Return stats, drawdowns, Hurst, tail index, EWMA vol, Monte-Carlo fan, AI analyst."),
  m("4", "run_indicator_comparison", "Indicator Comparison Lab", "Technical", "Multi-indicator overlay, z-score, rolling correlation, divergence explorer."),
  m("5", "run_pro_technical_analysis", "Pro Technical Scorecard", "Technical", "Master score, regime filter, pivot map, forward backtest, AI chat with tools."),
  m("6", "run_monte_carlo_merton", "Monte Carlo (Merton Jump-Diffusion)", "Risk", "GBM vs jump-diffusion calibration, path simulation, risk report, sensitivity + stress."),
  m("7", "run_xgb_signal", "XGB Signal Engine", "ML", "Feature engineering + gradient-boosted ensemble, SHAP-style attribution, signal panel, AI critic."),
  m("8", "run_order_flow_engine", "Order Flow Engine", "Intraday", "Footprint, VWAP bands, volume profile, session tape, intraday signals."),
  m("9", "run_price_forecast", "Price Forecast (Quant Ensemble)", "ML", "Ensemble forecast, GARCH calibration, Monte-Carlo targets, forecast table + AI analyst."),
  m("10", "run_arima_lstm_meta", "ARIMA-LSTM Meta Forecaster", "ML", "Classical + deep meta forecaster comparison with backtest windows."),
  m("11", "run_fundamental", "Fundamental Analysis", "Fundamental", "Gateway menu: overview, ledger, valuation, quality, peers, research AI — pick a function to open its desk."),
  m("12", "run_financial_statements", "Financial Statements", "Fundamental", "Income / balance / cash-flow tables, YoY, CAGR, statement AI chat, Excel export."),
  m("13", "run_stmt_charts", "Statement Charts", "Fundamental", "Bar-chart visualisation of statements with growth guides."),
  m("14", "run_dupont", "DuPont Analysis", "Fundamental", "ROE decomposition: margin × turnover × leverage with trend."),
  m("15", "run_forensic_accounting", "Forensic Accounting", "Fundamental", "Beneish + accruals, cash-conversion, quality-of-earnings flags."),
  m("16", "run_statement_analyzer", "Statement Analyzer", "Fundamental", "Structured P&L / BS / CF analysis with ratios and sparklines."),
  m("17", "run_company_profiler", "Company Profiler", "Fundamental", "Profile, key stats, peers, snapshot box."),
  m("18", "run_institutional_dcf", "Institutional DCF", "Valuation", "WACC build, historical margins, projections, sensitivity grid, Monte-Carlo, scenarios, Excel."),
  m("19", "run_institutional_lbo", "Institutional LBO", "Valuation", "Sources & uses, debt tranches, projections, IRR/MOIC, value bridge, sensitivity."),
  m("20", "run_historical_financials_4y", "Historical Financials (4Y)", "Fundamental", "4-year ratios, growth, DuPont, quality, capital efficiency, Excel export."),
  m("22", "run_risk_assessment", "Risk Assessment", "Risk", "Kelly sizing, MA-crossover trade stats, ATR sizing, risk dashboard, AI chat."),
  m("23", "run_rolling_risk", "Rolling Risk", "Risk", "Rolling Sortino / beta / drawdown term-structure."),
  m("24", "run_garch", "GARCH Volatility", "Risk", "GARCH(1,1) fit, vol forecast, regime note."),
  m("25", "run_regime_detection", "Regime Detection", "Risk", "Feature engineering + regime classifier, analytics + AI chat."),
  m("26", "run_vol_trading_framework", "Vol Trading Framework", "Options", "HV term-structure, expected moves, strategy picker."),
  m("27", "run_pairs_trading", "Pairs Trading", "Statistical", "Hedge ratio, half-life, Hurst, z-score bands, backtest."),
  m("28", "run_fama_french", "Fama-French Factors", "Statistical", "3/4-factor OLS, rolling betas, attribution dashboard."),
  m("29", "run_efficient_frontier", "Efficient Frontier", "Portfolio", "Mean-variance frontier, max-Sharpe / min-vol portfolios."),
  m("30", "run_mean_reversion", "Mean Reversion Lab", "Statistical", "Bollinger/RSI signals, backtest, walk-forward, Monte-Carlo equity, AI chat."),
  m("31", "run_monte_carlo_advanced", "Monte Carlo Advanced", "Risk", "Cornish-Fisher VaR, extreme paths, fan charts, risk report."),
  m("32", "run_options_engine", "Synthetic Options Engine", "Options", "Black-Scholes Greeks, vol regime, delta-40 strike picker, spread builder.", true),
  m("33", "run_options_greeks", "Options Greeks", "Options", "Spot + chain Greeks, expiry calendar, strategy note."),
  m("34", "run_sentiment_analysis", "Sentiment Analysis", "News", "VADER-style scoring, topic extraction, source weighting, charts, Excel."),
  m("35", "run_sector_analysis", "Sector Analysis", "Market", "Breadth, RS ratio/momentum, beta, sector rotation heatmap, AI chat."),
  m("36", "run_advanced_greeks", "Advanced Greeks", "Options", "Vanna/vomma/charm/speed, chain scoring, intraday scanner."),
  m("37", "run_news_events_hub", "News & Events Hub", "News", "Yahoo + RSS + GoogleNews aggregation, dedup, sentiment, AI analyst.", true),
  m("38", "run_global_macro_dashboard", "Global Macro Dashboard", "Market", "FRED indicator boards, global economic matrix, ECFC forecasts with country graphs, ECO calendar."),
  m("39", "run_shareholding_scraper", "Ownership", "Fundamental", "Holder mix, quarterly trend, full ledger with QoQ deltas."),
  m("40", "run_dividend_scanner", "Dividends", "Fundamental", "Yield, growth, full payout history to IPO, splits, yield board."),
  m("41", "run_large_deals_scanner", "Large Deals Scanner", "Screener", "Bulk/block deal feed scan with sector tagging."),
  m("42", "run_external_launcher", "External Chart Launcher", "Tools", "One-click TradingView / Screener / Yahoo / Groww links."),
  m("43", "run_documents_hub", "Corporate Documents Hub", "Fundamental", "Annual reports / filings browser per ticker."),
  m("44", "run_finshots_reader", "Finshots Reader", "News", "Finshots headlines + full-story reader."),
  m("45", "run_nbfc_news_scanner", "NBFC News Scanner", "News", "NBFC-focused RSS engine with sentiment + themes + AI chat.", true),
  m("46", "run_livemint_news", "Livemint Live Wire", "News", "Livemint/Mint feed wire with sentiment + AI scan.", true),
  m("47", "run_bloomberg_latest", "Bloomberg Live Wire", "News", "Multi-source wire, category sentiment, breaking panel, AI memo."),
  m("48", "run_stat_arb_engine", "Stat-Arb Engine", "Statistical", "Pair alignment, cointegration proxies, backtest, pair screener, AI chat."),
  m("49", "run_bible_terminal", "Bible Terminal", "Reading", "Scripture reader + AI commentary (general-knowledge module from original suite)."),
  m("51", "run_wikipedia", "Wikipedia Terminal", "Reading", "Search, article hub, section reader, AI explain/quiz/finance-lens."),
  m("52", "run_stochastic_engine", "Stochastic Vol Engine", "Risk", "Heston/GARCH vol surface, path simulation, sensitivity, 3D surface."),
  m("53", "run_terminal_dashboard", "Terminal Dashboard", "Market", "Market movers, indices, sector performance dashboard."),
  m("54", "run_alpha_autoencoder", "Alpha Signal Autoencoder", "ML", "Signal engineering + autoencoder compression, latent factors, pipeline."),
  m("55", "run_hybrid_garch_lstm", "Hybrid GARCH-LSTM", "ML", "GARCH features + LSTM/Transformer/TCN forecasters, backtest, AI critic."),
  m("56", "run_transformer_quant", "Deep Transformer Quant", "ML", "Dual-head transformer forecaster with NLL uncertainty, backtest, checkpoints."),
  m("57", "run_quantum_optimizer", "Portfolio Optimizer", "Portfolio", "Max-Sharpe / min-vol / max-return / risk-parity, frontier, correlation, AI chat."),
  m("58", "run_federated_swarm", "Federated Swarm AI", "ML", "8-node signal swarm (momentum, MR, trend, OBV, autocorr, vol, S/R, composite) with Byzantine filter."),
  m("59", "run_neural_ode_quant", "Neural ODE Quant", "ML", "Latent-ODE time-series model, training loop, forecast, evaluation."),
  m("60", "run_asset_graph", "Asset Dependency Graph", "Portfolio", "Pearson/partial/MST/Granger graphs, centrality, ASCII + chart render."),
  m("61", "run_rl_agent", "RL Trading Agent", "ML", "Reinforcement-learning trade agent runner."),
  m("62", "run_regime_hmm", "Regime HMM", "Risk", "Hidden-Markov regime fit, state analytics, dashboard, AI chat."),
  m("63", "run_risk_return_analyzer", "Risk-Return Analyzer", "Risk", "Per-ticker risk/return scatter, terminal table + chart."),
  m("64", "run_three_statement_linker", "Three-Statement Linker", "Fundamental", "IS/BS/CF golden links, trend + ratio dashboards, DuPont, WC, QoE, theory tutor, AI chat."),
  m("65", "run_market_newcomers", "Market Newcomers", "Screener", "IPO / newly-listed tracker via RSS."),
  m("66", "run_openrouter_chat", "OpenRouter Chat", "AI", "Multi-persona streaming chat with sessions, models, stats, export."),
  m("67", "run_workflow_scanner", "Workflow Scanner", "Screener", "Google-Sheets-style universe: strict filter, oversold RSI, momentum, Donchian breakout, custom builder, AI."),
  m("68", "run_strategy_tester", "Strategy Tester", "Backtest", "Multi-strategy tournament: indicators × parameters, leaderboard, trade log, AI advisor.", true),
  m("70", "run_options_greeks_recommender", "Options Strategy Recommender", "Options", "Chain → bias detector → 12-strategy payoff engine, top-3 + cards + chart."),
  m("71", "run_md_task_executor", "Markdown Task Executor", "AI", "Prompt-template runner with web context, tools, exec log, follow-ups."),
  m("72", "run_editorials_reader", "Editorials", "News", "Opinion and editorial pages from major outlets, inline reader + AI brief."),
  m("73", "run_prediction_market_oracle", "Prediction Market Oracle", "Market", "Polymarket live markets, edge/Kelly/EV, sentiment, portfolio review, AI chat."),
  m("75", "run_drawdown_scanner", "Drawdown Scanner", "Screener", "52-week dip scan with RSI, breadth, sortable universe."),
];

function t(id: string, code: string, label: string, description: string, route: string): ModuleInfo {
  return { id, pyFn: "terminal-native", label: `${label}`, category: "Terminal", description, route };
}

export const TERMINAL_DESKS: ModuleInfo[] = [
  t("101", "HOLD", "Portfolio Blotter", "Holdings with live P&L, allocation, dividend income forecast.", "/portfolio"),
  t("102", "ALRT", "Price Alerts", "Above/below triggers with live polling + browser notifications.", "/alerts"),
  t("103", "COMP", "Security Compare", "Rebased multi-security chart with return/vol/Sharpe stats.", "/compare"),
  t("104", "CORR", "Correlation Matrix", "1Y return correlations across securities.", "/corr"),
  t("105", "SEAS", "Seasonality", "Monthly seasonality heatmap + yearly returns from 10Y data.", "/season"),
  t("106", "EVTS", "History & Actions", "OHLC history browser, dividend events, splits.", "/events"),
  t("107", "BRTH", "Breadth & Movers", "Advances/declines, % above 20D, movers, volume shockers, gaps.", "/breadth"),
  t("108", "CALC", "Desk Calculators", "SIP, CAGR, Kelly, position size, pivots, Fibonacci, YTM, expiry.", "/calc"),
  t("109", "PRE", "Pre-Market Opening Desk", "Overnight signal scoring, Nifty intraday tape, NSE breadth, accuracy backtests.", "/opening"),
  t("110", "OC", "NSE Option Chain", "Live chain, PCR, max pain, gamma wall, Greeks, signal engine, payoff.", "/ochain"),
  t("111", "IND", "Macro Indicators", "GDP, PMI, payrolls, CPI/PCE, yields, curve, sentiment, India data.", "/macro"),
  t("112", "ANR", "Analyst Ratings", "Street consensus, buy split, estimates, key stats.", "/analyst"),
  t("113", "CAST", "Capital Structure", "Equity vs debt stack, WACC build, leverage path, debt tranches.", "/capital"),
  t("114", "NEXUS", "Nexus Chat — CFA Study", "CFA study chat with book + PDF library, modes and notes. Hosted app inside panel.", "/module/114"),
];

MODULES.push(...TERMINAL_DESKS);

export const MODULE_MAP: Record<string, ModuleInfo> = Object.fromEntries(MODULES.map((x) => [x.id, x]));

// Retired function IDs fold into their surviving equivalent, so old deep
// links, saved workspaces, muscle-memory codes (GI/SWING/ARENA) and numeric
// IDs keep working: #21 momentum + #74 swing live inside #67's all-boards
// scanner, #69 was byte-identical to #68's backtest.
export const MERGED_IDS: Record<string, string> = { "21": "67", "69": "68", "74": "67" };

export function resolveFuncId(id: string): string {
  return MERGED_IDS[id] ?? id;
}

export const CATEGORIES: string[] = Array.from(new Set(MODULES.map((x) => x.category)));
