// ============================================================================
// QUANTUMCLOUD V2 — MASTER LOGIC v1
// Syraeth Trading Brain — Core Architecture (Backbone Only)
// ----------------------------------------------------------------------------
// This file is a DOCTRINE LAYER, not UI.
// It defines how the brain THINKS, not which buttons exist.
// Paste as e.g. /core/master-logic.ts and wire from engine.ts.
//
// This is the current BASELINE, not frozen forever.
// Future versions: master-logic-v1_1, v2, etc. will layer on top.
// ============================================================================

/**
 * MODES
 * - BURST   : High-activity, small bites, cluster entries when conditions align.
 * - SCALPER : Fast in/out around short-term edges.
 * - TREND   : Fewer trades, backs larger swings with strong confirmation.
 * - ADAPTIVE: Lets the brain choose between Burst/Scalper/Trend in real-time.
 */
export type MasterTradingMode = "BURST" | "SCALPER" | "TREND" | "ADAPTIVE";

/**
 * HIGH-LEVEL INPUT CONTEXT
 * The engine core should provide this into Master Logic.
 * Types can be adapted to real project types, the shape is what matters.
 */
export interface MasterLogicContext {
  // user / session config
  selectedMode: MasterTradingMode;      // Burst / Scalper / Trend / Adaptive
  baseRiskFraction: number;       // slider (e.g. 0.0025 → 0.20)
  maxOpenPositions: number;       // hard cap on simultaneous positions
  accountEquity: number;          // current equity (paper or live)

  // market + feed data
  now: number;                    // timestamp for this tick
  symbolUniverse: string[];       // all allowed markets
  primarySymbols: string[];       // symbols chosen by MarketRouter (top N)
  priceHistory: Record<string, PriceSeries>; // OHLC + volume per timeframe

  // environment classification (from EnvironmentClassifier)
  environment: EnvironmentSnapshot;

  // edge scoring (from EdgeEngine)
  edges: Record<string, EdgeSnapshot>;       // per symbol

  // thermostat state (from ThermostatEngine)
  thermostat: ThermostatState;

  // session info (from SessionEventBrain)
  session: SessionSnapshot;

  // current risk + exposure (from TradeManagementEngine / engine core)
  openPositions: PositionSnapshot[];
  openExposureFraction: number;   // total notional / equity
}

/**
 * OUTPUT: what the Master Logic wants to do on this tick.
 */
export interface MasterLogicDecision {
  effectiveMode: MasterTradingMode;     // actual mode used this tick
  proposedOrders: ProposedMasterOrder[];// new entries the core should try to place
  updatedThermostat: ThermostatState; // next thermostat state
}

// Minimal placeholder shapes (adapt to real project types)
export interface PriceSeries {
  timeframe: "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
  candles: {
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }[];
}

export interface EnvironmentSnapshot {
  marketState: "TRENDING_UP" | "TRENDING_DOWN" | "RANGING" | "CHOPPY";
  volatilityState: "LOW" | "NORMAL" | "HIGH" | "EXTREME";
  liquidityState: "THIN" | "OK" | "DEEP";
  confidence: number; // 0–1
}

export interface EdgeSnapshot {
  symbol: string;
  // aggregated edge components, 0–100 each
  structureEdge: number;   // market structure / trend alignment
  volatilityEdge: number;  // volatility in the "right" zone for the mode
  sessionEdge: number;     // fits current session (London / NY / Asia etc.)
  correlationEdge: number; // symbol not fighting the rest of the book
  direction: "LONG" | "SHORT";
  confidence: number;      // 0–1, internal quality of this edge
}

export interface ThermostatState {
  // trade-level
  aggressionLevel: number;     // 0–1 → how bold we are sizing right now
  recentWinRate: number;       // 0–1 (rolling window)
  streakCount: number;         // positive for wins, negative for losses
  realizedDrawdownPct: number; // max DD over recent window, e.g. 0.08 = 8%
  regimeTag: "CALM" | "NORMAL" | "HOT" | "DANGER";
}

