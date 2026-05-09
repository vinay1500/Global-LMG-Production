import React from 'react';
import { Mail, Phone, MapPin, Globe } from 'lucide-react';
import { useNavigate } from 'react-router';
import { CONTACT_FORM_LINK } from '../config/launchLinks';
import { FOOTER_CONTENT } from '../content/site/common';
import { EXPERTISE_CATALOG } from '../data/expertiseCatalog';
import { ExternalFormCta } from './shared/ExternalFormCta';

export const Footer = () => {
  const navigate = useNavigate();

  return (
    <footer className="bg-black text-white pt-24 pb-12 overflow-hidden">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-16 mb-20">
          {/* Brand block keeps the primary trust signals and contact entry points together. */}
          <div className="space-y-8">
            <h2
              className="text-2xl font-bold tracking-tighter"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {FOOTER_CONTENT.brand}
            </h2>
            <div className="space-y-4">
              <a
                href={`mailto:${FOOTER_CONTENT.contact.email}`}
                className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors group"
              >
                <Mail size={18} className="group-hover:scale-110 transition-transform" />
                <span className="text-sm">{FOOTER_CONTENT.contact.email}</span>
              </a>
              <a
                href={FOOTER_CONTENT.contact.phoneHref}
                className="flex items-center gap-3 text-gray-400 hover:text-white transition-colors group"
              >
                <Phone size={18} className="group-hover:scale-110 transition-transform" />
                <span className="text-sm">{FOOTER_CONTENT.contact.phone}</span>
              </a>
              <div className="flex items-start gap-3 text-gray-400">
                <MapPin size={18} className="mt-1 group-hover:scale-110 transition-transform" />
                <span className="text-sm leading-relaxed">
                  {FOOTER_CONTENT.address.map((line, index) => (
                    <React.Fragment key={line}>
                      {line}
                      {index < FOOTER_CONTENT.address.length - 1 ? <br /> : null}
                    </React.Fragment>
                  ))}
                </span>
              </div>
            </div>

            <div className="pt-4">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500">
                {FOOTER_CONTENT.socialNote}
              </p>
            </div>
          </div>

          {/* Link columns surface the highest-value navigation targets from the brochure site. */}
          <div className="lg:col-span-2 grid grid-cols-2 gap-8">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-6">
                {FOOTER_CONTENT.expertiseHeading}
              </h4>
              <ul className="space-y-4 text-sm text-gray-400">
                {EXPERTISE_CATALOG.slice(0, 5).map((item) => (
                  <li
                    key={item.categorySlug}
                    onClick={() => navigate(item.route)}
                    className="hover:text-blue-600 cursor-pointer transition-colors"
                  >
                    {item.category}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-6">
                {FOOTER_CONTENT.resourcesHeading}
              </h4>
              <ul className="space-y-4 text-sm text-gray-400">
                {FOOTER_CONTENT.resources.map((link) => (
                  <li
                    key={link.path}
                    onClick={() => navigate(link.path)}
                    className="hover:text-white cursor-pointer transition-colors"
                  >
                    {link.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* The coverage card reinforces the global-delivery message without needing a full map asset. */}
          <div className="relative h-full min-h-[300px] lg:min-h-0 group">
            <h4 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-6">
              {FOOTER_CONTENT.coverage.heading}
            </h4>
            <div className="relative w-full aspect-square bg-white/5 rounded-3xl overflow-hidden border border-white/10 group-hover:border-white/20 transition-all">
              <div className="absolute inset-0 p-8 flex items-center justify-center opacity-40 group-hover:opacity-60 transition-opacity">
                <Globe size={180} strokeWidth={0.5} className="text-blue-500 animate-pulse-slow" />
              </div>
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <p className="text-xs font-bold uppercase tracking-widest mb-1">
                  {FOOTER_CONTENT.coverage.kicker}
                </p>
                <p className="text-[10px] text-gray-400">
                  {FOOTER_CONTENT.coverage.text}
                </p>
                
                
                <ExternalFormCta
                  formLink={CONTACT_FORM_LINK}
                  fallbackClassName="mt-4 block text-[10px] leading-relaxed text-gray-400"
                  className="inline-block mt-4 text-[10px] font-bold uppercase tracking-[0.2em] border-b border-white pb-1 hover:text-blue-400 transition-colors"
                >
                  {FOOTER_CONTENT.coverage.ctaLabel}
                </ExternalFormCta>
              </div>
              <div className="absolute top-1/4 left-1/3 w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,1)]" />
              <div className="absolute top-1/3 left-1/2 w-1.5 h-1.5 bg-blue-400 rounded-full" />
              <div className="absolute top-1/2 left-2/3 w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_10px_rgba(59,130,246,1)]" />
              <div className="absolute top-2/3 left-1/4 w-1.5 h-1.5 bg-blue-400 rounded-full" />
            </div>
          </div>
        </div>

        <div className="pt-12 border-t border-white/10 flex flex-col md:flex-row justify-between items-center gap-6 text-[10px] font-bold uppercase tracking-widest text-gray-500">
          <div className="flex gap-8">
            {FOOTER_CONTENT.legalLinks.map((link) => (
              <button
                key={link.path}
                type="button"
                onClick={() => navigate(link.path)}
                className="hover:text-white cursor-pointer transition-colors"
              >
                {link.label}
              </button>
            ))}
          </div>
          <p>{FOOTER_CONTENT.copyright}</p>
        </div>
      </div>
    </footer>
  );
};
