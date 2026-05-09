export type UrgencyLevel = string;
export type ConsultationMode = string;

export interface RequestData {
  fullName: string;
  email: string;
  mobile: string;
  services: string[];
  legalDomain: string;
  caseDetails: string;
  documents: File[];
  consultationMode: ConsultationMode;
  preferredDate: string;
  preferredEndAtUtc?: string;
  preferredStartAtUtc?: string;
  preferredTime: string;
  preferredTimezone?: string;
  urgency: UrgencyLevel;
  pastLegalAction: boolean;
}

export interface RequestWizardService {
  id: string;
  name: string;
  description: string;
  icon: string;
  baseFee: number;
}

export interface RequestWizardConsultationMode {
  description: string;
  fee: number;
  id: string;
  isInPerson: boolean;
  label: string;
  transportDisclaimer: string | null;
}

export interface RequestWizardUrgencyOption {
  allowedConsultationModes: string[];
  id: string;
  isImmediate: boolean;
  label: string;
  maxResponseHours: number | null;
  minResponseHours: number | null;
  responseWindowHours: number | null;
  surcharge: number;
  surchargeType: 'flat' | 'percent';
  timingLabel: string;
}

export interface RequestWizardPricingConfig {
  consultationModes: RequestWizardConsultationMode[];
  countryPricing: {
    countryCode: string;
    countryName: string;
    countrySource: 'default' | 'ip_geolocation' | 'phone' | 'request' | 'saved_address';
    currencyCode: string;
    isDefaultFallback: boolean;
    multiplier: number;
    pricingCountryConfidence: 'fallback' | 'high' | 'medium';
  };
  currencyCode: string;
  detectedCountryCode?: string;
  detectedCurrency?: string;
  legalDomains: LegalDomainOption[];
  showApproximateLocalCurrency: boolean;
  services: RequestWizardService[];
  urgencyOptions: RequestWizardUrgencyOption[];
}

export interface LegalDomainOption {
  id: string;
  name: string;
  description: string;
}

export const REQUEST_WIZARD_SERVICES: RequestWizardService[] = [
  {
    id: 'get-counsel',
    name: 'Get Me a Counsel',
    description: 'Representation & Arguments',
    icon: 'Users',
    baseFee: 1000,
  },
  {
    id: 'document-review',
    name: 'Document Review and Compliance Check',
    description: 'Audit & Verification',
    icon: 'FileCheck',
    baseFee: 1000,
  },
  {
    id: 'legal-drafting',
    name: 'Legal Drafting',
    description: 'Contracts, Notices, Applications',
    icon: 'FileText',
    baseFee: 1000,
  },
  {
    id: 'case-assessment',
    name: 'Case Assessment and Strategy',
    description: 'Merit Analysis & Planning',
    icon: 'Target',
    baseFee: 1000,
  },
  {
    id: 'litigation-monitoring',
    name: 'Litigation Monitoring',
    description: 'Shadow Counsel & Case Tracking',
    icon: 'Eye',
    baseFee: 1000,
  },
  {
    id: 'liaison-support',
    name: 'Liaison and Field Support',
    description: 'Registry, Filing, Police Station',
    icon: 'Briefcase',
    baseFee: 1000,
  },
  {
    id: 'court-technology',
    name: 'Court Technology and Digital Support',
    description: 'Live Hearings, E-courts',
    icon: 'Monitor',
    baseFee: 1000,
  },
];

export const LEGAL_DOMAINS: LegalDomainOption[] = [
  { id: 'civil', name: 'Civil Law', description: 'Property, Contracts, Torts' },
  { id: 'criminal', name: 'Criminal Law', description: 'Defense, Prosecution' },
  { id: 'corporate', name: 'Corporate Law', description: 'Business, Compliance' },
  { id: 'family', name: 'Family Law', description: 'Divorce, Custody, Inheritance' },
  { id: 'property', name: 'Property Law', description: 'Real Estate, RERA' },
  { id: 'labor', name: 'Labor & Employment', description: 'Workplace, Labor Rights' },
  { id: 'tax', name: 'Tax Law', description: 'Income Tax, GST' },
  {
    id: 'intellectual-property',
    name: 'Intellectual Property',
    description: 'Patents, Trademarks',
  },
  { id: 'consumer', name: 'Consumer Law', description: 'Consumer Rights, Protection' },
  { id: 'other', name: 'Other', description: 'Other legal matters' },
];

export const TIME_SLOTS = [
  '09:00 AM - 09:45 AM',
  '10:00 AM - 10:45 AM',
  '11:00 AM - 11:45 AM',
  '12:00 PM - 12:45 PM',
  '02:00 PM - 02:45 PM',
  '03:00 PM - 03:45 PM',
  '04:00 PM - 04:45 PM',
  '05:00 PM - 05:45 PM',
];

export const DEFAULT_REQUEST_PRICING_CONFIG: RequestWizardPricingConfig = {
  consultationModes: [
    {
      description: 'Remote video consultation',
      fee: 0,
      id: 'video',
      isInPerson: false,
      label: 'Video Call',
      transportDisclaimer: null,
    },
    {
      description: 'Phone consultation',
      fee: 0,
      id: 'phone',
      isInPerson: false,
      label: 'Phone Call',
      transportDisclaimer: null,
    },
    {
      description: 'In-person coordination meeting',
      fee: 0,
      id: 'in-person',
      isInPerson: true,
      label: 'In-Person',
      transportDisclaimer:
        'Transportation cost is extra and borne by the client. Final travel support cost depends on city and country.',
    },
  ],
  countryPricing: {
    countryCode: 'US',
    countryName: 'United States',
    countrySource: 'default',
    currencyCode: 'USD',
    isDefaultFallback: true,
    multiplier: 1,
    pricingCountryConfidence: 'fallback',
  },
  currencyCode: 'USD',
  detectedCountryCode: 'US',
  detectedCurrency: 'USD',
  legalDomains: LEGAL_DOMAINS,
  showApproximateLocalCurrency: true,
  services: REQUEST_WIZARD_SERVICES,
  urgencyOptions: [
    {
      allowedConsultationModes: ['phone', 'video', 'in-person'],
      id: 'standard',
      isImmediate: false,
      label: 'Standard (24-48 hrs)',
      maxResponseHours: 48,
      minResponseHours: 24,
      responseWindowHours: 48,
      surcharge: 0,
      surchargeType: 'flat',
      timingLabel: '24-48 hrs',
    },
    {
      allowedConsultationModes: ['phone', 'video'],
      id: 'within-6hrs',
      isImmediate: true,
      label: 'Immediate (Within 6 hrs)',
      maxResponseHours: 6,
      minResponseHours: null,
      responseWindowHours: 6,
      surcharge: 500,
      surchargeType: 'flat',
      timingLabel: 'Within 6 hrs',
    },
    {
      allowedConsultationModes: ['phone', 'video'],
      id: 'within-2hrs',
      isImmediate: true,
      label: 'Immediate (Within 2 hrs)',
      maxResponseHours: 2,
      minResponseHours: null,
      responseWindowHours: 2,
      surcharge: 1000,
      surchargeType: 'flat',
      timingLabel: 'Within 2 hrs',
    },
  ],
};
