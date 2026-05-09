import React, { useMemo } from 'react';
import { formatCurrency, formatDate } from '../../data/formatters';
import type { Invoice } from '../../data/adminTypes';
import type { InvoiceSettings } from '../../lib/api/contracts';

type InvoicePreviewProps = {
  amountDue?: number;
  amountPaid?: number;
  invoice: Invoice;
  invoiceSettings?: InvoiceSettings;
};

const statusTone = (status: Invoice['status']) => {
  switch (status) {
    case 'paid':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case 'overdue':
    case 'failed':
      return 'border-red-200 bg-red-50 text-red-700';
    case 'draft':
      return 'border-gray-200 bg-gray-50 text-gray-600';
    case 'refunded':
      return 'border-amber-200 bg-amber-50 text-amber-700';
    default:
      return 'border-blue-200 bg-blue-50 text-blue-700';
  }
};

const compactLines = (lines: Array<string | null | undefined>) =>
  lines.filter((line) => Boolean(String(line || '').trim())) as string[];

export const InvoicePreview = ({
  amountDue,
  amountPaid,
  invoice,
  invoiceSettings,
}: InvoicePreviewProps) => {
  const business = {
    address: invoice.business?.address || invoiceSettings?.businessAddress || '',
    email: invoice.business?.email || invoiceSettings?.businessEmail || '',
    gstin: invoice.business?.gstin || invoiceSettings?.gstin || '',
    name:
      invoice.business?.name ||
      invoiceSettings?.businessLegalName ||
      invoiceSettings?.billingDisplayName ||
      'Global LMG',
    paymentInstructions:
      invoice.business?.paymentInstructions || invoiceSettings?.paymentInstructions || '',
    phone: invoice.business?.phone || invoiceSettings?.businessPhone || '',
    state: invoice.business?.state || invoiceSettings?.businessState || '',
    website: invoice.business?.website || invoiceSettings?.businessWebsite || '',
  };

  const billing = invoice.billingSnapshot;
  const currencyCode = invoice.currencyCode || 'USD';
  const paid = amountPaid ?? 0;
  const due = amountDue ?? Math.max(invoice.totalAmount - paid, 0);
  const taxBreakdown = useMemo(() => {
    const taxes = new Map<string, { amount: number; label: string }>();

    invoice.items.forEach((item) => {
      item.taxes?.forEach((tax) => {
        const key = `${tax.code}-${tax.percent}`;
        const existing = taxes.get(key) || {
          amount: 0,
          label: `${tax.name} (${tax.percent.toFixed(2)}%)`,
        };
        existing.amount += tax.amount;
        taxes.set(key, existing);
      });
    });

    return Array.from(taxes.values());
  }, [invoice.items]);

  const businessLines = compactLines([
    business.address,
    business.phone ? `Phone: ${business.phone}` : null,
    business.email ? `Email: ${business.email}` : null,
    business.website,
    business.gstin ? `GSTIN: ${business.gstin}` : null,
    business.state ? `State: ${business.state}` : null,
  ]);

  const billingLines = compactLines([
    billing?.billingName || invoice.clientName,
    billing?.billingEmail,
    billing?.billingPhone,
    billing?.addressLine1,
    billing?.addressLine2,
    compactLines([billing?.city, billing?.state, billing?.postalCode]).join(', '),
    billing?.countryCode,
    billing?.gstin ? `GSTIN: ${billing.gstin}` : null,
  ]);

  return (
    <article className="admin-invoice-print-area mx-auto w-full max-w-[56rem] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="h-2 bg-[#2C2B29]" />
      <div className="space-y-8 p-4 sm:p-7 lg:p-10">
        <header className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
          <div className="min-w-0 space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gray-400">
                Invoice
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-gray-950 admin-wrap-anywhere" style={{ fontFamily: "'Playfair Display', serif" }}>
                {invoice.template?.subject || invoice.id}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-gray-500">{invoice.id}</span>
                <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${statusTone(invoice.status)}`}>
                  {invoice.status}
                </span>
              </div>
            </div>

            {invoice.template?.body ? (
              <p className="max-w-2xl whitespace-pre-line text-sm leading-6 text-gray-600 admin-wrap-anywhere">
                {invoice.template.body}
              </p>
            ) : null}
          </div>

          <div className="min-w-0 rounded-xl bg-gray-50 p-4 text-sm">
            <h2 className="text-lg font-semibold text-gray-950 admin-wrap-anywhere" style={{ fontFamily: "'Playfair Display', serif" }}>
              {business.name}
            </h2>
            <div className="mt-3 space-y-1 text-xs leading-5 text-gray-600 admin-wrap-anywhere">
              {businessLines.length ? (
                businessLines.map((line) => (
                  <p className="whitespace-pre-line" key={line}>
                    {line}
                  </p>
                ))
              ) : (
                <p>Business contact details are not configured.</p>
              )}
            </div>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Bill To</p>
            <div className="mt-2 space-y-1 text-sm text-gray-700 admin-wrap-anywhere">
              {billingLines.map((line) => (
                <p className="whitespace-pre-line" key={line}>
                  {line}
                </p>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Matter</p>
            <p className="mt-2 text-sm font-medium text-gray-900 admin-wrap-anywhere">
              {invoice.matterTitle || 'General services'}
            </p>
            {invoice.matterRef ? <p className="mt-1 text-xs text-gray-500">Ref: {invoice.matterRef}</p> : null}
          </div>
          <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Dates</p>
            <div className="mt-2 space-y-1 text-sm text-gray-700">
              <p>Issued: {formatDate(invoice.issueDate)}</p>
              <p>Due: {formatDate(invoice.dueDate)}</p>
            </div>
          </div>
        </section>

        <section className="admin-table-scroll">
          <table className="w-full min-w-[42rem] text-sm">
            <thead>
              <tr className="border-b border-gray-900 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="py-3 text-left">Description</th>
                <th className="w-20 py-3 text-center">Qty</th>
                <th className="w-32 py-3 text-right">Rate</th>
                <th className="w-32 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {invoice.items.map((item, index) => (
                <tr key={`${item.description}-${index}`}>
                  <td className="py-4 pr-4 align-top text-gray-900 admin-wrap-anywhere">
                    {item.description}
                    {item.taxes?.length ? (
                      <p className="mt-1 text-xs text-gray-500">
                        {item.taxes.map((tax) => `${tax.name} ${tax.percent.toFixed(2)}%`).join(' · ')}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-4 text-center text-gray-600">{item.quantity}</td>
                  <td className="py-4 text-right text-gray-600">{formatCurrency(item.rate, currencyCode)}</td>
                  <td className="py-4 text-right font-medium text-gray-900">{formatCurrency(item.amount, currencyCode)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,22rem)]">
          <div className="space-y-4 text-sm text-gray-600">
            {business.paymentInstructions ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="mb-1 font-semibold text-gray-950">Payment Instructions</p>
                <p className="whitespace-pre-line admin-wrap-anywhere">{business.paymentInstructions}</p>
              </div>
            ) : null}
            {invoice.template?.terms ? (
              <div className="rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="mb-1 font-semibold text-gray-950">Terms</p>
                <p className="whitespace-pre-line admin-wrap-anywhere">{invoice.template.terms}</p>
              </div>
            ) : null}
          </div>

          <div className="space-y-3 rounded-xl border border-gray-100 bg-gray-50 p-4 text-sm">
            <div className="flex justify-between gap-4 text-gray-600">
              <span>Subtotal</span>
              <span>{formatCurrency(invoice.amount, currencyCode)}</span>
            </div>
            {invoice.discount > 0 ? (
              <div className="flex justify-between gap-4 text-emerald-700">
                <span>Discount</span>
                <span>-{formatCurrency(invoice.discount, currencyCode)}</span>
              </div>
            ) : null}
            {taxBreakdown.length ? (
              taxBreakdown.map((tax) => (
                <div className="flex justify-between gap-4 text-gray-600" key={tax.label}>
                  <span>{tax.label}</span>
                  <span>{formatCurrency(tax.amount, currencyCode)}</span>
                </div>
              ))
            ) : (
              <div className="flex justify-between gap-4 text-gray-600">
                <span>Tax</span>
                <span>{formatCurrency(invoice.tax, currencyCode)}</span>
              </div>
            )}
            <div className="flex justify-between gap-4 border-t border-gray-200 pt-3 text-base font-semibold text-gray-950">
              <span>Total</span>
              <span>{formatCurrency(invoice.totalAmount, currencyCode)}</span>
            </div>
            <div className="flex justify-between gap-4 text-gray-600">
              <span>Paid</span>
              <span>{formatCurrency(paid, currencyCode)}</span>
            </div>
            <div className="flex justify-between gap-4 text-base font-semibold text-gray-950">
              <span>Due</span>
              <span>{formatCurrency(due, currencyCode)}</span>
            </div>
          </div>
        </section>

        {invoice.template?.footer ? (
          <footer className="border-t border-gray-100 pt-5 text-center text-xs leading-5 text-gray-500 admin-wrap-anywhere">
            <p className="whitespace-pre-line">{invoice.template.footer}</p>
          </footer>
        ) : null}
      </div>
    </article>
  );
};