export interface SessionSnapshot {
  label: string; // e.g. "London Open", "NY Mid", "Asia Overnight"
  phase: "OPEN" | "MID" | "CLOSE" | "OFF";
  quality: number;     // 0–1, how suitable the window is for active trading
  volatilityBias: "LOW" | "NORMAL" | "HIGH";
  spreadEstimate: number; // estimated avg spread % for main symbols
}

export interface PositionSnapshot {
  id: string;
  symbol: string;
  direction: "LONG" | "SHORT";
  size: number;            // position size in units / contracts
  entryPrice: number;
  stopPrice: number;
  takeProfitPrice: number;
  modeTag: MasterTradingMode;    // which mode opened it
  openedAt: number;
}

export interface ProposedMasterOrder {
  symbol: string;
  direction: "LONG" | "SHORT";
  size: number;
  entryType: "MARKET" | "LIMIT";
  entryPrice?: number;   // only for LIMIT
  stopPrice: number;
  takeProfitPrice: number;
  modeTag: MasterTradingMode;
  rationale: string;     // short text for logs
}

// ============================================================================
// MASTER LOGIC v1
// ============================================================================

export function runMasterLogicV1(ctx: MasterLogicContext): MasterLogicDecision {
  // 1) Decide EFFECTIVE MODE (Adaptive brain)
  const effectiveMode = selectEffectiveMode(ctx);

  // 2) Evaluate how aggressive we are allowed to be (Thermostat)
  const thermostat = updateThermostatState(ctx);

  // 3) Decide how much total fresh risk to allow on this tick
  const freeRiskFraction = computeFreeRiskFraction(ctx, thermostat);

  if (freeRiskFraction <= 0) {
    // Fully loaded or in cooldown → only manage existing positions (no new ones)
    return {
      effectiveMode,
      proposedOrders: [],
      updatedThermostat: thermostat,
    };
  }

  // 4) Rank symbols using edges + environment + router intuition
  const rankedSymbols = rankSymbolsForMode(ctx, effectiveMode);

  // 5) Build candidate orders from the top-ranked symbols
  const proposedOrders: ProposedMasterOrder[] = [];

  for (const symbol of rankedSymbols) {
    if (proposedOrders.length >= ctx.maxOpenPositions) break;

    const edge = ctx.edges[symbol];
    if (!edge) continue;

    // 5A) Check if we ALREADY hold this symbol heavily → avoid over-stacking
    const existing = ctx.openPositions.filter(p => p.symbol === symbol);
    if (existing.length > 0 && effectiveMode !== "BURST") {
      // Non-Burst modes avoid stacking; Burst is allowed to cluster.
      continue;
    }

    // 5B) Compute directional bias using multi-timeframe + edge direction
    const bias = computeDirectionalBias(ctx, symbol, edge);

    if (bias === "FLAT") continue; // no strong conviction

    // 5C) Compute entry strength for this mode
    const entryScore = computeEntryScoreForMode(effectiveMode, ctx, symbol, edge, bias);
    if (entryScore <= 0) continue;

    // 5D) Convert remaining risk budget and entryScore into position size
    const size = computePositionSize(ctx, thermostat, freeRiskFraction, entryScore, symbol);
    if (size <= 0) continue;

    // 5E) Build SL/TP using mode-specific trade management defaults
    const { stopPrice, takeProfitPrice } = computeStopsAndTargets(
      effectiveMode,
      ctx,
      symbol,
      bias,
    );

    proposedOrders.push({
      symbol,
      direction: bias === "LONG" ? "LONG" : "SHORT",
      size,
      entryType: "MARKET",
      stopPrice,
      takeProfitPrice,
      modeTag: effectiveMode,
      rationale: buildRationale(effectiveMode, ctx, symbol, edge, entryScore),
    });
  }

  return {
    effectiveMode,
    proposedOrders,
    updatedThermostat: thermostat,
  };
}

