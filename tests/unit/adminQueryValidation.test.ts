import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseOptionalSearchQuery,
  parsePaginationQuery,
  parseRequiredSearchQuery,
} from '../../admin_backend/src/routes/queryValidation.js';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('admin route query validation', () => {
  it('defaults and validates pagination bounds', () => {
    expect(parsePaginationQuery({})).toEqual({ limit: 50, offset: 0 });
    expect(parsePaginationQuery({ limit: '100', offset: '20' })).toEqual({
      limit: 100,
      offset: 20,
    });
    expect(() => parsePaginationQuery({ limit: '999999' })).toThrow();
    expect(() => parsePaginationQuery({ limit: '-1' })).toThrow();
    expect(() => parsePaginationQuery({ offset: '-1' })).toThrow();
    expect(() => parsePaginationQuery({ limit: 'nope' })).toThrow();
  });

  it('supports endpoint-specific maximum limits', () => {
    expect(parsePaginationQuery({ limit: '250' }, { maxLimit: 250 })).toEqual({
      limit: 250,
      offset: 0,
    });
    expect(() => parsePaginationQuery({ limit: '251' }, { maxLimit: 250 })).toThrow();
  });

  it('validates optional and required search text', () => {
    expect(parseOptionalSearchQuery('  Ada Lovelace  ')).toBe('Ada Lovelace');
    expect(parseOptionalSearchQuery('   ')).toBeUndefined();
    expect(parseRequiredSearchQuery('  invoice  ')).toBe('invoice');
    expect(() => parseRequiredSearchQuery('')).toThrow();
    expect(() => parseRequiredSearchQuery(`bad\u0000query`)).toThrow();
    expect(() => parseOptionalSearchQuery('x'.repeat(201))).toThrow();
  });

  it('routes admin list/search inputs through the shared validators', () => {
    for (const routeFile of [
      'admin_backend/src/routes/audit.ts',
      'admin_backend/src/routes/billing.ts',
      'admin_backend/src/routes/clients.ts',
      'admin_backend/src/routes/documents.ts',
      'admin_backend/src/routes/events.ts',
      'admin_backend/src/routes/matters.ts',
      'admin_backend/src/routes/messages.ts',
      'admin_backend/src/routes/notifications.ts',
      'admin_backend/src/routes/reports.ts',
    ]) {
      expect(read(routeFile)).toContain('parsePaginationQuery');
    }

    const searchRoute = read('admin_backend/src/routes/search.ts');
    expect(searchRoute).toContain('parseRequiredSearchQuery');
    expect(searchRoute).toContain('consumePersistentRateLimit');

    const clientRoute = read('admin_backend/src/routes/clients.ts');
    expect(clientRoute).toContain('parseOptionalSearchQuery');
  });
});
