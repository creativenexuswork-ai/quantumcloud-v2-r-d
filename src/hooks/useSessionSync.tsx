import { useEffect } from 'react';
import { usePaperStats } from './usePaperTrading';
import { useSessionStore } from '@/lib/state/sessionMachine';

/**
 * Hook to sync session data from backend paper-stats polling.
 * IMPORTANT: This hook only syncs P&L, positions, and stats.
 * It does NOT auto-start the session or change status based on backend.
 * Status changes only happen via explicit user actions (activate/hold/closeAll).
 */
export function useSessionSync() {
  const { data: paperData } = usePaperStats();
  const dispatch = useSessionStore((state) => state.dispatch);

  useEffect(() => {
    if (!paperData) return;

    const { stats } = paperData;

    // Sync position data - this is purely informational
    if (stats) {
      const hasPositions = (stats.openPositionsCount || 0) > 0;
      const openCount = stats.openPositionsCount || 0;
      
      dispatch({ 
        type: 'SYNC_POSITIONS', 
        hasPositions, 
        openCount 
      });

      dispatch({
        type: 'SYNC_PNL',
        pnlToday: stats.todayPnl || 0,
        tradesToday: stats.tradesToday || 0,
        winRate: stats.winRate || 0,
        equity: stats.equity || 10000,
      });
    }

    // Sync halted state from backend
    if (paperData.halted !== undefined) {
      dispatch({ type: 'SET_HALTED', halted: paperData.halted });
    }

    // NOTE: We intentionally do NOT sync sessionStatus from backend here.
    // The frontend session status is controlled only by user actions.
    // This prevents auto-start behavior on page load.

  }, [paperData, dispatch]);

  return paperData;
}
