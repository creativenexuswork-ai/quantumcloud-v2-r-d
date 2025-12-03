// Trading Engine - Main orchestration logic

import type {
  EngineContext,
  EngineState,
  Position,
  ClosedTrade,
  PriceTick,
  ProposedOrder,
  SystemLog,
  PaperConfig
} from './types';

import { applyRiskGuardrails, shouldHaltForDay, shouldLockBurst } from './risk';
import { MODE_RUNNERS } from './modes';
import { markToMarket, checkExits, closePositions, calculateStats } from './pnl';

interface RunTickInput {
  userId: string;
  config: PaperConfig;
  latestTicks: Record<string, PriceTick>;
  positions: Position[];
  recentTrades: ClosedTrade[];
  startingEquity: number;
}

/**
 * Main trading engine tick function
 * Processes market data, runs modes, applies risk, manages positions
 */
export function runTradingTick(input: RunTickInput): EngineState {
  const { userId, config, latestTicks, positions: inputPositions, recentTrades, startingEquity } = input;
  const logs: SystemLog[] = [];
  const now = new Date().toISOString();
  
  // Step 1: Mark positions to market
  let positions = markToMarket(inputPositions, latestTicks);
  
  // Step 2: Calculate current stats
  const todayTrades = recentTrades.filter(t => 
    t.sessionDate === new Date().toISOString().split('T')[0]
  );
  let stats = calculateStats(positions, todayTrades, startingEquity);
  
  // Step 3: Check if trading should be halted
  if (shouldHaltForDay(stats, config.riskConfig)) {
    // Close all positions and halt
    const { closedTrades: forceClosed, logs: closeLogs } = closePositions(
      positions,
      latestTicks,
      'risk_halt'
    );
    
    logs.push({
      level: 'error',
      source: 'risk',
      message: `Trading halted for day: Daily loss limit of ${config.riskConfig.maxDailyLossPercent}% reached`,
      createdAt: now
    });
    
    return {
      positions: [],
      trades: [...todayTrades, ...forceClosed],
      stats: calculateStats([], [...todayTrades, ...forceClosed], startingEquity),
      logs: [...logs, ...closeLogs],
      halted: true
    };
  }
  
  // Step 4: Check SL/TP exits
  const { remainingPositions, closedTrades: exitedTrades, logs: exitLogs } = checkExits(
    positions,
    latestTicks
  );
  positions = remainingPositions;
  const allTodayTrades = [...todayTrades, ...exitedTrades];
  logs.push(...exitLogs);
  
  // Step 5: Run enabled modes and collect proposed orders
  const allProposedOrders: ProposedOrder[] = [];
  
  // Build engine context
  stats = calculateStats(positions, allTodayTrades, startingEquity);
  const ctx: EngineContext = {
    userId,
    config,
    ticks: latestTicks,
    positions,
    recentTrades: allTodayTrades,
    stats,
    equity: stats.equity
  };
  
  // Run each enabled mode
  for (const mode of config.modeConfig.enabledModes) {
    // Skip burst if locked
    if (mode === 'burst' && shouldLockBurst(stats.burstPnlToday, config.burstConfig.dailyProfitTargetPercent)) {
      if (config.burstRequested) {
        logs.push({
          level: 'info',
          source: 'mode:burst',
          message: `Burst mode locked: Daily target of ${config.burstConfig.dailyProfitTargetPercent}% reached`,
          createdAt: now
        });
      }
      continue;
    }
    
    const runner = MODE_RUNNERS[mode];
    if (!runner) continue;
    
    try {
      const orders = runner(ctx);
      allProposedOrders.push(...orders);
    } catch (error) {
      logs.push({
        level: 'error',
        source: `mode:${mode}`,
        message: `Error running ${mode} mode: ${error}`,
        createdAt: now
      });
    }
  }
  
  // Step 6: Apply risk guardrails
  const { orders: allowedOrders, logs: riskLogs } = applyRiskGuardrails(
    allProposedOrders,
    positions,
    stats,
    config.riskConfig,
    stats.equity
  );
  logs.push(...riskLogs);
  
  // Step 7: Open new positions (paper trading)
  const newPositions: Position[] = allowedOrders.map(order => ({
    id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    userId,
    symbol: order.symbol,
    mode: order.mode,
    side: order.side,
    size: order.size,
    entryPrice: order.entryPrice,
    sl: order.sl,
    tp: order.tp,
    openedAt: now,
    unrealizedPnl: 0,
    batchId: order.batchId
  }));
  
  // Log new positions
  if (newPositions.length > 0) {
    const modeGroups = newPositions.reduce((acc, p) => {
      acc[p.mode] = (acc[p.mode] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    for (const [mode, count] of Object.entries(modeGroups)) {
      const symbols = [...new Set(newPositions.filter(p => p.mode === mode).map(p => p.symbol))];
      logs.push({
        level: 'info',
        source: `mode:${mode}`,
        message: `Opened ${count} ${mode} position(s) on ${symbols.join(', ')}`,
        meta: { count, symbols },
        createdAt: now
      });
    }
  }
  
  // Step 8: Combine positions and recalculate stats
  const finalPositions = [...positions, ...newPositions];
  const finalStats = calculateStats(finalPositions, allTodayTrades, startingEquity);
  
  return {
    positions: finalPositions,
    trades: allTodayTrades,
    stats: finalStats,
    logs,
    halted: false
  };
}

/**
 * Close all positions for a user (global close)
 */
export function globalClose(
  positions: Position[],
  ticks: Record<string, PriceTick>,
  recentTrades: ClosedTrade[],
  startingEquity: number
): EngineState {
  const { closedTrades, logs } = closePositions(positions, ticks, 'global_close');
  const allTrades = [...recentTrades, ...closedTrades];
  const stats = calculateStats([], allTrades, startingEquity);
  
  return {
    positions: [],
    trades: allTrades,
    stats,
    logs,
    halted: false
  };
}

/**
 * Close burst positions only (take burst profit)
 */
export function takeBurstProfit(
  positions: Position[],
  ticks: Record<string, PriceTick>,
  recentTrades: ClosedTrade[],
  startingEquity: number
): EngineState {
  const burstPositions = positions.filter(p => p.mode === 'burst');
  const otherPositions = positions.filter(p => p.mode !== 'burst');
  
  const { closedTrades, logs } = closePositions(burstPositions, ticks, 'take_burst_profit');
  const allTrades = [...recentTrades, ...closedTrades];
  const stats = calculateStats(otherPositions, allTrades, startingEquity);
  
  return {
    positions: otherPositions,
    trades: allTrades,
    stats,
    logs,
    halted: false
  };
}
