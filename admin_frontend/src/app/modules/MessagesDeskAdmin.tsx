import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { 
  Search, Filter, CheckCircle, Clock, AlertCircle, 
  MessageSquare, Paperclip, Send, FileText, Calendar, 
  ChevronRight, MoreVertical, X, User, Briefcase, IndianRupee,
  Phone, Video, ShieldAlert, Archive
} from 'lucide-react';
import { formatCurrency, formatDate, formatDateTime } from '../data/formatters';
import type {
  ChatMessage,
  Invoice,
  Matter,
  MessageThread,
  PlatformEvent,
  PlatformUser,
} from '../data/adminTypes';
import type { AdminTemplate } from '../lib/api/contracts';
import { StatusBadge, UrgencyDot } from '../components/dashboard/StatusBadge';
import { EmptyState } from './EmptyState';

interface MessagesDeskAdminProps {
  clients?: PlatformUser[];
  events?: PlatformEvent[];
  invoices?: Invoice[];
  matters?: Matter[];
  messages?: ChatMessage[];
  messageTemplates?: AdminTemplate[];
  onArchiveThread?: (threadId: string) => Promise<void>;
  onCreateThread?: (payload: {
    clientId: string;
    confirmDuplicateGeneral?: boolean;
    content: string;
    matterId?: string;
  }) => Promise<{ threadId: string }>;
  onDownloadAttachment?: (documentId: string) => void;
  onMarkThreadRead?: (threadId: string) => Promise<void>;
  onSendReply?: (threadId: string, content: string) => Promise<void>;
  searchQuery: string;
  threads?: MessageThread[];
}

type FilterType = 'all' | 'unread' | 'waiting' | 'high-priority';

type DuplicateGeneralWarning = {
  existingThreadId?: string;
  message: string;
};

