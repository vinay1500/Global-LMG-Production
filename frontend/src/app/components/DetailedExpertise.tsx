import React, { useState } from 'react';
import { ArrowRight, ChevronRight, Download } from 'lucide-react';
import { HOME_DETAILED_EXPERTISE_CONTENT } from '../content/site/home';
import { EXPERTISE_CATALOG } from '../data/expertiseCatalog';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { CLIENT_INTAKE_FORM_LINK } from '../config/launchLinks';
import { ExternalFormCta } from './shared/ExternalFormCta';

 
export const DetailedExpertise = () => {
  const [activeTab, setActiveTab] = useState(0);
  const [expandedItem, setExpandedItem] = useState<number | null>(null);
  const [isGeneratingBrochure, setIsGeneratingBrochure] = useState(false);
  const navigate = useNavigate();

 
  // Get short description (first 120 characters)
  const getShortDescription = (item: string) => {
    const text = item.includes(':') ? item.split(':').slice(1).join(':').trim() : item;
    return text.length > 120 ? text.substring(0, 120) + '...' : text;
  };

 
  const handleBrochureDownload = async () => {
    setIsGeneratingBrochure(true);

    try {
      const { downloadLegalExpertisePdf } = await import('../lib/legalExpertisePdf');
      await downloadLegalExpertisePdf();
    } finally {
      setIsGeneratingBrochure(false);
    }
  };

  return (
    <section className="py-32 bg-white relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-[40vw] h-full bg-gray-50/50 -z-10" />

      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row gap-20">
          {/* Left Column: Navigation & Context */}
          <div className="w-full lg:w-1/3">
            <div className="sticky top-32">
              <div className="mb-12">
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-600 mb-4 block">
                  {HOME_DETAILED_EXPERTISE_CONTENT.eyebrow}
                </span>
                <h2
                  className="text-5xl md:text-6xl mb-6 leading-tight"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {HOME_DETAILED_EXPERTISE_CONTENT.titleLines.map((line, index) => (
                    <React.Fragment key={line}>
                      {line}
                      {index < HOME_DETAILED_EXPERTISE_CONTENT.titleLines.length - 1 ? <br /> : null}
                    </React.Fragment>
                  ))}
                </h2>
                <p className="text-gray-500 font-light leading-relaxed max-w-sm">
                  {HOME_DETAILED_EXPERTISE_CONTENT.summary}
                </p>
              </div>

              <div className="flex flex-col gap-1">
                {EXPERTISE_CATALOG.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveTab(idx)}
                    onDoubleClick={() => navigate(item.route)}
                    className={`group flex items-center justify-between px-6 py-5 text-left rounded-2xl transition-all duration-300 ${
                      activeTab === idx
                        ? 'bg-black text-white shadow-xl shadow-black/20'
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    <span
                      className={`text-sm font-semibold transition-all ${activeTab === idx ? 'translate-x-2' : ''}`}
                    >
                      {item.category}
                    </span>
                    <ChevronRight
                      size={18}
                      className={`transition-all duration-300 ${
                        activeTab === idx ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-4'
                      }`}
                    />
                  </button>
                ))}
              </div>

              <div className="mt-12 p-8 border border-gray-100 rounded-3xl bg-gray-50/50">
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">
                  {HOME_DETAILED_EXPERTISE_CONTENT.resourceHeading}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    void handleBrochureDownload();
                  }}
                  disabled={isGeneratingBrochure}
                  className="flex items-center gap-3 text-sm font-bold hover:text-blue-600 transition-colors group disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <Download size={18} className="text-gray-400 group-hover:text-blue-600" />
                  {isGeneratingBrochure
                    ? HOME_DETAILED_EXPERTISE_CONTENT.brochureLoadingLabel
                    : HOME_DETAILED_EXPERTISE_CONTENT.brochureIdleLabel}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Detailed Content */}
          <div className="w-full lg:w-2/3">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="space-y-12"
              >
                <div className="pb-12 border-b border-gray-100">
                  <h3
                    className="text-4xl md:text-5xl mb-6"
                    style={{ fontFamily: "'Playfair Display', serif" }}
                  >
                    {EXPERTISE_CATALOG[activeTab].category}
                  </h3>
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-[2px] bg-blue-600 mt-3 flex-shrink-0" />
                    <p className="text-xl text-gray-600 font-light leading-relaxed">
                      {EXPERTISE_CATALOG[activeTab].description}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-16 gap-y-10">
                  {EXPERTISE_CATALOG[activeTab].items.map((item, i) => {
                    const isExpanded = expandedItem === i;
                    const title = item.title;
                    const description = item.summary;
                    const shortDesc = getShortDescription(`${item.title}: ${item.summary}`);

                    return (
                      <div
                        key={i}
                        className="group relative"
                        onMouseEnter={() => setExpandedItem(i)}
                        onMouseLeave={() => setExpandedItem(null)}
                      >
                        <div className="flex flex-col gap-3">
                          <div
                            className={`h-0.5 ${isExpanded ? 'w-8' : 'w-0'} bg-blue-600 transition-all duration-300`}
                          />
                          <h4
                            className={`text-lg font-semibold ${isExpanded ? 'text-blue-600' : ''} transition-colors`}
                          >
                            {title}
                          </h4>

                          {/* Expandable Description */}
                          <div
                            className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-48 opacity-100' : 'max-h-0 opacity-0'}`}
                          >
                            {description && (
                              <p className="text-sm text-gray-600 leading-relaxed font-light line-clamp-3 mb-3">
                                {shortDesc}
                              </p>
                            )}
                            <button
                              type="button"
                              onClick={() => navigate(item.route)}
                              className="text-xs font-bold uppercase tracking-wider text-blue-600 hover:text-blue-800 transition-colors flex items-center gap-2"
                            >
                              Read More
                              <ArrowRight size={14} />
                            </button>
                          </div>

                          {/* Original description (hidden when expanded) */}
                          {!isExpanded && description && (
                            <p className="text-sm text-gray-500 leading-relaxed font-light">
                              {description}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-12">
                  
                  
                  <ExternalFormCta
                    formLink={CLIENT_INTAKE_FORM_LINK}
                    fallbackClassName="max-w-sm text-sm leading-relaxed text-gray-500"
                    className="inline-flex items-center gap-3 px-10 py-5 bg-black text-white text-xs font-bold uppercase tracking-[0.2em] hover:bg-gray-800 transition-colors"
                  >
                    {HOME_DETAILED_EXPERTISE_CONTENT.ctaLabel}
                    <ArrowRight size={16} />
                  </ExternalFormCta>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
};
