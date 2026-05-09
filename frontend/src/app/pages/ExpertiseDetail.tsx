import React from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { ArrowLeft, Globe, Scale, Landmark } from 'lucide-react';
import { motion } from 'motion/react';
import { Seo } from '../components/seo/Seo';
import { ExternalFormCta } from '../components/shared/ExternalFormCta';
import { CLIENT_INTAKE_FORM_LINK } from '../config/launchLinks';
import { EXPERTISE_CATALOG, getExpertiseCategoryById } from '../data/expertiseCatalog';
import { buildWebPageJsonLd } from '../seo/jsonLd';
import { NotFoundPage } from './NotFoundPage';

export const ExpertiseDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const expertise = getExpertiseCategoryById(decodeURIComponent(id || ''));

 
  if (!expertise) {
    return (
      <NotFoundPage
        title="Practice area not found"
        description="The requested practice area could not be matched to a valid route."
        backToPath="/"
        backToLabel="Back to Home"
      />
    );
  }

  return (
    <div className="pt-32 pb-24 min-h-screen bg-white">
      <Seo
        title={expertise.category}
        description={expertise.description}
        path={expertise.route}
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: expertise.category, path: expertise.route },
        ]}
        keywords={[expertise.category, 'legal expertise', 'practice area']}
        structuredData={buildWebPageJsonLd({
          title: expertise.category,
          description: expertise.description,
          path: expertise.route,
          type: 'CollectionPage',
        })}
      />
      <div className="max-w-7xl mx-auto px-6">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-gray-400 hover:text-black transition-colors mb-12"
        >
          <ArrowLeft size={16} />
          Back to Home
        </Link>

        <div className="flex flex-col lg:flex-row gap-20 mb-24">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-full lg:w-1/2 space-y-8"
          >
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-black flex items-center justify-center text-white">
                <Scale size={24} />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-600">
                PRACTICE AREA
              </span>
            </div>
            <h1
              className="text-5xl md:text-7xl leading-tight"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {expertise.category}
            </h1>
            <p className="text-xl text-gray-500 font-light leading-relaxed">
              {expertise.description}
            </p>
            <div className="flex flex-wrap gap-4">
              {['Global Coverage', 'Strategic Insight', 'Regulatory Excellence'].map((tag) => (
                <span
                  key={tag}
                  className="px-4 py-2 bg-gray-50 rounded-full text-[10px] font-bold uppercase tracking-widest text-gray-400"
                >
                  {tag}
                </span>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="w-full lg:w-1/2"
          >
            <div className="p-10 border border-gray-100 rounded-[2rem] bg-gray-50/50 space-y-8">
              <h3 className="text-xl font-bold flex items-center gap-3">
                <Landmark size={20} className="text-blue-600" />
                Specialized Services
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {expertise.items.map((item, i) => {
                  return (
                    <div
                      key={i}
                      onClick={() => navigate(item.route)}
                      className="flex items-start gap-3 p-4 bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-all group cursor-pointer"
                    >
                      <div className="w-1 h-1 rounded-full bg-blue-600 mt-2 opacity-40 group-hover:opacity-100 transition-opacity" />
                      <span className="text-xs font-medium text-gray-600 group-hover:text-black transition-colors">
                        {item.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="p-12 bg-black rounded-[2.5rem] text-white">
            <Globe className="text-blue-400 mb-6" size={32} />
            <h4 className="text-xl font-bold mb-4">Cross-Border Reach</h4>
            <p className="text-sm text-gray-400 font-light leading-relaxed">
              Our {expertise.category.toLowerCase()} practice spans across all major global
              financial hubs, ensuring seamless legal support wherever your business takes you.
            </p>
          </div>
          <div className="p-12 bg-blue-600 rounded-[2.5rem] text-white">
            <Scale className="text-blue-200 mb-6" size={32} />
            <h4 className="text-xl font-bold mb-4">Unrivaled Expertise</h4>
            <p className="text-sm text-blue-100 font-light leading-relaxed">
              Recognized as leaders in {expertise.category.toLowerCase()}, our partners bring a
              wealth of experience in high-stakes litigation and advisory.
            </p>
          </div>
          <div className="p-12 border border-gray-100 rounded-[2.5rem] flex flex-col items-center justify-center text-center">
            <h4
              className="text-2xl font-bold mb-4"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Need strategic advice?
            </h4>
            <p className="text-sm text-gray-500 mb-8 max-w-[200px]">
              Our experts are ready to assist you with your legal needs.
            </p>
            
            
            <ExternalFormCta
              formLink={CLIENT_INTAKE_FORM_LINK}
              fallbackClassName="block max-w-[240px] text-sm leading-relaxed text-gray-500"
              className="w-full inline-flex items-center justify-center py-4 bg-black text-white rounded-full font-bold uppercase tracking-widest text-xs hover:bg-gray-800 transition-colors"
            >
              Contact Practice Lead
            </ExternalFormCta>
          </div>
        </div>
      </div>
    </div>
  );
};