export const MessagesDeskAdmin: React.FC<MessagesDeskAdminProps> = ({
  clients = [],
  events = [],
  invoices = [],
  matters = [],
  messages = [],
  messageTemplates = [],
  onArchiveThread,
  onCreateThread,
  onDownloadAttachment,
  onMarkThreadRead,
  onSendReply,
  searchQuery,
  threads = [],
}) => {
  const navigate = useNavigate();
  const [localSearch, setLocalSearch] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedThreadId, setSelectedThreadId] = useState<string>(threads[0]?.id || '');
  const [newMessage, setNewMessage] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [isArchiving, setIsArchiving] = useState(false);
  const [markingThreadId, setMarkingThreadId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeClientId, setComposeClientId] = useState('');
  const [composeMatterId, setComposeMatterId] = useState('');
  const [composeContent, setComposeContent] = useState('');
  const [composeError, setComposeError] = useState<string | null>(null);
  const [duplicateGeneralWarning, setDuplicateGeneralWarning] =
    useState<DuplicateGeneralWarning | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);

  useEffect(() => {
    if (!threads.some((thread) => thread.id === selectedThreadId)) {
      setSelectedThreadId(threads[0]?.id || '');
    }
  }, [selectedThreadId, threads]);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId),
    [selectedThreadId, threads]
  );

  useEffect(() => {
    if (
      !activeThread ||
      activeThread.unreadCount <= 0 ||
      !onMarkThreadRead ||
      markingThreadId === activeThread.id
    ) {
      return;
    }

    setMarkingThreadId(activeThread.id);
    void onMarkThreadRead(activeThread.id)
      .catch((error) => {
        setActionError(error instanceof Error ? error.message : 'Unable to mark thread as read.');
      })
      .finally(() => setMarkingThreadId(null));
  }, [activeThread, markingThreadId, onMarkThreadRead]);
  
  const threadMessages = useMemo(() => {
    if (!activeThread) return [];
    return messages.filter(m => m.threadId === activeThread.id).sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [activeThread, messages]);

  const activeMatter = useMemo(() => {
    if (!activeThread) return null;
    return matters.find(m => m.id === activeThread.matterId) || null;
  }, [activeThread, matters]);

  const activeClient = useMemo(() => {
    if (!activeThread) return null;
    return clients.find(u => u.id === activeThread.clientId) || null;
  }, [activeThread, clients]);

  const clientInvoices = useMemo(() => {
    if (!activeThread) return [];
    return invoices.filter(i => i.clientId === activeThread.clientId).slice(0, 3);
  }, [activeThread, invoices]);

  const clientEvents = useMemo(() => {
    if (!activeThread) return [];
    return events
      .filter((event) => event.clientId === activeThread.clientId && event.status === 'upcoming')
      .slice(0, 3);
  }, [activeThread, events]);

  const composeClient = useMemo(
    () => clients.find((client) => client.id === composeClientId) || null,
    [clients, composeClientId]
  );

  const composeMatterOptions = useMemo(
    () => matters.filter((matter) => matter.clientId === composeClientId),
    [composeClientId, matters]
  );

  const existingActiveGeneralThread = useMemo(
    () =>
      threads.find(
        (thread) =>
          thread.clientId === composeClientId &&
          !thread.matterId &&
          thread.status !== 'resolved'
      ) || null,
    [composeClientId, threads]
  );

  const activeMessageTemplates = useMemo(
    () =>
      messageTemplates.filter(
        (template) => template.type === 'message' && template.isActive && !template.archivedAt
      ),
    [messageTemplates]
  );

  useEffect(() => {
    if (composeMatterId && !composeMatterOptions.some((matter) => matter.id === composeMatterId)) {
      setComposeMatterId('');
    }
  }, [composeMatterId, composeMatterOptions]);

  const filteredThreads = useMemo(() => {
    const search = (localSearch || searchQuery).toLowerCase();
    return threads.filter(t => {
      // Apply Search
      const matchesSearch = 
        t.clientName.toLowerCase().includes(search) || 
        t.matterTitle.toLowerCase().includes(search) ||
        t.lastMessage.toLowerCase().includes(search);
      
      if (!matchesSearch) return false;

      // Apply Filters
      if (filterType === 'unread') return t.unreadCount > 0;
      if (filterType === 'waiting') return t.status === 'waiting';
      if (filterType === 'high-priority') return t.urgency === 'within-2hrs' || t.urgency === 'within-6hrs';
      
      return true;
    }).sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
  }, [localSearch, searchQuery, filterType, threads]);

  const getUrgencyColor = (urgency: string) => {
    switch(urgency) {
      case 'within-2hrs': return 'text-red-600 bg-red-50 border-red-200';
      case 'within-6hrs': return 'text-amber-600 bg-amber-50 border-amber-200';
      default: return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  const getUrgencyLabel = (urgency: string) => {
    switch(urgency) {
      case 'within-2hrs': return 'High Priority';
      case 'within-6hrs': return 'Medium Priority';
      default: return 'Standard';
    }
  };

  // Group messages by date
  const groupedMessages = useMemo(() => {
    const groups: { [date: string]: ChatMessage[] } = {};
    threadMessages.forEach(msg => {
      const date = new Date(msg.timestamp).toLocaleDateString(undefined, {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
      });
      if (!groups[date]) groups[date] = [];
      groups[date].push(msg);
    });
    return groups;
  }, [threadMessages]);

  const renderMessageTemplate = (template: AdminTemplate) =>
    template.body.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, variable: string) => {
      const values: Record<string, string> = {
        adminName: 'Global LMG Support',
        clientName: activeClient?.name || composeClient?.name || 'Client',
        matterTitle: activeMatter?.title || composeMatterOptions.find((matter) => matter.id === composeMatterId)?.title || '',
        platformName: 'Global LMG',
        supportEmail: 'support@globallmg.local',
      };

      return values[variable] || '';
    });

  const insertTemplateIntoReply = (templateId: string) => {
    const template = activeMessageTemplates.find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }

    const rendered = renderMessageTemplate(template);
    setNewMessage((current) => (current.trim() ? `${current.trim()}\n\n${rendered}` : rendered));
  };

  const insertTemplateIntoCompose = (templateId: string) => {
    const template = activeMessageTemplates.find((entry) => entry.id === templateId);
    if (!template) {
      return;
    }

    const rendered = renderMessageTemplate(template);
    setComposeContent((current) => (current.trim() ? `${current.trim()}\n\n${rendered}` : rendered));
  };

  const resetCompose = () => {
    setComposeClientId('');
    setComposeMatterId('');
    setComposeContent('');
    setComposeError(null);
    setDuplicateGeneralWarning(null);
    setIsCreatingThread(false);
  };

  const openCompose = () => {
    setComposeClientId((current) => current || clients[0]?.id || '');
    setComposeMatterId('');
    setComposeContent('');
    setComposeError(null);
    setDuplicateGeneralWarning(null);
    setIsComposeOpen(true);
  };

  const createThread = (confirmDuplicateGeneral = false) => {
    if (!onCreateThread || !composeClientId || !composeContent.trim()) {
      return;
    }

    if (!composeMatterId && existingActiveGeneralThread && !confirmDuplicateGeneral) {
      setDuplicateGeneralWarning({
        existingThreadId: existingActiveGeneralThread.id,
        message: 'An active general thread already exists for this client.',
      });
      return;
    }

    setComposeError(null);
    setDuplicateGeneralWarning(null);
    setIsCreatingThread(true);
    void onCreateThread({
      clientId: composeClientId,
      confirmDuplicateGeneral: confirmDuplicateGeneral || undefined,
      content: composeContent.trim(),
      matterId: composeMatterId || undefined,
    })
      .then((result) => {
        setSelectedThreadId(result.threadId);
        setIsComposeOpen(false);
        resetCompose();
      })
      .catch((error) => {
        const apiError = error as {
          code?: string;
          issues?: { existingThreadId?: string; existingThreadSubject?: string };
          message?: string;
        };

        if (apiError.code === 'active_general_thread_exists') {
          setDuplicateGeneralWarning({
            existingThreadId: apiError.issues?.existingThreadId,
            message: apiError.message || 'An active general thread already exists for this client.',
          });
          return;
        }

        setComposeError(apiError.message || 'Unable to create this message thread.');
      })
      .finally(() => setIsCreatingThread(false));
  };

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col -m-6 p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-medium text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Communications Desk</h1>
          <p className="text-sm text-gray-500 mt-1">Manage client correspondence and internal thread routing.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg transition"
            onClick={() => navigate('/reports?drilldown=waiting-threads')}
            type="button"
          >
            Open Reports Export
          </button>
          <button
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400 flex items-center gap-2 transition"
            disabled={!onCreateThread || clients.length === 0}
            onClick={openCompose}
            type="button"
          >
            <MessageSquare className="w-4 h-4" /> New Message
          </button>
        </div>
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 gap-6 xl:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)_minmax(18rem,22rem)]">
        
        {/* Left: Thread List */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="p-4 border-b border-gray-100 space-y-4 bg-gray-50/50">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input 
                type="text"
                placeholder="Search messages..."
                value={localSearch}
                onChange={e => setLocalSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400 bg-white"
              />
            </div>
            
            <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
              <button 
                onClick={() => setFilterType('all')}
                className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full border transition ${filterType === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
              >
                All
              </button>
              <button 
                onClick={() => setFilterType('unread')}
                className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full border transition ${filterType === 'unread' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
              >
                Unread
              </button>
              <button 
                onClick={() => setFilterType('waiting')}
                className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full border transition ${filterType === 'waiting' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
              >
                Needs Action
              </button>
              <button 
                onClick={() => setFilterType('high-priority')}
                className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full border transition flex items-center gap-1 ${filterType === 'high-priority' ? 'bg-red-500 text-white border-red-500' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
              >
                <AlertCircle className="w-3 h-3" /> Priority
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredThreads.map(thread => (
              <div 
                key={thread.id} 
                onClick={() => setSelectedThreadId(thread.id)}
                className={`p-4 border-b border-gray-50 cursor-pointer transition relative group ${selectedThreadId === thread.id ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
              >
                {selectedThreadId === thread.id && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-600" />
                )}
                <div className="mb-1.5 flex min-w-0 items-start justify-between">
                  <h3 className={`min-w-0 truncate pr-2 text-sm ${thread.unreadCount > 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
                    {thread.clientName}
                  </h3>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-gray-400 whitespace-nowrap">
                      {new Date(thread.lastMessageAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                    {thread.unreadCount > 0 && (
                      <span className="flex items-center justify-center w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full">
                        {thread.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
                
                <div className="flex items-center gap-2 mb-2">
                  <span className="bg-gray-100 text-gray-600 text-[10px] font-semibold px-1.5 py-0.5 rounded truncate max-w-[120px]">
                    {thread.matterTitle}
                  </span>
                  {thread.urgency !== 'standard' && (
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${getUrgencyColor(thread.urgency)} flex items-center gap-1`}>
                      <AlertCircle className="w-2.5 h-2.5" />
                      {thread.urgency === 'within-2hrs' ? 'Urgent' : 'Priority'}
                    </span>
                  )}
                </div>

                <p className={`text-xs line-clamp-2 ${thread.unreadCount > 0 ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                  {thread.lastMessage}
                </p>
              </div>
            ))}
            {filteredThreads.length === 0 && (
              <div className="p-4 h-full flex flex-col items-center justify-center min-h-[300px]">
                <EmptyState 
                  icon={MessageSquare} 
                  title="No threads found" 
                  description="Your inbox is empty based on the current filters."
                  action={{ label: "Clear Filters", onClick: () => { setFilterType('all'); setLocalSearch(''); } }}
                />
              </div>
            )}
          </div>
        </div>

        {/* Middle: Active Conversation */}
        {activeThread ? (
          <div className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            {/* Chat Header */}
            <div className="z-10 flex shrink-0 flex-col gap-3 border-b border-gray-100 bg-gray-50/50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-3">
                  <h2 className="text-lg font-medium text-gray-900 truncate">{activeThread.clientName}</h2>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getUrgencyColor(activeThread.urgency)} uppercase tracking-wider`}>
                    {getUrgencyLabel(activeThread.urgency)}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider ${activeThread.status === 'waiting' ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200'}`}>
                    {activeThread.status === 'waiting' ? 'Needs Action' : 'Resolved/Active'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <Briefcase className="w-3.5 h-3.5" />
                  <span className="font-medium text-gray-700">{activeThread.matterTitle}</span>
                  <span className="text-gray-300">•</span>
                  <span>{activeThread.matterRef ? `Ref: ${activeThread.matterRef}` : 'General thread'}</span>
                  <span className="text-gray-300">•</span>
                  <span>Assigned to {activeThread.assignedTo}</span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!onArchiveThread || isArchiving}
                  onClick={() => {
                    if (!activeThread || !onArchiveThread || isArchiving) {
                      return;
                    }

                    if (!window.confirm('Archive this conversation thread?')) {
                      return;
                    }

                    setActionError(null);
                    setIsArchiving(true);
                    void onArchiveThread(activeThread.id)
                      .catch((error) => {
                        setActionError(
                          error instanceof Error
                            ? error.message
                            : 'Unable to archive this conversation.'
                        );
                      })
                      .finally(() => setIsArchiving(false));
                  }}
                  title="Archive thread"
                  type="button"
                >
                  <Archive className="w-4 h-4" />
                </button>
                <button className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition"><MoreVertical className="w-4 h-4" /></button>
              </div>
            </div>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto bg-[#FCFBF8] p-4 sm:p-6">
              {Object.entries(groupedMessages).map(([date, messages]) => (
                <div key={date} className="mb-8">
                  <div className="flex justify-center mb-6">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
                      {date}
                    </span>
                  </div>
                  
                  <div className="space-y-6">
                    {messages.map(msg => {
                      const isClient = msg.senderRole === 'client';
                      const isSystem = msg.senderRole === 'system';
                      
                      if (isSystem) {
                        return (
                          <div key={msg.id} className="flex justify-center">
                            <div className="flex max-w-full items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-2 text-xs text-gray-500 admin-wrap-anywhere">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              {msg.content}
                              <span className="text-gray-400 ml-2">
                                {new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={msg.id} className={`flex flex-col ${isClient ? 'items-start' : 'items-end'}`}>
                          <div className="flex max-w-full items-end gap-2 sm:max-w-[80%]">
                            {isClient && (
                              <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 text-sm font-bold shadow-sm">
                                {msg.senderName.charAt(0)}
                              </div>
                            )}
                            
                            <div className={`flex min-w-0 flex-col ${isClient ? 'items-start' : 'items-end'}`}>
                              <span className="text-[11px] text-gray-500 mb-1 px-1 font-medium">
                                {msg.senderName} <span className="font-normal opacity-70 ml-1">{new Date(msg.timestamp).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
                              </span>
                              
                              <div className={`max-w-full p-3.5 rounded-2xl text-sm shadow-sm admin-wrap-anywhere ${
                                isClient 
                                  ? 'bg-white border border-gray-200 text-gray-800 rounded-bl-sm' 
                                  : 'bg-gray-900 text-white rounded-br-sm'
                              }`}>
                                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                                
                                {msg.attachments && msg.attachments.length > 0 && (
                                  <div className="mt-3 space-y-2">
                                    {msg.attachments.map((att, i) => (
                                      <button
                                        key={`${msg.id}-${att.documentId}-${i}`}
                                        className={`flex min-w-0 max-w-full items-center gap-2 rounded border p-2 text-left ${
                                          isClient ? 'bg-gray-50 border-gray-100' : 'bg-gray-800 border-gray-700'
                                        }`}
                                        disabled={!onDownloadAttachment}
                                        onClick={() => onDownloadAttachment?.(att.documentId)}
                                        title="Download attachment"
                                        type="button"
                                      >
                                        <FileText className={`w-4 h-4 ${isClient ? 'text-blue-500' : 'text-gray-400'}`} />
                                        <span className={`text-xs truncate ${isClient ? 'text-gray-700' : 'text-gray-300'}`}>{att.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>

                            {!isClient && (
                              <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center shrink-0 text-sm font-bold shadow-sm border border-white">
                                {msg.senderName.charAt(0)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Input Area */}
            <div className="p-4 bg-white border-t border-gray-100 shrink-0">
              <div className="bg-gray-50 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-gray-900/10 focus-within:border-gray-400 transition overflow-hidden">
                <textarea 
                  rows={3}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  disabled={activeThread.status === 'resolved' || isSending}
                  placeholder={
                    activeThread.status === 'resolved'
                      ? 'This conversation is closed.'
                      : `Reply to ${activeThread.clientName}...`
                  }
                  className="w-full bg-transparent p-3 text-sm outline-none resize-none"
                />
                <div className="flex flex-col gap-3 border-t border-gray-200 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-wrap items-center gap-1">
                    <button
                      className="p-2 text-gray-300 rounded-lg cursor-not-allowed"
                      disabled
                      title="Reply attachments are handled through Documents Center for now."
                      type="button"
                    >
                      <Paperclip className="w-4 h-4" />
                    </button>
                    <select
                      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300"
                      disabled={activeMessageTemplates.length === 0 || activeThread.status === 'resolved'}
                      onChange={(event) => {
                        insertTemplateIntoReply(event.target.value);
                        event.target.value = '';
                      }}
                      title={
                        activeMessageTemplates.length === 0
                          ? 'No active message templates configured.'
                          : 'Insert message template'
                      }
                      value=""
                    >
                      <option value="">Use Template</option>
                      {activeMessageTemplates.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="bg-gray-900 text-white px-4 py-1.5 rounded-lg text-sm font-medium flex items-center gap-2 hover:bg-gray-800 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={
                      !newMessage.trim() ||
                      isSending ||
                      !onSendReply ||
                      activeThread.status === 'resolved'
                    }
                    onClick={() => {
                      if (
                        !activeThread ||
                        !newMessage.trim() ||
                        !onSendReply ||
                        activeThread.status === 'resolved'
                      ) {
                        return;
                      }

                      setActionError(null);
                      setIsSending(true);
                      void onSendReply(activeThread.id, newMessage.trim())
                        .then(() => setNewMessage(''))
                        .catch((error) => {
                          setActionError(
                            error instanceof Error ? error.message : 'Unable to send this reply.'
                          );
                        })
                        .finally(() => setIsSending(false));
                    }}
                    type="button"
                  >
                    Send <Send className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {actionError && (
                <p className="mt-3 text-center text-xs text-red-600">{actionError}</p>
              )}
              <div className="flex items-center justify-center gap-4 mt-3">
                <span className="text-[10px] text-gray-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> External communication securely logged</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 items-center justify-center rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <EmptyState 
              icon={MessageSquare} 
              title="No Thread Selected" 
              description="Select a conversation from the left queue to view messages, respond to clients, and manage case communication."
            />
          </div>
        )}

        {/* Right: Contextual Metadata */}
        {activeThread && activeClient ? (
          <div className="flex min-w-0 flex-col gap-6 overflow-y-auto">
            {/* Client Context Card */}
            <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm admin-wrap-anywhere">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Client Profile</h3>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-lg font-bold border border-blue-100">
                  {activeClient.name.charAt(0)}
                </div>
                <div className="min-w-0">
                  <h4 className="font-medium text-gray-900">{activeClient.name}</h4>
                  <p className="text-xs text-gray-500">
                    {activeClient.lifecycle === 'client' ? 'Client' : 'Prospect / Lead'}
                  </p>
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-2 text-gray-600">
                  <User className="w-4 h-4 text-gray-400" />
                  <span>ID: {activeClient.id}</span>
                </div>
                <div className="flex items-center gap-2 text-gray-600">
                  <Phone className="w-4 h-4 text-gray-400" />
                  <span>{activeClient.phone || 'Not available'}</span>
                </div>
                <button
                  className="w-full mt-2 py-2 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition"
                  onClick={() => navigate(`/clients/${activeClient.id}`)}
                  type="button"
                >
                  View Full Profile
                </button>
              </div>
            </div>

            {/* Matter Context Card */}
            {activeMatter ? (
              <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm admin-wrap-anywhere">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Linked Matter</h3>
                <div className="mb-4">
                  <h4 className="font-medium text-gray-900 mb-1">{activeMatter.title}</h4>
                  <StatusBadge status={activeMatter.operationalStatus} size="sm" />
                </div>
                
                <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 space-y-2 text-sm mb-4">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Stage</span>
                    <span className="font-medium text-gray-900 capitalize">
                      {activeMatter.lifecycleStage.replace(/-/g, ' ')}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Filed On</span>
                    <span className="font-medium text-gray-900">{formatDate(activeMatter.createdAt)}</span>
                  </div>
                </div>
                
                <button
                  className="w-full py-2 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-100 rounded-lg transition"
                  onClick={() => navigate(`/matters/${activeMatter.id}`)}
                  type="button"
                >
                  Open Matter Desk
                </button>
              </div>
            ) : null}

            {/* Upcoming Meetings */}
            {clientEvents.length > 0 && (
              <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                  Upcoming Events
                  <span className="bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded text-[10px]">{clientEvents.length}</span>
                </h3>
                <div className="space-y-3">
                  {clientEvents.map(event => (
                    <button
                      key={event.id}
                      className="flex gap-3 text-left w-full rounded-lg hover:bg-gray-50 transition"
                      onClick={() => navigate(`/meetings?clientId=${activeThread.clientId}`)}
                      type="button"
                    >
                      <div className="flex flex-col items-center justify-center w-10 h-10 bg-amber-50 rounded-lg border border-amber-100 shrink-0">
                        <span className="text-[10px] font-bold text-amber-600 uppercase leading-none mb-0.5">
                          {new Date(event.date).toLocaleDateString(undefined, { month: 'short' })}
                        </span>
                        <span className="text-sm font-bold text-gray-900 leading-none">
                          {new Date(event.date).getDate()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {event.time}
                          {event.type === 'hearing' ? <Briefcase className="w-3 h-3 ml-1" /> : <Video className="w-3 h-3 ml-1" />}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Invoices */}
            {clientInvoices.length > 0 && (
              <div className="min-w-0 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Recent Invoices</h3>
                <div className="space-y-3">
                  {clientInvoices.map(inv => (
                    <button
                      key={inv.id}
                      className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-left transition hover:border-gray-200"
                      onClick={() => navigate(`/billing?clientId=${activeThread.clientId}`)}
                      type="button"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{formatCurrency(inv.totalAmount)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">Due {formatDate(inv.dueDate)}</p>
                      </div>
                      <StatusBadge status={inv.status} size="sm" />
                    </button>
                  ))}
                </div>
                <button
                  className="w-full mt-3 text-xs font-medium text-gray-500 hover:text-gray-900 text-center py-1"
                  onClick={() => navigate(`/billing?clientId=${activeThread.clientId}`)}
                  type="button"
                >
                  View All Billing
                </button>
              </div>
            )}

          </div>
        ) : null}
      </div>
      {isComposeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/30 px-4">
          <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-medium text-gray-900">New Message</h2>
                <p className="mt-0.5 text-xs text-gray-500">Start a client-visible conversation from Global LMG.</p>
              </div>
              <button
                className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-900"
                onClick={() => {
                  setIsComposeOpen(false);
                  resetCompose();
                }}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Client
                </label>
                <select
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                  value={composeClientId}
                  onChange={(event) => {
                    setComposeClientId(event.target.value);
                    setComposeMatterId('');
                    setDuplicateGeneralWarning(null);
                    setComposeError(null);
                  }}
                >
                  <option value="">Select client</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name} {client.email ? `(${client.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  Matter
                </label>
                <select
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400 disabled:bg-gray-50 disabled:text-gray-400"
                  disabled={!composeClientId || composeMatterOptions.length === 0}
                  value={composeMatterId}
                  onChange={(event) => {
                    setComposeMatterId(event.target.value);
                    setDuplicateGeneralWarning(null);
                    setComposeError(null);
                  }}
                >
                  <option value="">General conversation</option>
                  {composeMatterOptions.map((matter) => (
                    <option key={matter.id} value={matter.id}>
                      {matter.referenceCode ? `${matter.referenceCode} · ` : ''}{matter.title}
                    </option>
                  ))}
                </select>
                {composeClient && composeMatterOptions.length === 0 && (
                  <p className="mt-1.5 text-xs text-gray-400">No linked matters found for this client.</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-400">
                  First Message
                </label>
                <div className="mb-2 flex justify-end">
                  <select
                    className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-300"
                    disabled={activeMessageTemplates.length === 0}
                    onChange={(event) => {
                      insertTemplateIntoCompose(event.target.value);
                      event.target.value = '';
                    }}
                    value=""
                  >
                    <option value="">Insert template</option>
                    {activeMessageTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="min-h-[120px] w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                  onChange={(event) => {
                    setComposeContent(event.target.value);
                    setComposeError(null);
                  }}
                  placeholder="Write the first message the client will see..."
                  value={composeContent}
                />
              </div>

              {duplicateGeneralWarning && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                  <p className="font-medium">{duplicateGeneralWarning.message}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {duplicateGeneralWarning.existingThreadId && (
                      <button
                        className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                        onClick={() => {
                          setSelectedThreadId(duplicateGeneralWarning.existingThreadId || '');
                          setIsComposeOpen(false);
                          resetCompose();
                        }}
                        type="button"
                      >
                        Open Existing Thread
                      </button>
                    )}
                    <button
                      className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                      disabled={isCreatingThread}
                      onClick={() => createThread(true)}
                      type="button"
                    >
                      Create Separate Thread
                    </button>
                  </div>
                </div>
              )}

              {composeError && (
                <p className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {composeError}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-5 py-4">
              <button
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => {
                  setIsComposeOpen(false);
                  resetCompose();
                }}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!composeClientId || !composeContent.trim() || isCreatingThread}
                onClick={() => createThread(false)}
                type="button"
              >
                {isCreatingThread ? 'Creating...' : 'Create Thread'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