// ============================================================================
// SUPPORTING BRAINS (v1 BEHAVIOUR)
// ============================================================================

/**
 * ADAPTIVE MODE SELECTION
 * - If user picked a fixed mode → honour it.
 * - In ADAPTIVE: choose Burst / Scalper / Trend based on environment + session + thermostat.
 */
function selectEffectiveMode(ctx: MasterLogicContext): MasterTradingMode {
  if (ctx.selectedMode !== "ADAPTIVE") {
    return ctx.selectedMode;
  }

  const { environment, session, thermostat } = ctx;

  // Simple interpretable rules, extendable later
  const isHotSession = session.quality > 0.7 && environment.volatilityState === "HIGH";
  const isCalmTrend =
    environment.marketState === "TRENDING_UP" ||
    environment.marketState === "TRENDING_DOWN";

  if (thermostat.regimeTag === "DANGER") {
    // In danger regime, force Trend (slow down, cleaner setups only)
    return "TREND";
  }

  if (isHotSession && thermostat.regimeTag === "HOT") {
    // Market + brain are both "hot" → Burst is allowed
    return "BURST";
  }

  if (isHotSession && environment.marketState === "RANGING") {
    // High activity but not directional → Scalper
    return "SCALPER";
  }

  if (isCalmTrend && environment.volatilityState !== "EXTREME") {
    // Clean trend conditions → Trend mode
    return "TREND";
  }

  // Default fallback when nothing stands out
  return "SCALPER";
}

/**
 * THERMOSTAT ENGINE v1
 * - Reads recent performance and sets aggression + regime.
 * - Always bounded: never allows uncontrolled leverage.
 */
function updateThermostatState(ctx: MasterLogicContext): ThermostatState {
  const t = { ...ctx.thermostat };

  // Regime derivation (very simple v1 logic; can be refined later)
  const dd = t.realizedDrawdownPct;
  const win = t.recentWinRate;
  const streak = t.streakCount;

  if (dd > 0.15) {
    t.regimeTag = "DANGER";
    t.aggressionLevel = 0.2;
  } else if (dd > 0.08) {
    t.regimeTag = "CALM";
    t.aggressionLevel = 0.4;
  } else if (win > 0.65 && streak >= 3) {
    t.regimeTag = "HOT";
    t.aggressionLevel = 0.9;
  } else {
    t.regimeTag = "NORMAL";
    t.aggressionLevel = 0.6;
  }

  // Clamp aggression between 0.15 and 1.0 for safety
  t.aggressionLevel = Math.max(0.15, Math.min(1.0, t.aggressionLevel));

  return t;
}

/**
 * FREE RISK BUDGET
 * - How much additional fraction of equity we are allowed to put at risk.
 * - Simple v1 rule: cap exposure at baseRiskFraction * 5 (soft) * thermostat.aggressionLevel.
 */
function computeFreeRiskFraction(ctx: MasterLogicContext, t: ThermostatState): number {
  const maxExposure = ctx.baseRiskFraction * 5 * t.aggressionLevel;
  const free = maxExposure - ctx.openExposureFraction;
  return Math.max(0, free);
}

/**
 * SYMBOL RANKING
 * - Uses edge scores + environment + session to pick the best markets for this mode.
 */
