import { useEffect, useRef } from 'react';
import { usePaperStats } from './usePaperTrading';
import { useSessionStore } from '@/lib/state/sessionMachine';

/**
 * Hook to sync session data from backend paper-stats polling.
 * Syncs P&L, positions, halted state, and session status.
 */
export function useSessionSync() {
  const { data: paperData, refetch } = usePaperStats();
  const dispatch = useSessionStore((state) => state.dispatch);
  const currentStatus = useSessionStore((state) => state.status);
  const lastStatusRef = useRef(currentStatus);

  useEffect(() => {
    if (!paperData) return;

    const { stats } = paperData;

    // Sync position data
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

    // Soft-mode: keep halted in state for analytics only
    // UI remains active regardless of halted
    if (paperData.halted !== undefined) {
      dispatch({ type: 'SET_HALTED', halted: paperData.halted });
    }
    // Note: halted is tracked but not enforced in soft-mode

    // Sync session status from backend (for terminal states)
    const backendStatus = paperData.sessionStatus;
    if (backendStatus === 'idle' || backendStatus === 'stopped') {
      if (currentStatus === 'running' || currentStatus === 'holding') {
        console.log(`[SessionSync] Backend says ${backendStatus}, syncing from ${currentStatus}`);
        dispatch({ type: 'SYNC_STATUS', status: backendStatus });
      }
    }

    lastStatusRef.current = currentStatus;
  }, [paperData, dispatch, currentStatus]);

  return { paperData, refetch };
}
