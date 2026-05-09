import React from 'react';
import { useParams, useNavigate } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Seo } from '../components/seo/Seo';
import { ExternalFormCta } from '../components/shared/ExternalFormCta';
import { SafeRichText } from '../components/shared/SafeRichText';
import { CLIENT_INTAKE_FORM_LINK } from '../config/launchLinks';
import {
  getExpertiseCategoryById,
  getExpertiseItemById,
  getExpertiseItemByLegacyId,
} from '../data/expertiseCatalog';
import { buildServiceJsonLd } from '../seo/jsonLd';
import { NotFoundPage } from './NotFoundPage';

export const ExpertiseItemDetail = () => {
  const { categorySlug, itemSlug, id } = useParams();
  const navigate = useNavigate();

 
  const category = categorySlug ? getExpertiseCategoryById(categorySlug) : undefined;
  const item =
    categorySlug && itemSlug
      ? getExpertiseItemById(categorySlug, itemSlug)
      : id
        ? getExpertiseItemByLegacyId(id)
        : undefined;

  if (!item) {
    return (
      <NotFoundPage
        title="Expertise item not found"
        description="The requested expertise entry could not be matched to a valid practice area item."
        backToPath={category?.route || '/'}
        backToLabel={category ? 'Back to Practice Area' : 'Back to Home'}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <Seo
        title={item.title}
        description={item.summary}
        path={item.route}
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: item.categoryTitle, path: `/expertise/${item.categorySlug}` },
          { name: item.title, path: item.route },
        ]}
        keywords={[item.categoryTitle, item.title, 'legal service']}
        structuredData={buildServiceJsonLd({
          name: item.title,
          description: item.summary,
          path: item.route,
          serviceType: item.categoryTitle,
        })}
      />
      {/* Back Button */}
      <div className="max-w-7xl mx-auto px-6 pt-12">
        <button
          onClick={() => navigate(`/expertise/${item.categorySlug}`)}
          className="flex items-center gap-2 text-sm font-medium hover:text-blue-600 transition-colors group"
        >
          <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
          Back to Expertise
        </button>
      </div>

      {/* Content */}
      <article className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-8">
          <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block mb-4">
            {item.categoryTitle}
          </span>
          <h1
            className="text-5xl md:text-6xl mb-8 leading-tight"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            {item.title}
          </h1>
        </div>

        <SafeRichText
          className="prose prose-lg max-w-none"
          html={item.fullContent}
          style={{
            fontFamily: "'Inter', sans-serif",
            lineHeight: '1.8',
          }}
        />

        <div className="mt-16 pt-8 border-t border-gray-200">
          
          <ExternalFormCta
            formLink={CLIENT_INTAKE_FORM_LINK}
            fallbackClassName="block max-w-md text-sm leading-relaxed text-gray-500"
            className="inline-flex px-10 py-5 bg-black text-white text-xs font-bold uppercase tracking-[0.2em] hover:bg-gray-800 transition-colors"
          >
            Schedule a Consultation
          </ExternalFormCta>
        </div>
      </article>
    </div>
  );
};