function rankSymbolsForMode(ctx: MasterLogicContext, mode: MasterTradingMode): string[] {
  const symbols = ctx.primarySymbols.length ? ctx.primarySymbols : ctx.symbolUniverse;

  const scored = symbols
    .map(symbol => {
      const edge = ctx.edges[symbol];
      if (!edge) return null;

      let score =
        edge.structureEdge * 0.4 +
        edge.volatilityEdge * 0.25 +
        edge.sessionEdge * 0.2 +
        edge.correlationEdge * 0.15;

      // Mode-based tweaks
      if (mode === "BURST") {
        // likes volatility + session
        score += edge.volatilityEdge * 0.15 + edge.sessionEdge * 0.1;
      } else if (mode === "TREND") {
        // likes structure + correlation
        score += edge.structureEdge * 0.2 + edge.correlationEdge * 0.15;
      } else if (mode === "SCALPER") {
        // likes session + moderate volatility
        score += edge.sessionEdge * 0.25;
      }

      return { symbol, score };
    })
    .filter((x): x is { symbol: string; score: number } => !!x)
    .sort((a, b) => b.score - a.score);

  // Only use the top cluster for new entries
  return scored.slice(0, 6).map(s => s.symbol);
}

/**
 * DIRECTIONAL BIAS (simple v1)
 * - Uses edge.direction, but can be adjusted by higher timeframe trend.
 */
function computeDirectionalBias(
  ctx: MasterLogicContext,
  symbol: string,
  edge: EdgeSnapshot,
): "LONG" | "SHORT" | "FLAT" {
  // Simple v1: trust the EdgeEngine direction if confidence is decent
  if (edge.confidence < 0.35) return "FLAT";
  return edge.direction;
}

/**
 * ENTRY SCORE PER MODE
 * - 0 = no trade, 1 = strong signal.
 * - Combines edge confidence + environment + session.
 */
function computeEntryScoreForMode(
  mode: MasterTradingMode,
  ctx: MasterLogicContext,
  symbol: string,
  edge: EdgeSnapshot,
  bias: "LONG" | "SHORT" | "FLAT",
): number {
  if (bias === "FLAT") return 0;

  const { environment, session } = ctx;

  let score = edge.confidence; // 0–1

  // Volatility shaping
  if (mode === "BURST") {
    if (environment.volatilityState === "HIGH" || environment.volatilityState === "EXTREME") {
      score *= 1.2;
    } else if (environment.volatilityState === "LOW") {
      score *= 0.6;
    }
  } else if (mode === "SCALPER") {
    if (environment.volatilityState === "NORMAL" || environment.volatilityState === "HIGH") {
      score *= 1.1;
    }
  } else if (mode === "TREND") {
    if (environment.marketState === "TRENDING_UP" || environment.marketState === "TRENDING_DOWN") {
      score *= 1.3;
    } else if (environment.marketState === "RANGING") {
      score *= 0.5;
    }
  }

  // Session quality
  score *= 0.5 + session.quality * 0.5; // 0.5–1.0 multiplier

  // Clamp
  score = Math.max(0, Math.min(1, score));

  // Require minimum threshold to avoid noise
  const minThreshold = mode === "BURST" ? 0.25 : mode === "SCALPER" ? 0.3 : 0.35;
  if (score < minThreshold) return 0;

  return score;
}

/**
 * POSITION SIZING
 * - Converts risk budget + aggression + entryScore into a concrete size.
 */
function computePositionSize(
  ctx: MasterLogicContext,
  t: ThermostatState,
  freeRiskFraction: number,
  entryScore: number,
  symbol: string,
): number {
  // v1: per-trade risk fraction is proportional to entryScore and aggression
  const perTradeRisk =
    ctx.baseRiskFraction * (0.5 + entryScore * 0.5) * (0.5 + t.aggressionLevel * 0.5);

  // Hard-cap per-trade risk
  const cappedRisk = Math.min(perTradeRisk, freeRiskFraction, ctx.baseRiskFraction * 1.5);

  if (cappedRisk <= 0) return 0;

  // The engine core should convert "risk fraction" to actual size using symbol volatility
  // For this doctrine layer, just return a placeholder "risk fraction" value:
  const syntheticSize = cappedRisk; // engine translates this to contracts / units.
  return syntheticSize;
}

/**
 * STOPS & TARGETS v1
 * - Per mode default RR template (can be refined with ATR etc.).
 */
