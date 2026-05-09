import React, { useMemo, useState } from 'react';
import { ArrowLeft, CreditCard, Download, FileText, Loader2, ReceiptIndianRupee } from 'lucide-react';
import { StatusBadge } from '../StatusBadge';
import { formatCurrency, formatDate } from '../../../utils/dashboardFormatting';
import type { InvoiceDetailResponse } from '../../../lib/api/contracts';

interface InvoiceDetailSectionProps {
  errorMessage: string | null;
  invoice: InvoiceDetailResponse | null;
  isLoading: boolean;
  onBack: () => void;
  onDownloadInvoice: (invoiceId: string) => void;
  onOpenMatter: (matterId: string | null) => void;
  onPayOnline: (invoiceId: string, amount?: number | null) => Promise<void>;
}

export const InvoiceDetailSection = ({
  errorMessage,
  invoice,
  isLoading,
  onBack,
  onDownloadInvoice,
  onOpenMatter,
  onPayOnline,
}: InvoiceDetailSectionProps) => {
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [paymentSelection, setPaymentSelection] = useState<'full' | 'installment'>('full');
  const [isPayingOnline, setIsPayingOnline] = useState(false);
  const selectedPaymentAmount = useMemo(() => {
    if (!invoice) {
      return null;
    }

    if (paymentSelection === 'installment' && invoice.paymentOptions.allowsPartial) {
      return invoice.paymentOptions.minimumPaymentAmount;
    }

    return invoice.amountDue;
  }, [invoice, paymentSelection]);
  if (isLoading) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Billing & Invoices
        </button>
        <div className="rounded-xl border border-gray-100 bg-white p-8 shadow-sm">
          <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
            Loading invoice
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            We are loading the invoice details.
          </p>
        </div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Billing & Invoices
        </button>
        <div className="rounded-xl border border-red-100 bg-white p-8 shadow-sm">
          <h1 className="text-2xl" style={{ fontFamily: "'Playfair Display', serif" }}>
            Invoice unavailable
          </h1>
          <p className="mt-3 text-sm text-gray-500">
            {errorMessage || 'We could not load that invoice right now.'}
          </p>
        </div>
      </div>
    );
  }

  const currencyCode = invoice.currencyCode || 'USD';
  const canPayOnline =
    invoice.paymentOptions.onlineEnabled &&
    invoice.paymentOptions.payable &&
    invoice.amountDue > 0 &&
    !['paid', 'void', 'draft'].includes(invoice.statusCode);
  const paymentAmount = selectedPaymentAmount ?? invoice.amountDue;
  const onlinePaymentUnavailableMessage =
    invoice.paymentOptions.paymentDisabledReason ||
    'Online payment is not available for this invoice. Please contact billing support.';

  const handlePayOnline = async () => {
    setPaymentError(null);
    setPaymentMessage(null);
    setIsPayingOnline(true);

    try {
      await onPayOnline(invoice.id, paymentAmount);
      setPaymentMessage('Payment confirmed. Your invoice balance has been updated.');
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'We could not complete the online payment.');
    } finally {
      setIsPayingOnline(false);
    }
  };

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Billing & Invoices
      </button>

      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="text-xl" style={{ fontFamily: "'Playfair Display', serif" }}>
                {invoice.template?.subject || invoice.invoiceNumber}
              </h1>
              <StatusBadge status={invoice.statusCode} size="md" />
            </div>
            <p className="text-sm text-gray-500">
              Issued {formatDate(invoice.issueDate)} · Due {formatDate(invoice.dueDate)}
            </p>
            {invoice.template?.body ? (
              <p className="mt-4 max-w-2xl whitespace-pre-line text-sm text-gray-600">
                {invoice.template.body}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {invoice.matterId && (
              <button
                type="button"
                onClick={() => onOpenMatter(invoice.matterId)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                View Matter
              </button>
            )}
            <button
              type="button"
              onClick={() => onDownloadInvoice(invoice.id)}
              className="flex items-center gap-1 rounded-lg bg-gray-900 px-3 py-1.5 text-xs text-white hover:bg-gray-800"
            >
              <Download className="h-3.5 w-3.5" /> Download PDF
            </button>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Subtotal',
              value: formatCurrency(invoice.subtotalAmount, currencyCode),
              tone: 'text-gray-900',
            },
            {
              label: 'Tax',
              value: formatCurrency(invoice.taxAmount, currencyCode),
              tone: 'text-sky-700',
            },
            {
              label: 'Paid',
              value: formatCurrency(invoice.amountPaid, currencyCode),
              tone: 'text-emerald-600',
            },
            {
              label: 'Due',
              value: formatCurrency(invoice.amountDue, currencyCode),
              tone: invoice.amountDue > 0 ? 'text-amber-600' : 'text-emerald-600',
            },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-gray-100 bg-gray-50 p-4">
              <p className="mb-1 text-xs text-gray-500">{card.label}</p>
              <p className={`text-2xl ${card.tone}`} style={{ fontFamily: "'Playfair Display', serif" }}>
                {card.value}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-6">
            <div>
              <div className="mb-3 flex items-center gap-2">
                <ReceiptIndianRupee className="h-4 w-4 text-gray-400" />
                <h2 className="text-sm text-gray-500">Invoice Items</h2>
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50/60">
                      {['Description', 'Qty', 'Rate', 'Amount'].map((header) => (
                        <th key={header} className="px-4 py-3 text-left text-xs text-gray-500">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 bg-white">
                    {invoice.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-4 py-3 align-top">
                          <p className="text-sm text-gray-900">{line.description}</p>
                          {line.taxes.length > 0 && (
                            <p className="mt-1 text-xs text-gray-400">
                              {line.taxes
                                .map((tax) => `${tax.name} (${tax.percent.toFixed(2)}%)`)
                                .join(' · ')}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{line.quantity}</td>
                        <td className="px-4 py-3 text-sm text-gray-600">
                          {formatCurrency(line.unitPrice, currencyCode)}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-900">
                          {formatCurrency(line.lineTotal, currencyCode)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {invoice.installments.length > 0 && (
              <div>
                <h2 className="mb-3 text-sm text-gray-500">Installments</h2>
                <div className="space-y-2">
                  {invoice.installments.map((installment) => (
                    <div
                      key={installment.id}
                      className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm">
                          Installment {installment.installmentNo} · {formatDate(installment.dueDate)}
                        </p>
                        <p className="text-xs text-gray-400">
                          Paid {formatCurrency(installment.amountPaid, currencyCode)} · Remaining{' '}
                          {formatCurrency(installment.amountRemaining, currencyCode)}
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <StatusBadge status={installment.statusCode} />
                        <span className="text-sm text-gray-900">
                          {formatCurrency(installment.amountDue, currencyCode)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(invoice.template?.terms || invoice.template?.footer) && (
              <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-400" />
                  <h2 className="text-sm text-gray-500">Invoice Notes</h2>
                </div>
                <div className="space-y-3 text-sm text-gray-600">
                  {invoice.template?.terms ? (
                    <div>
                      <p className="mb-1 text-xs uppercase tracking-wider text-gray-400">Payment Terms</p>
                      <p className="whitespace-pre-line">{invoice.template.terms}</p>
                    </div>
                  ) : null}
                  {invoice.template?.footer ? (
                    <p className="whitespace-pre-line text-xs text-gray-500">{invoice.template.footer}</p>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl bg-gray-50 p-4">
              <h2 className="mb-3 text-xs uppercase tracking-wider text-gray-400">Summary</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span>{formatCurrency(invoice.subtotalAmount, currencyCode)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Discount</span>
                  <span>{formatCurrency(invoice.discountAmount, currencyCode)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Tax</span>
                  <span>{formatCurrency(invoice.taxAmount, currencyCode)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2 font-medium">
                  <span>Total</span>
                  <span>{formatCurrency(invoice.totalAmount, currencyCode)}</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl bg-gray-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-gray-400" />
                <h2 className="text-xs uppercase tracking-wider text-gray-400">Payment</h2>
              </div>

              {paymentError ? (
                <div className="mb-3 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {paymentError}
                </div>
              ) : null}
              {paymentMessage ? (
                <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {paymentMessage}
                </div>
              ) : null}

              {invoice.amountDue <= 0 ? (
                <p className="text-sm text-emerald-700">This invoice is fully paid.</p>
              ) : (
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-500">Amount due</p>
                    <p className="text-2xl text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>
                      {formatCurrency(invoice.amountDue, currencyCode)}
                    </p>
                  </div>

                  {invoice.paymentOptions.allowsPartial ? (
                    <div className="grid grid-cols-1 gap-2">
                      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                        <span>Full balance</span>
                        <span className="flex items-center gap-2">
                          <span className="text-gray-600">{formatCurrency(invoice.amountDue, currencyCode)}</span>
                          <input
                            type="radio"
                            checked={paymentSelection === 'full'}
                            onChange={() => setPaymentSelection('full')}
                          />
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                        <span>Next installment</span>
                        <span className="flex items-center gap-2">
                          <span className="text-gray-600">
                            {formatCurrency(invoice.paymentOptions.minimumPaymentAmount, currencyCode)}
                          </span>
                          <input
                            type="radio"
                            checked={paymentSelection === 'installment'}
                            onChange={() => setPaymentSelection('installment')}
                          />
                        </span>
                      </label>
                    </div>
                  ) : null}

                  {canPayOnline ? (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          void handlePayOnline();
                        }}
                        disabled={isPayingOnline}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isPayingOnline ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
                        Pay Online
                      </button>
                      <p className="text-xs text-gray-500">
                        Secure online payment · {formatCurrency(paymentAmount, currencyCode)}
                      </p>
                    </div>
                  ) : (
                    <p className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600">
                      {onlinePaymentUnavailableMessage}
                    </p>
                  )}

                  {invoice.paymentOptions.offlineEnabled ? (
                    <p className="text-xs text-gray-500">
                      For offline payment, contact the billing team or use the payment instructions below.
                    </p>
                  ) : null}
                </div>
              )}
            </div>

            {invoice.billingSnapshot && (
              <div className="rounded-xl bg-gray-50 p-4">
                <h2 className="mb-3 text-xs uppercase tracking-wider text-gray-400">Bill To</h2>
                <div className="space-y-1 text-sm text-gray-600">
                  <p className="text-gray-900">{invoice.billingSnapshot.billingName}</p>
                  <p>{invoice.billingSnapshot.billingEmail}</p>
                  <p>{invoice.billingSnapshot.billingPhone}</p>
                  <p>{invoice.billingSnapshot.addressLine1}</p>
                  {invoice.billingSnapshot.addressLine2 && <p>{invoice.billingSnapshot.addressLine2}</p>}
                  <p>
                    {invoice.billingSnapshot.city}, {invoice.billingSnapshot.state}{' '}
                    {invoice.billingSnapshot.postalCode}
                  </p>
                  <p>{invoice.billingSnapshot.countryCode}</p>
                  {invoice.billingSnapshot.gstin && <p>GSTIN: {invoice.billingSnapshot.gstin}</p>}
                </div>
              </div>
            )}

            {invoice.business && (
              <div className="rounded-xl bg-gray-50 p-4">
                <h2 className="mb-3 text-xs uppercase tracking-wider text-gray-400">From</h2>
                <div className="space-y-1 text-sm text-gray-600">
                  {invoice.business.name && <p className="text-gray-900">{invoice.business.name}</p>}
                  {invoice.business.address && <p className="whitespace-pre-line">{invoice.business.address}</p>}
                  {invoice.business.phone && <p>Phone: {invoice.business.phone}</p>}
                  {invoice.business.email && <p>Email: {invoice.business.email}</p>}
                  {invoice.business.website && <p>{invoice.business.website}</p>}
                  {invoice.business.gstin && <p>GSTIN: {invoice.business.gstin}</p>}
                  {invoice.business.paymentInstructions && (
                    <div className="border-t border-gray-200 pt-2">
                      <p className="mb-1 text-xs uppercase tracking-wider text-gray-400">Payment Instructions</p>
                      <p className="whitespace-pre-line">{invoice.business.paymentInstructions}</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {invoice.documents.length > 0 && (
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-gray-400" />
                  <h2 className="text-xs uppercase tracking-wider text-gray-400">Related Records</h2>
                </div>
                <div className="space-y-2">
                  {invoice.documents.map((document) => (
                    <div key={document.id} className="rounded-lg bg-white px-3 py-2 text-sm text-gray-700">
                      {document.label}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
