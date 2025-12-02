import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUserSettings, useUpdateUserSettings } from '@/hooks/useUserSettings';
import { useState, useEffect } from 'react';
import { toast } from '@/hooks/use-toast';

export function SettingsTab() {
  const { data: settings, isLoading } = useUserSettings();
  const updateSettings = useUpdateUserSettings();

  const [formData, setFormData] = useState({
    maxDailyLoss: 5,
    maxConcurrentRisk: 10,
    burstSize: 20,
    burstDailyTarget: 8,
    useAiReasoning: true,
    showAdvanced: false,
    useNewsApi: false,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        maxDailyLoss: settings.max_daily_loss_pct || 5,
        maxConcurrentRisk: settings.max_concurrent_risk_pct || 10,
        burstSize: settings.burst_size || 20,
        burstDailyTarget: settings.burst_daily_target_pct || 8,
        useAiReasoning: settings.use_ai_reasoning ?? true,
        showAdvanced: settings.show_advanced_explanations ?? false,
        useNewsApi: settings.use_news_api ?? false,
      });
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        max_daily_loss_pct: formData.maxDailyLoss,
        max_concurrent_risk_pct: formData.maxConcurrentRisk,
        burst_size: formData.burstSize,
        burst_daily_target_pct: formData.burstDailyTarget,
        use_ai_reasoning: formData.useAiReasoning,
        show_advanced_explanations: formData.showAdvanced,
        use_news_api: formData.useNewsApi,
      });
      toast({
        title: 'Settings Saved',
        description: 'Your settings have been updated.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save settings.',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading settings...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Global Risk Settings */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Global Risk Settings</CardTitle>
          <CardDescription>Configure account-wide risk parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>Max Daily Loss</span>
              <span className="text-muted-foreground">{formData.maxDailyLoss}%</span>
            </Label>
            <Slider
              value={[formData.maxDailyLoss]}
              onValueChange={([v]) => setFormData(p => ({ ...p, maxDailyLoss: v }))}
              min={1}
              max={10}
              step={0.5}
            />
            <p className="text-xs text-muted-foreground">
              Trading stops when daily losses reach this threshold
            </p>
          </div>

          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>Max Concurrent Risk</span>
              <span className="text-muted-foreground">{formData.maxConcurrentRisk}%</span>
            </Label>
            <Slider
              value={[formData.maxConcurrentRisk]}
              onValueChange={([v]) => setFormData(p => ({ ...p, maxConcurrentRisk: v }))}
              min={5}
              max={25}
              step={1}
            />
            <p className="text-xs text-muted-foreground">
              Maximum total risk across all open positions
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Burst Settings */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Burst Mode Settings</CardTitle>
          <CardDescription>Configure burst trading parameters</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>Burst Size</span>
              <span className="text-muted-foreground">{formData.burstSize} positions</span>
            </Label>
            <Slider
              value={[formData.burstSize]}
              onValueChange={([v]) => setFormData(p => ({ ...p, burstSize: v }))}
              min={5}
              max={50}
              step={5}
            />
            <p className="text-xs text-muted-foreground">
              Number of micro-positions per burst batch
            </p>
          </div>

          <div className="space-y-2">
            <Label className="flex justify-between">
              <span>Daily Profit Target</span>
              <span className="text-muted-foreground">{formData.burstDailyTarget}%</span>
            </Label>
            <Slider
              value={[formData.burstDailyTarget]}
              onValueChange={([v]) => setFormData(p => ({ ...p, burstDailyTarget: v }))}
              min={3}
              max={15}
              step={1}
            />
            <p className="text-xs text-muted-foreground">
              Burst mode locks after reaching this daily target
            </p>
          </div>
        </CardContent>
      </Card>

      {/* AI Settings */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>AI Settings</CardTitle>
          <CardDescription>Configure AI reasoning and explanations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label>Use AI Reasoning</Label>
              <p className="text-xs text-muted-foreground">
                Enable AI-powered trade decisions
              </p>
            </div>
            <Switch
              checked={formData.useAiReasoning}
              onCheckedChange={(v) => setFormData(p => ({ ...p, useAiReasoning: v }))}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Show Advanced Explanations</Label>
              <p className="text-xs text-muted-foreground">
                Display detailed AI reasoning for trades
              </p>
            </div>
            <Switch
              checked={formData.showAdvanced}
              onCheckedChange={(v) => setFormData(p => ({ ...p, showAdvanced: v }))}
            />
          </div>
        </CardContent>
      </Card>

      {/* API Settings */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>API & Integrations</CardTitle>
          <CardDescription>Configure external connections</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>Broker API Base URL</Label>
            <Input placeholder="https://api.broker.com/v1" disabled />
            <p className="text-xs text-muted-foreground">
              Configure in account settings for live trading
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Use News API</Label>
              <p className="text-xs text-muted-foreground">
                Enable external news sentiment analysis
              </p>
            </div>
            <Switch
              checked={formData.useNewsApi}
              onCheckedChange={(v) => setFormData(p => ({ ...p, useNewsApi: v }))}
            />
          </div>
        </CardContent>
      </Card>

      <div className="md:col-span-2">
        <Button onClick={handleSave} className="w-full" size="lg">
          Save All Settings
        </Button>
      </div>
    </div>
  );
}