function computeStopsAndTargets(
  mode: MasterTradingMode,
  ctx: MasterLogicContext,
  symbol: string,
  bias: "LONG" | "SHORT",
): { stopPrice: number; takeProfitPrice: number } {
  // This layer defines RELATIVE behaviour; actual prices are calculated by engine core.
  // For now we just provide indicative RR templates via comments:

  // BURST   : wider stops, modest TP, but allowed to stack.
  // SCALPER : tight stops, tight TP (e.g. 1:1–1.2:1), high frequency.
  // TREND   : moderate stop, larger TP (e.g. 2.5:1–3:1), low frequency.

  // In this doctrine-only file, return dummy numbers; real implementation will do ATR maths.
  return {
    stopPrice: 0,       // engine must replace with real SL calculation
    takeProfitPrice: 0, // engine must replace with real TP calculation
  };
}

/**
 * RATIONALE BUILDER
 * - Short human-readable explanation for logs.
 */
function buildRationale(
  mode: MasterTradingMode,
  ctx: MasterLogicContext,
  symbol: string,
  edge: EdgeSnapshot,
  entryScore: number,
): string {
  return [
    `${mode} entry on ${symbol}`,
    `edge=${edge.confidence.toFixed(2)}`,
    `structure=${edge.structureEdge.toFixed(0)}`,
    `vol=${edge.volatilityEdge.toFixed(0)}`,
    `session=${ctx.session.label}`,
    `score=${entryScore.toFixed(2)}`,
  ].join(" | ");
}

// ============================================================================
// BRIDGE FUNCTIONS: Convert existing engine types to Master Logic types
// ============================================================================

import type { EnvironmentSummary } from './environment';
import type { EdgeSignal } from './edge';
import type { ThermostatState as EngineThermostatState } from './thermostat';
import type { SessionInfo } from './session-brain';
import type { Position, PriceTick, TradingMode } from './types';

// Type for the session analysis result
type SessionAnalysisResult = {
  session: SessionInfo;
  adjustments: {
    entryThresholdMultiplier: number;
    sizeMultiplier: number;
    tpMultiplier: number;
    aggressiveness: 'conservative' | 'normal' | 'aggressive';
  };
  eventCheck: {
    nearEvent: boolean;
    event: { name: string; timeUTC: string; impact: 'low' | 'medium' | 'high'; currencies: string[] } | null;
    minutesUntil: number | null;
  };
  shouldReduceExposure: boolean;
};

/**
 * Convert engine environment to master logic environment
 */
export function bridgeEnvironment(env: EnvironmentSummary): EnvironmentSnapshot {
  // Map market state
  let marketState: EnvironmentSnapshot['marketState'] = 'RANGING';
  if (env.marketState === 'trend_clean' || env.marketState === 'trend_messy') {
    // Use volatility or other heuristics to determine up/down
    marketState = 'TRENDING_UP'; // simplified, could use price momentum
  } else if (env.marketState === 'range_trap' || env.marketState === 'chaos') {
    marketState = 'CHOPPY';
  }
  
  // Map volatility state
  let volatilityState: EnvironmentSnapshot['volatilityState'] = 'NORMAL';
  if (env.volState === 'expansion' || env.volState === 'spike') {
    volatilityState = 'HIGH';
  } else if (env.volState === 'compression') {
    volatilityState = 'LOW';
  } else if (env.volState === 'exhaustion') {
    volatilityState = 'NORMAL';
  }
  
  // Map liquidity state
  let liquidityState: EnvironmentSnapshot['liquidityState'] = 'OK';
  if (env.liquidityState === 'thin') {
    liquidityState = 'THIN';
  } else if (env.liquidityState === 'broken') {
    liquidityState = 'THIN';
  }
  
  return {
    marketState,
    volatilityState,
    liquidityState,
    confidence: env.environmentConfidence
  };
}

/**
 * Convert engine edge to master logic edge
 */
