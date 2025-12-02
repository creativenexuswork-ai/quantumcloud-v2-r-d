import { useState } from 'react';
import { Header } from '@/components/layout/Header';
import { TabNavigation } from '@/components/tabs/TabNavigation';
import { EquityCard } from '@/components/dashboard/EquityCard';
import { LiveStateCard } from '@/components/dashboard/LiveStateCard';
import { BurstControlCard } from '@/components/dashboard/BurstControlCard';
import { TradesTab } from '@/components/tabs/TradesTab';
import { ModesTab } from '@/components/tabs/ModesTab';
import { MarketsTab } from '@/components/tabs/MarketsTab';
import { SettingsTab } from '@/components/tabs/SettingsTab';
import { LogsTab } from '@/components/tabs/LogsTab';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <div className="min-h-screen bg-background">
      <Header />
      
      <main className="container mx-auto px-4 py-6 space-y-6">
        <TabNavigation activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'dashboard' && (
          <div className="space-y-6 animate-fade-in">
            {/* Row 1 - Main Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
              <EquityCard />
              <LiveStateCard />
              <BurstControlCard />
            </div>
          </div>
        )}

        {activeTab === 'trades' && (
          <div className="animate-fade-in">
            <TradesTab />
          </div>
        )}

        {activeTab === 'modes' && (
          <div className="animate-fade-in">
            <ModesTab />
          </div>
        )}

        {activeTab === 'markets' && (
          <div className="animate-fade-in">
            <MarketsTab />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="animate-fade-in">
            <SettingsTab />
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="animate-fade-in">
            <LogsTab />
          </div>
        )}
      </main>
    </div>
  );
}
