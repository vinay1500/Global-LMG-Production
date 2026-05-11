import React, { Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AccessDeniedPage } from './features/auth/AccessDeniedPage';
import { LoginPage } from './features/auth/LoginPage';
import { PasswordRotationPage } from './features/auth/PasswordRotationPage';
import { NotFoundPage } from './features/system/NotFoundPage';
import { AdminLayout } from './layout/AdminLayout';
import {
  CLIENT_ROUTE_PERMISSIONS,
  DOCUMENT_ROUTE_PERMISSIONS,
  EVENT_ROUTE_PERMISSIONS,
  MATTER_ROUTE_PERMISSIONS,
  MESSAGE_ROUTE_PERMISSIONS,
  SETTINGS_ROUTE_PERMISSIONS,
} from './config/navigation';
import { RequireAdminAuth } from './routes/RequireAdminAuth';
import { RequirePermission } from './routes/RequirePermission';

const AdminAccountPage = React.lazy(() =>
  import('./features/account/AdminAccountPage').then((module) => ({ default: module.AdminAccountPage }))
);
const AuditPage = React.lazy(() =>
  import('./features/audit/AuditPage').then((module) => ({ default: module.AuditPage }))
);
const BillingPage = React.lazy(() =>
  import('./features/billing/BillingPage').then((module) => ({ default: module.BillingPage }))
);
const ClientDetailPage = React.lazy(() =>
  import('./features/clients/ClientDetailPage').then((module) => ({ default: module.ClientDetailPage }))
);
const ClientsPage = React.lazy(() =>
  import('./features/clients/ClientsPage').then((module) => ({ default: module.ClientsPage }))
);
const DashboardPage = React.lazy(() =>
  import('./features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage }))
);
const DocumentsPage = React.lazy(() =>
  import('./features/documents/DocumentsPage').then((module) => ({ default: module.DocumentsPage }))
);
const MatterDetailPage = React.lazy(() =>
  import('./features/matters/MatterDetailPage').then((module) => ({ default: module.MatterDetailPage }))
);
const MattersPage = React.lazy(() =>
  import('./features/matters/MattersPage').then((module) => ({ default: module.MattersPage }))
);
const MessagesPage = React.lazy(() =>
  import('./features/messages/MessagesPage').then((module) => ({ default: module.MessagesPage }))
);
const MeetingsPage = React.lazy(() =>
  import('./features/meetings/MeetingsPage').then((module) => ({ default: module.MeetingsPage }))
);
const NotificationsPage = React.lazy(() =>
  import('./features/notifications/NotificationsPage').then((module) => ({ default: module.NotificationsPage }))
);
const ReportsPage = React.lazy(() =>
  import('./features/reports/ReportsPage').then((module) => ({ default: module.ReportsPage }))
);
const RequestsPage = React.lazy(() =>
  import('./features/requests/RequestsPage').then((module) => ({ default: module.RequestsPage }))
);
const SettingsPage = React.lazy(() =>
  import('./features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage }))
);
const TasksPage = React.lazy(() =>
  import('./features/tasks/TasksPage').then((module) => ({ default: module.TasksPage }))
);

const RouteFallback = () => (
  <div className="flex min-h-[320px] items-center justify-center text-sm text-gray-500">
    Loading workspace...
  </div>
);

export const AdminRoutes = () => {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/change-password" element={<PasswordRotationPage />} />
        <Route path="/forbidden" element={<AccessDeniedPage />} />

        <Route element={<RequireAdminAuth />}>
          <Route element={<AdminLayout />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route element={<RequirePermission permission="dashboard.view" />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/reports" element={<ReportsPage />} />
              <Route path="/tasks" element={<TasksPage />} />
            </Route>
            <Route element={<RequirePermission anyOf={SETTINGS_ROUTE_PERMISSIONS} />}>
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route element={<RequirePermission anyOf={CLIENT_ROUTE_PERMISSIONS} />}>
              <Route path="/clients" element={<ClientsPage />} />
              <Route path="/clients/:clientId" element={<ClientDetailPage />} />
            </Route>
            <Route element={<RequirePermission anyOf={MATTER_ROUTE_PERMISSIONS} />}>
              <Route path="/matters" element={<MattersPage />} />
              <Route path="/matters/:matterId" element={<MatterDetailPage />} />
            </Route>
            <Route element={<RequirePermission permission="matter.view" />}>
              <Route path="/requests" element={<RequestsPage />} />
            </Route>
            <Route element={<RequirePermission permission="notification.view" />}>
              <Route path="/notifications" element={<NotificationsPage />} />
            </Route>
            <Route element={<RequirePermission permission="audit.view" />}>
              <Route path="/audit" element={<AuditPage />} />
            </Route>
            <Route element={<RequirePermission anyOf={MESSAGE_ROUTE_PERMISSIONS} />}>
              <Route path="/messages" element={<MessagesPage />} />
            </Route>
            <Route element={<RequirePermission anyOf={DOCUMENT_ROUTE_PERMISSIONS} />}>
              <Route path="/documents" element={<DocumentsPage />} />
            </Route>
            <Route element={<RequirePermission anyOf={EVENT_ROUTE_PERMISSIONS} />}>
              <Route path="/meetings" element={<MeetingsPage />} />
            </Route>
            <Route element={<RequirePermission permission="invoice.view" />}>
              <Route path="/billing" element={<BillingPage />} />
            </Route>
            <Route path="/account" element={<AdminAccountPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
};
