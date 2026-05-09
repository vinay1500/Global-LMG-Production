import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Routes, Route, useLocation } from 'react-router';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { IntroSection } from './components/IntroSection';
import { Footer } from './components/Footer';
import { ScrollToTop } from './components/ScrollToTop';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Seo } from './components/seo/Seo';
import { buildOrganizationJsonLd, buildWebPageJsonLd, buildWebSiteJsonLd } from './seo/jsonLd';
import { AuthProvider } from './contexts/AuthContext';
import { DashboardProvider } from './contexts/DashboardContext';
import { useAuth } from './contexts/useAuth';
import { HOME_HERO_CONTENT, HOME_SEO_CONTENT } from './content/site/home';

// Lazy loading keeps the public brochure pages and dashboard chunks out of the initial bundle.
const CarouselSection = lazy(async () => ({
  default: (await import('./components/CarouselSection')).CarouselSection,
}));
const Spotlight = lazy(async () => ({
  default: (await import('./components/Spotlight')).Spotlight,
}));
const DetailedExpertise = lazy(async () => ({
  default: (await import('./components/DetailedExpertise')).DetailedExpertise,
}));
const CareersSection = lazy(async () => ({
  default: (await import('./components/CareersSection')).CareersSection,
}));
const AuthModal = lazy(async () => ({
  default: (await import('./components/auth/AuthModal')).AuthModal,
}));

const AboutPage = lazy(async () => ({
  default: (await import('./pages/AboutPage')).AboutPage,
}));
const ServiceDetail = lazy(async () => ({
  default: (await import('./pages/ServiceDetail')).ServiceDetail,
}));
const CareerDetail = lazy(async () => ({
  default: (await import('./pages/CareerDetail')).CareerDetail,
}));
const ExpertiseDetail = lazy(async () => ({
  default: (await import('./pages/ExpertiseDetail')).ExpertiseDetail,
}));
const ExpertiseItemDetail = lazy(async () => ({
  default: (await import('./pages/ExpertiseItemDetail')).ExpertiseItemDetail,
}));
const ClientDashboard = lazy(async () => ({
  default: (await import('./pages/ClientDashboard')).ClientDashboard,
}));

const InsightsPage = lazy(async () => ({
  default: (await import('./pages/InsightsPage')).InsightsPage,
}));
const InsightDetail = lazy(async () => ({
  default: (await import('./pages/InsightDetail')).InsightDetail,
}));
const MarketReports = lazy(async () => ({
  default: (await import('./pages/MarketReports')).MarketReports,
}));
const Newsroom = lazy(async () => ({
  default: (await import('./pages/Newsroom')).Newsroom,
}));
const ProBono = lazy(async () => ({
  default: (await import('./pages/ProBono')).ProBono,
}));
const CareersPage = lazy(async () => ({
  default: (await import('./pages/CareersPage')).CareersPage,
}));
const NotFoundPage = lazy(async () => ({
  default: (await import('./pages/NotFoundPage')).NotFoundPage,
}));
const PrivacyPolicyPage = lazy(async () => ({
  default: (await import('./pages/PrivacyPolicyPage')).PrivacyPolicyPage,
}));
const CookiePolicyPage = lazy(async () => ({
  default: (await import('./pages/CookiePolicyPage')).CookiePolicyPage,
}));
const LegalDisclaimerPage = lazy(async () => ({
  default: (await import('./pages/LegalDisclaimerPage')).LegalDisclaimerPage,
}));
const TermsOfServicePage = lazy(async () => ({
  default: (await import('./pages/TermsOfServicePage')).TermsOfServicePage,
}));
const RefundCancellationPolicyPage = lazy(async () => ({
  default: (await import('./pages/RefundCancellationPolicyPage')).RefundCancellationPolicyPage,
}));

// Shared loading skeleton for deferred homepage sections.
const SectionLoadingFallback = () => (
  <section className="py-24 bg-white" aria-hidden="true">
    <div className="max-w-7xl mx-auto px-6 space-y-6">
      <div className="h-4 w-28 rounded-full bg-gray-100 animate-pulse" />
      <div className="h-14 max-w-3xl rounded-[2rem] bg-gray-100 animate-pulse" />
      <div className="h-4 max-w-2xl rounded-full bg-gray-100 animate-pulse" />
    </div>
  </section>
);

