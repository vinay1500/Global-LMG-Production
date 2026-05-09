import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingWorkspace } from './BillingWorkspace';
import type { Invoice } from '../data/adminTypes';
import { adminApi } from '../lib/api/admin';

vi.mock('../lib/api/admin', () => ({
  adminApi: {
    downloadInvoicePdf: vi.fn(),
    fetchInvoicePdfPreview: vi.fn(),
  },
}));

const mockedAdminApi = vi.mocked(adminApi);

const invoice: Invoice = {
  amount: 300,
  billingSnapshot: {
    addressLine1: '1 Main Street',
    addressLine2: null,
    billingEmail: 'client@example.com',
    billingName: 'Acme Legal',
    billingPhone: '+15555550100',
    city: 'New York',
    countryCode: 'US',
    gstin: null,
    postalCode: '10001',
    state: 'NY',
  },
  business: {
    address: 'Global LMG',
    email: 'billing@globallmg.org',
    gstin: null,
    name: 'Global LMG',
    paymentInstructions: null,
    phone: null,
    state: null,
    website: null,
  },
  clientId: 'client-1',
  clientName: 'Acme Legal',
  currencyCode: 'USD',
  discount: 0,
  dueDate: '2026-06-30',
  id: 'INV-1001',
  issueDate: '2026-06-01',
  items: [{ amount: 300, description: 'Retainer', quantity: 1, rate: 300 }],
  matterId: 'matter-1',
  matterRef: 'MAT-1001',
  matterTitle: 'Commercial Review',
  status: 'pending',
  tax: 0,
  template: {
    body: null,
    footer: null,
    id: null,
    subject: 'Invoice INV-1001',
    terms: null,
    version: null,
  },
  totalAmount: 300,
};

beforeEach(() => {
  mockedAdminApi.fetchInvoicePdfPreview.mockReset();
  mockedAdminApi.downloadInvoicePdf.mockReset();
  mockedAdminApi.fetchInvoicePdfPreview.mockResolvedValue({
    blob: new Blob(['%PDF-1.4'], { type: 'application/pdf' }),
    fileName: 'invoice.pdf',
  });
  mockedAdminApi.downloadInvoicePdf.mockResolvedValue(undefined);
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invoice-preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('BillingWorkspace', () => {
  it('keeps invoice list/search visible and loads PDF preview through a blob URL', async () => {
    render(
      <MemoryRouter>
        <BillingWorkspace invoices={[invoice]} />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: /invoice list/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search invoices/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /advanced filters/i })).toBeInTheDocument();
    expect(screen.getByText('INV-1001')).toBeInTheDocument();

    await waitFor(() => expect(mockedAdminApi.fetchInvoicePdfPreview).toHaveBeenCalledWith('INV-1001'));
    const preview = await screen.findByTitle('Invoice PDF INV-1001');
    expect(preview).toHaveAttribute('src', 'blob:invoice-preview');
  });

  it('shows an empty list and select-invoice preview state when no invoices exist', () => {
    render(
      <MemoryRouter>
        <BillingWorkspace invoices={[]} />
      </MemoryRouter>
    );

    expect(screen.getByText('No invoices yet')).toBeInTheDocument();
    expect(screen.getByText('Select an invoice to preview')).toBeInTheDocument();
    expect(mockedAdminApi.fetchInvoicePdfPreview).not.toHaveBeenCalled();
  });
});

describe('AdminRuntimeGuard', () => {
  it('hides stack traces and shows an error reference in production mode', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('PROD', true);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const preventUnhandledErrorLog = (event: ErrorEvent) => {
      event.preventDefault();
    };
    window.addEventListener('error', preventUnhandledErrorLog);
    const { AdminRuntimeGuard } = await import('../App');
    const Broken = () => {
      throw new Error('render failed');
    };

    const { container } = render(
      <AdminRuntimeGuard>
        <Broken />
      </AdminRuntimeGuard>
    );

    expect(screen.getByText('Admin frontend failed to render')).toBeInTheDocument();
    expect(screen.getByText(/^Reference: [a-z0-9]{8}$/)).toBeInTheDocument();
    expect(container.querySelector('pre')).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    window.removeEventListener('error', preventUnhandledErrorLog);
  });
});
