import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { RouteGuard } from '@/components/layout/RouteGuard';
import { ROUTES } from '@/constants/routes';

import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import DashboardPage from '@/pages/DashboardPage';
import ScriptsTemplatesPage from '@/pages/ScriptsTemplatesPage';
import ReportCreatePage from '@/pages/ReportCreatePage';
import ReportsPage from '@/pages/ReportsPage';
import AssistantPage from '@/pages/AssistantPage';
import UsersPage from '@/pages/UsersPage';
import ConversationsPage from '@/pages/ConversationsPage';
import SettingsPage from '@/pages/SettingsPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path={ROUTES.LOGIN} element={<LoginPage />} />
      <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
      <Route element={<AppLayout />}>
        <Route path={ROUTES.DASHBOARD} element={<RouteGuard requiredFeature="dashboard"><DashboardPage /></RouteGuard>} />
        <Route path={ROUTES.SCRIPTS} element={<RouteGuard requiredFeature="scripts"><ScriptsTemplatesPage /></RouteGuard>} />
        <Route path={ROUTES.REPORT_CREATE} element={<RouteGuard requiredFeature="reportCreate"><ReportCreatePage /></RouteGuard>} />
        <Route path={ROUTES.REPORTS} element={<RouteGuard requiredFeature="reports"><ReportsPage /></RouteGuard>} />
        <Route path={ROUTES.ASSISTANT} element={<RouteGuard requiredFeature="assistant"><AssistantPage /></RouteGuard>} />
        <Route path={ROUTES.USERS} element={<RouteGuard requiredFeature="users"><UsersPage /></RouteGuard>} />
        <Route path={ROUTES.CONVERSATIONS} element={<RouteGuard requiredFeature="conversations"><ConversationsPage /></RouteGuard>} />
        <Route path={ROUTES.SETTINGS} element={<RouteGuard requiredFeature="settings"><SettingsPage /></RouteGuard>} />
        <Route path="*" element={<Navigate to={ROUTES.DASHBOARD} replace />} />
      </Route>
    </Routes>
  );
}
