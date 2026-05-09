import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddressForm, type AddressFormValue } from './address/AddressForm';
import { NewRequestWizard } from './NewRequestWizard';
import { InvoiceDetailSection } from './dashboard/sections/InvoiceDetailSection';
import type { InvoiceDetailResponse, RequestPricingConfigResponse } from '../lib/api/contracts';
import { dashboardApi } from '../lib/api/dashboard';

vi.mock('../lib/api/dashboard', () => ({
  dashboardApi: {
    getRequestPricingConfig: vi.fn(),
  },
}));

const mockedPricingConfig = vi.mocked(dashboardApi.getRequestPricingConfig);

const pricingConfig: RequestPricingConfigResponse = {
  consultationModes: [
    {
      description: 'Remote consultation',
      fee: 20,
      id: 'video',
      isInPerson: false,
      label: 'Video Call',
      transportDisclaimer: null,
    },
  ],
  countryPricing: {
    countryCode: 'US',
    countryName: 'United States',
    countrySource: 'saved_address',
    currencyCode: 'USD',
    isDefaultFallback: false,
    multiplier: 1,
    pricingCountryConfidence: 'high',
  },
  currencyCode: 'USD',
  detectedCountryCode: 'US',
  detectedCurrency: 'USD',
  legalDomains: [{ description: 'Contract disputes', id: 'civil', name: 'Civil Law' }],
  showApproximateLocalCurrency: true,
  services: [
    {
      baseFee: 120,
      description: 'Case tracking and shadow counsel',
      icon: 'Eye',
      id: 'litigation-monitoring',
      name: 'Litigation Monitoring',
    },
  ],
  urgencyOptions: [
    {
      allowedConsultationModes: ['video'],
      id: 'standard',
      isImmediate: false,
      label: 'Standard',
      maxResponseHours: 48,
      minResponseHours: 24,
      responseWindowHours: 48,
      surcharge: 0,
      surchargeType: 'flat',
      timingLabel: '24-48 hrs',
    },
  ],
};

const baseInvoice: InvoiceDetailResponse = {
  amountDue: 120,
  amountPaid: 0,
  amountRefunded: 0,
  billingSnapshot: null,
  business: {
    address: null,
    email: null,
    gstin: null,
    name: 'Global LMG',
    paymentInstructions: null,
    phone: null,
    state: null,
    website: null,
  },
  clientAccountId: 'client-1',
  currencyCode: 'USD',
  discountAmount: 0,
  documents: [],
  dueDate: '2026-06-15',
  id: 'invoice-public-id',
  installments: [],
  invoiceNumber: 'INV-1001',
  issueDate: '2026-06-01',
  lines: [
    {
      description: 'Document review',
      discountAmount: 0,
      id: 1,
      lineSubtotal: 120,
      lineTotal: 120,
      quantity: 1,
      serviceId: null,
      sortOrder: 1,
      subscriptionPlanId: null,
      taxableAmount: 120,
      taxes: [],
      typeCode: 'service',
      unitPrice: 120,
    },
  ],
  matterId: null,
  paymentOptions: {
    allowsPartial: false,
    amountDue: 120,
    currencyCode: 'USD',
    minimumPaymentAmount: 50,
    offlineEnabled: true,
    onlineEnabled: true,
    suggestedPaymentAmount: 120,
  },
  statusCode: 'issued',
  subtotalAmount: 120,
  taxAmount: 0,
  template: {
    body: null,
    footer: null,
    id: null,
    subject: 'Invoice INV-1001',
    terms: null,
    version: null,
  },
  totalAmount: 120,
  typeCode: 'service',
};

beforeEach(() => {
  mockedPricingConfig.mockReset();
});

