import { useEffect, useRef } from 'react';
import { usePaperStats } from './usePaperTrading';
import { useSessionStore } from '@/lib/state/sessionMachine';

/**
 * Hook to sync session data from backend paper-stats polling.
 * Syncs P&L, positions, stats only.
 * TODO: Re-enable halted and session status sync after testing.
 */
export function useSessionSync() {
  const { data: paperData, refetch } = usePaperStats();
  const dispatch = useSessionStore((state) => state.dispatch);
  const currentStatus = useSessionStore((state) => state.status);
  const lastStatusRef = useRef(currentStatus);

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

    // TODO: Re-enable halted sync after testing
    // TEMPORARY: Never set halted state from backend
    // if (paperData.halted !== undefined) {
    //   dispatch({ type: 'SET_HALTED', halted: paperData.halted });
    // }

    // TODO: Re-enable session status sync after testing
    // TEMPORARY: Never force session to idle from backend sync
    // const backendStatus = paperData.sessionStatus;
    // if (backendStatus === 'idle' || backendStatus === 'stopped') {
    //   if (currentStatus === 'running' || currentStatus === 'holding') {
    //     console.log(`[SessionSync] Backend says ${backendStatus}, syncing from ${currentStatus}`);
    //     dispatch({ type: 'SYNC_STATUS', status: backendStatus });
    //   }
    // }

    lastStatusRef.current = currentStatus;
  }, [paperData, dispatch, currentStatus]);

  return { paperData, refetch };
}
