import { create } from 'zustand';
import { useSession, AccountType } from '@/lib/state/session';
import { usePaperStats } from './usePaperTrading';

/**
 * Extended Session State Hook
 * 
 * Combines the base session state with trading-specific state like:
 * - Mode selection and configuration
 * - Risk settings
 * - Session performance metrics
 * 
 * ARCHITECTURE NOTE:
 * This extends useSession from lib/state/session.ts to add mode-specific state.
 * The base session state (accountType, isRunning, selectedSymbol) remains in the original store.
 */

export type TradingMode = 
  | 'burst' 
  | 'scalper' 
  | 'trend' 
  | 'swing' 
  | 'memory' 
  | 'sniper' 
  | 'risk-off' 
  | 'ai-assist';

export type SessionStatus = 'idle' | 'running' | 'paused' | 'error';

export interface RiskSettings {
  maxDailyDrawdown: number;
  maxPerTradeRisk: number;
  positionSizingMode: 'fixed' | 'percent' | 'volatility';
  dailyProfitTarget: number;
}

export interface ModeConfig {
  // Burst/Scalper specific
  burstTradesPerRun: number;
  maxConcurrentPositions: number;
  burstDuration: 'short' | 'medium' | 'long';
  burstTpStyle: 'fast' | 'scaled';
  
  // Trend/Swing specific
  trendTimeframe: 'intraday' | 'daily' | 'weekly';
  signalSensitivity: 'low' | 'medium' | 'high';
  
  // Memory/AI specific
  lookbackWindow: number;
  confidenceThreshold: number;
}

interface TradingState {
  // Mode state
  selectedMode: TradingMode;
  enabledModes: TradingMode[];
  
  // Risk settings
  riskSettings: RiskSettings;
  
  // Mode configuration
  modeConfig: ModeConfig;
  
  // Actions
  setSelectedMode: (mode: TradingMode) => void;
  toggleMode: (mode: TradingMode) => void;
  updateRiskSettings: (settings: Partial<RiskSettings>) => void;
  updateModeConfig: (config: Partial<ModeConfig>) => void;
}

export const useTradingState = create<TradingState>((set) => ({
  selectedMode: 'burst',
  enabledModes: ['burst', 'trend'],
  
  riskSettings: {
    maxDailyDrawdown: 5,
    maxPerTradeRisk: 1,
    positionSizingMode: 'percent',
    dailyProfitTarget: 8,
  },
  
  modeConfig: {
    burstTradesPerRun: 20,
    maxConcurrentPositions: 5,
    burstDuration: 'short',
    burstTpStyle: 'fast',
    trendTimeframe: 'intraday',
    signalSensitivity: 'medium',
    lookbackWindow: 50,
    confidenceThreshold: 0.7,
  },
  
  setSelectedMode: (mode) => set({ selectedMode: mode }),
  
  toggleMode: (mode) => set((state) => ({
    enabledModes: state.enabledModes.includes(mode)
      ? state.enabledModes.filter(m => m !== mode)
      : [...state.enabledModes, mode]
  })),
  
  updateRiskSettings: (settings) => set((state) => ({
    riskSettings: { ...state.riskSettings, ...settings }
  })),
  
  updateModeConfig: (config) => set((state) => ({
    modeConfig: { ...state.modeConfig, ...config }
  })),
}));

// Combined hook for full session state
export function useFullSessionState() {
  const { accountType, isRunning, selectedSymbol, setAccountType, setRunning, setSymbol } = useSession();
  const tradingState = useTradingState();
  const { data: paperData } = usePaperStats();
  
  // Derive session status
  const status: SessionStatus = isRunning ? 'running' : 'idle';
  
  // Get performance from paper stats
  const todayPnl = paperData?.stats?.todayPnl || 0;
  const todayPnlPercent = paperData?.stats?.todayPnlPercent || 0;
  const tradesToday = paperData?.stats?.tradesToday || 0;
  const winRate = paperData?.stats?.winRate || 0;
  const equity = paperData?.stats?.equity || 10000;
  
  return {
    // Account state
    accountType,
    setAccountType,
    
    // Session state
    isRunning,
    setRunning,
    status,
    
    // Symbol state
    selectedSymbol,
    setSymbol,
    
    // Mode state
    selectedMode: tradingState.selectedMode,
    enabledModes: tradingState.enabledModes,
    setSelectedMode: tradingState.setSelectedMode,
    toggleMode: tradingState.toggleMode,
    
    // Risk settings
    riskSettings: tradingState.riskSettings,
    updateRiskSettings: tradingState.updateRiskSettings,
    
    // Mode config
    modeConfig: tradingState.modeConfig,
    updateModeConfig: tradingState.updateModeConfig,
    
    // Performance metrics
    equity,
    todayPnl,
    todayPnlPercent,
    tradesToday,
    winRate,
  };
}

// Mode descriptions
export const MODE_INFO: Record<TradingMode, { name: string; description: string }> = {
  burst: {
    name: 'Burst Mode',
    description: 'Execute rapid clusters of micro-trades targeting quick profits. Best for high-volatility periods.',
  },
  scalper: {
    name: 'Scalper Mode', 
    description: 'Capture small price movements with tight stops. Requires fast execution and low spreads.',
  },
  trend: {
    name: 'Trend Mode',
    description: 'Follow established market trends with dynamic position sizing. Rides momentum for larger gains.',
  },
  swing: {
    name: 'Swing Mode',
    description: 'Capture multi-day price swings using higher timeframes. Lower frequency, larger targets.',
  },
  memory: {
    name: 'Memory Mode',
    description: 'Adapts risk and sizing based on recent performance. Increases exposure after wins, reduces after losses.',
  },
  sniper: {
    name: 'Sniper Mode',
    description: 'Waits for high-confidence setups only. Low frequency but high precision entries.',
  },
  'risk-off': {
    name: 'Risk-Off Mode',
    description: 'Reduces all risk parameters significantly. Use during uncertain market conditions.',
  },
  'ai-assist': {
    name: 'AI-Assist Mode',
    description: 'Leverages AI analysis for trade decisions. Combines multiple signals for enhanced accuracy.',
  },
};
