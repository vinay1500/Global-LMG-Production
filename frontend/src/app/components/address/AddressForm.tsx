import React from 'react';
import { ADDRESS_AUTOCOMPLETE_MODE, GOOGLE_MAPS_API_KEY } from '../../config/runtime';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  getCountryNameOrSelf,
  isPostalCodeReasonable,
} from '../../utils/countryDialCodes';
import { getStateRegionSuggestions } from '../../utils/geoAddressData';
import { getPostalCodeMetadata } from '../../utils/postalCodeMetadata';

type AddressSourceCode = 'google' | 'ip_prefill' | 'manual';
type AddressValidationStatus = 'manual' | 'unverified' | 'verified';

export interface AddressFormValue {
  city: string;
  country: string;
  googlePlaceId?: string | null;
  line1: string;
  line2: string;
  postalCode: string;
  sourceCode: AddressSourceCode;
  state: string;
  validationStatusCode: AddressValidationStatus;
}

interface AddressFormProps {
  idPrefix: string;
  onChange: (value: AddressFormValue) => void;
  value: AddressFormValue;
  variant?: 'glass' | 'light';
}

type GooglePlacesWindow = Window & {
  google?: {
    maps?: {
      places?: {
        Autocomplete: new (
          input: HTMLInputElement,
          options: { fields: string[]; types?: string[] }
        ) => {
          addListener: (eventName: string, handler: () => void) => void;
          getPlace: () => {
            address_components?: Array<{
              long_name: string;
              short_name: string;
              types: string[];
            }>;
            place_id?: string;
          };
        };
      };
    };
  };
};

const googleMapsScriptId = 'global-lmg-google-places';
let googleMapsScriptPromise: Promise<void> | null = null;

const loadGoogleMapsScript = () => {
  const apiKey = GOOGLE_MAPS_API_KEY;
  if (typeof window === 'undefined' || !apiKey) {
    return Promise.reject(new Error('Google Maps API key is not configured.'));
  }

  const googleWindow = window as GooglePlacesWindow;
  if (googleWindow.google?.maps?.places) {
    return Promise.resolve();
  }

  if (googleMapsScriptPromise) {
    return googleMapsScriptPromise;
  }

  googleMapsScriptPromise = new Promise<void>((resolve, reject) => {
    const existingScript = document.getElementById(googleMapsScriptId) as HTMLScriptElement | null;
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Google Maps script failed.')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = googleMapsScriptId;
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Maps script failed.'));
    document.head.appendChild(script);
  }).catch((error) => {
    googleMapsScriptPromise = null;
    throw error;
  });

  return googleMapsScriptPromise;
};

const componentValue = (
  components: Array<{ long_name: string; short_name: string; types: string[] }> | undefined,
  type: string,
  useShortName = false
) => {
  const component = components?.find((entry) => entry.types.includes(type));
  return useShortName ? component?.short_name || '' : component?.long_name || '';
};

const getAddressLines = (components: Array<{ long_name: string; short_name: string; types: string[] }> | undefined) => {
  const streetNumber = componentValue(components, 'street_number');
  const route = componentValue(components, 'route');
  const premise = componentValue(components, 'premise');
  const subpremise = componentValue(components, 'subpremise');
  const line1 = [streetNumber, route].filter(Boolean).join(' ') || premise;
  const line2 = subpremise ? `Unit ${subpremise}` : '';

  return { line1, line2 };
};

export const createEmptyAddressValue = (country = DEFAULT_COUNTRY): AddressFormValue => ({
  city: '',
  country,
  googlePlaceId: null,
  line1: '',
  line2: '',
  postalCode: '',
  sourceCode: 'manual',
  state: '',
  validationStatusCode: 'manual',
});

