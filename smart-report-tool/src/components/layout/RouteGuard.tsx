import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { canAccess } from '@/utils/permissions';
import { ROUTES } from '@/constants/routes';
import type { FeatureKey } from '@/types';

interface RouteGuardProps {
  children: React.ReactNode;
  requiredFeature?: FeatureKey;
}

export function RouteGuard({ children, requiredFeature }: RouteGuardProps) {
  const { user, isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  }

  if (requiredFeature && !canAccess(user?.role, requiredFeature)) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return <>{children}</>;
}
