import React from 'react';
import { motion } from 'motion/react';
import { Heart, Scale, Users, Globe, ArrowRight, Award } from 'lucide-react';
import { ImageWithFallback } from '../components/shared/ImageWithFallback';
import { Seo } from '../components/seo/Seo';
import { ExternalFormCta } from '../components/shared/ExternalFormCta';
import { CONTACT_FORM_LINK, PARTNER_FORM_LINK } from '../config/launchLinks';
import { PRO_BONO_EMAIL } from '../config/brand';
import {
  PRO_BONO_CASE_STUDIES,
  PRO_BONO_IMPACT_AREAS,
  PRO_BONO_PAGE_CONTENT,
  PRO_BONO_RECOGNITION_AWARDS,
  PRO_BONO_STATS,
} from '../data/proBono';
import { buildWebPageJsonLd } from '../seo/jsonLd';

const PRO_BONO_ICON_MAP = {
  globe: Globe,
  heart: Heart,
  scale: Scale,
  users: Users,
};



export const ProBono = () => {
  return (
    <div className="pt-32 pb-24 bg-white">
      <Seo
        title="Pro Bono"
        description={PRO_BONO_PAGE_CONTENT.intro}
        path="/pro-bono"
        image={PRO_BONO_CASE_STUDIES[0]?.image}
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Pro Bono', path: '/pro-bono' },
        ]}
        keywords={['pro bono', 'access to justice', 'legal aid', 'Global LMG']}
        structuredData={buildWebPageJsonLd({
          title: 'Pro Bono Commitment',
          description: PRO_BONO_PAGE_CONTENT.intro,
          path: '/pro-bono',
        })}
      />
      <div className="max-w-7xl mx-auto px-6">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl mb-24"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-600 mb-6 block">
            {PRO_BONO_PAGE_CONTENT.eyebrow}
          </span>
          <h1
            className="text-6xl md:text-8xl mb-8"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {PRO_BONO_PAGE_CONTENT.title.split('\n')[0]}
            <br />
            {PRO_BONO_PAGE_CONTENT.title.split('\n')[1]}
          </h1>
          <p className="text-xl text-gray-500 font-light leading-relaxed">
            {PRO_BONO_PAGE_CONTENT.intro}
          </p>
        </motion.div>

        {/* Stats Banner */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-32">
          
          {PRO_BONO_STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="text-center"
            >
              <h3 className="text-5xl font-bold mb-2 text-blue-600">{stat.value}</h3>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>

        {/* Impact Areas */}
        <div className="mb-32">
          <h2
            className="text-4xl md:text-5xl mb-16"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {PRO_BONO_PAGE_CONTENT.impactTitle}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {PRO_BONO_IMPACT_AREAS.map((area, i) => {
              const Icon = PRO_BONO_ICON_MAP[area.iconKey];

              return (
                <motion.div
                  key={area.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="p-10 bg-gray-50 rounded-[2.5rem] space-y-6 hover:shadow-xl transition-shadow"
                >
                  <div className="w-14 h-14 rounded-2xl bg-white flex items-center justify-center text-blue-600 shadow-sm">
                    <Icon size={28} />
                  </div>
                  <h3 className="text-2xl font-bold">{area.title}</h3>
                  <p className="text-gray-600 font-light leading-relaxed">{area.description}</p>
                  <div className="pt-4 border-t border-gray-200">
                    <p className="text-sm font-bold text-blue-600">{area.stats}</p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Case Studies */}
        <div className="mb-32">
          <h2
            className="text-4xl md:text-5xl mb-16"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {PRO_BONO_PAGE_CONTENT.storiesTitle}
          </h2>

          <div className="space-y-8">
            {PRO_BONO_CASE_STUDIES.map((study, i) => (
              <motion.div
                key={study.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="group cursor-pointer"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                  <div
                    className={`relative aspect-[4/3] rounded-3xl overflow-hidden bg-gray-100 ${i % 2 === 1 ? 'md:order-2' : ''}`}
                  >
                    <ImageWithFallback
                      src={study.image}
                      alt={study.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                  </div>

                  <div className={`space-y-6 ${i % 2 === 1 ? 'md:order-1' : ''}`}>
                    <div className="inline-block px-4 py-2 bg-blue-100 text-blue-600 text-xs font-bold uppercase tracking-widest rounded-full">
                      Case Study
                    </div>
                    <h3
                      className="text-3xl font-bold group-hover:text-blue-600 transition-colors"
                      style={{ fontFamily: "'Playfair Display', serif" }}
                    >
                      {study.title}
                    </h3>
                    <p className="text-lg text-gray-600 font-light leading-relaxed">
                      {study.description}
                    </p>
                    <div className="flex items-center gap-4 pt-4">
                      <Award size={20} className="text-blue-600" />
                      <span className="text-sm font-bold text-blue-600">{study.impact}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Recognition */}
        <div className="mb-32 p-16 bg-black text-white rounded-[3rem]">
          <div className="max-w-3xl mx-auto text-center">
            <h2
              className="text-4xl md:text-5xl mb-8"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {PRO_BONO_PAGE_CONTENT.recognitionTitle}
            </h2>
            <p className="text-xl text-gray-400 font-light leading-relaxed mb-12">
              {PRO_BONO_PAGE_CONTENT.recognitionDescription}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {PRO_BONO_RECOGNITION_AWARDS.map((award, i) => (
                <div key={i} className="p-8 bg-white/10 rounded-2xl backdrop-blur-sm">
                  <Award size={32} className="mx-auto mb-4 text-blue-400" />
                  <p className="text-sm font-semibold">{award}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Get Involved */}
        <div className="p-16 bg-gray-50 rounded-[3rem]">
          <div className="max-w-3xl mx-auto text-center">
            <h2
              className="text-4xl md:text-5xl mb-6"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {PRO_BONO_PAGE_CONTENT.partnershipTitle}
            </h2>
            <p className="text-xl text-gray-600 font-light mb-12 leading-relaxed">
              {PRO_BONO_PAGE_CONTENT.partnershipDescription}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              
              
              <ExternalFormCta
                formLink={PARTNER_FORM_LINK}
                fallbackClassName="max-w-sm text-sm leading-relaxed text-gray-500"
                className="px-12 py-5 bg-black text-white text-xs font-bold uppercase tracking-[0.2em] hover:bg-gray-800 transition-colors inline-flex items-center justify-center gap-3 rounded-full"
              >
                Apply for Pro Bono Support
                <ArrowRight size={16} />
              </ExternalFormCta>
              <ExternalFormCta
                formLink={CONTACT_FORM_LINK}
                fallbackClassName="max-w-sm text-sm leading-relaxed text-gray-500"
                className="px-12 py-5 border-2 border-black text-black text-xs font-bold uppercase tracking-[0.2em] hover:bg-black hover:text-white transition-colors inline-flex items-center justify-center gap-3 rounded-full"
              >
                Contact Our Team
              </ExternalFormCta>
            </div>
            <p className="mt-8 text-sm text-gray-500">Email: {PRO_BONO_EMAIL}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
