import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bell,
  Briefcase,
  Calendar,
  CheckCircle,
  CreditCard,
  FileText,
  History,
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Settings,
  Users,
} from 'lucide-react';

export type AdminNavItem = {
  deferred?: boolean;
  icon: LucideIcon;
  id: string;
  label: string;
  path: string;
  permission?: string;
  permissionsAny?: string[];
};

export const SETTINGS_ROUTE_PERMISSIONS = ['settings.view', 'settings.manage', 'rbac.manage'];
export const CLIENT_ROUTE_PERMISSIONS = ['client_account.view', 'client_account.view_assigned'];
export const MATTER_ROUTE_PERMISSIONS = ['matter.view', 'matter.view_assigned'];
export const DOCUMENT_ROUTE_PERMISSIONS = ['document.view', 'document.view_assigned'];
export const MESSAGE_ROUTE_PERMISSIONS = [
  'message.view',
  'message.send',
  'message.view_assigned',
  'message.send_assigned',
];
export const EVENT_ROUTE_PERMISSIONS = ['event.view', 'event.view_assigned'];

export const canViewNavItem = (permissionCodes: string[] | undefined, item: AdminNavItem) => {
  if (!item.permission && !item.permissionsAny?.length) {
    return true;
  }

  if (item.permission && permissionCodes?.includes(item.permission)) {
    return true;
  }

  return Boolean(item.permissionsAny?.some((permission) => permissionCodes?.includes(permission)));
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  { id: 'requests', label: 'Requests', path: '/requests', icon: Inbox, permission: 'matter.view' },
  { id: 'clients', label: 'Clients', path: '/clients', icon: Users, permissionsAny: CLIENT_ROUTE_PERMISSIONS },
  { id: 'matters', label: 'Matters Desk', path: '/matters', icon: Briefcase, permissionsAny: MATTER_ROUTE_PERMISSIONS },
  { id: 'meetings', label: 'Meetings', path: '/meetings', icon: Calendar, permissionsAny: EVENT_ROUTE_PERMISSIONS },
  { id: 'messages', label: 'Messages', path: '/messages', icon: MessageSquare, permissionsAny: MESSAGE_ROUTE_PERMISSIONS },
  { id: 'documents', label: 'Documents', path: '/documents', icon: FileText, permissionsAny: DOCUMENT_ROUTE_PERMISSIONS },
  { id: 'billing', label: 'Billing & Ledger', path: '/billing', icon: CreditCard, permission: 'invoice.view' },
  { id: 'notifications', label: 'Notifications', path: '/notifications', icon: Bell, permission: 'notification.view' },
  { id: 'tasks', label: 'Tasks & Ops', path: '/tasks', icon: CheckCircle, permission: 'dashboard.view' },
  { id: 'audit', label: 'Audit Log', path: '/audit', icon: History, permission: 'audit.view' },
  { id: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, permission: 'dashboard.view' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: Settings, permissionsAny: SETTINGS_ROUTE_PERMISSIONS },
];
