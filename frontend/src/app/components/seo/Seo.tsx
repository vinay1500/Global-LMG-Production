import { useEffect } from 'react';
import { useLocation } from 'react-router';
import {
  DEFAULT_ROBOTS,
  DEFAULT_SEO_DESCRIPTION,
  DEFAULT_SEO_IMAGE_PATH,
  DEFAULT_THEME_COLOR,
  DEFAULT_TWITTER_CARD,
  getAbsoluteSiteUrl,
  getSeoTitle,
} from '../../seo/siteMetadata';
import type { BreadcrumbItem, SeoJsonLd } from '../../seo/jsonLd';
import { buildBreadcrumbJsonLd } from '../../seo/jsonLd';

interface SeoProps {
  title?: string;
  description?: string;
  path?: string;
  image?: string;
  imageAlt?: string;
  type?: 'website' | 'article';
  robots?: string;
  keywords?: string[];
  publishedTime?: string;
  modifiedTime?: string;
  breadcrumbs?: BreadcrumbItem[];
  structuredData?: SeoJsonLd | SeoJsonLd[];
}

const upsertMetaTag = (attributeName: 'name' | 'property', attributeValue: string) => {
  let element = document.head.querySelector(
    `meta[${attributeName}="${attributeValue}"]`
  ) as HTMLMetaElement | null;

  if (!element) {
    element = document.createElement('meta');
    element.setAttribute(attributeName, attributeValue);
    document.head.appendChild(element);
  }

  return element;
};

const setOrRemoveMetaContent = (
  attributeName: 'name' | 'property',
  attributeValue: string,
  content?: string
) => {
  const existingElement = document.head.querySelector(
    `meta[${attributeName}="${attributeValue}"]`
  ) as HTMLMetaElement | null;

  if (!content) {
    existingElement?.remove();
    return;
  }

  const element = existingElement ?? upsertMetaTag(attributeName, attributeValue);
  element.setAttribute('content', content);
};

const upsertCanonicalLink = (href: string) => {
  let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;

  if (!link) {
    link = document.createElement('link');
    link.setAttribute('rel', 'canonical');
    document.head.appendChild(link);
  }

  link.setAttribute('href', href);
};

export const Seo = ({
  title,
  description = DEFAULT_SEO_DESCRIPTION,
  path,
  image = DEFAULT_SEO_IMAGE_PATH,
  imageAlt,
  type = 'website',
  robots = DEFAULT_ROBOTS,
  keywords,
  publishedTime,
  modifiedTime,
  breadcrumbs,
  structuredData,
}: SeoProps) => {
  const location = useLocation();
  const seoTitle = getSeoTitle(title);
  const canonicalUrl = getAbsoluteSiteUrl(path ?? location.pathname);
  const absoluteImageUrl = getAbsoluteSiteUrl(image);
  const keywordsContent = keywords?.join(', ');
  const jsonLdBlocks = [
    ...(breadcrumbs && breadcrumbs.length > 1 ? [buildBreadcrumbJsonLd(breadcrumbs)] : []),
    ...(Array.isArray(structuredData) ? structuredData : structuredData ? [structuredData] : []),
  ];
  const serializedJsonLdBlocks = JSON.stringify(jsonLdBlocks);

  useEffect(() => {
    document.title = seoTitle;

    setOrRemoveMetaContent('name', 'description', description);
    setOrRemoveMetaContent('name', 'robots', robots);
    setOrRemoveMetaContent('name', 'keywords', keywordsContent);
    setOrRemoveMetaContent('name', 'theme-color', DEFAULT_THEME_COLOR);

    setOrRemoveMetaContent('property', 'og:site_name', 'Global LMG');
    setOrRemoveMetaContent('property', 'og:type', type);
    setOrRemoveMetaContent('property', 'og:title', seoTitle);
    setOrRemoveMetaContent('property', 'og:description', description);
    setOrRemoveMetaContent('property', 'og:url', canonicalUrl);
    setOrRemoveMetaContent('property', 'og:image', absoluteImageUrl);
    setOrRemoveMetaContent('property', 'og:image:alt', imageAlt ?? seoTitle);

    setOrRemoveMetaContent('name', 'twitter:card', DEFAULT_TWITTER_CARD);
    setOrRemoveMetaContent('name', 'twitter:title', seoTitle);
    setOrRemoveMetaContent('name', 'twitter:description', description);
    setOrRemoveMetaContent('name', 'twitter:image', absoluteImageUrl);

    setOrRemoveMetaContent('property', 'article:published_time', publishedTime);
    setOrRemoveMetaContent('property', 'article:modified_time', modifiedTime);
    setOrRemoveMetaContent('property', 'og:updated_time', modifiedTime ?? publishedTime);

    upsertCanonicalLink(canonicalUrl);

    document.head
      .querySelectorAll('script[data-seo-json-ld="true"]')
      .forEach((element) => element.remove());

    const parsedJsonLdBlocks = JSON.parse(serializedJsonLdBlocks) as SeoJsonLd[];

    parsedJsonLdBlocks.forEach((block) => {
      const scriptElement = document.createElement('script');
      scriptElement.type = 'application/ld+json';
      scriptElement.dataset.seoJsonLd = 'true';
      scriptElement.textContent = JSON.stringify(block);
      document.head.appendChild(scriptElement);
    });
  }, [
    absoluteImageUrl,
    canonicalUrl,
    description,
    imageAlt,
    keywordsContent,
    modifiedTime,
    publishedTime,
    robots,
    seoTitle,
    serializedJsonLdBlocks,
    type,
  ]);

  return null;
};
