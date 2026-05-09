import React, { useState, useMemo } from 'react';
import { 
  Bell, Filter, Search, CheckCircle, Clock, MoreVertical, ExternalLink, 
  Folder, CreditCard, FileText, MessageSquare, Briefcase, Info, RefreshCcw, 
  AlertCircle, Loader2, RotateCcw, X, Users
} from 'lucide-react';
import { formatDate } from '../data/formatters';
import type { SystemNotification } from '../data/adminTypes';
import type { ReminderWorkspaceResponse } from '../lib/api/contracts';
import { EmptyState } from './EmptyState';

type FilterType = 'all' | 'billing' | 'document' | 'event' | 'matter' | 'message' | 'system' | 'proposal';
type FilterStatus = 'all' | 'unread' | 'read' | 'dismissed';

export const NotificationsCenter: React.FC<{
  actionError?: string | null;
  actionStatus?: string | null;
  isProcessingReminders?: boolean;
  notifications?: SystemNotification[];
  onDismiss?: (notificationId: string) => Promise<void>;
  onMarkAllRead?: (notificationIds: string[]) => Promise<void>;
  onMarkAsRead?: (notificationId: string) => Promise<void>;
  onProcessReminders?: () => Promise<void>;
  onRetryReminder?: (reminderId: string) => Promise<void>;
  reminderWorkspace?: ReminderWorkspaceResponse;
  retryingReminderId?: string | null;
}> = ({
  actionError,
  actionStatus,
  isProcessingReminders = false,
  notifications = [],
  onDismiss,
  onMarkAllRead,
  onMarkAsRead,
  onProcessReminders,
  onRetryReminder,
  reminderWorkspace,
  retryingReminderId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('unread');

  const filteredNotifications = useMemo(() => {
    return notifications.filter(n => {
      const matchesSearch = 
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
        n.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (n.clientName && n.clientName.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (n.matterTitle && n.matterTitle.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesType = typeFilter === 'all' || n.type === typeFilter;
      
      const matchesStatus = 
        statusFilter === 'all' ? !n.dismissed : 
        statusFilter === 'unread' ? (!n.read && !n.dismissed) : 
        statusFilter === 'read' ? (n.read && !n.dismissed) : 
        statusFilter === 'dismissed' ? n.dismissed : true;

      return matchesSearch && matchesType && matchesStatus;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [notifications, searchQuery, typeFilter, statusFilter]);

  const getIconForType = (type: string) => {
    switch (type) {
      case 'billing': return <CreditCard className="w-5 h-5 text-emerald-600" />;
      case 'document': return <FileText className="w-5 h-5 text-blue-600" />;
      case 'event': return <Clock className="w-5 h-5 text-amber-600" />;
      case 'matter': return <Briefcase className="w-5 h-5 text-purple-600" />;
      case 'message': return <MessageSquare className="w-5 h-5 text-pink-600" />;
      case 'proposal': return <FileText className="w-5 h-5 text-indigo-600" />;
      default: return <Info className="w-5 h-5 text-gray-600" />;
    }
  };

  const getBadgeClassForType = (type: string) => {
    switch (type) {
      case 'billing': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'document': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'event': return 'bg-amber-50 text-amber-700 border-amber-100';
      case 'matter': return 'bg-purple-50 text-purple-700 border-purple-100';
      case 'message': return 'bg-pink-50 text-pink-700 border-pink-100';
      case 'proposal': return 'bg-indigo-50 text-indigo-700 border-indigo-100';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const unreadCount = notifications.filter(n => !n.read && !n.dismissed).length;

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col -m-6 p-6 bg-[#fafafa]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Command Center</h1>
            {unreadCount > 0 && (
              <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-0.5 rounded-full border border-red-200">
                {unreadCount} Unread
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-1">Review system alerts, client actions, and operational updates.</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => {
              if (!onMarkAllRead) {
                return;
              }

              void onMarkAllRead(
                notifications.filter((notification) => !notification.read && !notification.dismissed).map((notification) => notification.id)
              );
            }}
            disabled={unreadCount === 0}
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            <CheckCircle className="w-4 h-4" /> Mark All Read
          </button>
        </div>
      </div>

      {reminderWorkspace && (
        <ReminderQueuePanel
          actionError={actionError}
          actionStatus={actionStatus}
          isProcessing={isProcessingReminders}
          onProcessDue={onProcessReminders}
          onRetry={onRetryReminder}
          retryingReminderId={retryingReminderId}
          workspace={reminderWorkspace}
        />
      )}

      <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
        <div className="w-full lg:w-64 flex-shrink-0 space-y-6 overflow-y-auto pr-2 no-scrollbar">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Filter className="w-4 h-4" /> Views
            </h3>
            <div className="space-y-1">
              {[
                { id: 'unread', label: 'Unread Inbox', icon: Bell },
                { id: 'all', label: 'All Active', icon: Folder },
                { id: 'read', label: 'Recently Read', icon: CheckCircle },
                { id: 'dismissed', label: 'Dismissed', icon: X }
              ].map(view => (
                <button
                  key={view.id}
                  onClick={() => setStatusFilter(view.id as FilterStatus)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition
                    ${statusFilter === view.id 
                      ? 'bg-gray-900 text-white' 
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}
                >
                  <div className="flex items-center gap-2">
                    <view.icon className="w-4 h-4" /> {view.label}
                  </div>
                  {view.id === 'unread' && unreadCount > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusFilter === view.id ? 'bg-white/20' : 'bg-red-100 text-red-600'}`}>
                      {unreadCount}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Categories</h3>
            <div className="space-y-1">
              {['all', 'billing', 'document', 'event', 'matter', 'message', 'proposal'].map(type => (
                <button
                  key={type}
                  onClick={() => setTypeFilter(type as FilterType)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition capitalize
                    ${typeFilter === type 
                      ? 'bg-gray-100 text-gray-900 font-medium' 
                      : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${type === 'all' ? 'bg-gray-400' : getBadgeClassForType(type).split(' ')[0]}`} />
                    {type}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
          <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="text"
                placeholder="Search notifications..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 bg-white"
              />
            </div>
            <div className="text-sm text-gray-500 font-medium ml-auto">
              Showing {filteredNotifications.length} items
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {filteredNotifications.length === 0 ? (
              <div className="h-full flex items-center justify-center">
                <EmptyState 
                  icon={Bell} 
                  title="You're all caught up!" 
                  description="No notifications match your current filters. Take a break or adjust your view settings to see more."
                  action={{ label: "Clear Filters", onClick: () => { setTypeFilter('all'); setStatusFilter('all'); setSearchQuery(''); } }}
                />
              </div>
            ) : (
              <div className="relative before:absolute before:inset-0 before:ml-6 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-px before:bg-gray-200">
                {filteredNotifications.map((notif, index) => {
                  const isDateHeader = index === 0 || new Date(notif.date).toDateString() !== new Date(filteredNotifications[index - 1].date).toDateString();
                  
                  return (
                    <div key={notif.id} className="relative group mb-8">
                      {isDateHeader && (
                        <div className="flex items-center justify-center mb-8 mt-2 relative z-10">
                          <span className="bg-gray-100 text-gray-600 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider border border-gray-200">
                            {formatDate(notif.date)}
                          </span>
                        </div>
                      )}

                      <div className="flex items-start md:justify-normal md:odd:flex-row-reverse group relative z-10">
                        <div className={`flex items-center justify-center w-12 h-12 rounded-full border-4 border-[#fafafa] shadow-sm shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 ${notif.read ? 'bg-gray-100' : 'bg-white'}`}>
                          {getIconForType(notif.type)}
                        </div>

                        <div className={`w-[calc(100%-4rem)] md:w-[calc(50%-3rem)] bg-white border p-5 rounded-xl shadow-sm transition-all duration-200 hover:shadow-md
                          ${!notif.read ? 'border-blue-200 shadow-[0_0_0_1px_rgba(59,130,246,0.1)]' : 'border-gray-200'}
                          ${notif.dismissed ? 'opacity-60' : 'opacity-100'}`}
                        >
                          {!notif.read && (
                            <div className="absolute top-5 right-5 w-2.5 h-2.5 bg-blue-500 rounded-full md:group-odd:left-5 md:group-odd:right-auto" />
                          )}
                          
                          <div className="flex flex-col gap-2 relative">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${getBadgeClassForType(notif.type)}`}>
                                {notif.type}
                              </span>
                              <span className="text-xs text-gray-400 font-medium">{new Date(notif.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              <span className="text-xs text-gray-400 mx-1">•</span>
                              <span className="text-xs text-gray-500 font-medium">Source: {notif.source}</span>
                            </div>

                            <h4 className={`text-base font-bold ${!notif.read ? 'text-gray-900' : 'text-gray-700'}`}>{notif.title}</h4>
                            <p className="text-sm text-gray-600 leading-relaxed">{notif.body}</p>

                            {(notif.clientName || notif.matterTitle) && (
                              <div className="mt-3 pt-3 border-t border-gray-100 flex flex-wrap gap-3">
                                {notif.clientName && (
                                  <div className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 cursor-pointer bg-gray-50 px-2 py-1 rounded">
                                    <Users className="w-3.5 h-3.5" />
                                    {notif.clientName}
                                  </div>
                                )}
                                {notif.matterTitle && (
                                  <div className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 cursor-pointer bg-gray-50 px-2 py-1 rounded">
                                    <Briefcase className="w-3.5 h-3.5" />
                                    {notif.matterTitle}
                                  </div>
                                )}
                              </div>
                            )}

                            <div className={`flex items-center gap-3 mt-4 pt-3 border-t border-gray-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity ${notif.read && notif.dismissed ? 'hidden' : ''}`}>
                              {!notif.read && (
                                <button
                                  onClick={() => {
                                    if (!onMarkAsRead) {
                                      return;
                                    }

                                    void onMarkAsRead(notif.id);
                                  }}
                                  className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
                                >
                                  <CheckCircle className="w-3.5 h-3.5" /> Mark Read
                                </button>
                              )}
                              {!notif.dismissed && (
                                <button
                                  onClick={() => {
                                    if (!onDismiss) {
                                      return;
                                    }

                                    void onDismiss(notif.id);
                                  }}
                                  className="text-xs font-medium text-gray-500 hover:text-red-600 flex items-center gap-1"
                                >
                                  <X className="w-3.5 h-3.5" /> Dismiss
                                </button>
                              )}
                              {notif.actionUrl ? (
                                <a
                                  className="text-xs font-medium text-gray-500 hover:text-gray-900 flex items-center gap-1 ml-auto"
                                  href={notif.actionUrl}
                                >
                                  View Details <ExternalLink className="w-3.5 h-3.5" />
                                </a>
                              ) : (
                                <span className="text-xs font-medium text-gray-400 flex items-center gap-1 ml-auto">
                                  Details in source workspace
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const ReminderQueuePanel = ({
  actionError,
  actionStatus,
  isProcessing,
  onProcessDue,
  onRetry,
  retryingReminderId,
  workspace,
}: {
  actionError?: string | null;
  actionStatus?: string | null;
  isProcessing: boolean;
  onProcessDue?: () => Promise<void>;
  onRetry?: (reminderId: string) => Promise<void>;
  retryingReminderId?: string | null;
  workspace: ReminderWorkspaceResponse;
}) => {
  const failedReminders = workspace.reminders.filter((reminder) => reminder.status === 'failed');
  const dueReminders = workspace.reminders.filter(
    (reminder) => reminder.status === 'pending' || reminder.status === 'processing'
  );

  return (
    <div className="mb-6 flex-shrink-0 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-gray-900">Reminder Queue</h2>
            <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              portal processing
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            Email and SMS delivery are marked sent only after the delivery service confirms success.
          </p>
        </div>

        <button
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!onProcessDue || isProcessing || workspace.metrics.due === 0}
          onClick={() => {
            if (onProcessDue) {
              void onProcessDue();
            }
          }}
          type="button"
        >
          {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          Process Due
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <ReminderStat label="Pending" value={workspace.metrics.pending} />
        <ReminderStat label="Due Now" tone="amber" value={workspace.metrics.due} />
        <ReminderStat label="Failed" tone="rose" value={workspace.metrics.failed} />
        <ReminderStat label="Processing" tone="blue" value={workspace.metrics.processing} />
        <ReminderStat label="Sent 7d" tone="emerald" value={workspace.metrics.sentRecent} />
      </div>

      {(actionStatus || actionError) && (
        <div
          className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
            actionError
              ? 'border-red-200 bg-red-50 text-red-700'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          {actionError || actionStatus}
        </div>
      )}

      {failedReminders.length > 0 ? (
        <div className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {failedReminders.slice(0, 5).map((reminder) => (
            <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between" key={reminder.id}>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-gray-900">{reminder.eventTitle}</p>
                <p className="mt-1 text-xs text-gray-500">
                  {reminder.clientName || 'Client'} · {reminder.recipientName} · scheduled {reminder.scheduledAt}
                </p>
                <p className="mt-1 text-xs text-red-600">
                  {reminder.failureReason || 'Reminder failed and is waiting for retry.'}
                </p>
              </div>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!onRetry || retryingReminderId === reminder.id}
                onClick={() => {
                  if (onRetry) {
                    void onRetry(reminder.id);
                  }
                }}
                type="button"
              >
                {retryingReminderId === reminder.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Retry
              </button>
            </div>
          ))}
        </div>
      ) : dueReminders.length > 0 ? (
        <p className="mt-4 text-xs text-gray-500">
          {dueReminders.length} due or processing reminder(s) are ready for portal processing.
        </p>
      ) : (
        <p className="mt-4 text-xs text-gray-500">No failed reminder jobs are waiting for retry.</p>
      )}
    </div>
  );
};

const ReminderStat = ({
  label,
  tone = 'neutral',
  value,
}: {
  label: string;
  tone?: 'amber' | 'blue' | 'emerald' | 'neutral' | 'rose';
  value: number;
}) => {
  const toneClasses: Record<typeof tone, string> = {
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    neutral: 'bg-gray-50 text-gray-700 border-gray-100',
    rose: 'bg-red-50 text-red-700 border-red-100',
  };

  return (
    <div className={`rounded-lg border px-3 py-2 ${toneClasses[tone]}`}>
      <p className="text-[10px] font-bold uppercase tracking-wider opacity-70">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
};
