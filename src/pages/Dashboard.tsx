import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { RegionProvider } from '@/contexts/RegionContext';
import { MapLayersProvider } from '@/components/map/MapLayersContext';
import { Button } from '@/components/ui/button';
import { Shield, LogOut } from 'lucide-react';
import RegionMap from '@/components/map/RegionMap';
import RegionSidebar from '@/components/map/RegionSidebar';
import neotopiaLogo from '@/assets/neotopia-logo.svg';

const DashboardContent = () => {
  const navigate = useNavigate();
  const { user, signOut, isAdmin } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <img src={neotopiaLogo} alt="Neotopia" className="h-6 w-auto" />
          <span className="text-lg font-bold text-foreground">navigator</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {user?.email}
          </span>
          {isAdmin && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/admin')}
              className="text-accent hover:bg-accent/10"
            >
              <Shield className="mr-1 h-4 w-4" />
              Admin
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        <RegionSidebar />
        <main className="flex-1">
          <RegionMap />
        </main>
      </div>
    </div>
  );
};

const Dashboard = () => {
  return (
    <RegionProvider>
      <MapLayersProvider>
        <DashboardContent />
      </MapLayersProvider>
    </RegionProvider>
  );
};

export default Dashboard;
