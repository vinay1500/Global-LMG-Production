import React, { useState, useMemo } from 'react';
import { formatDate, formatDateTime } from '../data/formatters';
import type { AuditEntry } from '../data/adminTypes';
import { 
  Search, Filter, History, User, Calendar as CalendarIcon, FileText, 
  Briefcase, CreditCard, MessageSquare, Plus, Clock, Activity, ArrowRight,
  Shield, UserCheck, ChevronRight, X, Layers, Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const ENTITY_COLORS: Record<string, string> = {
  matter: 'bg-purple-100 text-purple-700 border-purple-200',
  invoice: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  payment: 'bg-green-100 text-green-700 border-green-200',
  document: 'bg-blue-100 text-blue-700 border-blue-200',
  event: 'bg-amber-100 text-amber-700 border-amber-200',
  user: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  lead: 'bg-rose-100 text-rose-700 border-rose-200',
  message: 'bg-pink-100 text-pink-700 border-pink-200',
};

const ENTITY_ICONS: Record<string, React.ElementType> = {
  matter: Briefcase,
  invoice: FileText,
  payment: CreditCard,
  document: FileText,
  event: CalendarIcon,
  user: User,
  lead: UserCheck,
  message: MessageSquare,
};

export const AuditExplorer: React.FC<{ entries?: AuditEntry[] }> = ({ entries = [] }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<string | 'all'>('all');
  const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);

  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      const matchesSearch = 
        entry.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.actor.toLowerCase().includes(searchQuery.toLowerCase()) ||
        entry.entityId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (entry.newValue && entry.newValue.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (entry.oldValue && entry.oldValue.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesEntity = selectedEntity === 'all' || entry.entityType === selectedEntity;
      
      return matchesSearch && matchesEntity;
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [entries, searchQuery, selectedEntity]);

  const renderTimeline = () => {
    if (filteredEntries.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
            <History className="w-8 h-8 text-gray-300" />
          </div>
          <h3 className="text-lg font-medium text-gray-900">No audit records found</h3>
          <p className="text-sm text-gray-500 mt-1 max-w-sm">No forensic logs match your current search and filter criteria.</p>
        </div>
      );
    }

    return (
      <div className="relative before:absolute before:inset-0 before:ml-6 md:before:ml-8 before:-translate-x-px before:h-full before:w-px before:bg-gray-200">
        {filteredEntries.map((entry, index) => {
          const isDateHeader = index === 0 || new Date(entry.timestamp).toDateString() !== new Date(filteredEntries[index - 1].timestamp).toDateString();
          const EntityIcon = ENTITY_ICONS[entry.entityType] || Database;
          const badgeClass = ENTITY_COLORS[entry.entityType] || 'bg-gray-100 text-gray-700 border-gray-200';
          
          return (
            <div key={entry.id} className="relative group mb-6">
              {isDateHeader && (
                <div className="flex items-center mb-6 mt-2 relative z-10 pl-16 md:pl-20">
                  <span className="bg-white text-gray-600 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest border border-gray-200 shadow-sm">
                    {formatDate(entry.timestamp)}
                  </span>
                </div>
              )}

              <div 
                className="flex items-start gap-4 relative z-10 cursor-pointer"
                onClick={() => setSelectedEntry(entry)}
              >
                {/* Timeline Dot */}
                <div className={`flex items-center justify-center w-12 h-12 md:w-16 md:h-16 rounded-full border-4 border-[#fafafa] bg-white shadow-sm shrink-0 transition-transform group-hover:scale-105`}>
                  <div className={`w-8 h-8 md:w-10 md:h-10 rounded-full flex items-center justify-center border ${badgeClass}`}>
                    <EntityIcon className="w-4 h-4 md:w-5 md:h-5" />
                  </div>
                </div>

                {/* Audit Card */}
                <div className={`flex-1 bg-white border p-4 md:p-5 rounded-xl shadow-sm transition-all duration-200 group-hover:shadow-md group-hover:border-gray-300
                  ${selectedEntry?.id === entry.id ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200'}`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-3">
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-500 font-medium">
                          {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="text-gray-300">•</span>
                        <span className="flex items-center gap-1 text-xs font-medium text-gray-700 bg-gray-50 px-2 py-0.5 rounded border border-gray-100">
                          {entry.actorRole === 'system' ? <Shield className="w-3 h-3 text-gray-500" /> : <User className="w-3 h-3 text-gray-500" />}
                          {entry.actor}
                        </span>
                        <span className="text-gray-300">•</span>
                        <span className="text-xs text-gray-500 font-medium uppercase tracking-wider">
                          {entry.sourceModule}
                        </span>
                      </div>
                      <h4 className="text-base font-bold text-gray-900">{entry.action}</h4>
                    </div>
                    <div className="shrink-0 flex items-center gap-1 text-xs font-bold text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-100 uppercase tracking-widest">
                      {entry.entityType} <ChevronRight className="w-3 h-3 text-gray-400" /> <span className="font-mono">{entry.entityId}</span>
                    </div>
                  </div>

                  {/* Summary of change */}
                  {(entry.oldValue || entry.newValue) && (
                    <div className="mt-3 pt-3 border-t border-gray-50 flex items-center gap-3">
                      {entry.oldValue && (
                        <div className="flex-1 bg-red-50 text-red-700 px-3 py-1.5 rounded flex items-center gap-2 text-sm border border-red-100/50 line-through opacity-70">
                          <span className="truncate">{entry.oldValue}</span>
                        </div>
                      )}
                      {entry.oldValue && entry.newValue && (
                        <ArrowRight className="w-4 h-4 text-gray-300 shrink-0" />
                      )}
                      {entry.newValue && (
                        <div className="flex-1 bg-green-50 text-green-700 px-3 py-1.5 rounded flex items-center gap-2 text-sm border border-green-100/50 font-medium">
                          <span className="truncate">{entry.newValue}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderDetailDrawer = () => {
    if (!selectedEntry) return null;
    
    const EntityIcon = ENTITY_ICONS[selectedEntry.entityType] || Database;
    const badgeClass = ENTITY_COLORS[selectedEntry.entityType] || 'bg-gray-100 text-gray-700 border-gray-200';

    return (
      <div className="fixed inset-0 z-50 flex justify-end">
        <motion.div 
          initial={{ opacity: 0 }} 
          animate={{ opacity: 1 }} 
          exit={{ opacity: 0 }} 
          className="absolute inset-0 bg-black/20 backdrop-blur-sm"
          onClick={() => setSelectedEntry(null)}
        />
        <motion.div 
          initial={{ x: '100%' }} 
          animate={{ x: 0 }} 
          exit={{ x: '100%' }} 
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="relative w-full max-w-md bg-white h-full shadow-2xl border-l border-gray-200 flex flex-col z-10"
        >
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-gray-400" />
              <h2 className="text-lg font-medium" style={{ fontFamily: "'Playfair Display', serif" }}>Audit Record Details</h2>
            </div>
            <button onClick={() => setSelectedEntry(null)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* Header Identity */}
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 ${badgeClass}`}>
                <EntityIcon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-gray-900 leading-tight">{selectedEntry.action}</h3>
                <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
                  <Clock className="w-4 h-4" />
                  {formatDateTime(selectedEntry.timestamp)}
                </div>
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 grid grid-cols-2 gap-y-4 gap-x-6">
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Actor</span>
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                  {selectedEntry.actorRole === 'system' ? <Shield className="w-4 h-4 text-gray-400" /> : <User className="w-4 h-4 text-gray-400" />}
                  {selectedEntry.actor}
                </div>
              </div>
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Actor Role</span>
                <span className="text-sm text-gray-600 capitalize">{selectedEntry.actorRole.replace('-', ' ')}</span>
              </div>
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Entity Reference</span>
                <div className="flex items-center gap-1.5 text-sm">
                  <span className="capitalize text-gray-600">{selectedEntry.entityType}</span>
                  <span className="text-gray-300">•</span>
                  <span className="font-mono font-medium text-gray-900">{selectedEntry.entityId}</span>
                </div>
              </div>
              <div>
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Source Module</span>
                <span className="text-sm text-gray-600 flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-gray-400" />
                  {selectedEntry.sourceModule}
                </span>
              </div>
            </div>

            {/* Diff Viewer */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                <Activity className="w-4 h-4" /> Data Changes
              </h4>
              
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                {!selectedEntry.oldValue && !selectedEntry.newValue ? (
                  <div className="p-6 text-center text-sm text-gray-500 italic bg-gray-50">
                    No explicit data value changes recorded for this event.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {selectedEntry.oldValue && (
                      <div className="p-4 bg-red-50/30">
                        <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider block mb-1.5">Previous State</span>
                        <div className="font-mono text-sm text-red-700 bg-white border border-red-100 p-3 rounded shadow-sm whitespace-pre-wrap break-words">
                          {selectedEntry.oldValue}
                        </div>
                      </div>
                    )}
                    {selectedEntry.newValue && (
                      <div className="p-4 bg-green-50/30">
                        <span className="text-[10px] font-bold text-green-500 uppercase tracking-wider block mb-1.5">New State</span>
                        <div className="font-mono text-sm text-green-700 bg-white border border-green-100 p-3 rounded shadow-sm whitespace-pre-wrap break-words font-medium">
                          {selectedEntry.newValue}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">System Record ID</span>
              <span className="font-mono text-xs text-gray-400">{selectedEntry.id}</span>
            </div>
          </div>
        </motion.div>
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-80px)] flex flex-col -m-6 p-6 bg-[#fafafa]">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0 mb-6">
        <div>
          <h1 className="text-2xl font-medium text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Audit Explorer</h1>
          <p className="text-sm text-gray-500 mt-1">Forensic review of all system activity, entity mutations, and communications.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input 
              type="text"
              placeholder="Search audit logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-64 pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-200 bg-white shadow-sm"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">
        {/* Filters Sidebar */}
        <div className="w-full lg:w-56 flex-shrink-0 space-y-6 overflow-y-auto pr-2 no-scrollbar">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Filter className="w-4 h-4" /> Entity Filters
            </h3>
            <div className="space-y-1">
              <button
                onClick={() => setSelectedEntity('all')}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition font-medium
                  ${selectedEntity === 'all' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >
                <div className="flex items-center gap-2">
                  <Database className="w-4 h-4" /> All Entities
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${selectedEntity === 'all' ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                  {entries.length}
                </span>
              </button>
              
              {['matter', 'invoice', 'payment', 'document', 'event', 'user', 'lead', 'message'].map(type => {
                const count = entries.filter(e => e.entityType === type).length;
                if (count === 0) return null;
                const Icon = ENTITY_ICONS[type];
                
                return (
                  <button
                    key={type}
                    onClick={() => setSelectedEntity(type)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition capitalize
                      ${selectedEntity === type ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4" /> {type}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full bg-gray-100 ${selectedEntity === type ? 'text-gray-900 font-bold' : 'text-gray-500'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Timeline Area */}
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto no-scrollbar bg-transparent pr-2">
          {renderTimeline()}
        </div>
      </div>

      {/* Detail Drawer */}
      <AnimatePresence>
        {renderDetailDrawer()}
      </AnimatePresence>
    </div>
  );
};
