import { env } from '../config/env.js';
import { providerFetch } from './providerHttp.js';

export interface AddressForValidation {
  city: string;
  country: string;
  googlePlaceId?: string | null;
  line1: string;
  line2?: string | null;
  postalCode: string;
  sourceCode?: 'google' | 'ip_prefill' | 'manual';
  state: string;
  validationStatusCode?: 'manual' | 'unverified' | 'verified';
}

const normalizeCountryCode = (value: string) => {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(normalized) ? normalized : normalized.slice(0, 3);
};

export const validateAddressForStorage = async (
  address: AddressForValidation
): Promise<AddressForValidation> => {
  const initialStatus =
    address.validationStatusCode || (address.sourceCode === 'google' ? 'unverified' : 'manual');
  const apiKey = env.GOOGLE_ADDRESS_VALIDATION_API_KEY || env.GOOGLE_MAPS_API_KEY;

  if (env.ADDRESS_VALIDATION_MODE !== 'google' || !apiKey) {
    return {
      ...address,
      validationStatusCode: initialStatus,
    };
  }

  try {
    const response = await providerFetch(
      `https://addressvalidation.googleapis.com/v1:validateAddress?key=${encodeURIComponent(apiKey)}`,
      {
        body: JSON.stringify({
          address: {
            addressLines: [address.line1, address.line2].filter(Boolean),
            administrativeArea: address.state,
            locality: address.city,
            postalCode: address.postalCode,
            regionCode: normalizeCountryCode(address.country),
          },
          enableUspsCass: false,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        operation: 'google_address_validation',
        providerCode: 'google-address-validation',
        retryDelayMs: 250,
        safeToRetry: true,
      }
    );

    if (!response.ok) {
      return { ...address, validationStatusCode: 'unverified' };
    }

    const payload = (await response.json()) as {
      result?: {
        verdict?: {
          addressComplete?: boolean;
          hasInferredComponents?: boolean;
          hasReplacedComponents?: boolean;
          validationGranularity?: string;
        };
      };
    };
    const verdict = payload.result?.verdict;
    const isVerified =
      Boolean(verdict?.addressComplete) &&
      !verdict?.hasInferredComponents &&
      !verdict?.hasReplacedComponents &&
      verdict?.validationGranularity !== 'OTHER';

    return {
      ...address,
      validationStatusCode: isVerified ? 'verified' : 'unverified',
    };
  } catch {
    return {
      ...address,
      validationStatusCode: 'unverified',
    };
  }
};