// Shared loading skeleton for route-level page transitions.
const RouteLoadingFallback = () => (
  <main className="pt-32 pb-24 bg-white" aria-hidden="true">
    <div className="max-w-7xl mx-auto px-6 space-y-6">
      <div className="h-4 w-24 rounded-full bg-gray-100 animate-pulse" />
      <div className="h-16 max-w-3xl rounded-[2rem] bg-gray-100 animate-pulse" />
      <div className="h-4 max-w-2xl rounded-full bg-gray-100 animate-pulse" />
      <div className="h-72 rounded-[2rem] bg-gray-50 animate-pulse" />
    </div>
  </main>
);

const AuthModalLoadingFallback = () => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
    aria-hidden="true"
  >
    <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <div className="mx-auto h-10 w-10 rounded-full bg-gray-100 animate-pulse" />
      <div className="mt-6 h-4 w-28 rounded-full bg-gray-100 animate-pulse" />
      <div className="mt-4 h-10 rounded-xl bg-gray-100 animate-pulse" />
      <div className="mt-3 h-10 rounded-xl bg-gray-100 animate-pulse" />
    </div>
  </div>
);

// The homepage stays brochure-focused and defers heavier sections until after first paint.
const HomePage = () => (
  <main>
    <Seo
      title={HOME_SEO_CONTENT.title}
      description={HOME_SEO_CONTENT.description}
      path="/"
      image={HOME_SEO_CONTENT.image}
      structuredData={[
        buildOrganizationJsonLd(),
        buildWebSiteJsonLd(),
        buildWebPageJsonLd({
          title: HOME_SEO_CONTENT.title,
          description: HOME_SEO_CONTENT.description,
          path: '/',
        }),
      ]}
    />
    <IntroSection />
    <Hero image={HOME_HERO_CONTENT.image} />
    <Suspense fallback={<SectionLoadingFallback />}>
      <CarouselSection />
    </Suspense>
    <Suspense fallback={<SectionLoadingFallback />}>
      <Spotlight />
    </Suspense>
    <Suspense fallback={<SectionLoadingFallback />}>
      <DetailedExpertise />
    </Suspense>
    <Suspense fallback={<SectionLoadingFallback />}>
      <CareersSection />
    </Suspense>
  </main>
);

// Dashboard access waits for the session-backed auth state before rendering the client portal.
const DashboardRoute = () => {
  const { isAuthenticated, isAuthReady } = useAuth();

  if (!isAuthReady) {
    return <RouteLoadingFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <DashboardProvider>
      <ClientDashboard />
    </DashboardProvider>
  );
};

// The layout switches between the public-site shell and the dashboard shell based on the route.
const AppLayout = () => {
  const location = useLocation();
  const { isAuthModalOpen } = useAuth();
  const isDashboardRoute =
    location.pathname === '/dashboard' || location.pathname.startsWith('/dashboard/');

  return (
    <div
      className={`min-h-screen text-black selection:bg-black/10 ${
        isDashboardRoute ? 'bg-[#fafafa]' : 'bg-white'
      }`}
    >
      {!isDashboardRoute && <Navbar />}

      <Suspense fallback={<RouteLoadingFallback />}>
        <Routes>
          {/* Public brochure routes */}
          <Route path="/" element={<HomePage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/services/:id" element={<ServiceDetail />} />
          <Route path="/careers/:id" element={<CareerDetail />} />
          <Route path="/expertise/:id" element={<ExpertiseDetail />} />
          <Route path="/expertise/:categorySlug/:itemSlug" element={<ExpertiseItemDetail />} />
          <Route path="/expertise-item/:id" element={<ExpertiseItemDetail />} />

          {/* Client portal route */}
          <Route path="/dashboard" element={<DashboardRoute />} />

          {/* Public content, legal, and fallback routes */}
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/insights/:id" element={<InsightDetail />} />
          <Route path="/market-reports" element={<MarketReports />} />
          <Route path="/newsroom" element={<Newsroom />} />
          <Route path="/pro-bono" element={<ProBono />} />
          <Route path="/careers" element={<CareersPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/cookies" element={<CookiePolicyPage />} />
          <Route path="/legal-disclaimer" element={<LegalDisclaimerPage />} />
          <Route path="/terms" element={<TermsOfServicePage />} />
          <Route path="/refund-cancellation" element={<RefundCancellationPolicyPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>

      {isAuthModalOpen && (
        <Suspense fallback={<AuthModalLoadingFallback />}>
          <AuthModal />
        </Suspense>
      )}

      {!isDashboardRoute && <Footer />}
    </div>
  );
};

// App mounts the auth provider once so brochure pages and dashboard routes share the same session-backed auth state.
const App = () => {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <ScrollToTop />
          <AppLayout />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  );
};

export default App;
