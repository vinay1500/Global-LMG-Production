import React, { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, 
  Users, 
  FileCheck, 
  FileText, 
  Target, 
  Eye, 
  Briefcase, 
  Monitor,
  Phone,
  Video,
  UserCheck,
  Upload,
  CheckCircle,
  ChevronRight
} from 'lucide-react';
import {
  type ConsultationMode,
  type RequestWizardConsultationMode,
  type RequestWizardPricingConfig,
  type RequestWizardService,
  type RequestWizardUrgencyOption,
  type UrgencyLevel,
  type RequestData
} from '../data/requestWizardData';
import { fetchWithTimeout } from '../lib/api/client';
import { dashboardApi } from '../lib/api/dashboard';
import { formatCurrencyAmount } from '../utils/currency';
import { getCountryCurrency, getCountryTimeZone } from '../utils/geoAddressData';

interface NewRequestWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenSettings?: () => void;
  onSubmit: (data: RequestData) => Promise<void> | void;
  userName?: string;
  userEmail?: string;
  userMobile?: string;
  billingCountryCode?: string | null;
}

export type { RequestData };

const serviceIcons: Record<string, React.ElementType> = {
  'Users': Users,
  'FileCheck': FileCheck,
  'FileText': FileText,
  'Target': Target,
  'Eye': Eye,
  'Briefcase': Briefcase,
  'Monitor': Monitor
};

const consultationModeIcons: Record<string, React.ElementType> = {
  phone: Phone,
  video: Video,
  'in-person': UserCheck,
};

const toMoney = (amount: number) => Math.round((amount + Number.EPSILON) * 100) / 100;

const formatMoney = (amount: number, currencyCode: string) => {
  return formatCurrencyAmount(amount, currencyCode);
};

type LocalCurrencyEstimate = {
  currencyCode: string;
  rate: number;
};

const buildUsdRateUrls = () => [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.min.json',
  'https://latest.currency-api.pages.dev/v1/currencies/usd.min.json',
];

const fetchUsdRate = async (quoteCurrencyCode: string): Promise<LocalCurrencyEstimate | null> => {
  const quoteCurrency = quoteCurrencyCode.trim().toLowerCase();

  for (const url of buildUsdRateUrls()) {
    try {
      const response = await fetchWithTimeout(url, { headers: { accept: 'application/json' } });
      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as { usd?: Record<string, unknown> };
      const rate = Number(payload.usd?.[quoteCurrency]);
      if (Number.isFinite(rate) && rate > 0) {
        return {
          currencyCode: quoteCurrencyCode.trim().toUpperCase(),
          rate,
        };
      }
    } catch {
      // Local currency estimates are optional and must never block request creation.
    }
  }

  return null;
};

const TIME_WINDOW_DURATION_MINUTES = 45;
const TIME_WINDOW_INTERVAL_MINUTES = 30;

const padClock = (value: number) => String(value).padStart(2, '0');

