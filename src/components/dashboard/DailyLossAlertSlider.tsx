import { useState, useEffect } from 'react';
import { Slider } from '@/components/ui/slider';
import { supabase } from '@/integrations/supabase/client';
import { usePaperStats } from '@/hooks/usePaperTrading';
import { toast } from '@/hooks/use-toast';

/**
 * Daily Loss Alert Slider - Config only, NO enforcement.
 * This value is for analytics and future alerts only.
 * It does NOT stop trading.
 */
export function DailyLossAlertSlider() {
  const { data: paperData } = usePaperStats();
  const [value, setValue] = useState(5);
  const [isSaving, setIsSaving] = useState(false);

  // Sync value from config
  useEffect(() => {
    if (paperData?.config?.daily_loss_limit_pct) {
      setValue(paperData.config.daily_loss_limit_pct);
    }
  }, [paperData?.config?.daily_loss_limit_pct]);

  const handleChange = async (newValue: number[]) => {
    const v = newValue[0];
    setValue(v);
  };

  const handleCommit = async (newValue: number[]) => {
    const v = newValue[0];
    setIsSaving(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from('paper_config')
        .update({ daily_loss_limit_pct: v })
        .eq('user_id', user.id);

      toast({
        title: 'Daily Loss Alert Updated',
        description: `Alert threshold set to ${v}%`,
      });
    } catch (error) {
      console.error('Failed to save daily loss limit:', error);
      toast({
        title: 'Error',
        description: 'Failed to save setting',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">
          Daily loss alert (%)
        </label>
        <span className="text-sm font-mono text-muted-foreground">
          {value}%
        </span>
      </div>
      
      <Slider
        value={[value]}
        onValueChange={handleChange}
        onValueCommit={handleCommit}
        min={1}
        max={30}
        step={1}
        disabled={isSaving}
        className="w-full"
      />
      
      <p className="text-xs text-muted-foreground">
        Used for analytics and future alerts. Does NOT stop trading.
      </p>
    </div>
  );
}
