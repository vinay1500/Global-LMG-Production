import React, { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Search, Filter, ChevronDown, Check, User, Mail, Phone, Clock, FileText, Briefcase, Plus, MoreVertical, 
  LayoutGrid, List as ListIcon, Shield, CreditCard, MessageSquare, ArrowRight, Star, AlertCircle, Building2, Loader2
} from 'lucide-react';
import { formatCurrency, formatDate } from '../data/formatters';
import type { PlatformUser } from '../data/adminTypes';
import { StatusBadge } from '../components/dashboard/StatusBadge';
import { EmptyState } from './EmptyState';
import type { ClientListItem, CreateClientPayload, CreateClientResponse } from '../lib/api/contracts';

type DirectoryClient = PlatformUser | ClientListItem;

export const ClientDirectory = ({ 
  clients = [],
  createRequested,
  onCreateClient,
  onCreateRequestHandled,
  onSelectClient 
}: { 
  clients?: DirectoryClient[];
  createRequested?: boolean;
  onCreateClient?: (payload: CreateClientPayload) => Promise<CreateClientResponse>;
  onCreateRequestHandled?: () => void;
  onSelectClient: (client: PlatformUser) => void 
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list');
  const [filterOpen, setFilterOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createForm, setCreateForm] = useState<CreateClientPayload>({
    clientType: 'individual',
    displayName: '',
    email: '',
    phone: '',
    portalAccessEnabled: true,
    primaryContactName: '',
    city: '',
    state: '',
    notes: '',
  });
  const [activeFilters, setActiveFilters] = useState<Record<string, string>>({
    lifecycle: 'all',
    balance: 'all',
    matters: 'all',
    messages: 'all',
    activity: 'all'
  });

  useEffect(() => {
    if (createRequested && onCreateClient) {
      setCreateOpen(true);
      onCreateRequestHandled?.();
    }
  }, [createRequested, onCreateClient, onCreateRequestHandled]);

  const resetCreateForm = () => {
    setCreateError('');
    setCreateForm({
      clientType: 'individual',
      displayName: '',
      email: '',
      phone: '',
      portalAccessEnabled: true,
      primaryContactName: '',
      city: '',
      state: '',
      notes: '',
    });
  };

  const closeCreateModal = () => {
    if (isCreating) {
      return;
    }

    setCreateOpen(false);
    resetCreateForm();
  };

  const submitCreateClient = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!onCreateClient) {
      setCreateError('Client creation is not available in this workspace.');
      return;
    }

    if (!createForm.displayName.trim() || !createForm.primaryContactName.trim() || !createForm.email.trim()) {
      setCreateError('Client name, primary contact, and email are required.');
      return;
    }

    setCreateError('');
    setIsCreating(true);

    try {
      await onCreateClient({
        ...createForm,
        city: createForm.city?.trim() || undefined,
        displayName: createForm.displayName.trim(),
        email: createForm.email.trim(),
        notes: createForm.notes?.trim() || undefined,
        phone: createForm.phone?.trim() || undefined,
        primaryContactName: createForm.primaryContactName.trim(),
        state: createForm.state?.trim() || undefined,
      });
      setCreateOpen(false);
      resetCreateForm();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to create client.');
    } finally {
      setIsCreating(false);
    }
  };

  const getClientStats = (client: DirectoryClient) => {
    const liveClient = client as Partial<ClientListItem>;

    if (
      typeof liveClient.activeMatters === 'number' &&
      typeof liveClient.totalDue === 'number' &&
      typeof liveClient.mattersCount === 'number' &&
      typeof liveClient.hasUnread === 'boolean'
    ) {
      return {
        activeMatters: liveClient.activeMatters,
        hasUnread: liveClient.hasUnread,
        mattersCount: liveClient.mattersCount,
        totalDue: liveClient.totalDue,
      };
    }

    return {
      activeMatters: 0,
      hasUnread: false,
      mattersCount: 0,
      totalDue: 0,
    };
  };

  const filteredClients = useMemo(() => {
    return clients.filter(c => {
      // Base client lifecycle
      if (activeFilters.lifecycle !== 'all') {
        if (activeFilters.lifecycle === 'client' && c.lifecycle !== 'client') return false;
        if (activeFilters.lifecycle === 'lead' && c.lifecycle !== 'lead') return false;
      } else {
        // Default to showing clients and leads
        if (c.lifecycle !== 'client' && c.lifecycle !== 'lead') return false;
      }

      // Text search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch = 
          c.name.toLowerCase().includes(q) || 
          c.email.toLowerCase().includes(q) ||
          c.phone?.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      const stats = getClientStats(c);

      // Balance
      if (activeFilters.balance === 'has-balance' && stats.totalDue === 0) return false;
      if (activeFilters.balance === 'clear' && stats.totalDue > 0) return false;

      // Matters
      if (activeFilters.matters === 'active' && stats.activeMatters === 0) return false;
      if (activeFilters.matters === 'none' && stats.mattersCount > 0) return false;

      // Messages
      if (activeFilters.messages === 'unread' && !stats.hasUnread) return false;

      return true;
    });
  }, [searchQuery, activeFilters, clients]);

  const updateFilter = (key: string, value: string) => {
    setActiveFilters(prev => ({ ...prev, [key]: prev[key] === value ? 'all' : value }));
  };

  const renderFilterSection = (title: string, key: string, options: { id: string, label: string }[]) => (
    <div className="mb-6">
      <h4 className="text-xs font-semibold text-[#8C8981] uppercase tracking-wider mb-3 px-1">{title}</h4>
      <div className="space-y-1">
        {options.map(opt => {
          const isActive = activeFilters[key] === opt.id;
          return (
            <label 
              key={opt.id} 
              className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors group ${isActive ? 'bg-[#EAD2A8]/20 text-[#2C2B29]' : 'hover:bg-white text-[#5A7C96]'}`}
              onClick={() => updateFilter(key, opt.id)}
            >
              <span className={`text-sm ${isActive ? 'font-medium' : ''}`}>{opt.label}</span>
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isActive ? 'bg-[#C19A5B] border-[#C19A5B]' : 'border-[#E6E4DD] bg-white group-hover:border-[#C19A5B]'}`}>
                {isActive && <Check className="w-3 h-3 text-white" />}
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex h-full bg-[#FCFBF8] animate-in fade-in duration-500 relative">
      {/* Mobile Overlay */}
      <AnimatePresence>
        {filterOpen && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setFilterOpen(false)}
            className="fixed inset-0 bg-[#2C2B29]/20 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Left Filter Rail */}
      <motion.div 
        className={`fixed lg:static inset-y-0 left-0 z-50 w-64 border-r border-[#E6E4DD] bg-[#F9F8F6] p-5 flex flex-col shrink-0 overflow-y-auto transform transition-transform duration-300 lg:translate-x-0 ${filterOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center justify-between mb-6 px-1">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[#8C8981]" />
            <h3 className="text-sm font-semibold text-[#2C2B29] uppercase tracking-wider">Refine Directory</h3>
          </div>
          <button onClick={() => setFilterOpen(false)} className="lg:hidden p-1 text-[#8C8981] hover:text-[#2C2B29] hover:bg-[#E6E4DD] rounded transition">
            ✕
          </button>
        </div>

        <div className="flex-1">
          {renderFilterSection('Lifecycle Stage', 'lifecycle', [
            { id: 'client', label: 'Active Clients' },
            { id: 'lead', label: 'Inbound Leads' }
          ])}

          <div className="mb-6">
            <h4 className="text-xs font-semibold text-[#8C8981] uppercase tracking-wider mb-3 px-1">
              Verification Status
            </h4>
            <div className="rounded-xl border border-dashed border-[#E6E4DD] bg-white/70 px-3 py-3">
              <p className="text-sm font-medium text-[#2C2B29]">Not configured</p>
              <p className="text-xs text-[#8C8981] mt-1">
                KYC/verification filters will appear after the verification status field is DB-backed.
              </p>
            </div>
          </div>

          {renderFilterSection('Unpaid Balance', 'balance', [
            { id: 'has-balance', label: 'Has Outstanding' },
            { id: 'clear', label: 'Clear Balance' }
          ])}

          {renderFilterSection('Active Matters', 'matters', [
            { id: 'active', label: 'Has Active Matters' },
            { id: 'none', label: 'No Active Matters' }
          ])}

          {renderFilterSection('Communications', 'messages', [
            { id: 'unread', label: 'Unread Messages' }
          ])}
        </div>

        {Object.values(activeFilters).some(v => v !== 'all') && (
          <div className="pt-4 border-t border-[#E6E4DD]">
            <button 
              onClick={() => setActiveFilters({ lifecycle: 'all', balance: 'all', matters: 'all', messages: 'all', activity: 'all' })}
              className="w-full py-2 text-xs font-medium text-[#8C8981] hover:text-[#2C2B29] hover:bg-white rounded-lg transition-colors"
            >
              Clear All Filters
            </button>
          </div>
        )}
      </motion.div>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header & Controls */}
        <div className="p-6 border-b border-[#E6E4DD] bg-white shrink-0 z-10 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-medium text-[#2C2B29]" style={{ fontFamily: "'Playfair Display', serif" }}>Client Directory</h2>
              <p className="text-sm text-[#8C8981] mt-1">Manage client profiles, lifecycles, and access status.</p>
            </div>
            <button
              className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium shadow-sm transition ${
                onCreateClient
                  ? 'bg-[#2C2B29] text-white hover:bg-[#4A4946]'
                  : 'cursor-not-allowed border border-dashed border-[#D8D5CC] bg-[#F4F1EA] text-[#8C8981]'
              }`}
              disabled={!onCreateClient}
              onClick={() => {
                resetCreateForm();
                setCreateOpen(true);
              }}
              title={onCreateClient ? 'Create a new client account.' : 'Client creation is unavailable in this workspace.'}
              type="button"
            >
              <Plus className="w-4 h-4" /> New Client
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-2">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A8A69F]" />
              <input 
                type="text" 
                placeholder="Search by name, email, or phone..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm border border-[#E6E4DD] rounded-lg focus:outline-none focus:border-[#C19A5B] bg-[#FCFBF8] shadow-sm transition-colors"
              />
            </div>
            
            <div className="flex items-center justify-between w-full sm:w-auto gap-3">
              <button 
                onClick={() => setFilterOpen(true)}
                className="lg:hidden flex items-center gap-2 px-3 py-2 text-sm font-medium bg-white border border-[#E6E4DD] text-[#2C2B29] rounded-lg shadow-sm hover:bg-[#F4F1EA] transition-colors"
              >
                <Filter className="w-4 h-4" /> Filters
                {Object.values(activeFilters).filter(v => v !== 'all').length > 0 && (
                  <span className="w-4 h-4 bg-[#C19A5B] text-white text-[10px] rounded-full flex items-center justify-center">
                    {Object.values(activeFilters).filter(v => v !== 'all').length}
                  </span>
                )}
              </button>

              <div className="flex items-center bg-[#F4F1EA] rounded-lg p-1 border border-[#E6E4DD] shadow-sm">
                <button 
                  onClick={() => setViewMode('list')}
                  className={`p-1.5 rounded-md transition-all flex items-center justify-center ${viewMode === 'list' ? 'bg-white text-[#2C2B29] shadow-sm' : 'text-[#8C8981] hover:text-[#2C2B29]'}`}
                  title="List View"
                >
                  <ListIcon className="w-4 h-4" />
                </button>
                <button 
                  onClick={() => setViewMode('card')}
                  className={`p-1.5 rounded-md transition-all flex items-center justify-center ${viewMode === 'card' ? 'bg-white text-[#2C2B29] shadow-sm' : 'text-[#8C8981] hover:text-[#2C2B29]'}`}
                  title="Card View"
                >
                  <LayoutGrid className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#FCFBF8]">
          <div className="max-w-7xl mx-auto">
            {filteredClients.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#E6E4DD] shadow-sm flex items-center justify-center p-12">
                <EmptyState 
                  icon={Search} 
                  title="No clients found" 
                  description="We couldn't find any clients matching your filters or search query."
                  action={{ label: "Clear Search & Filters", onClick: () => { setSearchQuery(''); setActiveFilters({ lifecycle: 'all', balance: 'all', matters: 'all', messages: 'all', activity: 'all' }) } }}
                />
              </div>
            ) : viewMode === 'list' ? (
              <div className="bg-white border border-[#E6E4DD] rounded-xl shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm whitespace-nowrap">
                    <thead>
                      <tr className="bg-[#F9F8F6] text-[#8C8981] border-b border-[#E6E4DD]">
                        <th className="font-semibold px-5 py-3 tracking-wider text-[11px] uppercase">Client Profile</th>
                        <th className="font-semibold px-5 py-3 tracking-wider text-[11px] uppercase">Contact</th>
                        <th className="font-semibold px-5 py-3 tracking-wider text-[11px] uppercase">Stage</th>
                        <th className="font-semibold px-5 py-3 tracking-wider text-[11px] uppercase">Active Matters</th>
                        <th className="font-semibold px-5 py-3 tracking-wider text-[11px] uppercase">Outstanding</th>
                        <th className="font-semibold px-5 py-3 tracking-wider text-[11px] uppercase">Last Activity</th>
                        <th className="font-semibold px-5 py-3 w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F4F1EA]">
                      {filteredClients.map(client => {
                        const stats = getClientStats(client);
                        return (
                          <tr 
                            key={client.id} 
                            onClick={() => onSelectClient(client)}
                            className="hover:bg-[#FCFBF8] transition-colors cursor-pointer group"
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-[#EFF3F6] text-[#5A7C96] flex items-center justify-center font-medium border border-[#D3DFE8] relative">
                                  {client.name.charAt(0)}
                                  {stats.hasUnread && (
                                    <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#d4183d] rounded-full border-2 border-white" />
                                  )}
                                </div>
                                <div>
                                  <p className="font-medium text-[#2C2B29] group-hover:text-[#C19A5B] transition-colors">{client.name}</p>
                                  <div className="flex items-center gap-1.5 text-xs text-[#8C8981] mt-0.5">
                                    <Building2 className="w-3 h-3" />
                                    <span>{client.companyName || 'Individual'}</span>
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-col gap-1">
                                <span className="text-[#2C2B29] flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-[#8C8981]" /> {client.email}</span>
                                <span className="text-[#8C8981] text-xs flex items-center gap-2"><Phone className="w-3.5 h-3.5" /> {client.phone}</span>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <StatusBadge status={client.lifecycle} size="sm" />
                            </td>
                            <td className="px-5 py-4">
                              {stats.activeMatters > 0 ? (
                                <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-[#FDF8EF] text-[#997A48] text-xs font-medium border border-[#EAD2A8]">
                                  <Briefcase className="w-3.5 h-3.5" /> {stats.activeMatters} Active
                                </span>
                              ) : (
                                <span className="text-[#A8A69F] text-xs font-medium bg-[#F4F1EA] px-2 py-1 rounded border border-[#E6E4DD]">No active</span>
                              )}
                            </td>
                            <td className="px-5 py-4">
                              {stats.totalDue > 0 ? (
                                <span className="inline-flex items-center gap-1.5 font-medium text-[#d4183d] bg-[#FDE8EC] px-2 py-1 rounded text-xs border border-[#F5C2C7]">
                                  <AlertCircle className="w-3.5 h-3.5" /> {formatCurrency(stats.totalDue)}
                                </span>
                              ) : (
                                <span className="text-[#8C8981] text-xs flex items-center gap-1.5"><Check className="w-3.5 h-3.5 text-[#A8A69F]" /> Clear</span>
                              )}
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[#2C2B29]">{formatDate(client.lastActiveAt)}</span>
                                <span className="text-xs text-[#8C8981]">Portal Login</span>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <button className="p-1.5 text-[#8C8981] hover:text-[#2C2B29] rounded-md hover:bg-[#E6E4DD] transition opacity-0 group-hover:opacity-100 focus:opacity-100">
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {filteredClients.map(client => {
                  const stats = getClientStats(client);
                  return (
                    <div 
                      key={client.id}
                      onClick={() => onSelectClient(client)}
                      className="bg-white border border-[#E6E4DD] rounded-xl p-5 shadow-sm hover:shadow-md hover:border-[#C19A5B] transition-all cursor-pointer group flex flex-col relative"
                    >
                      {stats.hasUnread && (
                        <div className="absolute top-4 right-4 w-2 h-2 bg-[#d4183d] rounded-full" title="Unread Messages" />
                      )}
                      
                      <div className="flex items-center gap-4 mb-4">
                        <div className="w-12 h-12 rounded-full bg-[#EFF3F6] text-[#5A7C96] flex items-center justify-center font-medium text-lg border border-[#D3DFE8] shrink-0 group-hover:bg-[#EAD2A8] group-hover:text-[#997A48] group-hover:border-[#C19A5B] transition-colors">
                          {client.name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-medium text-[#2C2B29] truncate">{client.name}</h3>
                          <p className="text-xs text-[#8C8981] truncate mt-0.5">{client.companyName || 'Individual Client'}</p>
                        </div>
                      </div>
                      
                      <div className="space-y-2.5 mb-5 flex-1">
                        <div className="flex items-center text-xs text-[#5A7C96] gap-2.5 bg-[#F9F8F6] p-2 rounded-md border border-[#F4F1EA]">
                          <Mail className="w-3.5 h-3.5 text-[#8C8981] shrink-0" /> <span className="truncate">{client.email}</span>
                        </div>
                        <div className="flex items-center text-xs text-[#5A7C96] gap-2.5 bg-[#F9F8F6] p-2 rounded-md border border-[#F4F1EA]">
                          <Phone className="w-3.5 h-3.5 text-[#8C8981] shrink-0" /> <span>{client.phone}</span>
                        </div>
                      </div>
                      
                      <div className="pt-4 border-t border-[#E6E4DD] flex flex-col gap-3">
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#8C8981]">Active Matters</span>
                          <span className={`font-medium ${stats.activeMatters > 0 ? 'text-[#2C2B29]' : 'text-[#8C8981]'}`}>{stats.activeMatters}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#8C8981]">Outstanding</span>
                          <span className={`font-medium ${stats.totalDue > 0 ? 'text-[#d4183d]' : 'text-[#8C8981]'}`}>
                            {stats.totalDue > 0 ? formatCurrency(stats.totalDue) : 'Clear'}
                          </span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-[#8C8981]">Stage</span>
                          <StatusBadge status={client.lifecycle} size="sm" />
                        </div>
                      </div>

                      <div className="mt-4 pt-4 border-t border-[#E6E4DD] text-center opacity-0 group-hover:opacity-100 transition-opacity absolute bottom-0 left-0 w-full bg-white/95 backdrop-blur-sm rounded-b-xl border-t-0 pb-4">
                         <span className="text-xs font-medium text-[#C19A5B] flex items-center justify-center gap-1">Open Client 360 <ArrowRight className="w-3.5 h-3.5" /></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence>
        {createOpen && (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[80] flex items-center justify-center bg-[#2C2B29]/30 p-4 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
          >
            <motion.form
              animate={{ opacity: 1, y: 0 }}
              className="w-full max-w-2xl rounded-xl border border-[#E6E4DD] bg-white shadow-2xl"
              exit={{ opacity: 0, y: 10 }}
              initial={{ opacity: 0, y: 10 }}
              onSubmit={submitCreateClient}
            >
              <div className="flex items-start justify-between border-b border-[#E6E4DD] p-5">
                <div>
                  <h3 className="text-lg font-medium text-[#2C2B29]">New Client</h3>
                  <p className="mt-1 text-sm text-[#8C8981]">
                    Create a client account and primary contact. Portal credentials are not emailed automatically.
                  </p>
                </div>
                <button
                  className="rounded-lg p-1.5 text-[#8C8981] transition hover:bg-[#F4F1EA] hover:text-[#2C2B29]"
                  disabled={isCreating}
                  onClick={closeCreateModal}
                  type="button"
                >
                  ✕
                </button>
              </div>

              <div className="grid gap-4 p-5 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#8C8981]">Client name</span>
                  <input
                    className="w-full rounded-lg border border-[#E6E4DD] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
                    onChange={(event) => setCreateForm((current) => ({ ...current, displayName: event.target.value }))}
                    placeholder="Client or organization name"
                    required
                    value={createForm.displayName}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#8C8981]">Primary contact</span>
                  <input
                    className="w-full rounded-lg border border-[#E6E4DD] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, primaryContactName: event.target.value }))
                    }
                    placeholder="Full name"
                    required
                    value={createForm.primaryContactName}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#8C8981]">Email</span>
                  <input
                    className="w-full rounded-lg border border-[#E6E4DD] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
                    onChange={(event) => setCreateForm((current) => ({ ...current, email: event.target.value }))}
                    placeholder="client@example.com"
                    required
                    type="email"
                    value={createForm.email}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#8C8981]">Phone</span>
                  <input
                    className="w-full rounded-lg border border-[#E6E4DD] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
                    onChange={(event) => setCreateForm((current) => ({ ...current, phone: event.target.value }))}
                    placeholder="+91..."
                    value={createForm.phone || ''}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#8C8981]">Client type</span>
                  <select
                    className="w-full rounded-lg border border-[#E6E4DD] bg-white px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        clientType: event.target.value as CreateClientPayload['clientType'],
                      }))
                    }
                    value={createForm.clientType}
                  >
                    <option value="individual">Individual</option>
                    <option value="business">Business</option>
                    <option value="organization">Organization</option>
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#8C8981]">City</span>
                  <input
                    className="w-full rounded-lg border border-[#E6E4DD] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
                    onChange={(event) => setCreateForm((current) => ({ ...current, city: event.target.value }))}
                    placeholder="Optional"
                    value={createForm.city || ''}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#8C8981]">State</span>
                  <input
                    className="w-full rounded-lg border border-[#E6E4DD] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
                    onChange={(event) => setCreateForm((current) => ({ ...current, state: event.target.value }))}
                    placeholder="Optional"
                    value={createForm.state || ''}
                  />
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-[#E6E4DD] bg-[#FCFBF8] px-3 py-2">
                  <input
                    checked={Boolean(createForm.portalAccessEnabled)}
                    className="h-4 w-4 accent-[#C19A5B]"
                    onChange={(event) =>
                      setCreateForm((current) => ({
                        ...current,
                        portalAccessEnabled: event.target.checked,
                      }))
                    }
                    type="checkbox"
                  />
                  <span className="text-sm text-[#2C2B29]">Enable portal access record</span>
                </label>
                <label className="space-y-1.5 sm:col-span-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-[#8C8981]">Notes</span>
                  <textarea
                    className="min-h-24 w-full rounded-lg border border-[#E6E4DD] px-3 py-2 text-sm text-[#2C2B29] outline-none transition focus:border-[#C19A5B]"
                    onChange={(event) => setCreateForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Internal onboarding note"
                    value={createForm.notes || ''}
                  />
                </label>
              </div>

              {createError ? (
                <div className="mx-5 mb-4 rounded-lg border border-[#F5C2C7] bg-[#FDE8EC] px-3 py-2 text-sm text-[#9A1B32]">
                  {createError}
                </div>
              ) : null}

              <div className="flex items-center justify-between border-t border-[#E6E4DD] bg-[#FCFBF8] p-5">
                <p className="text-xs text-[#8C8981]">Invite delivery: manual review until outbound delivery is configured.</p>
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-lg border border-[#E6E4DD] px-4 py-2 text-sm font-medium text-[#5A7C96] transition hover:bg-white"
                    disabled={isCreating}
                    onClick={closeCreateModal}
                    type="button"
                  >
                    Cancel
                  </button>
                  <button
                    className="flex items-center gap-2 rounded-lg bg-[#2C2B29] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#4A4946] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={isCreating}
                    type="submit"
                  >
                    {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Create Client
                  </button>
                </div>
              </div>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
