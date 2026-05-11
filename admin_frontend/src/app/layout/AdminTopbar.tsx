import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  Briefcase,
  Calendar,
  ChevronDown,
  CreditCard,
  FileUp,
  KeyRound,
  LogOut,
  Menu,
  MessageSquare,
  Plus,
  Scale,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  UserCircle,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router';
import type { AdminSessionUser } from '../lib/api/contracts';
import {
  DOCUMENT_ROUTE_PERMISSIONS,
  EVENT_ROUTE_PERMISSIONS,
  MESSAGE_ROUTE_PERMISSIONS,
  SETTINGS_ROUTE_PERMISSIONS,
} from '../config/navigation';

type AdminTopbarProps = {
  currentUser: AdminSessionUser | null;
  onOpenSearch: () => void;
  onSignOut: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
};

export const AdminTopbar: React.FC<AdminTopbarProps> = ({
  currentUser,
  onOpenSearch,
  onSignOut,
  onToggleSidebar,
  sidebarOpen,
}) => {
  const navigate = useNavigate();
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const accountMenuRef = useRef<HTMLDivElement | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const initials = currentUser?.displayName?.slice(0, 1)?.toUpperCase() || 'A';
  const hasPermission = (permission: string) => Boolean(currentUser?.permissionCodes.includes(permission));
  const hasAnyPermission = (permissions: string[]) =>
    permissions.some((permission) => currentUser?.permissionCodes.includes(permission));

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (actionsMenuRef.current && !actionsMenuRef.current.contains(target)) {
        setActionsOpen(false);
      }

      if (accountMenuRef.current && !accountMenuRef.current.contains(target)) {
        setAccountOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const navigateAndClose = (path: string) => {
    navigate(path);
    setActionsOpen(false);
    setAccountOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 bg-[#F4F1EA] border-b border-[#E6E4DD] h-16 flex items-center justify-between px-4 sm:px-6 shadow-sm">
      <div className="flex min-w-0 items-center gap-4">
        <button
          className="lg:hidden p-2 -ml-2 text-[#8C8981] hover:text-[#2C2B29] hover:bg-[#E6E4DD] rounded-lg transition"
          onClick={onToggleSidebar}
          type="button"
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-8 h-8 bg-[#2C2B29] rounded flex items-center justify-center shadow-sm">
            <Scale className="w-4.5 h-4.5 text-[#C19A5B]" />
          </div>
          <span
            className="truncate text-xl font-bold tracking-tight text-[#2C2B29]"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            LegalConnect
          </span>
          <span className="hidden sm:inline-block ml-2 px-2 py-0.5 bg-[#E6E4DD] text-[#4A4946] text-[10px] font-bold uppercase tracking-widest rounded">
            Admin
          </span>
        </div>
      </div>

      <div className="mx-8 hidden min-w-0 max-w-xl flex-1 lg:block">
        <button className="relative w-full flex items-center text-left" onClick={onOpenSearch} type="button">
          <Search className="w-4 h-4 text-[#8C8981] absolute left-3 top-1/2 -translate-y-1/2" />
          <div className="pl-9 pr-4 py-2 text-sm bg-white border border-[#E6E4DD] rounded-lg w-full text-[#A8A69F] hover:border-[#C19A5B] transition-colors cursor-text shadow-sm">
            Global search clients, matters, documents...
          </div>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            <span className="text-[10px] text-[#A8A69F] border border-[#E6E4DD] rounded px-1.5 py-0.5 bg-[#FCFBF8]">
              ⌘K
            </span>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-3 sm:gap-5">
        <button
          className="md:hidden p-2 text-[#8C8981] hover:text-[#2C2B29] hover:bg-[#E6E4DD] rounded-full transition"
          onClick={onOpenSearch}
          type="button"
        >
          <Search className="w-5 h-5" />
        </button>
        <div className="relative hidden lg:block" ref={actionsMenuRef}>
          <button
            aria-expanded={actionsOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-[#2C2B29] bg-white border border-[#E6E4DD] rounded-lg hover:bg-[#FCFBF8] transition shadow-sm"
            onClick={() => {
              setActionsOpen((current) => !current);
              setAccountOpen(false);
            }}
            type="button"
          >
            <Plus className="w-4 h-4" /> New Action
            <ChevronDown className="w-3.5 h-3.5 text-[#A8A69F]" />
          </button>
          {actionsOpen ? (
            <div
              className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[#E6E4DD] bg-white p-2 shadow-xl"
              role="menu"
            >
              {hasAnyPermission(MESSAGE_ROUTE_PERMISSIONS) ? (
                <MenuAction
                  description="Start or reply from Communications Desk"
                  icon={MessageSquare}
                  label="New Message"
                  onClick={() => navigateAndClose('/messages')}
                />
              ) : null}
              {hasAnyPermission(EVENT_ROUTE_PERMISSIONS) ? (
                <MenuAction
                  description="Create or manage scheduled meetings"
                  icon={Calendar}
                  label="Create Event / Meetings"
                  onClick={() => navigateAndClose('/meetings')}
                />
              ) : null}
              {hasAnyPermission(DOCUMENT_ROUTE_PERMISSIONS) ? (
                <MenuAction
                  description="Upload and review client documents"
                  icon={FileUp}
                  label="Upload Document / Documents"
                  onClick={() => navigateAndClose('/documents')}
                />
              ) : null}
              {hasPermission('invoice.view') ? (
                <MenuAction
                  description="Create invoices or record payments"
                  icon={CreditCard}
                  label="Open Billing"
                  onClick={() => navigateAndClose('/billing')}
                />
              ) : null}
              {hasPermission('dashboard.view') ? (
                <MenuAction
                  description="Open DB-backed drilldowns and exports"
                  icon={BarChart3}
                  label="Open Reports"
                  onClick={() => navigateAndClose('/reports')}
                />
              ) : null}
              <div className="my-2 border-t border-[#F4F1EA]" />
              {hasPermission('client_account.manage') ? (
                <MenuAction
                  description="Open Client Directory create flow"
                  icon={Users}
                  label="New Client"
                  onClick={() => navigateAndClose('/clients?action=new')}
                />
              ) : null}
              {hasPermission('matter.update') ? (
                <MenuAction
                  description="Open Matter Desk create flow"
                  icon={Briefcase}
                  label="New Matter"
                  onClick={() => navigateAndClose('/matters?action=new')}
                />
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="h-6 w-px bg-[#E6E4DD] hidden sm:block" />
        <button
          aria-label="Open notifications"
          className="p-2 text-[#8C8981] hover:text-[#2C2B29] hover:bg-[#E6E4DD] rounded-full transition relative disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!hasPermission('notification.view')}
          onClick={() => navigateAndClose('/notifications')}
          type="button"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#C19A5B] rounded-full border-2 border-[#F4F1EA]" />
        </button>
        <div className="relative" ref={accountMenuRef}>
          <button
            aria-expanded={accountOpen}
            aria-haspopup="menu"
            className="flex items-center gap-3 rounded-xl px-1.5 py-1 transition hover:bg-[#E6E4DD]/70"
            onClick={() => {
              setAccountOpen((current) => !current);
              setActionsOpen(false);
            }}
            type="button"
          >
            <div className="hidden text-right md:block">
              <p className="text-sm font-medium text-[#2C2B29]">
                {currentUser?.displayName || 'Admin User'}
              </p>
              <p className="text-[11px] text-[#8C8981]">{currentUser?.email || 'Session bootstrap pending'}</p>
            </div>
            <div className="w-8 h-8 rounded-full bg-[#2C2B29] flex items-center justify-center text-[#F4F1EA] shadow-sm">
              {currentUser ? initials : <Shield className="w-4 h-4" />}
            </div>
          </button>
          {accountOpen ? (
            <div
              className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-[#E6E4DD] bg-white p-2 shadow-xl"
              role="menu"
            >
              <div className="px-3 py-2">
                <p className="text-sm font-medium text-[#2C2B29]">
                  {currentUser?.displayName || 'Admin User'}
                </p>
                <p className="text-xs text-[#8C8981]">{currentUser?.email || 'Session bootstrap pending'}</p>
              </div>
              <div className="my-2 border-t border-[#F4F1EA]" />
              {hasAnyPermission(SETTINGS_ROUTE_PERMISSIONS) ? (
                <MenuAction
                  description="Platform settings workspace"
                  icon={Settings}
                  label="Settings"
                  onClick={() => navigateAndClose('/settings')}
                />
              ) : null}
              {hasPermission('notification.view') ? (
                <MenuAction
                  description="Notification center"
                  icon={Bell}
                  label="Notifications"
                  onClick={() => navigateAndClose('/notifications')}
                />
              ) : null}
              <MenuAction
                description="Update your admin display details"
                icon={UserCircle}
                label="My Profile"
                onClick={() => navigateAndClose('/account?tab=profile')}
              />
              <MenuAction
                description="Change your password securely"
                icon={KeyRound}
                label="Change Password"
                onClick={() => navigateAndClose('/account?tab=password')}
              />
              <MenuAction
                description="Workspace defaults and display preferences"
                icon={SlidersHorizontal}
                label="Preferences"
                onClick={() => navigateAndClose('/account?tab=preferences')}
              />
              <div className="my-2 border-t border-[#F4F1EA]" />
              <MenuAction
                description="End this admin session"
                icon={LogOut}
                label="Sign out"
                onClick={() => {
                  setAccountOpen(false);
                  void onSignOut();
                }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
};

const MenuAction = ({
  description,
  disabled,
  icon: Icon,
  label,
  onClick,
}: {
  description: string;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
}) => (
  <button
    className={`flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition ${
      disabled
        ? 'cursor-not-allowed text-[#A8A69F]'
        : 'text-[#2C2B29] hover:bg-[#F4F1EA]'
    }`}
    disabled={disabled}
    onClick={onClick}
    role="menuitem"
    type="button"
  >
    <Icon className={`mt-0.5 h-4 w-4 ${disabled ? 'text-[#C9C6BD]' : 'text-[#C19A5B]'}`} />
    <span>
      <span className="block text-sm font-medium">{label}</span>
      <span className="mt-0.5 block text-xs text-[#8C8981]">{description}</span>
    </span>
  </button>
);
