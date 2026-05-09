import React, { useEffect, useMemo, useState } from 'react';
import { 
  Calendar as CalendarIcon, Clock, Video, Phone, User, 
  MapPin, CheckCircle, XCircle, AlertCircle, ChevronLeft, 
  ChevronRight, MoreVertical, Plus, List, LayoutGrid, Eye, EyeOff
} from 'lucide-react';
import { type Matter, type PlatformEvent, type PlatformUser } from '../data/adminTypes';
import { StatusBadge } from '../components/dashboard/StatusBadge';

type EventMutationPayload = {
  clientAccountId?: string;
  date?: string;
  durationMinutes?: number;
  matterId?: string | null;
  meetLink?: string | null;
  mode?: string;
  notes?: string | null;
  time?: string;
  title?: string;
  type?: string;
  visibleToClient?: boolean;
};

interface MeetingsWorkspaceProps {
  clients?: PlatformUser[];
  events?: PlatformEvent[];
  matters?: Matter[];
  onCreateEvent?: (payload: {
    clientAccountId?: string;
    date: string;
    durationMinutes?: number;
    matterId?: string;
    meetLink?: string;
    mode: string;
    notes?: string;
    time: string;
    title: string;
    type: string;
    visibleToClient?: boolean;
  }) => Promise<void>;
  onCancelEvent?: (eventId: string, reason?: string) => Promise<void>;
  onRetryCalendarSync?: (eventId: string) => Promise<void>;
  onUpdateEvent?: (eventId: string, payload: EventMutationPayload) => Promise<void>;
}

type ViewMode = 'calendar' | 'agenda';
type FilterStatus = 'all' | 'upcoming' | 'completed' | 'cancelled';
type FilterType = 'all' | 'consultation' | 'hearing' | 'field-visit' | 'deadline';

