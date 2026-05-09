export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export const normalizeGstin = (value: string | null | undefined) => {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : null;
};

export const isValidGstin = (value: string) => GSTIN_PATTERN.test(value);
