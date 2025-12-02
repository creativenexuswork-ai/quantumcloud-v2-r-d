import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { useModeConfigs, useToggleMode, MODE_DEFINITIONS, ModeKey } from '@/hooks/useModeConfigs';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { useState } from 'react';

export function ModesTab() {
  const { data: modeConfigs, isLoading } = useModeConfigs();
  const toggleMode = useToggleMode();

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading modes...</div>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {Object.entries(MODE_DEFINITIONS).map(([key, definition]) => {
        const config = modeConfigs?.find(c => c.mode_key === key);
        
        return (
          <ModeCard
            key={key}
            modeKey={key as ModeKey}
            definition={definition}
            config={config}
            onToggle={(enabled) => {
              if (config) {
                toggleMode.mutate({ id: config.id, enabled });
              }
            }}
          />
        );
      })}
    </div>
  );
}

interface ModeCardProps {
  modeKey: ModeKey;
  definition: typeof MODE_DEFINITIONS[ModeKey];
  config?: {
    id: string;
    enabled: boolean | null;
    risk_per_trade_pct: number | null;
    max_daily_loss_pct: number | null;
    max_daily_profit_pct: number | null;
  };
  onToggle: (enabled: boolean) => void;
}

function ModeCard({ modeKey, definition, config, onToggle }: ModeCardProps) {
  const [riskPct, setRiskPct] = useState(config?.risk_per_trade_pct || 1);

  return (
    <Card className="glass-card-hover">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{definition.icon}</span>
            <CardTitle className="text-base">{definition.name}</CardTitle>
          </div>
          <Switch
            checked={config?.enabled ?? false}
            onCheckedChange={onToggle}
          />
        </div>
        <Badge 
          variant="outline" 
          className={`w-fit text-xs ${
            definition.risk === 'Safe' ? 'border-success text-success' :
            definition.risk === 'Aggressive' ? 'border-destructive text-destructive' :
            'border-warning text-warning'
          }`}
        >
          {definition.risk}
        </Badge>
      </CardHeader>
      <CardContent>
        <CardDescription className="text-xs mb-4">
          {definition.description}
        </CardDescription>
        
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="w-full gap-2">
              <Settings2 className="h-4 w-4" />
              Configure
            </Button>
          </SheetTrigger>
          <SheetContent className="glass-card">
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span>{definition.icon}</span>
                {definition.name} Settings
              </SheetTitle>
            </SheetHeader>
            <div className="space-y-6 mt-6">
              <div className="space-y-2">
                <Label className="flex justify-between">
                  <span>Risk per Trade</span>
                  <span className="text-muted-foreground">{riskPct}%</span>
                </Label>
                <Slider
                  value={[riskPct]}
                  onValueChange={([v]) => setRiskPct(v)}
                  min={0.1}
                  max={5}
                  step={0.1}
                />
              </div>
              
              <div className="space-y-2">
                <Label className="flex justify-between">
                  <span>Max Daily Loss</span>
                  <span className="text-muted-foreground">{config?.max_daily_loss_pct || 5}%</span>
                </Label>
                <Slider
                  value={[config?.max_daily_loss_pct || 5]}
                  min={1}
                  max={10}
                  step={0.5}
                  disabled
                />
              </div>

              <div className="space-y-2">
                <Label className="flex justify-between">
                  <span>Max Daily Profit</span>
                  <span className="text-muted-foreground">{config?.max_daily_profit_pct || 10}%</span>
                </Label>
                <Slider
                  value={[config?.max_daily_profit_pct || 10]}
                  min={5}
                  max={20}
                  step={1}
                  disabled
                />
              </div>

              <Button className="w-full">Save Changes</Button>
            </div>
          </SheetContent>
        </Sheet>
      </CardContent>
    </Card>
  );
}