export function bridgeEdge(edge: EdgeSignal): EdgeSnapshot {
  return {
    symbol: '', // will be set by caller
    structureEdge: edge.edgeScore * 0.4,
    volatilityEdge: edge.edgeScore * 0.25,
    sessionEdge: edge.edgeScore * 0.2,
    correlationEdge: edge.edgeScore * 0.15,
    direction: edge.edgeDirection === 'long' ? 'LONG' : edge.edgeDirection === 'short' ? 'SHORT' : 'LONG',
    confidence: edge.edgeConfidence
  };
}

/**
 * Convert engine thermostat to master logic thermostat
 */
export function bridgeThermostat(t: EngineThermostatState): ThermostatState {
  // Map aggression level string to number
  let aggressionLevel = 0.6;
  if (t.aggressionLevel === 'low') aggressionLevel = 0.3;
  else if (t.aggressionLevel === 'medium') aggressionLevel = 0.6;
  else if (t.aggressionLevel === 'high') aggressionLevel = 0.9;
  
  // Map regime tag
  let regimeTag: ThermostatState['regimeTag'] = 'NORMAL';
  if (t.adjustmentReason.includes('danger') || t.adjustmentReason.includes('loss')) {
    regimeTag = 'DANGER';
  } else if (t.adjustmentReason.includes('calm') || t.adjustmentReason.includes('cautious')) {
    regimeTag = 'CALM';
  } else if (t.adjustmentReason.includes('hot') || t.adjustmentReason.includes('aggressive')) {
    regimeTag = 'HOT';
  }
  
  return {
    aggressionLevel,
    recentWinRate: t.recentWinRate / 100, // convert from percentage
    streakCount: t.streakType === 'win' ? t.streakLength : -t.streakLength,
    realizedDrawdownPct: 0, // TODO: calculate from trades
    regimeTag
  };
}

/**
 * Convert engine session to master logic session
 */
export function bridgeSession(s: SessionAnalysisResult): SessionSnapshot {
  const phaseMap: Record<string, SessionSnapshot['phase']> = {
    'asia_early': 'OPEN',
    'asia_late': 'MID',
    'london_early': 'OPEN',
    'london_prime': 'MID',
    'overlap': 'MID',
    'ny_prime': 'MID',
    'ny_late': 'CLOSE',
    'off_hours': 'OFF'
  };
  
  return {
    label: s.session.name,
    phase: phaseMap[s.session.phase] || 'MID',
    quality: s.session.quality,
    volatilityBias: s.session.volatilityExpected.toUpperCase() as SessionSnapshot['volatilityBias'],
    spreadEstimate: 0.001 // default estimate
  };
}

/**
 * Convert engine positions to master logic positions
 */
export function bridgePositions(positions: Position[]): PositionSnapshot[] {
  return positions.map(p => ({
    id: p.id,
    symbol: p.symbol,
    direction: p.side === 'long' ? 'LONG' : 'SHORT',
    size: p.size,
    entryPrice: p.entryPrice,
    stopPrice: p.sl || 0,
    takeProfitPrice: p.tp || 0,
    modeTag: mapTradingModeToMaster(p.mode),
    openedAt: new Date(p.openedAt).getTime()
  }));
}

/**
 * Map engine trading mode to master logic mode
 */
export function mapTradingModeToMaster(mode: TradingMode): MasterTradingMode {
  if (mode === 'burst') return 'BURST';
  if (mode === 'trend' || mode === 'swing') return 'TREND';
  if (mode === 'sniper') return 'SCALPER';
  if (mode === 'hybrid') return 'ADAPTIVE';
  return 'SCALPER'; // default
}

/**
 * Map master logic mode to engine trading mode
 */
export function mapMasterModeToEngine(mode: MasterTradingMode): TradingMode {
  if (mode === 'BURST') return 'burst';
  if (mode === 'TREND') return 'trend';
  if (mode === 'SCALPER') return 'swing';
  if (mode === 'ADAPTIVE') return 'hybrid';
  return 'swing'; // default
}