export const MeetingsWorkspace: React.FC<MeetingsWorkspaceProps> = ({
  clients = [],
  events = [],
  matters = [],
  onCancelEvent,
  onCreateEvent,
  onRetryCalendarSync,
  onUpdateEvent,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('agenda');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('upcoming');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(events[0]?.id || null);
  const [currentDate, setCurrentDate] = useState<Date>(new Date());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isRetryingCalendarSync, setIsRetryingCalendarSync] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showEditForm, setShowEditForm] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [draftEvent, setDraftEvent] = useState({
    clientAccountId: clients[0]?.id || '',
    date: '',
    durationMinutes: 60,
    matterId: '',
    meetLink: '',
    mode: 'video',
    notes: '',
    time: '',
    title: '',
    type: 'consultation',
    visibleToClient: true,
  });
  const [editEvent, setEditEvent] = useState({
    date: '',
    durationMinutes: 60,
    meetLink: '',
    mode: 'video',
    notes: '',
    time: '',
    title: '',
    type: 'consultation',
    visibleToClient: true,
  });

  useEffect(() => {
    if (!events.some((event) => event.id === selectedEventId)) {
      setSelectedEventId(events[0]?.id || null);
    }
  }, [events, selectedEventId]);

  useEffect(() => {
    setDraftEvent((current) => ({
      ...current,
      clientAccountId: current.clientAccountId || clients[0]?.id || '',
    }));
  }, [clients]);

  const activeEvent = useMemo(() => events.find(e => e.id === selectedEventId) || null, [events, selectedEventId]);

  useEffect(() => {
    if (!activeEvent) {
      setShowEditForm(false);
      return;
    }

    setEditEvent({
      date: activeEvent.date,
      durationMinutes: activeEvent.duration || 60,
      meetLink: activeEvent.meetLink || '',
      mode: activeEvent.mode,
      notes: activeEvent.notes || '',
      time: activeEvent.time?.slice(0, 5) || '',
      title: activeEvent.title,
      type: activeEvent.type,
      visibleToClient: activeEvent.visibleToClient,
    });
    setActionError(null);
    setActionMessage(null);
  }, [activeEvent]);

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (typeFilter !== 'all') {
        if (typeFilter === 'consultation' && e.type !== 'consultation') return false;
        if (typeFilter === 'hearing' && e.type !== 'hearing') return false;
        if (typeFilter === 'field-visit' && e.type !== 'field-visit') return false;
        if (typeFilter === 'deadline' && e.type !== 'deadline') return false;
      }
      return true;
    }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [events, statusFilter, typeFilter]);

  // Group events by date for agenda view
  const groupedEvents = useMemo(() => {
    const groups: { [date: string]: PlatformEvent[] } = {};
    filteredEvents.forEach(evt => {
      if (!groups[evt.date]) groups[evt.date] = [];
      groups[evt.date].push(evt);
    });
    return groups;
  }, [filteredEvents]);

  const mattersForDraftClient = useMemo(
    () => matters.filter((matter) => matter.clientId === draftEvent.clientAccountId),
    [draftEvent.clientAccountId, matters]
  );

  const getModeIcon = (mode: string, className = "w-4 h-4") => {
    switch (mode) {
      case 'video': return <Video className={`text-blue-500 ${className}`} />;
      case 'phone': return <Phone className={`text-emerald-500 ${className}`} />;
      case 'in-person':
      case 'court':
      case 'office': return <MapPin className={`text-amber-500 ${className}`} />;
      default: return <CalendarIcon className={`text-gray-400 ${className}`} />;
    }
  };

  const getTypeColor = (type: string) => {
    switch(type) {
      case 'hearing': return 'bg-red-50 text-red-700 border-red-100';
      case 'consultation': return 'bg-blue-50 text-blue-700 border-blue-100';
      case 'field-visit': return 'bg-emerald-50 text-emerald-700 border-emerald-100';
      case 'deadline': return 'bg-amber-50 text-amber-700 border-amber-100';
      default: return 'bg-gray-50 text-gray-700 border-gray-100';
    }
  };

  const getStatusStyle = (status: string) => {
    switch(status) {
      case 'upcoming': return 'border-l-blue-500';
      case 'completed': return 'border-l-emerald-500 opacity-70';
      case 'cancelled': return 'border-l-red-500 opacity-50';
      case 'rescheduled': return 'border-l-amber-500';
      default: return 'border-l-gray-300';
    }
  };

  const getCalendarSyncLabel = (event: PlatformEvent) => {
    switch (event.calendarSyncStatus) {
      case 'synced':
        return 'Google Calendar synced';
      case 'cancelled':
        return 'Google Calendar event cancelled';
      case 'failed':
        return 'Google sync failed; event is stored locally';
      case 'pending':
        return 'Google Calendar sync pending';
      case 'local':
        return 'Local/manual calendar mode';
      default:
        return 'Google Calendar disabled';
    }
  };

  const getReminderLabel = (event: PlatformEvent) => {
    if (event.reminderStatus === 'scheduled') {
      return `${event.reminderCount || 0} pending reminder${event.reminderCount === 1 ? '' : 's'}`;
    }

    if (event.reminderStatus === 'cancelled') {
      return 'Reminders cancelled';
    }

    return event.visibleToClient ? 'No future reminders due' : 'Hidden from client reminders';
  };

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col -m-6 p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-medium text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Meetings & Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">Admin scheduling, meeting oversight, and matter deadlines.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 p-1 rounded-lg">
            <button 
              onClick={() => setViewMode('agenda')}
              className={`p-1.5 rounded-md flex items-center transition ${viewMode === 'agenda' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
              title="Agenda View"
            >
              <List className="w-4 h-4" />
            </button>
            <button 
              className="p-1.5 rounded-md flex items-center text-gray-300 cursor-not-allowed"
              disabled
              title="Agenda is the active scheduling view."
              type="button"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
          </div>
          <button
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition flex items-center gap-2"
            onClick={() => setShowCreateForm((current) => !current)}
            type="button"
          >
            <Plus className="w-4 h-4" /> Schedule Event
          </button>
        </div>
      </div>

      {showCreateForm ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
          <h3 className="text-lg font-medium text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
            Schedule Event
          </h3>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Client</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                onChange={(event) =>
                  setDraftEvent((current) => ({
                    ...current,
                    clientAccountId: event.target.value,
                    matterId: '',
                  }))
                }
                value={draftEvent.clientAccountId}
              >
                <option value="">Select client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Matter</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                onChange={(event) =>
                  setDraftEvent((current) => ({
                    ...current,
                    matterId: event.target.value,
                  }))
                }
                value={draftEvent.matterId}
              >
                <option value="">General / no matter</option>
                {mattersForDraftClient.map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Title</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                onChange={(event) => setDraftEvent((current) => ({ ...current, title: event.target.value }))}
                value={draftEvent.title}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                onChange={(event) => setDraftEvent((current) => ({ ...current, type: event.target.value as FilterType }))}
                value={draftEvent.type}
              >
                <option value="consultation">Consultation</option>
                <option value="hearing">Hearing</option>
                <option value="field-visit">Field Visit</option>
                <option value="deadline">Deadline</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                onChange={(event) => setDraftEvent((current) => ({ ...current, date: event.target.value }))}
                type="date"
                value={draftEvent.date}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Time</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                onChange={(event) => setDraftEvent((current) => ({ ...current, time: event.target.value }))}
                type="time"
                value={draftEvent.time}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Mode</label>
              <select
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                onChange={(event) => setDraftEvent((current) => ({ ...current, mode: event.target.value }))}
                value={draftEvent.mode}
              >
                <option value="video">Video</option>
                <option value="phone">Phone</option>
                <option value="office">Office</option>
                <option value="court">Court</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Duration (minutes)</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                min={15}
                onChange={(event) =>
                  setDraftEvent((current) => ({
                    ...current,
                    durationMinutes: Number(event.target.value || 60),
                  }))
                }
                type="number"
                value={draftEvent.durationMinutes}
              />
            </div>
            {draftEvent.mode === 'video' ? (
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Manual Meeting Link</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  onChange={(event) => setDraftEvent((current) => ({ ...current, meetLink: event.target.value }))}
                  placeholder="Optional; Google Meet is filled after sync when configured"
                  value={draftEvent.meetLink}
                />
              </div>
            ) : null}
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-500 mb-1">Notes</label>
              <textarea
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                onChange={(event) => setDraftEvent((current) => ({ ...current, notes: event.target.value }))}
                rows={3}
                value={draftEvent.notes}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="inline-flex items-center gap-2 text-sm text-gray-600">
              <input
                checked={draftEvent.visibleToClient}
                className="rounded border-gray-300"
                onChange={(event) =>
                  setDraftEvent((current) => ({ ...current, visibleToClient: event.target.checked }))
                }
                type="checkbox"
              />
              Visible to client portal
            </label>
            <div className="flex gap-2">
              <button
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600"
                onClick={() => setShowCreateForm(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg disabled:opacity-50"
                disabled={!draftEvent.clientAccountId || !draftEvent.title || !draftEvent.date || !draftEvent.time || !onCreateEvent || isSubmitting}
                onClick={() => {
                  if (!onCreateEvent) {
                    return;
                  }

                  setActionError(null);
                  setActionMessage(null);
                  setIsSubmitting(true);
                  void onCreateEvent(draftEvent)
                    .then(() => {
                      setActionMessage('Event scheduled.');
                      setShowCreateForm(false);
                      setDraftEvent((current) => ({
                        ...current,
                        date: '',
                        durationMinutes: 60,
                        matterId: '',
                        meetLink: '',
                        notes: '',
                        time: '',
                        title: '',
                        type: 'consultation',
                        visibleToClient: true,
                      }));
                    })
                    .catch((error) => {
                      setActionError(
                        error instanceof Error ? error.message : 'Unable to create event.'
                      );
                    })
                    .finally(() => setIsSubmitting(false));
                }}
                type="button"
              >
                Create Event
              </button>
            </div>
          </div>
          {actionError && <p className="text-sm text-red-600">{actionError}</p>}
        </div>
      ) : null}

      {actionMessage && !showCreateForm ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {actionMessage}
        </div>
      ) : null}
      {actionError && !showCreateForm ? (
        <div className="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <div className="grid min-h-0 min-w-0 flex-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
        
        {/* Left Column: Agenda/Calendar */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {/* Controls Bar */}
          <div className="p-4 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4 bg-gray-50/50">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button className="p-1 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded" onClick={() => setCurrentDate((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))} type="button"><ChevronLeft className="w-4 h-4" /></button>
                <span className="text-sm font-medium text-gray-900 min-w-[120px] text-center">
                  {currentDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
                <button className="p-1 text-gray-400 hover:text-gray-900 bg-white border border-gray-200 rounded" onClick={() => setCurrentDate((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))} type="button"><ChevronRight className="w-4 h-4" /></button>
              </div>
              <button className="text-xs font-medium text-blue-600 bg-blue-50 px-3 py-1.5 rounded-md hover:bg-blue-100 transition" onClick={() => setCurrentDate(new Date())} type="button">
                Today
              </button>
            </div>
            
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as FilterStatus)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none bg-white min-w-[120px]"
              >
                <option value="all">All Statuses</option>
                <option value="upcoming">Upcoming</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </select>

              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value as FilterType)}
                className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none bg-white min-w-[130px]"
              >
                <option value="all">All Event Types</option>
                <option value="consultation">Consultations</option>
                <option value="hearing">Hearings</option>
                <option value="field-visit">Field Visits</option>
                <option value="deadline">Deadlines</option>
              </select>
            </div>
          </div>

          {/* View Area */}
          <div className="flex-1 overflow-y-auto bg-gray-50/30 p-4">
            {viewMode === 'agenda' ? (
              <div className="space-y-8 max-w-4xl mx-auto">
                {Object.entries(groupedEvents).map(([date, events]) => (
                  <div key={date}>
                    <h3 className="text-sm font-bold text-gray-900 border-b border-gray-200 pb-2 mb-4 sticky top-0 bg-gray-50/90 backdrop-blur z-10">
                      {new Date(date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                    </h3>
                    <div className="space-y-3 pl-2">
                      {events.map(evt => (
                        <div 
                          key={evt.id} 
                          onClick={() => setSelectedEventId(evt.id)}
                          className={`flex items-stretch bg-white border border-gray-200 rounded-lg shadow-sm cursor-pointer transition overflow-hidden border-l-4 group hover:shadow-md ${getStatusStyle(evt.status)} ${selectedEventId === evt.id ? 'ring-2 ring-blue-500/20' : ''}`}
                        >
                          <div className="w-24 p-4 border-r border-gray-100 flex flex-col items-center justify-center shrink-0 bg-gray-50/50">
                            <span className="text-sm font-bold text-gray-900">{evt.time.split(' ')[0]}</span>
                            <span className="text-xs font-medium text-gray-500">{evt.time.split(' ')[1]}</span>
                            {evt.duration > 0 && <span className="text-[10px] text-gray-400 mt-1">{evt.duration}m</span>}
                          </div>
                          <div className="flex-1 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 min-w-0">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium text-gray-900 truncate">{evt.title}</h4>
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${getTypeColor(evt.type)} uppercase tracking-wider`}>
                                  {evt.type.replace('-', ' ')}
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-xs text-gray-500">
                                {evt.clientName && (
                                  <span className="flex items-center gap-1"><User className="w-3.5 h-3.5" /> {evt.clientName}</span>
                                )}
                                <span className="flex items-center gap-1">
                                  {getModeIcon(evt.mode, "w-3.5 h-3.5")} 
                                  <span className="capitalize">{evt.mode.replace('-', ' ')}</span>
                                </span>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-3 shrink-0">
                              {evt.status === 'upcoming' && evt.meetLink && (
                                <a 
                                  href={evt.meetLink} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  onClick={(e) => e.stopPropagation()}
                                  className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-medium rounded transition flex items-center gap-1.5"
                                >
                                  <Video className="w-3.5 h-3.5" /> Join
                                </a>
                              )}
                              <StatusBadge status={evt.status} size="sm" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {filteredEvents.length === 0 && (
                  <div className="text-center py-12">
                    <CalendarIcon className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-gray-900">No events found</h3>
                    <p className="text-gray-500 mt-1">Try adjusting your filters or date range.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-center">
                <div>
                  <LayoutGrid className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900">Calendar Grid Disabled</h3>
                  <p className="text-gray-500 mt-1 text-sm max-w-xs mx-auto">Agenda view is the live DB-backed schedule. Calendar grid is a future view.</p>
                  <button onClick={() => setViewMode('agenda')} className="mt-4 text-blue-600 text-sm font-medium hover:underline">Switch to Agenda</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Meeting Detail Drawer/Panel */}
        {activeEvent ? (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col overflow-hidden h-full">
            <div className="p-5 border-b border-gray-100 flex items-start justify-between bg-gray-50/50">
              <div>
                <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded border mb-2 uppercase tracking-wider ${getTypeColor(activeEvent.type)}`}>
                  {activeEvent.type.replace('-', ' ')}
                </span>
                <h2 className="text-lg font-medium text-gray-900 leading-tight">{activeEvent.title}</h2>
              </div>
              <div className="flex gap-2">
                <button
                  className="p-1.5 text-gray-300 rounded cursor-not-allowed"
                  disabled
                  title="Additional event actions are not enabled yet."
                  type="button"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Core Details */}
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <CalendarIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{new Date(activeEvent.date).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>
                    <p className="text-xs text-gray-500">{activeEvent.time} ({activeEvent.duration > 0 ? `${activeEvent.duration} minutes` : 'All Day'})</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                    {getModeIcon(activeEvent.mode)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 capitalize">{activeEvent.mode.replace('-', ' ')}</p>
                    {activeEvent.location ? (
                      <p className="text-xs text-gray-500 truncate">{activeEvent.location}</p>
                    ) : activeEvent.meetLink ? (
                      <a href={activeEvent.meetLink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate block">
                        {activeEvent.meetLink}
                      </a>
                    ) : null}
                  </div>
                </div>

                {activeEvent.clientName && (
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">Client: {activeEvent.clientName}</p>
                      {activeEvent.matterTitle && (
                        <p className="text-xs text-gray-500 truncate">Matter: {activeEvent.matterTitle}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Admin Controls */}
              <div className="pt-5 border-t border-gray-100 space-y-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Event Settings</h3>
                
                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    {activeEvent.visibleToClient ? <Eye className="w-4 h-4 text-blue-600" /> : <EyeOff className="w-4 h-4 text-amber-600" />}
                    <div>
                      <p className="text-sm font-medium text-gray-900">Client Visibility</p>
                      <p className="text-xs text-gray-500">{activeEvent.visibleToClient ? 'Visible on client portal' : 'Hidden internal event'}</p>
                    </div>
                  </div>
                  <button
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${activeEvent.visibleToClient ? 'bg-blue-600' : 'bg-gray-300'}`}
                    disabled={!onUpdateEvent || isUpdating || activeEvent.status === 'cancelled'}
                    onClick={() => {
                      if (!onUpdateEvent) {
                        return;
                      }

                      setActionError(null);
                      setActionMessage(null);
                      setIsUpdating(true);
                      void onUpdateEvent(activeEvent.id, {
                        visibleToClient: !activeEvent.visibleToClient,
                      })
                        .then(() => setActionMessage('Event visibility updated.'))
                        .catch((error) =>
                          setActionError(error instanceof Error ? error.message : 'Unable to update visibility.')
                        )
                        .finally(() => setIsUpdating(false));
                    }}
                    type="button"
                  >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${activeEvent.visibleToClient ? 'translate-x-5' : 'translate-x-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="w-4 h-4 text-gray-600" />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Automated Reminders</p>
                      <p className="text-xs text-gray-500">{getReminderLabel(activeEvent)}</p>
                    </div>
                  </div>
                  <button
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                      activeEvent.reminderStatus === 'scheduled' ? 'bg-blue-600' : 'bg-gray-300'
                    }`}
                    disabled
                    title="Reminders are managed automatically from event time and visibility."
                    type="button"
                  >
                    <span className="inline-block h-3 w-3 transform translate-x-5 rounded-full bg-white transition-transform" />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200 bg-gray-50/50">
                  <div className="flex items-center gap-3">
                    <CheckCircle className={`w-4 h-4 ${
                      activeEvent.calendarSyncStatus === 'failed'
                        ? 'text-red-600'
                        : activeEvent.calendarSyncStatus === 'pending'
                          ? 'text-blue-600'
                        : activeEvent.calendarSyncStatus === 'synced'
                          ? 'text-emerald-600'
                          : 'text-gray-600'
                    }`} />
                    <div>
                      <p className="text-sm font-medium text-gray-900">Calendar Sync</p>
                      <p className="text-xs text-gray-500">{getCalendarSyncLabel(activeEvent)}</p>
                      <p className="mt-1 text-xs text-gray-500">
                        Sync mode: {activeEvent.calendarOwnerEmail ? 'Workspace delegation' : 'Local/manual'}
                      </p>
                      {activeEvent.calendarOwnerEmail ? (
                        <p className="mt-1 text-xs text-gray-500">Calendar owner: {activeEvent.calendarOwnerEmail}</p>
                      ) : null}
                      {activeEvent.googleAttendeeStatus ? (
                        <p className="mt-1 text-xs text-gray-500">Client invite: {activeEvent.googleAttendeeStatus.replace(/_/g, ' ')}</p>
                      ) : null}
                      {activeEvent.calendarSyncError ? (
                        <p className="mt-1 text-xs text-red-600">{activeEvent.calendarSyncError}</p>
                      ) : activeEvent.calendarSyncedAt ? (
                        <p className="mt-1 text-xs text-gray-400">Last synced {activeEvent.calendarSyncedAt}</p>
                      ) : null}
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={!onRetryCalendarSync || isRetryingCalendarSync}
                    onClick={() => {
                      if (!onRetryCalendarSync) {
                        return;
                      }

                      setActionError(null);
                      setActionMessage(null);
                      setIsRetryingCalendarSync(true);
                      void onRetryCalendarSync(activeEvent.id)
                        .then(() => setActionMessage('Calendar sync retried.'))
                        .catch((error) =>
                          setActionError(error instanceof Error ? error.message : 'Unable to retry calendar sync.')
                        )
                        .finally(() => setIsRetryingCalendarSync(false));
                    }}
                    type="button"
                  >
                    {isRetryingCalendarSync ? 'Retrying...' : 'Retry Sync'}
                  </button>
                </div>
              </div>

              {showEditForm && activeEvent.status !== 'cancelled' && (
                <div className="pt-5 border-t border-gray-100 space-y-3">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Edit Event</h3>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    onChange={(event) => setEditEvent((current) => ({ ...current, title: event.target.value }))}
                    value={editEvent.title}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      onChange={(event) => setEditEvent((current) => ({ ...current, date: event.target.value }))}
                      type="date"
                      value={editEvent.date}
                    />
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      onChange={(event) => setEditEvent((current) => ({ ...current, time: event.target.value }))}
                      type="time"
                      value={editEvent.time}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      onChange={(event) => setEditEvent((current) => ({ ...current, type: event.target.value }))}
                      value={editEvent.type}
                    >
                      <option value="consultation">Consultation</option>
                      <option value="hearing">Hearing</option>
                      <option value="field-visit">Field Visit</option>
                      <option value="deadline">Deadline</option>
                    </select>
                    <input
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      min={15}
                      onChange={(event) =>
                        setEditEvent((current) => ({
                          ...current,
                          durationMinutes: Number(event.target.value || 60),
                        }))
                      }
                      type="number"
                      value={editEvent.durationMinutes}
                    />
                  </div>
                  <select
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    onChange={(event) => setEditEvent((current) => ({ ...current, mode: event.target.value }))}
                    value={editEvent.mode}
                  >
                    <option value="video">Video</option>
                    <option value="phone">Phone</option>
                    <option value="office">Office</option>
                    <option value="court">Court</option>
                  </select>
                  {editEvent.mode === 'video' && (
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                      onChange={(event) => setEditEvent((current) => ({ ...current, meetLink: event.target.value }))}
                      placeholder="Manual meeting link"
                      type="url"
                      value={editEvent.meetLink}
                    />
                  )}
                  <textarea
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                    onChange={(event) => setEditEvent((current) => ({ ...current, notes: event.target.value }))}
                    rows={3}
                    value={editEvent.notes}
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600"
                      onClick={() => setShowEditForm(false)}
                      type="button"
                    >
                      Close
                    </button>
                    <button
                      className="rounded-lg bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                      disabled={!onUpdateEvent || isUpdating || !editEvent.title || !editEvent.date || !editEvent.time}
                      onClick={() => {
                        if (!onUpdateEvent) {
                          return;
                        }

                        setActionError(null);
                        setActionMessage(null);
                        setIsUpdating(true);
                        void onUpdateEvent(activeEvent.id, {
                          date: editEvent.date,
                          durationMinutes: editEvent.durationMinutes,
                          meetLink: editEvent.mode === 'video' ? editEvent.meetLink || null : null,
                          mode: editEvent.mode,
                          notes: editEvent.notes || null,
                          time: editEvent.time,
                          title: editEvent.title,
                          type: editEvent.type,
                          visibleToClient: editEvent.visibleToClient,
                        })
                          .then(() => {
                            setActionMessage('Event updated.');
                            setShowEditForm(false);
                          })
                          .catch((error) =>
                            setActionError(error instanceof Error ? error.message : 'Unable to update event.')
                          )
                          .finally(() => setIsUpdating(false));
                      }}
                      type="button"
                    >
                      Save Event
                    </button>
                  </div>
                </div>
              )}

              {/* Notes */}
              {activeEvent.notes && (
                <div className="pt-5 border-t border-gray-100">
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Event Notes</h3>
                  <div className="bg-amber-50/50 border border-amber-100 p-3 rounded-lg text-sm text-gray-800 whitespace-pre-wrap">
                    {activeEvent.notes}
                  </div>
                </div>
              )}

            </div>

            {/* Actions Footer */}
            {activeEvent.status === 'upcoming' && (
              <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-3 shrink-0">
                <button
                  className="flex-1 bg-white border border-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 transition disabled:opacity-50"
                  disabled={!onUpdateEvent || isUpdating}
                  onClick={() => setShowEditForm((current) => !current)}
                  type="button"
                >
                  Edit / Reschedule
                </button>
                <button
                  className="flex-1 bg-red-50 border border-red-100 text-red-700 py-2 rounded-lg text-sm font-medium hover:bg-red-100 transition disabled:opacity-50"
                  disabled={!onCancelEvent || isCancelling}
                  onClick={() => {
                    if (!onCancelEvent) {
                      return;
                    }

                    const reason = window.prompt('Optional cancellation reason') || undefined;

                    setActionError(null);
                    setActionMessage(null);
                    setIsCancelling(true);
                    void onCancelEvent(activeEvent.id, reason)
                      .then(() => setActionMessage('Event cancelled.'))
                      .catch((error) =>
                        setActionError(error instanceof Error ? error.message : 'Unable to cancel event.')
                      )
                      .finally(() => setIsCancelling(false));
                  }}
                  type="button"
                >
                  Cancel Event
                </button>
                {activeEvent.meetLink && (
                  <a href={activeEvent.meetLink} target="_blank" rel="noopener noreferrer" className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition flex items-center justify-center gap-2">
                    <Video className="w-4 h-4" /> Join Meet
                  </a>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col items-center justify-center p-8 text-center h-full">
            <CalendarIcon className="w-12 h-12 text-gray-200 mb-4" />
            <h3 className="text-lg font-medium text-gray-900">No Event Selected</h3>
            <p className="text-sm text-gray-500 mt-1 max-w-sm">Select an event from the calendar to view its details, manage visibility, or join a call.</p>
          </div>
        )}
      </div>
    </div>
  );
};
