import React from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { ArrowLeft, Send, MapPin, Briefcase, Calendar, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import { ExternalFormCta } from '../components/shared/ExternalFormCta';
import { CAREERS_FORM_LINK } from '../config/launchLinks';
import { Seo } from '../components/seo/Seo';
import {
  getCareerCategoryById,
  getCareerOpeningById,
  getCareerOpeningsForCategory,
} from '../content/site/careers';
import { buildWebPageJsonLd } from '../seo/jsonLd';
import { NotFoundPage } from './NotFoundPage';



export const CareerDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const careerId = decodeURIComponent(id || '');
  const category = getCareerCategoryById(careerId);
  const opening = getCareerOpeningById(careerId);

  if (!category && !opening) {
    return (
      <NotFoundPage
        title="Career page not found"
        description="The requested career page could not be matched to a valid category or opening."
        backToPath="/careers"
        backToLabel="Back to Careers"
      />
    );
  }

  if (opening) {
    return (
      <div className="pt-32 pb-24 min-h-screen bg-gray-50">
        <Seo
          title={opening.title}
          description={opening.description}
          path={`/careers/${opening.slug}`}
          breadcrumbs={[
            { name: 'Home', path: '/' },
            { name: 'Careers', path: '/careers' },
            { name: opening.title, path: `/careers/${opening.slug}` },
          ]}
          keywords={[opening.categoryTitle, opening.department, opening.location, opening.type]}
          structuredData={buildWebPageJsonLd({
            title: opening.title,
            description: opening.description,
            path: `/careers/${opening.slug}`,
          })}
        />
        <div className="max-w-4xl mx-auto px-6">
          <Link
            to="/careers"
            className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-gray-400 hover:text-black transition-colors mb-12"
          >
            <ArrowLeft size={16} />
            Back to Careers
          </Link>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white p-12 rounded-[2.5rem] shadow-xl shadow-black/5"
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-12">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-600 mb-2 block">
                  OPEN POSITION
                </span>
                <h1
                  className="text-4xl md:text-5xl font-bold"
                  style={{ fontFamily: "'Playfair Display', serif" }}
                >
                  {opening.title}
                </h1>
              </div>
              <ExternalFormCta
                formLink={CAREERS_FORM_LINK}
                fallbackClassName="max-w-sm text-sm leading-relaxed text-gray-500"
                className="px-8 py-4 bg-black text-white rounded-full font-bold uppercase tracking-widest text-xs hover:bg-gray-800 transition-colors flex items-center gap-2"
              >
                Apply Now
                <Send size={14} />
              </ExternalFormCta>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-8 pb-12 border-b border-gray-100 mb-12">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-gray-400">
                  <MapPin size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Location</span>
                </div>
                <p className="text-sm font-semibold">{opening.location}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-gray-400">
                  <Briefcase size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Type</span>
                </div>
                <p className="text-sm font-semibold">{opening.type}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-gray-400">
                  <Calendar size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Posted</span>
                </div>
                <p className="text-sm font-semibold">{opening.postedLabel}</p>
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-gray-400">
                  <Send size={14} />
                  <span className="text-[10px] font-bold uppercase tracking-widest">
                    Department
                  </span>
                </div>
                <p className="text-sm font-semibold">{opening.department}</p>
              </div>
            </div>

            <div className="prose prose-gray max-w-none space-y-8">
              <section>
                <h3 className="text-xl font-bold mb-4">About the Role</h3>
                <p className="text-gray-500 leading-relaxed font-light">{opening.description}</p>
              </section>

              <section>
                <h3 className="text-xl font-bold mb-4">Key Responsibilities</h3>
                <ul className="list-disc pl-5 text-gray-500 space-y-2 font-light">
                  {opening.responsibilities.map((responsibility) => (
                    <li key={responsibility}>{responsibility}</li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold mb-4">Qualifications</h3>
                <ul className="list-disc pl-5 text-gray-500 space-y-2 font-light">
                  {opening.qualifications.map((qualification) => (
                    <li key={qualification}>{qualification}</li>
                  ))}
                </ul>
              </section>
            </div>
          </motion.div>
        </div>
      </div>
    );
  }

  const categoryOpenings = getCareerOpeningsForCategory(category!.slug);

  return (
    <div className="pt-32 pb-24 min-h-screen bg-white">
      <Seo
        title={category!.heroTitle}
        description={category!.heroDescription}
        path={`/careers/${category!.slug}`}
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Careers', path: '/careers' },
          { name: category!.title, path: `/careers/${category!.slug}` },
        ]}
        keywords={[category!.title, 'careers', 'legal jobs', 'internships']}
        structuredData={buildWebPageJsonLd({
          title: category!.heroTitle,
          description: category!.heroDescription,
          path: `/careers/${category!.slug}`,
          type: 'CollectionPage',
        })}
      />
      <div className="max-w-6xl mx-auto px-6">
        <Link
          to="/careers"
          className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-gray-400 hover:text-black transition-colors mb-12"
        >
          <ArrowLeft size={16} />
          Back to Careers
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-3xl mb-16"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-blue-600 mb-6 block">
            CAREER CATEGORY
          </span>
          <h1
            className="text-5xl md:text-7xl mb-8"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {category!.heroTitle}
          </h1>
          <p className="text-xl text-gray-500 font-light leading-relaxed">
            {category!.heroDescription}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-10">
          <div className="space-y-6">
            {categoryOpenings.map((job, index) => (
              <motion.div
                key={job.slug}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                onClick={() => navigate(`/careers/${job.slug}`)}
                className="group p-8 border border-gray-200 rounded-2xl hover:border-blue-600 hover:shadow-lg transition-all cursor-pointer bg-white"
              >
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <span className="px-3 py-1 bg-blue-100 text-blue-600 text-xs font-bold uppercase tracking-wider rounded-full">
                      {job.type}
                    </span>
                    <h2 className="text-2xl font-bold mt-4 mb-3 group-hover:text-blue-600 transition-colors">
                      {job.title}
                    </h2>
                    <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
                      <MapPin size={14} />
                      {job.location}
                    </div>
                    <p className="text-gray-600 font-light leading-relaxed">{job.description}</p>
                  </div>
                  <div className="w-11 h-11 rounded-full bg-gray-100 group-hover:bg-blue-600 transition-colors flex items-center justify-center flex-shrink-0">
                    <ArrowRight
                      size={18}
                      className="text-gray-600 group-hover:text-white transition-colors"
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="p-10 bg-gray-50 rounded-[2.5rem] h-fit">
            <h3
              className="text-2xl font-bold mb-4"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              {category!.title}
            </h3>
            <p className="text-gray-600 font-light leading-relaxed mb-6">{category!.description}</p>
            <p className="text-sm text-gray-500 mb-8">
              {categoryOpenings.length}{' '}
              {categoryOpenings.length === 1 ? 'opening is' : 'openings are'} currently available in
              this category.
            </p>
            <ExternalFormCta
              formLink={CAREERS_FORM_LINK}
              fallbackClassName="max-w-sm text-sm leading-relaxed text-gray-500"
              className="inline-flex items-center gap-2 px-8 py-4 bg-black text-white rounded-full text-xs font-bold uppercase tracking-widest hover:bg-gray-800 transition-colors"
            >
              Contact Recruitment
              <Send size={14} />
            </ExternalFormCta>
          </div>
        </div>
      </div>
    </div>
  );
};
