import React from 'react';
import { ArrowRight, GraduationCap, Briefcase, Users } from 'lucide-react';
import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { CAREERS_FORM_LINK } from '../config/launchLinks';
import { CAREER_CATEGORIES, CAREERS_HOME_SECTION } from '../content/site/careers';
import { ExternalFormCta } from './shared/ExternalFormCta';

 
const CAREER_ICON_MAP = {
  'graduation-cap': GraduationCap,
  briefcase: Briefcase,
  users: Users,
};

export const CareersSection = () => {
  const navigate = useNavigate();

 
  return (
    <section className="py-24 bg-white">
      <div className="max-w-7xl mx-auto px-6">
        <div className="max-w-3xl mb-16">
          <h2
            onClick={() => navigate('/careers')}
            className="text-5xl md:text-6xl mb-6 cursor-pointer hover:text-blue-600 transition-colors"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {CAREERS_HOME_SECTION.title}
          </h2>
          <p className="text-xl text-gray-500 font-light leading-relaxed">
            {CAREERS_HOME_SECTION.intro}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {CAREER_CATEGORIES.map((card, idx) => {
            const Icon = CAREER_ICON_MAP[card.iconKey];

            return (
              <motion.div
                key={idx}
                whileHover={{ y: -8 }}
                className="p-10 border border-gray-100 rounded-3xl hover:shadow-2xl hover:shadow-black/5 transition-all group"
              >
                <div
                  className={`w-14 h-14 rounded-2xl ${card.color} flex items-center justify-center mb-8 group-hover:scale-110 transition-transform`}
                >
                  <Icon size={28} />
                </div>
                <h3
                  className="text-2xl font-bold mb-4"
                  style={{ fontFamily: "'Inter', sans-serif" }}
                >
                  {card.title}
                </h3>
                <p className="text-gray-500 text-sm leading-relaxed mb-8">{card.description}</p>
                <button
                  type="button"
                  onClick={() => navigate(`/careers/${card.slug}`)}
                  className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest group-hover:text-blue-600 transition-colors"
                >
                  Apply now
                  <ArrowRight
                    size={16}
                    className="group-hover:translate-x-1 transition-transform"
                  />
                </button>
              </motion.div>
            );
          })}
        </div>

        <div className="mt-20 p-12 bg-black rounded-[2rem] text-white flex flex-col md:flex-row items-center justify-between gap-8 overflow-hidden relative">
          <div className="relative z-10">
            <h4
              className="text-3xl font-medium mb-4"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {CAREERS_HOME_SECTION.ctaTitle}
            </h4>
            <p className="text-gray-400 max-w-xl">
              {CAREERS_HOME_SECTION.ctaBody}
            </p>
          </div>
          
          
          <ExternalFormCta
            formLink={CAREERS_FORM_LINK}
            fallbackClassName="relative z-10 max-w-sm text-sm leading-relaxed text-gray-300"
            className="relative z-10 px-10 py-5 bg-white text-black font-bold uppercase tracking-widest text-xs hover:bg-gray-100 transition-colors whitespace-nowrap"
          >
            {CAREERS_HOME_SECTION.ctaButtonLabel}
          </ExternalFormCta>
          {/* Decorative element */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-600/20 blur-[100px] -mr-32 -mt-32" />
        </div>
      </div>
    </section>
  );
};
