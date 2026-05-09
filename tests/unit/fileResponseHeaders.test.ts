import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const extractBlock = (source: string, start: string, end: string) => {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);

  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);

  return source.slice(startIndex, endIndex);
};

const expectSensitiveDownloadHeaders = (block: string) => {
  expect(block).toMatch(/setHeader\(['"]Cache-Control['"], ['"]no-store['"]\)/i);
  expect(block).toMatch(/setHeader\(\s*['"]Content-Disposition['"][\s\S]*?`attachment;/i);
  expect(block).toMatch(/setHeader\(['"]Content-Type['"]/i);
  expect(block).toMatch(/setHeader\(['"]X-Content-Type-Options['"], ['"]nosniff['"]\)/i);
  expect(block).not.toContain('Content-Security-Policy');
};

const expectSensitiveInlineHeaders = (block: string, options: { sandbox: boolean }) => {
  expect(block).toMatch(/setHeader\(['"]Cache-Control['"], ['"]no-store['"]\)/i);
  expect(block).toMatch(/setHeader\(\s*['"]Content-Disposition['"][\s\S]*?`inline;/i);
  expect(block).toMatch(/setHeader\(['"]Content-Type['"]/i);
  expect(block).toMatch(/setHeader\(['"]X-Content-Type-Options['"], ['"]nosniff['"]\)/i);
  if (options.sandbox) {
    expect(block).toMatch(/setHeader\(['"]Content-Security-Policy['"], ['"]sandbox['"]\)/i);
  }
};

describe('sensitive file response headers', () => {
  it('aligns client document preview and download headers', () => {
    const source = readSource('backend/src/routes/me.ts');
    const downloadBlock = extractBlock(
      source,
      "meRouter.get(\n  '/me/documents/:documentId/download'",
      "meRouter.get(\n  '/me/documents/:documentId/preview'",
    );
    const previewBlock = extractBlock(
      source,
      "meRouter.get(\n  '/me/documents/:documentId/preview'",
      "meRouter.get(\n  '/me/events'",
    );

    expectSensitiveDownloadHeaders(downloadBlock);
    expectSensitiveInlineHeaders(previewBlock, { sandbox: true });
  });

  it('aligns client upload download headers', () => {
    const source = readSource('backend/src/routes/uploads.ts');
    const block = extractBlock(source, "uploadsRouter.get(\n  '/uploads/:uploadId/download'", '\n);');

    expectSensitiveDownloadHeaders(block);
  });

  it('aligns admin document preview and download headers', () => {
    const source = readSource('admin_backend/src/routes/documents.ts');
    const downloadBlock = extractBlock(
      source,
      "documentsRouter.get(\n  '/documents/:documentId/download'",
      "documentsRouter.get(\n  '/documents/:documentId/preview'",
    );
    const previewBlock = extractBlock(
      source,
      "documentsRouter.get(\n  '/documents/:documentId/preview'",
      "documentsRouter.post(\n  '/documents/uploads'",
    );

    expectSensitiveDownloadHeaders(downloadBlock);
    expectSensitiveInlineHeaders(previewBlock, { sandbox: true });
  });

  it('keeps invoice PDFs and report CSV exports no-store and nosniff', () => {
    const clientInvoiceSource = readSource('backend/src/routes/me.ts');
    const adminBillingSource = readSource('admin_backend/src/routes/billing.ts');
    const reportsSource = readSource('admin_backend/src/routes/reports.ts');
    const clientInvoiceBlock = extractBlock(
      clientInvoiceSource,
      "meRouter.get(\n  '/me/invoices/:invoiceId/download'",
      "meRouter.post(\n  '/me/invoices/:invoiceId/payment-order'",
    );
    const adminInvoiceBlock = extractBlock(
      adminBillingSource,
      "billingRouter.get(\n  '/billing/invoices/:invoiceId/download'",
      "billingRouter.post(\n  '/billing/invoices'",
    );
    const csvBlock = extractBlock(
      reportsSource,
      "reportsRouter.get(\n  '/reports/drilldowns/:kind/export.csv'",
      '\n);',
    );

    expectSensitiveDownloadHeaders(clientInvoiceBlock);
    expectSensitiveInlineHeaders(adminInvoiceBlock, { sandbox: false });
    expect(csvBlock).toMatch(/setHeader\(['"]cache-control['"], ['"]no-store['"]\)/i);
    expect(csvBlock).toMatch(/setHeader\(['"]content-type['"], ['"]text\/csv; charset=utf-8['"]\)/i);
    expect(csvBlock).toMatch(/setHeader\(\s*['"]content-disposition['"][\s\S]*?`attachment;/i);
    expect(csvBlock).toMatch(/setHeader\(['"]x-content-type-options['"], ['"]nosniff['"]\)/i);
  });
});
