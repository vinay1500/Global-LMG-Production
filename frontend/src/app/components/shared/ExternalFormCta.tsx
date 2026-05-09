import type { ReactNode } from 'react';
import type { LaunchFormLink } from '../../config/launchLinks';

type ExternalFormCtaProps = {
  children: ReactNode;
  className: string;
  fallbackClassName?: string;
  formLink: LaunchFormLink;
};

export const ExternalFormCta = ({
  children,
  className,
  fallbackClassName,
  formLink,
}: ExternalFormCtaProps) => {
  if (!formLink.url) {
    return (
      <p className={fallbackClassName || 'text-sm leading-relaxed text-gray-500'}>
        {formLink.fallbackMessage}
      </p>
    );
  }

  return (
    <a
      href={formLink.url}
      target="_blank"
      rel="noopener noreferrer"
      referrerPolicy="no-referrer"
      className={className}
    >
      {children}
    </a>
  );
};
