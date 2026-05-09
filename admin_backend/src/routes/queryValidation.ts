import { z } from 'zod';

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

const firstQueryValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);

export interface PaginationQueryOptions {
  defaultLimit?: number;
  maxLimit?: number;
}

export const parsePaginationQuery = (
  query: Record<string, unknown>,
  options: PaginationQueryOptions = {}
) => {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 200;
  const schema = z.object({
    limit: z.preprocess(
      (value) => firstQueryValue(value) ?? undefined,
      z.coerce.number().int().positive().max(maxLimit).default(defaultLimit)
    ),
    offset: z.preprocess(
      (value) => firstQueryValue(value) ?? undefined,
      z.coerce.number().int().min(0).default(0)
    ),
  });

  return schema.parse(query);
};

const searchTextSchema = z
  .string()
  .trim()
  .max(200)
  .refine((value) => !CONTROL_CHARACTER_PATTERN.test(value), {
    message: 'Search cannot include control characters.',
  });

const requiredSearchTextSchema = searchTextSchema.refine((value) => value.length > 0, {
  message: 'Search query is required.',
});

export const parseOptionalSearchQuery = (value: unknown) => {
  const queryValue = firstQueryValue(value);
  if (typeof queryValue !== 'string') {
    return undefined;
  }

  const parsed = searchTextSchema.parse(queryValue);
  return parsed.length > 0 ? parsed : undefined;
};

export const parseRequiredSearchQuery = (value: unknown) => {
  const queryValue = firstQueryValue(value);
  return requiredSearchTextSchema.parse(typeof queryValue === 'string' ? queryValue : '');
};
