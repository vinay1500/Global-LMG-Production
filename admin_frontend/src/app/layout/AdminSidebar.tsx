import React from 'react';
import { LogOut } from 'lucide-react';
import { NavLink } from 'react-router';
import { ADMIN_NAV_ITEMS, canViewNavItem } from '../config/navigation';
import { useAdminSession } from '../providers/AdminSessionProvider';

type AdminSidebarProps = {
  onNavigate?: () => void;
  onSignOut: () => void;
};

export const AdminSidebar: React.FC<AdminSidebarProps> = ({ onNavigate, onSignOut }) => {
  const { currentUser } = useAdminSession();
  const visibleItems = ADMIN_NAV_ITEMS.filter((item) => canViewNavItem(currentUser?.permissionCodes, item));

  return (
    <aside className="fixed lg:sticky top-16 left-0 h-[calc(100vh-64px)] w-64 bg-[#F4F1EA] border-r border-[#E6E4DD] z-50 flex flex-col">
      <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8">
        <div>
          <h4 className="text-[10px] font-bold text-[#A8A69F] uppercase tracking-widest mb-3 px-3">
            Main Navigation
          </h4>
          <nav className="space-y-1">
            {visibleItems.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.id}
                  className={({ isActive }) =>
                    `w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition border ${
                      isActive
                        ? 'bg-[#FCFBF8] text-[#2C2B29] shadow-sm border-[#E6E4DD]'
                        : 'text-[#8C8981] hover:bg-[#E6E4DD]/50 hover:text-[#2C2B29] border-transparent'
                    }`
                  }
                  onClick={onNavigate}
                  to={item.path}
                >
                  {({ isActive }) => (
                    <>
                      <Icon
                        className={`w-4.5 h-4.5 ${
                          isActive ? 'text-[#C19A5B]' : 'text-[#A8A69F]'
                        }`}
                      />
                      <span>{item.label}</span>
                      {item.deferred ? (
                        <span className="ml-auto text-[10px] uppercase tracking-widest text-[#A8A69F]">
                          Later
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </div>

      <div className="p-4 border-t border-[#E6E4DD]">
        <button
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-[#8C8981] hover:bg-[#FDF8EF] hover:text-[#C19A5B] transition"
          onClick={onSignOut}
          type="button"
        >
          <LogOut className="w-4.5 h-4.5 text-[#A8A69F]" />
          Sign Out
        </button>
      </div>
    </aside>
  );
};