const formatClockLabel = (totalMinutes: number) => {
  const normalizedMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalizedMinutes / 60);
  const minute = normalizedMinutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${padClock(hour12)}:${padClock(minute)} ${period}`;
};

const REQUEST_TIME_WINDOWS = Array.from({ length: 24 * (60 / TIME_WINDOW_INTERVAL_MINUTES) }, (_, index) => {
  const startMinutes = index * TIME_WINDOW_INTERVAL_MINUTES;
  const endMinutes = startMinutes + TIME_WINDOW_DURATION_MINUTES;
  const startClock = `${padClock(Math.floor(startMinutes / 60))}:${padClock(startMinutes % 60)}`;
  const normalizedEndMinutes = endMinutes % 1440;
  const endClock = `${padClock(Math.floor(normalizedEndMinutes / 60))}:${padClock(normalizedEndMinutes % 60)}`;

  return {
    endMinutes,
    label: `${formatClockLabel(startMinutes)} - ${formatClockLabel(endMinutes)}`,
    startMinutes,
    value: `${startClock}-${endClock}`,
  };
});

const getBrowserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const getTimeZoneOffsetMs = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hour = Number(values.hour === '24' ? '00' : values.hour);
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    hour,
    Number(values.minute),
    Number(values.second)
  );

  return asUtc - date.getTime();
};

const zonedClockToUtcIso = (dateValue: string, clockValue: string, timeZone: string, dayOffset = 0) => {
  const [year, month, day] = dateValue.split('-').map((part) => Number(part));
  const [hour, minute] = clockValue.split(':').map((part) => Number(part));
  const targetLocalAsUtc = Date.UTC(year, month - 1, day + dayOffset, hour, minute, 0);
  let utc = new Date(targetLocalAsUtc);

  for (let index = 0; index < 2; index += 1) {
    utc = new Date(targetLocalAsUtc - getTimeZoneOffsetMs(utc, timeZone));
  }

  return utc.toISOString();
};

const buildPreferredWindowSnapshot = (preferredDate: string, preferredTime: string, timeZone: string) => {
  if (!preferredDate || !preferredTime.includes('-')) {
    return {
      preferredEndAtUtc: undefined,
      preferredStartAtUtc: undefined,
      preferredTimezone: timeZone,
    };
  }

  const [startClock, endClock] = preferredTime.split('-').map((part) => part.trim());
  const selectedWindow = REQUEST_TIME_WINDOWS.find((window) => window.value === preferredTime);
  const endsNextDay = selectedWindow ? selectedWindow.endMinutes >= 1440 : endClock <= startClock;

  return {
    preferredEndAtUtc: zonedClockToUtcIso(preferredDate, endClock, timeZone, endsNextDay ? 1 : 0),
    preferredStartAtUtc: zonedClockToUtcIso(preferredDate, startClock, timeZone),
    preferredTimezone: timeZone,
  };
};

const PRICING_UNAVAILABLE_MESSAGE = 'Pricing temporarily unavailable — please refresh in a minute';

const hasRequiredPricingArray = <T,>(value: T[] | null | undefined): value is T[] =>
  Array.isArray(value) && value.length > 0;

const hasUsablePricingConfig = (
  config: Partial<RequestWizardPricingConfig> | null | undefined
) =>
  hasRequiredPricingArray(config?.services) &&
  hasRequiredPricingArray(config?.consultationModes) &&
  hasRequiredPricingArray(config?.urgencyOptions) &&
  hasRequiredPricingArray(config?.legalDomains) &&
  Boolean(config?.countryPricing?.countryCode) &&
  Boolean(config?.countryPricing?.currencyCode || config?.currencyCode || config?.detectedCurrency);

const normalizePricingConfig = (config: RequestWizardPricingConfig): RequestWizardPricingConfig => ({
  ...config,
  consultationModes: config.consultationModes || [],
  services: config.services || [],
  legalDomains: config.legalDomains || [],
  showApproximateLocalCurrency: config.showApproximateLocalCurrency !== false,
  urgencyOptions:
    (config.urgencyOptions || []).length > 0
      ? config.urgencyOptions.map((urgency) => ({
          ...urgency,
          allowedConsultationModes:
            urgency.allowedConsultationModes && urgency.allowedConsultationModes.length > 0
              ? urgency.allowedConsultationModes
              : ['phone', 'video', 'in-person'],
          maxResponseHours:
            urgency.maxResponseHours === undefined ? urgency.responseWindowHours : urgency.maxResponseHours,
          minResponseHours: urgency.minResponseHours === undefined ? null : urgency.minResponseHours,
          timingLabel: urgency.timingLabel || '',
        }))
      : [],
});

export const NewRequestWizard: React.FC<NewRequestWizardProps> = ({
  isOpen,
  onClose,
  onOpenSettings,
  onSubmit,
  userName = '',
  userEmail = '',
  userMobile = '',
  billingCountryCode = null
}) => {
  const clientTimeZone = useMemo(
    () => getCountryTimeZone(billingCountryCode) || getBrowserTimeZone(),
    [billingCountryCode]
  );
  const createInitialFormData = (): RequestData => ({
    fullName: userName,
    email: userEmail,
    mobile: userMobile,
    services: [],
    legalDomain: '',
    caseDetails: '',
    documents: [],
    consultationMode: 'video',
    preferredDate: '',
    preferredEndAtUtc: undefined,
    preferredStartAtUtc: undefined,
    preferredTime: '',
    preferredTimezone: clientTimeZone,
    urgency: 'standard',
    pastLegalAction: false
  });
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<RequestData>(createInitialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pricingConfig, setPricingConfig] = useState<RequestWizardPricingConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [localCurrencyEstimate, setLocalCurrencyEstimate] = useState<LocalCurrencyEstimate | null>(null);

  const totalSteps = 7;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    let didCancel = false;
    setIsLoadingConfig(true);
    setConfigError(null);

    dashboardApi
      .getRequestPricingConfig()
      .then((config) => {
        if (didCancel) {
          return;
        }

        if (!hasUsablePricingConfig(config)) {
          setPricingConfig(null);
          setConfigError(PRICING_UNAVAILABLE_MESSAGE);
          setFormData((current) => ({
            ...current,
            consultationMode: '',
            legalDomain: '',
            services: [],
            urgency: '',
          }));
          return;
        }

        const nextConfig = normalizePricingConfig(config);
        setPricingConfig(nextConfig);
        setFormData((current) => ({
          ...current,
          consultationMode: nextConfig.consultationModes.some((mode) => mode.id === current.consultationMode)
            ? current.consultationMode
            : nextConfig.consultationModes[0]?.id || 'video',
          services: current.services.filter((serviceId) =>
            nextConfig.services.some((service) => service.id === serviceId)
          ),
          legalDomain: nextConfig.legalDomains.some((domain) => domain.id === current.legalDomain)
            ? current.legalDomain
            : '',
          urgency: nextConfig.urgencyOptions.some((urgency) => urgency.id === current.urgency)
            ? current.urgency
            : nextConfig.urgencyOptions[0]?.id || 'standard',
        }));
      })
      .catch((error) => {
        if (didCancel) {
          return;
        }
        setConfigError(
          error instanceof Error
            ? error.message
            : 'Unable to load current pricing configuration. Please try again.'
        );
        setPricingConfig(null);
      })
      .finally(() => {
        if (!didCancel) {
          setIsLoadingConfig(false);
        }
      });

    return () => {
      didCancel = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setFormData((current) => ({
      ...current,
      ...buildPreferredWindowSnapshot(current.preferredDate, current.preferredTime, clientTimeZone),
    }));
  }, [clientTimeZone, isOpen]);

  const localCurrencyCode = useMemo(() => {
    if (pricingConfig?.showApproximateLocalCurrency === false) {
      return null;
    }

    const currency = getCountryCurrency(pricingConfig?.countryPricing.countryCode || billingCountryCode);
    return currency && currency !== 'USD' ? currency : null;
  }, [
    billingCountryCode,
    pricingConfig?.countryPricing.countryCode,
    pricingConfig?.showApproximateLocalCurrency,
  ]);

  useEffect(() => {
    if (!isOpen || !localCurrencyCode) {
      setLocalCurrencyEstimate(null);
      return;
    }

    let didCancel = false;

    fetchUsdRate(localCurrencyCode).then((estimate) => {
      if (!didCancel) {
        setLocalCurrencyEstimate(estimate);
      }
    });

    return () => {
      didCancel = true;
    };
  }, [isOpen, localCurrencyCode]);

  const services = pricingConfig?.services || [];
  const legalDomains = pricingConfig?.legalDomains || [];
  const consultationModes = pricingConfig?.consultationModes || [];
  const urgencyOptions = pricingConfig?.urgencyOptions || [];
  const isPricingUnavailable = Boolean(configError) || !pricingConfig;
  const selectedServices = useMemo(
    () => services.filter((service) => formData.services.includes(service.id)),
    [formData.services, services]
  );
  const selectedServiceNames = selectedServices.map((service) => service.name);
  const selectedServicesLabel =
    selectedServiceNames.length > 0 ? selectedServiceNames.join(', ') : 'No services selected';
  const selectedConsultationMode = consultationModes.find(
    (mode) => mode.id === formData.consultationMode
  );
  const availableUrgencyOptions = useMemo(() => {
    if (!selectedConsultationMode) {
      return urgencyOptions;
    }
    return urgencyOptions.filter(
      (urgency) =>
        urgency.allowedConsultationModes.length === 0 ||
        urgency.allowedConsultationModes.includes(selectedConsultationMode.id)
    );
  }, [selectedConsultationMode, urgencyOptions]);
  const availableUrgencyIds = availableUrgencyOptions.map((urgency) => urgency.id).join('|');

  useEffect(() => {
    if (!isOpen || availableUrgencyOptions.length === 0) {
      return;
    }

    if (!availableUrgencyOptions.some((urgency) => urgency.id === formData.urgency)) {
      setFormData((current) => ({
        ...current,
        urgency: availableUrgencyOptions[0]?.id || 'standard',
      }));
    }
  }, [availableUrgencyIds, availableUrgencyOptions, formData.urgency, isOpen]);

  const handleNext = () => {
    if (isPricingUnavailable) {
      return;
    }

    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleServiceToggle = (serviceId: string) => {
    setFormData(prev => ({
      ...prev,
      services: prev.services.includes(serviceId)
        ? prev.services.filter(s => s !== serviceId)
        : [...prev.services, serviceId]
    }));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFormData(prev => ({
        ...prev,
        documents: [...prev.documents, ...Array.from(e.target.files!)]
      }));
    }
  };

  const updatePreferredDate = (preferredDate: string) => {
    setFormData((current) => ({
      ...current,
      preferredDate,
      ...buildPreferredWindowSnapshot(preferredDate, current.preferredTime, clientTimeZone),
    }));
  };

  const updatePreferredTime = (preferredTime: string) => {
    setFormData((current) => ({
      ...current,
      preferredTime,
      ...buildPreferredWindowSnapshot(current.preferredDate, preferredTime, clientTimeZone),
    }));
  };

  const handleSubmit = async () => {
    if (isSubmitting || isPricingUnavailable) {
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    let didClose = false;

    try {
      await onSubmit({
        ...formData,
        ...buildPreferredWindowSnapshot(formData.preferredDate, formData.preferredTime, clientTimeZone),
      });
      setCurrentStep(1);
      setFormData(createInitialFormData());
      didClose = true;
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error
          ? error.message
          : 'We could not submit your request right now. Please try again.'
      );
    } finally {
      if (!didClose) {
        setIsSubmitting(false);
      }
    }
  };

  const formatPriceDisplay = (amount: number) => {
    const dollarAmount = formatMoney(amount, 'USD');
    const matchingEstimate =
      localCurrencyEstimate && localCurrencyEstimate.currencyCode === localCurrencyCode
        ? localCurrencyEstimate
        : null;

    if (!matchingEstimate) {
      return dollarAmount;
    }

    const localAmount = formatMoney(toMoney(amount * matchingEstimate.rate), matchingEstimate.currencyCode);
    return `${dollarAmount} (approx. ${localAmount})`;
  };
  const serviceFee = toMoney(selectedServices.reduce((sum, service) => sum + service.baseFee, 0));
  const consultationFee = toMoney(selectedConsultationMode?.fee || 0);
  const selectedUrgency = availableUrgencyOptions.find((urgency) => urgency.id === formData.urgency);
  const urgencySurcharge = selectedUrgency
    ? selectedUrgency.surchargeType === 'percent'
      ? toMoney(serviceFee * (selectedUrgency.surcharge / 100))
      : toMoney(selectedUrgency.surcharge)
    : 0;
  const totalFee = toMoney(serviceFee + consultationFee + urgencySurcharge);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => {
            if (!isSubmitting) {
              onClose();
            }
          }}
        />

        {/* Modal */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative bg-white rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden"
          aria-busy={isSubmitting}
        >
          {/* Header */}
          <div className="sticky top-0 bg-white z-10 border-b border-gray-100">
            <div className="p-6 md:p-8">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-2xl md:text-3xl font-bold mb-2" style={{ fontFamily: "'Playfair Display', serif" }}>
                    New Request
                  </h2>
                  <p className="text-sm text-gray-500 uppercase tracking-widest font-bold">
                    Step {currentStep} of {totalSteps}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  disabled={isSubmitting}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X size={24} className="text-gray-400" />
                </button>
              </div>
              
              {/* Progress Bar */}
              <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-gradient-to-r from-blue-600 to-blue-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${(currentStep / totalSteps) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
              {isLoadingConfig ? (
                <p className="mt-3 text-xs font-medium text-blue-600">Loading current services and pricing...</p>
              ) : null}
              {!isLoadingConfig && !configError ? (
                <p className="mt-3 text-xs font-medium text-gray-500">
                  {localCurrencyEstimate
                    ? 'You will be billed in dollars. Local estimates in brackets are approximate.'
                    : 'Prices are shown in dollars.'}
                </p>
              ) : null}
              {configError ? (
                <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  {configError}
                </p>
              ) : null}
            </div>
          </div>

          {/* Content */}
          <div className="p-6 md:p-8 overflow-y-auto max-h-[calc(90vh-280px)]">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
              >
                {/* Step 1: Confirm Details */}
                {currentStep === 1 && (
                  <div>
                    <h3 className="text-2xl font-bold mb-2">Confirm Your Details</h3>
                    <p className="text-gray-500 mb-8">
                      These details come from Account Settings and will be saved with this request.
                    </p>
                    
                    <div className="bg-gray-50 rounded-2xl p-6 md:p-8 space-y-6">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">
                          Full Name
                        </label>
                        <p className="text-lg font-semibold text-gray-900">{formData.fullName || 'Not added'}</p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">
                          Email
                        </label>
                        <p className="text-lg font-semibold text-gray-900">{formData.email || 'Not added'}</p>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">
                          Mobile
                        </label>
                        <p className="text-lg font-semibold text-gray-900">{formData.mobile || 'Not added'}</p>
                      </div>

                      <div className="border-t border-gray-200 pt-6">
                        <h4 className="text-sm font-bold text-gray-900">Need to change these details?</h4>
                        <p className="mt-1 text-sm text-gray-500">
                          Update your name, email, phone, and billing address in Account Settings before creating a new request.
                        </p>
                        {onOpenSettings ? (
                          <button
                            type="button"
                            onClick={onOpenSettings}
                            className="mt-3 rounded-full border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-white"
                          >
                            Open Account Settings
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Select Services */}
                {currentStep === 2 && (
                  <div>
                    <h3 className="text-2xl font-bold mb-2">Select Primary Service</h3>
                    <p className="text-gray-500 mb-8">Choose one or multiple services you need</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {services.map((service: RequestWizardService) => {
                        const IconComponent = serviceIcons[service.icon] || Briefcase;
                        const isSelected = formData.services.includes(service.id);
                        
                        return (
                          <button
                            key={service.id}
                            type="button"
                            onClick={() => handleServiceToggle(service.id)}
                            className={`p-6 rounded-2xl border-2 transition-all text-left ${
                              isSelected
                                ? 'border-blue-600 bg-blue-50 shadow-lg shadow-blue-100'
                                : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                            }`}
                          >
                            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${
                              isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
                            }`}>
                              {IconComponent && <IconComponent size={24} />}
                            </div>
                            <h4 className="font-bold mb-1">{service.name}</h4>
                            <p className="text-sm text-gray-500">{service.description}</p>
                            <p className="mt-3 text-xs font-bold text-gray-700">
                              Starts at {formatPriceDisplay(service.baseFee)}
                            </p>
                            {isSelected && (
                              <div className="mt-4 flex items-center gap-2 text-blue-600 text-sm font-bold">
                                <CheckCircle size={16} />
                                Selected
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {formData.services.length > 0 && (
                      <div className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-100">
                        <p className="text-sm font-bold text-blue-900">
                          {formData.services.length} service{formData.services.length > 1 ? 's' : ''} selected • 
                          Base fee: {formatPriceDisplay(serviceFee)}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Step 3: Legal Domain */}
                {currentStep === 3 && (
                  <div>
                    <h3 className="text-2xl font-bold mb-2">Legal Domain</h3>
                    <p className="text-gray-500 mb-8">Which category does your case fall under?</p>
                    
                    <div className="space-y-3">
                      {legalDomains.map((domain) => (
                        <button
                          key={domain.id}
                          type="button"
                          onClick={() => setFormData({ ...formData, legalDomain: domain.id })}
                          className={`w-full p-4 rounded-xl border-2 transition-all text-left flex items-center gap-4 ${
                            formData.legalDomain === domain.id
                              ? 'border-blue-600 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            formData.legalDomain === domain.id
                              ? 'border-blue-600'
                              : 'border-gray-300'
                          }`}>
                            {formData.legalDomain === domain.id && (
                              <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                            )}
                          </div>
                          <div>
                            <p className="font-semibold">{domain.name}</p>
                            <p className="text-xs text-gray-500">{domain.description}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 4: Case Details */}
                {currentStep === 4 && (
                  <div>
                    <h3 className="text-2xl font-bold mb-2">Case Details</h3>
                    <p className="text-gray-500 mb-8">Describe the specific issue clearly.</p>
                    
                    <div className="space-y-6">
                      <div>
                        <textarea
                          value={formData.caseDetails}
                          onChange={(e) => setFormData({ ...formData, caseDetails: e.target.value })}
                          placeholder="e.g. I need a review of a builder buyer agreement for a property in Noida..."
                          className="w-full h-48 p-4 border-2 border-gray-200 rounded-xl outline-none focus:border-blue-600 transition-colors resize-none"
                        />
                      </div>

                      <div>
                        <h4 className="font-bold mb-4">Upload Documents</h4>
                        <label className="block border-2 border-dashed border-gray-300 rounded-xl p-12 text-center cursor-pointer hover:border-blue-600 hover:bg-blue-50 transition-all">
                          <input
                            type="file"
                            multiple
                            accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                            onChange={handleFileUpload}
                            className="hidden"
                          />
                          <Upload size={48} className="mx-auto text-gray-400 mb-4" />
                          <p className="text-gray-500 mb-1">Click to upload or drag & drop</p>
                          <p className="text-xs text-gray-400">PDF, DOCX, JPG supported</p>
                        </label>
                        {formData.documents.length > 0 && (
                          <div className="mt-4 space-y-2">
                            {formData.documents.map((file, index) => (
                              <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                                <FileText size={16} className="text-gray-400" />
                                <span className="text-sm flex-1">{file.name}</span>
                                <span className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 5: Consultation Mode */}
                {currentStep === 5 && (
                  <div>
                    <h3 className="text-2xl font-bold mb-8">Preferred Consultation Mode</h3>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {consultationModes.map((mode: RequestWizardConsultationMode) => {
                        const ModeIcon = consultationModeIcons[mode.id] || UserCheck;
                        const isSelected = formData.consultationMode === mode.id;
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            onClick={() => setFormData({ ...formData, consultationMode: mode.id as ConsultationMode })}
                            className={`p-8 rounded-2xl border-2 transition-all ${
                              isSelected
                                ? 'border-blue-600 bg-blue-50 shadow-lg shadow-blue-100'
                                : 'border-gray-200 hover:border-gray-300'
                            }`}
                          >
                            <ModeIcon size={48} className={`mx-auto mb-4 ${isSelected ? 'text-blue-600' : 'text-gray-400'}`} />
                            <p className="font-bold">{mode.label}</p>
                            {mode.description ? <p className="mt-2 text-xs text-gray-500">{mode.description}</p> : null}
                            {mode.fee > 0 ? (
                              <p className="mt-3 text-xs font-bold text-gray-700">
                                +{formatPriceDisplay(mode.fee)}
                              </p>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                    {selectedConsultationMode?.isInPerson && selectedConsultationMode.transportDisclaimer ? (
                      <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-800">
                        {selectedConsultationMode.transportDisclaimer}
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Step 6: Timing & Urgency */}
                {currentStep === 6 && (
                  <div>
                    <h3 className="text-2xl font-bold mb-8">Timing & Urgency</h3>
                    
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                            Preferred Date
                          </label>
                          <input
                            type="date"
                            value={formData.preferredDate}
                            onChange={(e) => updatePreferredDate(e.target.value)}
                            className="w-full p-4 border-2 border-gray-200 rounded-xl outline-none focus:border-blue-600 transition-colors"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                            Time Window
                          </label>
                          <select
                            value={formData.preferredTime}
                            onChange={(e) => updatePreferredTime(e.target.value)}
                            className="w-full p-4 border-2 border-gray-200 rounded-xl outline-none focus:border-blue-600 transition-colors"
                          >
                            <option value="">Select Time</option>
                            {REQUEST_TIME_WINDOWS.map((slot) => (
                              <option key={slot.value} value={slot.value}>
                                {slot.label}
                              </option>
                            ))}
                          </select>
                          <p className="mt-2 text-xs text-gray-500">
                            Times are shown in your billing country timezone. Admin scheduling receives the converted time.
                          </p>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                          Urgency Level
                        </label>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {availableUrgencyOptions.map((urgency: RequestWizardUrgencyOption) => {
                            const isSelected = formData.urgency === urgency.id;
                            const surchargeAmount =
                              urgency.surchargeType === 'percent'
                                ? toMoney(serviceFee * (urgency.surcharge / 100))
                                : urgency.surcharge;
                            return (
                              <button
                                key={urgency.id}
                                type="button"
                                onClick={() => setFormData({ ...formData, urgency: urgency.id as UrgencyLevel })}
                                className={`p-4 rounded-xl border-2 transition-all text-center ${
                                  isSelected
                                    ? 'border-blue-600 bg-blue-50'
                                    : 'border-gray-200 hover:border-gray-300'
                                }`}
                              >
                                <p className="font-semibold text-sm mb-1">{urgency.label}</p>
                                {urgency.timingLabel ? (
                                  <p className="mb-1 text-[11px] font-medium text-gray-500">{urgency.timingLabel}</p>
                                ) : null}
                                {surchargeAmount > 0 && (
                                  <p className="text-xs text-gray-500">
                                    +{formatPriceDisplay(surchargeAmount)}
                                    {urgency.surchargeType === 'percent' ? ` (${urgency.surcharge}%)` : ''}
                                  </p>
                                )}
                              </button>
                            );
                          })}
                        </div>
                        {selectedConsultationMode?.isInPerson ? (
                          <p className="mt-3 text-xs font-medium text-amber-700">
                            Only urgency options enabled for in-person consultations are shown. Transportation/travel costs
                            are extra and borne by the client. Final amount depends on city/country.
                          </p>
                        ) : null}
                        {availableUrgencyOptions.length === 0 ? (
                          <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                            No urgency option is currently available for this consultation mode.
                          </p>
                        ) : null}
                      </div>

                      <div>
                        <label className="block text-sm font-bold mb-3">
                          Any past legal action?
                        </label>
                        <div className="flex gap-4">
                          {[
                            { value: true, label: 'Yes' },
                            { value: false, label: 'No' }
                          ].map((option) => (
                            <button
                              key={option.label}
                              type="button"
                              onClick={() => setFormData({ ...formData, pastLegalAction: option.value })}
                              className={`flex items-center gap-2 px-6 py-3 rounded-xl border-2 transition-all ${
                                formData.pastLegalAction === option.value
                                  ? 'border-blue-600 bg-blue-50'
                                  : 'border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                formData.pastLegalAction === option.value
                                  ? 'border-blue-600'
                                  : 'border-gray-300'
                              }`}>
                                {formData.pastLegalAction === option.value && (
                                  <div className="w-2 h-2 rounded-full bg-blue-600" />
                                )}
                              </div>
                              <span className="font-medium">{option.label}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 7: Review & Confirmation */}
                {currentStep === 7 && (
                  <div>
                    <div className="text-center mb-8">
                      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle size={40} className="text-green-600" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2">Your request is ready for submission.</h3>
                      <p className="text-gray-500">
                        Review your selected services and complete payment to submit your request.
                      </p>
                      <p className="mt-3 text-sm text-gray-700">
                        <span className="font-semibold">Selected services:</span> {selectedServicesLabel}
                      </p>
                    </div>

                    <div className="bg-gray-50 rounded-2xl p-6 space-y-4 mb-8">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <span className="text-gray-600">Selected Services</span>
                          <p className="mt-1 text-sm font-medium text-gray-800">{selectedServicesLabel}</p>
                        </div>
                        <span className="shrink-0 text-xl font-bold">{formatPriceDisplay(serviceFee)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Consultation Mode</span>
                        <span className="text-xl font-bold">{formatPriceDisplay(consultationFee)}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">Urgency Surcharge</span>
                        <span className="text-xl font-bold">{formatPriceDisplay(urgencySurcharge)}</span>
                      </div>
                      <div className="border-t border-gray-200 pt-4">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-lg">Total</span>
                          <span className="text-2xl font-bold">{formatPriceDisplay(totalFee)}</span>
                        </div>
                        <p className="mt-2 text-xs text-gray-500">
                          Payment is required before your request is submitted to our intake team.
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Final fees may vary if scope, urgency, travel, or third-party costs change.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {submitError && (
            <div className="border-t border-red-100 bg-red-50 px-6 py-4 text-sm text-red-700 md:px-8">
              {submitError}
            </div>
          )}

          {/* Footer */}
          <div className="sticky bottom-0 bg-white border-t border-gray-100 p-6 md:p-8 flex items-center justify-between">
            <button
              onClick={handleBack}
              disabled={currentStep === 1 || isSubmitting}
              className="px-6 py-3 text-gray-400 font-bold disabled:opacity-30 hover:text-gray-600 transition-colors"
            >
              Back
            </button>
            
            {currentStep < totalSteps ? (
              <button
                onClick={handleNext}
                disabled={
                  isSubmitting ||
                  isLoadingConfig ||
                  isPricingUnavailable ||
                  (currentStep === 1 && (!formData.fullName || !formData.email || !formData.mobile)) ||
                  (currentStep === 2 && formData.services.length === 0) ||
                  (currentStep === 3 && !formData.legalDomain) ||
                  (currentStep === 4 && !formData.caseDetails) ||
                  (currentStep === 6 &&
                    (!formData.preferredDate ||
                      !formData.preferredTime ||
                      !formData.urgency ||
                      availableUrgencyOptions.length === 0))
                }
                className="px-8 py-3 bg-gray-900 text-white rounded-full font-bold hover:bg-black transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
              >
                Continue <ChevronRight size={18} />
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || isLoadingConfig || isPricingUnavailable}
                className="px-8 py-3 bg-green-600 text-white rounded-full font-bold hover:bg-green-700 transition-colors disabled:cursor-not-allowed disabled:opacity-60 flex items-center gap-2"
              >
                {isSubmitting ? 'Opening payment...' : 'Pay & Submit'} <CheckCircle size={18} />
              </button>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
