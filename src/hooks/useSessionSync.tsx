import { useEffect } from 'react';
import { usePaperStats } from './usePaperTrading';
import { useSessionMachine } from '@/lib/state/sessionMachine';

/**
 * Hook to sync session state from backend paper-stats polling
 * Should be used once at a high level (Dashboard or App)
 */
export function useSessionSync() {
  const { data: paperData } = usePaperStats();
  const { syncFromBackend, setPositionsSummary, setPnL } = useSessionMachine();

  useEffect(() => {
    if (!paperData) return;

    const { stats, config, sessionStatus, halted } = paperData;

    // Sync core session state
    syncFromBackend({
      sessionStatus,
      halted,
    });

    // Sync position data
    if (stats) {
      setPositionsSummary({
        hasPositions: (stats.openPositionsCount || 0) > 0,
        openCount: stats.openPositionsCount || 0,
      });

      setPnL({
        pnlToday: stats.todayPnl || 0,
        equity: stats.equity || 10000,
        tradesToday: stats.tradesToday || 0,
        winRate: stats.winRate || 0,
      });
    }
  }, [paperData, syncFromBackend, setPositionsSummary, setPnL]);

  return paperData;
}