export const AddressForm = ({
  idPrefix,
  onChange,
  value,
  variant = 'light',
}: AddressFormProps) => {
  const autocompleteInputRef = React.useRef<HTMLInputElement | null>(null);
  const latestValueRef = React.useRef(value);
  const latestOnChangeRef = React.useRef(onChange);
  const [autocompleteStatus, setAutocompleteStatus] = React.useState<'disabled' | 'ready' | 'failed' | 'loading'>(
    ADDRESS_AUTOCOMPLETE_MODE === 'google' && GOOGLE_MAPS_API_KEY ? 'loading' : 'disabled'
  );

  React.useEffect(() => {
    latestValueRef.current = value;
    latestOnChangeRef.current = onChange;
  }, [onChange, value]);

  React.useEffect(() => {
    if (ADDRESS_AUTOCOMPLETE_MODE !== 'google' || !GOOGLE_MAPS_API_KEY || !autocompleteInputRef.current) {
      setAutocompleteStatus('disabled');
      return;
    }

    let isMounted = true;
    loadGoogleMapsScript()
      .then(() => {
        const googleWindow = window as GooglePlacesWindow;
        if (!isMounted || !autocompleteInputRef.current || !googleWindow.google?.maps?.places) {
          return;
        }

        const autocomplete = new googleWindow.google.maps.places.Autocomplete(autocompleteInputRef.current, {
          fields: ['address_components', 'place_id'],
          types: ['address'],
        });
        autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          const components = place.address_components || [];
          const countryCode = componentValue(components, 'country', true);
          const countryName = getCountryNameOrSelf(countryCode);
          const { line1, line2 } = getAddressLines(components);
          const latestValue = latestValueRef.current;
          latestOnChangeRef.current({
            ...latestValue,
            city:
              componentValue(components, 'locality') ||
              componentValue(components, 'postal_town') ||
              componentValue(components, 'administrative_area_level_2'),
            country: countryName || latestValue.country,
            googlePlaceId: place.place_id || null,
            line1: line1 || latestValue.line1,
            line2: line2 || latestValue.line2,
            postalCode: componentValue(components, 'postal_code') || latestValue.postalCode,
            sourceCode: 'google',
            state: componentValue(components, 'administrative_area_level_1'),
            validationStatusCode: 'unverified',
          });
        });
        setAutocompleteStatus('ready');
      })
      .catch(() => {
        if (isMounted) {
          setAutocompleteStatus('failed');
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const fieldClass =
    variant === 'glass'
      ? 'w-full rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-white/45'
      : 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm';
  const labelClass =
    variant === 'glass'
      ? 'mb-2 block text-xs font-bold uppercase tracking-[0.2em] text-white/75'
      : 'mb-1 block text-xs uppercase tracking-[0.18em] text-gray-400';
  const hintClass = variant === 'glass' ? 'text-xs text-white/55' : 'text-xs text-gray-500';
  const stateSuggestions = getStateRegionSuggestions(value.country);
  const postalCodeMetadata = getPostalCodeMetadata(value.country);
  const postalLooksValid = !value.postalCode || isPostalCodeReasonable(value.postalCode, value.country);

  const update = (patch: Partial<AddressFormValue>) =>
    onChange({
      ...value,
      ...patch,
      sourceCode: patch.sourceCode || (value.sourceCode === 'google' ? 'google' : 'manual'),
    });

  const handleCountryChange = (country: string) => {
    const nextStateSuggestions = getStateRegionSuggestions(country);
    const stateStillApplies = nextStateSuggestions.some(
      (state) => state.toLowerCase() === value.state.trim().toLowerCase()
    );
    update({
      city: stateStillApplies ? value.city : '',
      country,
      postalCode: '',
      sourceCode: 'manual',
      state: stateStillApplies ? value.state : '',
      validationStatusCode: 'manual',
    });
  };

  return (
    <div className="space-y-4">
      {ADDRESS_AUTOCOMPLETE_MODE === 'google' && GOOGLE_MAPS_API_KEY ? (
        <label className="block">
          <span className={labelClass}>Search address</span>
          <input
            ref={autocompleteInputRef}
            className={fieldClass}
            placeholder="Start typing your billing address"
            type="text"
          />
          <p className={`mt-2 ${hintClass}`}>
            {autocompleteStatus === 'ready'
              ? 'Select a suggestion, then review the fields below.'
              : autocompleteStatus === 'failed'
                ? 'Address suggestions are unavailable. Enter the address manually.'
                : 'Manual entry is always available.'}
          </p>
        </label>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <label className="block md:col-span-2">
          <span className={labelClass}>Address line 1</span>
          <input
            className={fieldClass}
            id={`${idPrefix}-line1`}
            onChange={(event) => update({ line1: event.target.value, sourceCode: 'manual', validationStatusCode: 'manual' })}
            placeholder="Building, street, area"
            required
            type="text"
            value={value.line1}
          />
        </label>
        <label className="block md:col-span-2">
          <span className={labelClass}>Address line 2</span>
          <input
            className={fieldClass}
            id={`${idPrefix}-line2`}
            onChange={(event) => update({ line2: event.target.value, sourceCode: 'manual', validationStatusCode: 'manual' })}
            placeholder="Apartment, suite, landmark"
            type="text"
            value={value.line2}
          />
        </label>
        <label className="block">
          <span className={labelClass}>Country</span>
          <select
            className={fieldClass}
            id={`${idPrefix}-country`}
            onChange={(event) => handleCountryChange(event.target.value)}
            value={value.country}
          >
            {COUNTRIES.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={labelClass}>State / region</span>
          <input
            className={fieldClass}
            id={`${idPrefix}-state`}
            list={`${idPrefix}-state-suggestions`}
            onChange={(event) => update({ state: event.target.value, sourceCode: 'manual', validationStatusCode: 'manual' })}
            required
            type="text"
            value={value.state}
          />
          <datalist id={`${idPrefix}-state-suggestions`}>
            {stateSuggestions.map((state) => (
              <option key={state} value={state} />
            ))}
          </datalist>
        </label>
        <label className="block">
          <span className={labelClass}>City</span>
          <input
            className={fieldClass}
            id={`${idPrefix}-city`}
            onChange={(event) => update({ city: event.target.value, sourceCode: 'manual', validationStatusCode: 'manual' })}
            required
            type="text"
            value={value.city}
          />
        </label>
        <label className="block">
          <span className={labelClass}>{postalCodeMetadata.label}</span>
          <input
            className={fieldClass}
            id={`${idPrefix}-postal`}
            onChange={(event) => update({ postalCode: event.target.value, sourceCode: 'manual', validationStatusCode: 'manual' })}
            placeholder={postalCodeMetadata.placeholder}
            required
            type="text"
            value={value.postalCode}
          />
          {!postalLooksValid ? <p className={`mt-2 ${hintClass}`}>Check the {postalCodeMetadata.label.toLowerCase()} format for this country.</p> : null}
        </label>
      </div>
    </div>
  );
};
