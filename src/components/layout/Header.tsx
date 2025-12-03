import { Zap, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useFullSessionState } from '@/hooks/useSessionState';
import { toast } from '@/hooks/use-toast';

export function Header() {
  const { user, signOut } = useAuth();
  const { 
    accountType, 
    setAccountType, 
    status, 
    selectedMode,
  } = useFullSessionState();

  const handleLiveClick = () => {
    if (accountType === 'live') return;
    toast({
      title: 'Live Trading Not Connected',
      description: 'Configure your broker in the Live Trading panel to enable live trading.',
    });
  };

  const handlePaperClick = () => {
    setAccountType('paper');
  };

  const getStatusColor = () => {
    switch (status) {
      case 'running': return 'status-running';
      case 'holding': return 'status-paused';
      case 'stopped': return 'status-idle';
      default: return 'status-idle';
    }
  };

  const formatModeName = (mode: string) => {
    return mode.charAt(0).toUpperCase() + mode.slice(1).replace('-', ' ');
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-4">
        <div className="flex h-14 items-center justify-between">
          {/* Left - Brand */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Zap className="h-6 w-6 text-primary" />
              <div className="absolute inset-0 blur-lg bg-primary/30" />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold text-foreground">QuantumCloud</span>
              <span className="text-lg font-bold text-gradient">V2</span>
            </div>
          </div>

          {/* Center - Account & Mode Summary */}
          <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground">
            <span>Account:</span>
            <span className="font-medium text-foreground">
              {accountType === 'paper' ? 'PAPER' : 'LIVE'}
            </span>
            <span className="text-border">•</span>
            <span>Mode:</span>
            <span className="font-medium text-foreground">
              {formatModeName(selectedMode)}
            </span>
          </div>

          {/* Right - Account Pills, Status & User */}
          <div className="flex items-center gap-3">
            {/* Account Type Pills */}
            <div className="flex items-center gap-1 p-1 rounded-full bg-muted/30">
              <button
                onClick={handlePaperClick}
                className={accountType === 'paper' ? 'pill-active' : 'pill-inactive'}
              >
                Paper
              </button>
              <button
                onClick={handleLiveClick}
                className={accountType === 'live' ? 'pill-active' : 'pill-inactive'}
              >
                Live
              </button>
            </div>

            {/* Status Pill */}
            <div className={`status-pill ${getStatusColor()}`}>
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </div>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full">
                  <User className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border">
                <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                  {user?.email}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => signOut()} className="text-destructive">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
