import React, { useState, useEffect } from 'react';
import {
  Menu,
  Globe,
  ChevronDown,
  User,
  Settings,
  LogOut,
  Bell,
  ChevronRight,
  X,
} from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { SearchAutocomplete } from './SearchAutocomplete';
import { NAVIGATION_COPY } from '../content/site/common';
import { SERVICE_CATALOG, buildServicePath } from '../content/site/services';
import { Link, useNavigate } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { CONTACT_FORM_LINK } from '../config/launchLinks';
import { BRAND_WORDMARK } from '../config/brand';
import { useAuth } from '../contexts/useAuth';
import { CAREER_CATEGORIES } from '../content/site/careers';
import { EXPERTISE_CATALOG } from '../data/expertiseCatalog';

export const Navbar = () => {
  const navigate = useNavigate();
  const { currentUser, isAuthenticated, openAuthModal, signOut } = useAuth();

  // Local state tracks desktop mega menus, the signed-in account menu, and the mobile drawer.
  const [servicesOpen, setServicesOpen] = useState(false);
  const [careersOpen, setCareersOpen] = useState(false);
  const [expertiseOpen, setExpertiseOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [activeExpertiseIdx, setActiveExpertiseIdx] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const [mobileCareersOpen, setMobileCareersOpen] = useState(false);
  const [mobileExpertiseOpen, setMobileExpertiseOpen] = useState(false);

  // When the viewport returns to desktop width, close the mobile drawer automatically.
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setMobileMenuOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Keep the page fixed behind the drawer while mobile navigation is open.
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [mobileMenuOpen]);

  // Shared navigation helpers also reset any open drawer or menu state.
  const handleNavigation = (path: string, closeDropdown: () => void) => {
    closeDropdown();
    navigate(path);
  };

  const handleMobileNavigation = (path: string) => {
    setMobileMenuOpen(false);
    navigate(path);
  };

  const handleAuthNavigation = () => {
    setMobileMenuOpen(false);
    navigate('/');
    openAuthModal('signin');
  };

  const handleDashboardPanelNavigation = (
    panel: 'dashboard' | 'settings' | 'notifications',
    closeCallback?: () => void
  ) => {
    closeCallback?.();
    setMobileMenuOpen(false);
    navigate(panel === 'dashboard' ? '/dashboard' : `/dashboard?panel=${panel}`);
  };

  const handleSignOut = async () => {
    await signOut();
    setUserMenuOpen(false);
    setMobileMenuOpen(false);
    navigate('/');
  };

  const userInitials = currentUser?.name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((segment) => segment.charAt(0).toUpperCase())
    .join('');

  const servicesDropdown = (
    <div className="w-[600px] p-6 flex flex-col gap-1">
      <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-4 px-4">
        {NAVIGATION_COPY.dropdowns.services.heading}
      </h5>
      {SERVICE_CATALOG.map((service) => {
        return (
          <DropdownMenu.Item
            key={service.id}
            onSelect={() =>
              handleNavigation(buildServicePath(service.title), () =>
                setServicesOpen(false)
              )
            }
            className="group flex items-center px-4 py-3 rounded-xl hover:bg-gray-50 outline-none cursor-pointer transition-all border border-transparent hover:border-gray-100"
          >
            <div className="flex items-center gap-3">
              <div className="w-1 h-1 rounded-full bg-blue-600 opacity-0 group-hover:opacity-100 transition-opacity" />
              <span className="text-[14px] font-medium text-gray-900 group-hover:text-blue-600 transition-colors">
                {service.title}
              </span>
            </div>
          </DropdownMenu.Item>
        );
      })}
    </div>
  );

  const careersDropdown = (
    <div className="w-[320px] p-4 flex flex-col gap-1">
      <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-4 px-4">
        {NAVIGATION_COPY.dropdowns.careers.heading}
      </h5>
      <DropdownMenu.Item
        onSelect={() => handleNavigation('/careers', () => setCareersOpen(false))}
        className="group flex items-center justify-between px-4 py-4 rounded-xl hover:bg-blue-50 outline-none cursor-pointer transition-all border border-blue-100 bg-blue-50/30 mb-2"
      >
        <span className="text-sm font-bold text-blue-600 group-hover:text-blue-700 transition-colors">
          {NAVIGATION_COPY.dropdowns.careers.viewAll}
        </span>
        <ChevronRight
          size={14}
          className="text-blue-600 opacity-60 group-hover:opacity-100 transition-all"
        />
      </DropdownMenu.Item>
      {CAREER_CATEGORIES.map((career, i) => (
        <DropdownMenu.Item
          key={i}
          onSelect={() => handleNavigation(`/careers/${career.slug}`, () => setCareersOpen(false))}
          className="group flex items-center justify-between px-4 py-4 rounded-xl hover:bg-gray-50 outline-none cursor-pointer transition-all border border-transparent hover:border-gray-100"
        >
          <span className="text-sm font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
            {career.title}
          </span>
          <ChevronRight
            size={14}
            className="opacity-0 group-hover:opacity-100 transition-all -translate-x-2 group-hover:translate-x-0"
          />
        </DropdownMenu.Item>
      ))}
    </div>
  );

  const expertiseDropdown = (
    <div className="w-[1000px] flex h-[600px] overflow-hidden">
      {/* Sidebar Categories */}
      <div className="w-1/3 bg-gray-50/50 border-r border-gray-100 p-6 flex flex-col gap-2">
        <h5 className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400 mb-4 px-4">
          {NAVIGATION_COPY.dropdowns.expertise.heading}
        </h5>
        {EXPERTISE_CATALOG.map((cat, i) => (
          <button
            key={i}
            type="button"
            onMouseEnter={() => setActiveExpertiseIdx(i)}
            onClick={() => handleNavigation(cat.route, () => setExpertiseOpen(false))}
            className={`flex items-center justify-between px-4 py-4 rounded-xl text-left transition-all group ${
              activeExpertiseIdx === i
                ? 'bg-white shadow-lg shadow-black/5 text-blue-600 font-semibold'
                : 'text-gray-600 hover:bg-gray-100/50'
            }`}
          >
            <span className="text-sm">{cat.category}</span>
            <ChevronDown
              size={14}
              className={`opacity-40 transition-transform ${activeExpertiseIdx === i ? '-rotate-90 opacity-100' : ''}`}
            />
          </button>
        ))}
      </div>

      {/* Content Area */}
      <div className="w-2/3 p-10 bg-white overflow-y-auto custom-scrollbar">
        <div className="max-w-xl">
          <h4
            className="text-2xl font-bold mb-3"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {EXPERTISE_CATALOG[activeExpertiseIdx].category}
          </h4>
          <p className="text-sm text-gray-500 mb-8 leading-relaxed italic">
            {EXPERTISE_CATALOG[activeExpertiseIdx].description}
          </p>

          <div className="grid grid-cols-1 gap-y-4">
            {EXPERTISE_CATALOG[activeExpertiseIdx].items.map((item, j) => {
              return (
                <DropdownMenu.Item
                  key={j}
                  onSelect={() => handleNavigation(item.route, () => setExpertiseOpen(false))}
                  className="group flex items-start gap-4 p-3 rounded-lg hover:bg-blue-50/50 outline-none cursor-pointer transition-all"
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-600 mt-2 flex-shrink-0 opacity-40 group-hover:opacity-100 transition-opacity" />
                  <span className="text-sm text-gray-700 group-hover:text-black transition-colors leading-relaxed">
                    {item.title}
                  </span>
                </DropdownMenu.Item>
              );
            })}
          </div>

          <div className="mt-8 pt-6 border-t border-gray-100">
            <button
              type="button"
              onClick={() =>
                handleNavigation(EXPERTISE_CATALOG[activeExpertiseIdx].route, () =>
                  setExpertiseOpen(false)
                )
              }
              className="text-xs font-bold uppercase tracking-widest text-blue-600 hover:underline"
            >
              {NAVIGATION_COPY.dropdowns.expertise.viewFull} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Utility bar and primary navigation shell */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="bg-black text-white text-[10px] uppercase tracking-[0.2em] py-2 px-6 hidden md:block">
          <div className="max-w-7xl mx-auto flex justify-between items-center font-bold">
            <div className="flex gap-4 items-center">
              <span className="text-gray-300">{NAVIGATION_COPY.utility.network}</span>
              {CONTACT_FORM_LINK.url && (
                <>
                  <span className="opacity-40">|</span>
                  <a
                    href={CONTACT_FORM_LINK.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    className="hover:text-gray-300 transition-colors"
                  >
                    {NAVIGATION_COPY.links.contact}
                  </a>
                </>
              )}
            </div>
            <div className="flex gap-4">
              <Globe size={12} className="inline mr-1" />
              <span className="text-gray-300">{NAVIGATION_COPY.utility.language}</span>
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 md:px-6 h-16 md:h-20 flex items-center justify-between">
          <div className="flex items-center gap-8 lg:gap-12">
            <Link to="/" className="flex flex-col leading-none cursor-pointer group">
              <span
                className="text-xl md:text-2xl font-bold tracking-tighter transition-all group-hover:tracking-normal"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                {BRAND_WORDMARK}
              </span>
            </Link>

            <div className="hidden lg:flex items-center gap-6">
              <Link
                to="/about"
                className="text-sm font-medium hover:text-gray-600 transition-colors flex items-center gap-1 whitespace-nowrap py-4"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                {NAVIGATION_COPY.links.about}
              </Link>

              <DropdownMenu.Root open={servicesOpen} onOpenChange={setServicesOpen}>
                <DropdownMenu.Trigger
                  className="text-sm font-medium hover:text-gray-600 transition-colors flex items-center gap-1 whitespace-nowrap outline-none py-4 cursor-pointer bg-transparent border-0"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {NAVIGATION_COPY.links.services}
                  <ChevronDown size={14} className="opacity-50" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="z-[60] bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 animate-in fade-in zoom-in slide-in-from-top-2 duration-300 overflow-hidden"
                    sideOffset={8}
                    align="center"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    {servicesDropdown}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <DropdownMenu.Root open={expertiseOpen} onOpenChange={setExpertiseOpen}>
                <DropdownMenu.Trigger
                  className="text-sm font-medium hover:text-gray-600 transition-colors flex items-center gap-1 whitespace-nowrap outline-none py-4 cursor-pointer bg-transparent border-0"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  Legal Expertise
                  <ChevronDown size={14} className="opacity-50" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="z-[60] bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 animate-in fade-in zoom-in slide-in-from-top-2 duration-300 overflow-hidden"
                    sideOffset={8}
                    align="center"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    {expertiseDropdown}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <Link
                to="/insights"
                className="text-sm font-medium hover:text-gray-600 transition-colors flex items-center gap-1 whitespace-nowrap py-4"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                Blogs and Insights
              </Link>

              <DropdownMenu.Root open={careersOpen} onOpenChange={setCareersOpen}>
                <DropdownMenu.Trigger
                  className="text-sm font-medium hover:text-gray-600 transition-colors flex items-center gap-1 whitespace-nowrap outline-none py-4 cursor-pointer bg-transparent border-0"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {NAVIGATION_COPY.links.careers}
                  <ChevronDown size={14} className="opacity-50" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="z-[60] bg-white rounded-2xl shadow-2xl shadow-black/10 border border-gray-100 animate-in fade-in zoom-in slide-in-from-top-2 duration-300 overflow-hidden"
                    sideOffset={8}
                    align="start"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    {careersDropdown}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>

              <Link
                to="/"
                className="text-sm font-medium hover:text-gray-600 transition-colors flex items-center gap-1 whitespace-nowrap py-4"
                style={{ fontFamily: "'Inter', sans-serif" }}
              >
                Global Coverage
              </Link>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden md:block">
              <SearchAutocomplete />
            </div>

            {/* Desktop account area switches between a single sign-in CTA and a split dashboard pill. */}
            <div className="hidden lg:flex items-center gap-3">
              {isAuthenticated ? (
                <>
                  <div className="flex items-center rounded-full bg-gray-900 p-1 text-white shadow-lg shadow-black/10">
                    <button
                      type="button"
                      onClick={() => handleDashboardPanelNavigation('dashboard')}
                      className="px-4 md:px-5 py-2 text-xs font-semibold md:text-sm"
                    >
                      {NAVIGATION_COPY.account.dashboard}
                    </button>
                    <div className="h-6 w-px bg-white/15" />
                    <DropdownMenu.Root open={userMenuOpen} onOpenChange={setUserMenuOpen}>
                      <DropdownMenu.Trigger
                        type="button"
                        className="ml-1 flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-white/10 bg-white/10 text-xs font-bold text-white outline-none transition hover:border-white/20 hover:bg-white/15"
                        aria-label="Open dashboard menu"
                      >
                        {currentUser?.avatar ? (
                          <img
                            src={currentUser.avatar}
                            alt={currentUser.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          userInitials || 'GL'
                        )}
                      </DropdownMenu.Trigger>

                      <DropdownMenu.Portal>
                        <DropdownMenu.Content
                          className="z-[60] min-w-[240px] rounded-2xl border border-gray-100 bg-white p-2 shadow-2xl shadow-black/10 animate-in fade-in zoom-in duration-200"
                          sideOffset={10}
                          align="end"
                          onCloseAutoFocus={(event) => event.preventDefault()}
                        >
                          <div className="px-3 py-2 border-b border-gray-100 mb-1">
                            <p className="text-sm font-bold">{currentUser?.name}</p>
                            <p className="text-xs text-gray-500">Client Access</p>
                          </div>
                          <DropdownMenu.Item
                            onSelect={() =>
                              handleDashboardPanelNavigation('dashboard', () => setUserMenuOpen(false))
                            }
                            className="flex items-center gap-2 px-3 py-2 text-sm outline-none cursor-pointer hover:bg-gray-50 rounded-xl transition-colors"
                          >
                            <User size={16} /> {NAVIGATION_COPY.account.dashboard}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() =>
                              handleDashboardPanelNavigation('settings', () => setUserMenuOpen(false))
                            }
                            className="flex items-center gap-2 px-3 py-2 text-sm outline-none cursor-pointer hover:bg-gray-50 rounded-xl transition-colors"
                          >
                            <Settings size={16} /> {NAVIGATION_COPY.account.settings}
                          </DropdownMenu.Item>
                          <DropdownMenu.Item
                            onSelect={() =>
                              handleDashboardPanelNavigation('notifications', () => setUserMenuOpen(false))
                            }
                            className="flex items-center gap-2 px-3 py-2 text-sm outline-none cursor-pointer hover:bg-gray-50 rounded-xl transition-colors"
                          >
                            <Bell size={16} /> {NAVIGATION_COPY.account.notifications}
                          </DropdownMenu.Item>
                          <DropdownMenu.Separator className="my-1 h-px bg-gray-100" />
                          <DropdownMenu.Item
                            onSelect={() => {
                              void handleSignOut();
                            }}
                            className="flex items-center gap-2 px-3 py-2 text-sm text-red-600 outline-none cursor-pointer hover:bg-red-50 rounded-xl transition-colors"
                          >
                            <LogOut size={16} /> {NAVIGATION_COPY.account.signOut}
                          </DropdownMenu.Item>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                  </div>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleAuthNavigation}
                    className="flex items-center gap-2 px-4 md:px-5 py-2.5 bg-gray-900 text-white rounded-full hover:bg-black transition-all"
                  >
                    <span className="text-xs md:text-sm font-semibold">{NAVIGATION_COPY.account.signIn}</span>
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              className="lg:hidden p-2 hover:bg-gray-100 rounded-full transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              <Menu size={20} />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Menu Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60] lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
            />

            {/* Drawer */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full sm:w-[400px] bg-white z-[70] lg:hidden shadow-2xl overflow-y-auto"
            >
              {/* Header */}
              <div className="sticky top-0 bg-white border-b border-gray-100 p-6 flex items-center justify-between z-10">
                <span
                  className="text-xl font-bold tracking-tighter"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {BRAND_WORDMARK}
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              
              
              <div className="p-6 bg-gray-50 border-b border-gray-100">
                
                {isAuthenticated ? (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600 mb-3">
                      Client Dashboard
                    </p>
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-gray-900 text-sm font-bold text-white">
                        {currentUser?.avatar ? (
                          <img
                            src={currentUser.avatar}
                            alt={currentUser.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          userInitials || 'GL'
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-900">{currentUser?.name}</p>
                        <p className="text-xs text-gray-500">Client access is active</p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                        Open the dashboard or jump directly into account settings and notifications.
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => handleMobileNavigation('/dashboard')}
                        className="w-full inline-flex items-center justify-center px-4 py-3 bg-gray-900 text-white rounded-lg text-sm font-semibold hover:bg-black transition-colors"
                      >
                        {NAVIGATION_COPY.account.dashboard}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMobileNavigation('/dashboard?panel=settings')}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        <Settings size={16} />
                        {NAVIGATION_COPY.account.settings}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMobileNavigation('/dashboard?panel=notifications')}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 sm:col-span-2"
                      >
                        <Bell size={16} />
                        {NAVIGATION_COPY.account.notifications}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-blue-600 mb-3">
                      Client Access
                    </p>
                    <p className="text-sm text-gray-600 mb-4">
                      Open the client access modal to sign in, create an account, reset a password,
                      or continue with Google using the glassmorphism flow on the homepage.
                    </p>
                    <button
                      type="button"
                      onClick={handleAuthNavigation}
                      className="w-full inline-flex items-center justify-center px-4 py-3 rounded-lg bg-gray-900 text-sm font-semibold text-white hover:bg-black transition-colors"
                    >
                      {NAVIGATION_COPY.account.signIn}
                    </button>
                  </>
                )}
              </div>

              {/* Navigation Links */}
              <div className="p-6 space-y-2">
                <Link
                  to="/about"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <span className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    {NAVIGATION_COPY.links.about}
                  </span>
                  <ChevronRight
                    size={18}
                    className="text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all"
                  />
                </Link>

                {/* Services Accordion */}
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setMobileServicesOpen(!mobileServicesOpen)}
                    className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-semibold text-gray-900">{NAVIGATION_COPY.links.services}</span>
                    <ChevronDown
                      size={18}
                      className={`text-gray-400 transition-transform ${mobileServicesOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <AnimatePresence>
                    {mobileServicesOpen && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden bg-gray-50"
                      >
                        <div className="p-2 space-y-1">
                          {SERVICE_CATALOG.map((service) => {
                            return (
                              <button
                                key={service.id}
                                type="button"
                                onClick={() => handleMobileNavigation(buildServicePath(service.title))}
                                className="w-full text-left p-3 rounded-lg hover:bg-white transition-colors text-sm text-gray-700 hover:text-blue-600"
                              >
                                {service.title}
                              </button>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {/* Legal Expertise Accordion */}
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setMobileExpertiseOpen(!mobileExpertiseOpen)}
                    className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-semibold text-gray-900">Legal Expertise</span>
                    <ChevronDown
                      size={18}
                      className={`text-gray-400 transition-transform ${mobileExpertiseOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <AnimatePresence>
                    {mobileExpertiseOpen && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden bg-gray-50"
                      >
                        <div className="p-2 space-y-1">
                          {EXPERTISE_CATALOG.map((cat, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleMobileNavigation(cat.route)}
                              className="w-full text-left p-3 rounded-lg hover:bg-white transition-colors text-sm font-medium text-gray-700 hover:text-blue-600"
                            >
                              {cat.category}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <Link
                  to="/insights"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <span className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    Blogs and Insights
                  </span>
                  <ChevronRight
                    size={18}
                    className="text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all"
                  />
                </Link>

                {/* Careers Accordion */}
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setMobileCareersOpen(!mobileCareersOpen)}
                    className="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 transition-colors"
                  >
                    <span className="font-semibold text-gray-900">{NAVIGATION_COPY.links.careers}</span>
                    <ChevronDown
                      size={18}
                      className={`text-gray-400 transition-transform ${mobileCareersOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                  <AnimatePresence>
                    {mobileCareersOpen && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: 'auto' }}
                        exit={{ height: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden bg-gray-50"
                      >
                        <div className="p-2 space-y-1">
                          <button
                            type="button"
                            onClick={() => handleMobileNavigation('/careers')}
                            className="w-full text-left p-3 rounded-lg bg-blue-50 hover:bg-blue-100 transition-colors text-sm font-bold text-blue-600"
                          >
                            {NAVIGATION_COPY.dropdowns.careers.viewAll}
                          </button>
                          {CAREER_CATEGORIES.map((career, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => handleMobileNavigation(`/careers/${career.slug}`)}
                              className="w-full text-left p-3 rounded-lg hover:bg-white transition-colors text-sm text-gray-700 hover:text-blue-600"
                            >
                              {career.title}
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <Link
                  to="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between p-4 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  <span className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                    Global Coverage
                  </span>
                  <ChevronRight
                    size={18}
                    className="text-gray-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all"
                  />
                </Link>
              </div>

              {/* Footer Actions */}
              
              
              <div className="p-6 border-t border-gray-100">
                
                {isAuthenticated ? (
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => handleMobileNavigation('/dashboard')}
                      className="w-full inline-flex items-center justify-center gap-3 p-4 rounded-lg bg-gray-900 text-white transition-colors"
                    >
                      <span className="text-sm font-medium">Open Dashboard</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMobileNavigation('/dashboard?panel=settings')}
                      className="w-full inline-flex items-center justify-center gap-3 p-4 rounded-lg border border-gray-200 text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Settings size={18} />
                      <span className="text-sm font-medium">{NAVIGATION_COPY.account.settings}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMobileNavigation('/dashboard?panel=notifications')}
                      className="w-full inline-flex items-center justify-center gap-3 p-4 rounded-lg border border-gray-200 text-gray-700 transition-colors hover:bg-gray-50"
                    >
                      <Bell size={18} />
                      <span className="text-sm font-medium">{NAVIGATION_COPY.account.notifications}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSignOut();
                      }}
                      className="w-full inline-flex items-center justify-center gap-3 p-4 rounded-lg border border-red-100 text-red-600 transition-colors hover:bg-red-50"
                    >
                      <LogOut size={18} />
                      <span className="text-sm font-medium">{NAVIGATION_COPY.account.signOut}</span>
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleAuthNavigation}
                    className="w-full inline-flex items-center justify-center gap-3 p-4 rounded-lg bg-gray-900 text-white transition-colors"
                  >
                    <span className="text-sm font-medium">{NAVIGATION_COPY.account.signIn}</span>
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};
