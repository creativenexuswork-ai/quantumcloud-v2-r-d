import { ChevronDown, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuth } from '@/hooks/useAuth';
import { useAccounts, useSetActiveAccount } from '@/hooks/useAccounts';
import { StatusPill } from '@/components/ui/StatusPill';
import { useSession } from '@/lib/state/session';

export function Header() {
  const { user, signOut } = useAuth();
  const { data: accounts } = useAccounts();
  const setActiveAccount = useSetActiveAccount();
  const { accountType, setAccountType, isRunning } = useSession();
  
  const activeAccount = accounts?.find(a => a.is_active);
  const equity = activeAccount?.equity || 0;

  const handleAccountChange = (accountId: string) => {
    setActiveAccount.mutate(accountId);
  };

  const handleAccountTypeChange = (type: 'paper' | 'live') => {
    setAccountType(type);
  };

  // Derive status from global state
  const status = isRunning ? 'scanning' : 'idle';

  return (
    <header className="glass-card border-b border-border/30 px-6 py-4">
      <div className="flex items-center justify-between">
        {/* Left - Branding */}
        <div className="flex flex-col">
          <h1 className="text-xl font-bold text-card-foreground">
            QuantumCloud <span className="text-primary">V2</span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Personal AI-powered multi-mode trading console
          </p>
        </div>

        {/* Center - Account Selector */}
        <div className="flex items-center gap-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 bg-card border-border/50">
                <span className="font-medium">{activeAccount?.name || 'Select Account'}</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-48">
              {accounts?.map(account => (
                <DropdownMenuItem
                  key={account.id}
                  onClick={() => handleAccountChange(account.id)}
                  className="flex items-center justify-between"
                >
                  <span>{account.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    account.type === 'paper' 
                      ? 'bg-warning/20 text-warning' 
                      : 'bg-success/20 text-success'
                  }`}>
                    {account.type}
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="flex gap-2">
            <Button
              variant={accountType === 'paper' ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => handleAccountTypeChange('paper')}
            >
              Paper Trading
            </Button>
            <Button
              variant={accountType === 'live' ? 'default' : 'outline'}
              size="sm"
              className="text-xs"
              onClick={() => handleAccountTypeChange('live')}
            >
              Live Trading
            </Button>
          </div>
        </div>

        {/* Right - Stats & User */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="metric-label">Equity</p>
            <p className="metric-value text-card-foreground">
              ${equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
          </div>

          <div className="text-right">
            <p className="metric-label">Today P&L</p>
            <p className="metric-value profit-text">+0.00%</p>
          </div>

          {/* Paper Trading indicator pill */}
          {accountType === 'paper' && (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-primary/20 text-primary">
              Paper Trading
            </span>
          )}

          <StatusPill status={status} />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full">
                <User className="h-5 w-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
    </header>
  );
}
