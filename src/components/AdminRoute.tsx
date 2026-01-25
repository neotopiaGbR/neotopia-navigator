import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface AdminRouteProps {
  children: React.ReactNode;
}

const AdminRoute: React.FC<AdminRouteProps> = ({ children }) => {
  const { user, loading, profileLoading, profileStatus, isAdmin } = useAuth();

  // Wait for auth loading
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 text-4xl font-bold text-accent">N</div>
          <p className="text-muted-foreground">Laden...</p>
        </div>
      </div>
    );
  }

  // Not logged in - redirect to login
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Wait for profile to load before checking admin status
  // This prevents false redirects when profile hasn't loaded yet
  if (profileLoading || profileStatus === 'idle') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <div className="mb-4 text-4xl font-bold text-accent">N</div>
          <p className="text-muted-foreground">Berechtigungen prüfen...</p>
        </div>
      </div>
    );
  }

  // Profile loaded but not admin - redirect to dashboard
  if (!isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};

export default AdminRoute;