describe('AddressForm', () => {
  it('resets dependent address fields and changes postal label when country changes', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const value: AddressFormValue = {
      city: 'New York',
      country: 'United States',
      googlePlaceId: null,
      line1: '1 Main Street',
      line2: '',
      postalCode: '10001',
      sourceCode: 'manual',
      state: 'New York',
      validationStatusCode: 'manual',
    };

    render(<AddressForm idPrefix="billing" onChange={onChange} value={value} />);

    expect(screen.getByText('ZIP code')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Country'), 'India');

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        city: '',
        country: 'India',
        postalCode: '',
        sourceCode: 'manual',
        state: '',
        validationStatusCode: 'manual',
      })
    );
  });
});

describe('NewRequestWizard', () => {
  it('shows a production-safe pricing unavailable state and blocks Continue', async () => {
    mockedPricingConfig.mockResolvedValue({
      ...pricingConfig,
      consultationModes: [],
      services: [],
      urgencyOptions: [],
    });

    render(
      <NewRequestWizard
        isOpen
        onClose={vi.fn()}
        onSubmit={vi.fn()}
        userEmail="client@example.com"
        userMobile="+15555550100"
        userName="Client User"
      />
    );

    expect(
      await screen.findByText('Pricing temporarily unavailable — please refresh in a minute')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeDisabled();
  });

  it('shows selected services dynamically and uses Pay & Submit on the final step', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    mockedPricingConfig.mockResolvedValue(pricingConfig);

    render(
      <NewRequestWizard
        isOpen
        onClose={vi.fn()}
        onSubmit={onSubmit}
        userEmail="client@example.com"
        userMobile="+15555550100"
        userName="Client User"
      />
    );

    await screen.findByText('Prices are shown in dollars.');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText('Select Primary Service');
    await user.click(screen.getByRole('button', { name: /litigation monitoring/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText('Legal Domain');
    await user.click(screen.getByRole('button', { name: /civil law/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText('Case Details');
    await user.type(screen.getByPlaceholderText(/I need a review/i), 'Need urgent litigation monitoring.');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText('Preferred Consultation Mode');
    await user.click(screen.getByRole('button', { name: /video call/i }));
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText('Timing & Urgency');

    const dateInput = document.querySelector('input[type="date"]') as HTMLInputElement;
    expect(dateInput).toBeTruthy();
    await user.type(dateInput, '2026-06-20');
    await user.selectOptions(screen.getByRole('combobox'), '09:00-09:45');
    await user.click(screen.getByRole('button', { name: /continue/i }));
    await screen.findByText('Your request is ready for submission.');

    expect(screen.getAllByText(/Litigation Monitoring/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Payment is required before your request is submitted/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pay & submit/i })).toBeEnabled();
  });
});

describe('InvoiceDetailSection', () => {
  it('calls online payment with the displayed amount and shows confirmation', async () => {
    const user = userEvent.setup();
    const onPayOnline = vi.fn().mockResolvedValue(undefined);

    render(
      <InvoiceDetailSection
        errorMessage={null}
        invoice={baseInvoice}
        isLoading={false}
        onBack={vi.fn()}
        onDownloadInvoice={vi.fn()}
        onOpenMatter={vi.fn()}
        onPayOnline={onPayOnline}
      />
    );

    await user.click(screen.getByRole('button', { name: /pay \$120/i }));

    await waitFor(() =>
      expect(onPayOnline).toHaveBeenCalledWith('invoice-public-id', 120)
    );
    expect(
      await screen.findByText('Payment confirmed. Your invoice balance has been updated.')
    ).toBeInTheDocument();
  });

  it('shows PDF download and offline fallback when online payment is unavailable', () => {
    render(
      <InvoiceDetailSection
        errorMessage={null}
        invoice={{
          ...baseInvoice,
          paymentOptions: { ...baseInvoice.paymentOptions, onlineEnabled: false },
        }}
        isLoading={false}
        onBack={vi.fn()}
        onDownloadInvoice={vi.fn()}
        onOpenMatter={vi.fn()}
        onPayOnline={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /download pdf/i })).toBeInTheDocument();
    expect(
      screen.getByText('Online payment is not available for this invoice right now.')
    ).toBeInTheDocument();
    expect(
      screen.getByText(/For offline payment, contact the billing team/i)
    ).toBeInTheDocument();
  });
});
