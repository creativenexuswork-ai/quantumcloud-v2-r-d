// ============= Directional Bias Filter =============
// Blocks entries against dominant market bias or catastrophic performance

import type { Side, ClosedTrade, Position } from './types';
import type { RegimeSnapshot } from './regime';

export interface BiasFilterResult {
  allowed: boolean;
  reason: string;
  biasDirection: Side | 'neutral';
  confidence: number;
}

export interface DirectionalPerformance {
  longWinRate: number;
  shortWinRate: number;
  longCount: number;
  shortCount: number;
  longPnl: number;
  shortPnl: number;
}

const CATASTROPHIC_WIN_RATE = 20; // Below this, block that direction
const MIN_TRADES_FOR_BIAS = 5;    // Need at least this many trades to establish bias
const REGIME_OVERRIDE_STRENGTH = 50; // Regime strength needed to override

/**
 * Calculate performance by direction from recent trades
 */
export function calculateDirectionalPerformance(
  trades: ClosedTrade[],
  windowMinutes: number = 120
): DirectionalPerformance {
  const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000).toISOString();
  const recent = trades.filter(t => t.closedAt && t.closedAt > cutoff);
  
  const longs = recent.filter(t => t.side === 'long');
  const shorts = recent.filter(t => t.side === 'short');
  
  const longWins = longs.filter(t => t.realizedPnl > 0).length;
  const shortWins = shorts.filter(t => t.realizedPnl > 0).length;
  
  const longPnl = longs.reduce((sum, t) => sum + t.realizedPnl, 0);
  const shortPnl = shorts.reduce((sum, t) => sum + t.realizedPnl, 0);
  
  return {
    longWinRate: longs.length > 0 ? (longWins / longs.length) * 100 : 50,
    shortWinRate: shorts.length > 0 ? (shortWins / shorts.length) * 100 : 50,
    longCount: longs.length,
    shortCount: shorts.length,
    longPnl,
    shortPnl
  };
}

/**
 * Determine dominant market bias from regime and performance
 */
export function determineBias(
  regime: RegimeSnapshot | null,
  performance: DirectionalPerformance
): { direction: Side | 'neutral'; confidence: number; source: string } {
  let biasDirection: Side | 'neutral' = 'neutral';
  let confidence = 0;
  let source = 'none';
  
  // First check: Performance-based bias (strongest signal)
  if (performance.shortCount >= MIN_TRADES_FOR_BIAS && 
      performance.shortWinRate < CATASTROPHIC_WIN_RATE) {
    biasDirection = 'long'; // Bias LONG because SHORT is catastrophic
    confidence = 0.9;
    source = `SHORT win rate catastrophic (${performance.shortWinRate.toFixed(0)}%)`;
  } else if (performance.longCount >= MIN_TRADES_FOR_BIAS && 
             performance.longWinRate < CATASTROPHIC_WIN_RATE) {
    biasDirection = 'short'; // Bias SHORT because LONG is catastrophic
    confidence = 0.9;
    source = `LONG win rate catastrophic (${performance.longWinRate.toFixed(0)}%)`;
  }
  
  // Second check: Regime-based bias (if no performance-based)
  if (biasDirection === 'neutral' && regime) {
    if (regime.trendBias === 'bull' && regime.trendStrength > REGIME_OVERRIDE_STRENGTH) {
      biasDirection = 'long';
      confidence = regime.confidence * 0.7;
      source = `Regime bullish (strength: ${regime.trendStrength.toFixed(0)})`;
    } else if (regime.trendBias === 'bear' && regime.trendStrength > REGIME_OVERRIDE_STRENGTH) {
      biasDirection = 'short';
      confidence = regime.confidence * 0.7;
      source = `Regime bearish (strength: ${regime.trendStrength.toFixed(0)})`;
    }
  }
  
  // Third check: P&L-based bias
  if (biasDirection === 'neutral') {
    const pnlDiff = performance.longPnl - performance.shortPnl;
    const totalTrades = performance.longCount + performance.shortCount;
    
    if (totalTrades >= MIN_TRADES_FOR_BIAS) {
      if (pnlDiff > 100) { // $100+ more profitable on longs
        biasDirection = 'long';
        confidence = 0.5;
        source = `LONG P&L significantly better (+$${pnlDiff.toFixed(0)})`;
      } else if (pnlDiff < -100) {
        biasDirection = 'short';
        confidence = 0.5;
        source = `SHORT P&L significantly better (+$${Math.abs(pnlDiff).toFixed(0)})`;
      }
    }
  }
  
  return { direction: biasDirection, confidence, source };
}

/**
 * Main bias filter - determines if a proposed direction is allowed
 */
export function applyBiasFilter(
  proposedDirection: Side,
  regime: RegimeSnapshot | null,
  recentTrades: ClosedTrade[],
  openPositions: Position[]
): BiasFilterResult {
  const performance = calculateDirectionalPerformance(recentTrades);
  const bias = determineBias(regime, performance);
  
  // If no bias established, allow everything
  if (bias.direction === 'neutral') {
    return {
      allowed: true,
      reason: 'No directional bias detected',
      biasDirection: 'neutral',
      confidence: 0
    };
  }
  
  // If proposed direction matches bias, allow
  if (proposedDirection === bias.direction) {
    return {
      allowed: true,
      reason: `Direction aligns with bias: ${bias.source}`,
      biasDirection: bias.direction,
      confidence: bias.confidence
    };
  }
  
  // Proposed direction is AGAINST bias - check severity
  const isAgainstCatastrophic = 
    (proposedDirection === 'short' && performance.shortWinRate < CATASTROPHIC_WIN_RATE && performance.shortCount >= MIN_TRADES_FOR_BIAS) ||
    (proposedDirection === 'long' && performance.longWinRate < CATASTROPHIC_WIN_RATE && performance.longCount >= MIN_TRADES_FOR_BIAS);
  
  if (isAgainstCatastrophic) {
    // HARD BLOCK - catastrophic performance in this direction
    return {
      allowed: false,
      reason: `BLOCKED: ${proposedDirection.toUpperCase()} has catastrophic win rate (${proposedDirection === 'long' ? performance.longWinRate.toFixed(0) : performance.shortWinRate.toFixed(0)}%)`,
      biasDirection: bias.direction,
      confidence: bias.confidence
    };
  }
  
  // Soft block - against regime but not catastrophic
  if (bias.confidence > 0.6) {
    return {
      allowed: false,
      reason: `BLOCKED: ${proposedDirection.toUpperCase()} against strong bias: ${bias.source}`,
      biasDirection: bias.direction,
      confidence: bias.confidence
    };
  }
  
  // Weak bias - allow but log warning
  return {
    allowed: true,
    reason: `Warning: ${proposedDirection.toUpperCase()} against weak bias: ${bias.source}`,
    biasDirection: bias.direction,
    confidence: bias.confidence
  };
}

/**
 * Get bias filter summary for logging
 */
export function getBiasFilterSummary(
  recentTrades: ClosedTrade[],
  regime: RegimeSnapshot | null
): string {
  const perf = calculateDirectionalPerformance(recentTrades);
  const bias = determineBias(regime, perf);
  
  return `Bias: ${bias.direction.toUpperCase()} | LONG: ${perf.longWinRate.toFixed(0)}% (${perf.longCount} trades, $${perf.longPnl.toFixed(0)}) | SHORT: ${perf.shortWinRate.toFixed(0)}% (${perf.shortCount} trades, $${perf.shortPnl.toFixed(0)}) | Source: ${bias.source}`;
}
