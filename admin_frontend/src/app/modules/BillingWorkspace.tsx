import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { 
  CreditCard, FileText, Download, Mail, DollarSign, 
  Search, Filter, Plus, ChevronRight, CheckCircle, 
  Clock, AlertCircle, RefreshCcw, MoreVertical, 
  ArrowUpRight, FileCheck, Landmark, Copy, Printer
} from 'lucide-react';
import { formatCurrency, formatDate } from '../data/formatters';
import type { Invoice, Matter, Payment } from '../data/adminTypes';
import { StatusBadge } from '../components/dashboard/StatusBadge';
import { PaginationControls } from '../components/shared/PaginationControls';
import { adminApi } from '../lib/api/admin';
import type { InvoiceSettings, PaginationMeta, RecordPaymentResponse, RefundRecord } from '../lib/api/contracts';

type FilterStatus = 'all' | 'paid' | 'pending' | 'overdue' | 'draft';
type PaymentActivityFilter = 'all' | 'balance_due' | 'has_payments' | 'has_refunds' | 'paid_in_full';
type TaxFilter = 'all' | 'not_taxed' | 'taxed';
type PaymentMethod = Payment['method'];

export const BillingWorkspace: React.FC<{
  invoiceSettings?: InvoiceSettings;
  invoices?: Invoice[];
  matters?: Matter[];
  onCreateInvoice?: (payload: {
    amount: number;
    description: string;
    dueDate?: string;
    matterId: string;
  }) => Promise<{ invoiceId: string; status: 'created' }>;
  onCreateRefund?: (payload: {
    amount: number;
    invoiceId?: string;
    paymentId: string;
    reasonText: string;
  }) => Promise<void>;
  onRecordPayment?: (payload: {
    amount: number;
    invoiceId: string;
    notes?: string;
    paymentDate: string;
    paymentMethod: PaymentMethod;
    referenceNumber?: string;
  }) => Promise<RecordPaymentResponse>;
  onSendInvoice?: (
    invoiceId: string
  ) => Promise<{ emailDeliveryStatus?: 'failed' | 'manual' | 'sent'; invoiceId: string; status: 'reminder_sent' | 'sent' }>;
  isPaginationLoading?: boolean;
  onPageOffsetChange?: (offset: number) => void;
  pagination?: PaginationMeta;
  payments?: Payment[];
  refunds?: RefundRecord[];
}> = ({
  invoiceSettings,
  invoices = [],
  matters = [],
  onCreateInvoice,
  onCreateRefund,
  onRecordPayment,
  onSendInvoice,
  isPaginationLoading = false,
  onPageOffsetChange,
  pagination,
  payments = [],
  refunds = [],
}) => {
  const navigate = useNavigate();
  const [showCreateInvoiceForm, setShowCreateInvoiceForm] = useState(false);
  const [createMatterId, setCreateMatterId] = useState(matters[0]?.id || '');
  const [createDescription, setCreateDescription] = useState('');
  const [createAmount, setCreateAmount] = useState('');
  const [createDueDate, setCreateDueDate] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreatingInvoice, setIsCreatingInvoice] = useState(false);
  const [isSendingInvoice, setIsSendingInvoice] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [clientFilter, setClientFilter] = useState('all');
  const [matterFilter, setMatterFilter] = useState('all');
  const [countryFilter, setCountryFilter] = useState('all');
  const [issueDateFrom, setIssueDateFrom] = useState('');
  const [issueDateTo, setIssueDateTo] = useState('');
  const [dueDateFrom, setDueDateFrom] = useState('');
  const [dueDateTo, setDueDateTo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [taxFilter, setTaxFilter] = useState<TaxFilter>('all');
  const [paymentActivityFilter, setPaymentActivityFilter] = useState<PaymentActivityFilter>('all');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(invoices[0]?.id || null);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [showRefundForm, setShowRefundForm] = useState(false);
  const [isSubmittingRefund, setIsSubmittingRefund] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('bank-transfer');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [isPdfPreviewLoading, setIsPdfPreviewLoading] = useState(false);
  const [isDownloadingInvoice, setIsDownloadingInvoice] = useState(false);

  useEffect(() => {
    if (!invoices.some((invoice) => invoice.id === selectedInvoiceId)) {
      setSelectedInvoiceId(invoices[0]?.id || null);
    }
  }, [invoices, selectedInvoiceId]);

  useEffect(() => {
    setShowRefundForm(false);
    setRefundAmount('');
    setRefundReason('');
    setShowPaymentForm(false);
    setPaymentAmount('');
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod('bank-transfer');
    setPaymentReference('');
    setPaymentNotes('');
    setPaymentError(null);
  }, [selectedInvoiceId]);

  useEffect(() => {
    if (!matters.some((matter) => matter.id === createMatterId)) {
      setCreateMatterId(matters[0]?.id || '');
    }
  }, [createMatterId, matters]);

  const activeInvoice = useMemo(
    () => invoices.find(i => i.id === selectedInvoiceId) || null,
    [invoices, selectedInvoiceId]
  );

  useEffect(() => {
    if (!activeInvoice) {
      setPdfPreviewUrl(null);
      setPdfPreviewError(null);
      setIsPdfPreviewLoading(false);
      return undefined;
    }

    let isCancelled = false;
    let objectUrl: string | null = null;

    setPdfPreviewUrl(null);
    setPdfPreviewError(null);
    setIsPdfPreviewLoading(true);

    adminApi.fetchInvoicePdfPreview(activeInvoice.id)
      .then(({ blob }) => {
        if (isCancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setPdfPreviewUrl(objectUrl);
      })
      .catch((error) => {
        if (!isCancelled) {
          setPdfPreviewError(error instanceof Error ? error.message : 'Preview unavailable. Download invoice PDF.');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsPdfPreviewLoading(false);
        }
      });

    return () => {
      isCancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [activeInvoice]);

  const canSendInvoice = useMemo(
    () => Boolean(activeInvoice && !['paid', 'refunded', 'void'].includes(activeInvoice.status)),
    [activeInvoice]
  );

  const sendInvoiceLabel = activeInvoice?.status === 'draft' ? 'Send Invoice' : 'Send Reminder';
  
  const activePayments = useMemo(() => {
    if (!activeInvoice) return [];
    return payments.filter(p => p.invoiceId === activeInvoice.id).sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [activeInvoice, payments]);

  const activeRefunds = useMemo(() => {
    if (!activeInvoice) return [];
    return refunds
      .filter((refund) => refund.invoiceId === activeInvoice.id)
      .sort((a, b) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime());
  }, [activeInvoice, refunds]);

  const activePaidAmount = useMemo(
    () =>
      activePayments
        .filter((payment) => payment.status === 'success')
        .reduce((sum, payment) => sum + payment.amount, 0),
    [activePayments]
  );

  const activeRefundAmount = useMemo(
    () =>
      activeRefunds
        .filter((refund) => refund.status === 'completed')
        .reduce((sum, refund) => sum + refund.amount, 0),
    [activeRefunds]
  );

  const activeAmountDue = useMemo(() => {
    if (!activeInvoice) {
      return 0;
    }

    return Math.max(activeInvoice.totalAmount - activePaidAmount - activeRefundAmount, 0);
  }, [activeInvoice, activePaidAmount, activeRefundAmount]);
  const activeCurrencyCode = activeInvoice?.currencyCode || invoices[0]?.currencyCode || 'USD';

  const taxPreview = useMemo(() => {
    const amount = Number(createAmount);

    if (!invoiceSettings || Number.isNaN(amount) || amount <= 0) {
      return null;
    }

    const rate = invoiceSettings.gstEnabled && invoiceSettings.taxMode === 'forward_charge'
      ? invoiceSettings.defaultGstRatePercent
      : 0;
    const gross = Math.round(amount * 100);
    const taxable = invoiceSettings.pricesIncludeTax && rate > 0
      ? Math.round((gross * 10000) / (10000 + Math.round(rate * 100)))
      : gross;
    const tax = rate > 0
      ? invoiceSettings.pricesIncludeTax
        ? gross - taxable
        : Math.round((taxable * Math.round(rate * 100)) / 10000)
      : 0;
    const total = invoiceSettings.pricesIncludeTax ? gross : taxable + tax;

    return {
      note:
        invoiceSettings.taxMode === 'reverse_charge'
          ? 'Reverse charge: no tax added to invoice total.'
          : invoiceSettings.taxMode === 'exempt'
            ? 'Exempt: no tax added to invoice total.'
            : invoiceSettings.gstEnabled
              ? `${invoiceSettings.defaultGstRatePercent}% GST preview; final split uses client/business state.`
              : 'GST disabled: no tax added.',
      subtotal: taxable / 100,
      tax: tax / 100,
      total: total / 100,
    };
  }, [createAmount, invoiceSettings]);

  const canRecordPayment = Boolean(
    activeInvoice &&
      onRecordPayment &&
      activeAmountDue > 0 &&
      !['draft', 'paid', 'refunded', 'void'].includes(activeInvoice.status)
  );

  const invoiceFilterOptions = useMemo(() => {
    const clients = new Map<string, string>();
    const mattersById = new Map<string, { label: string; matterId: string }>();
    const countries = new Map<string, string>();

    invoices.forEach((invoice) => {
      clients.set(invoice.clientId, invoice.clientName);
      mattersById.set(invoice.matterId, {
        label: invoice.matterRef ? `${invoice.matterRef} · ${invoice.matterTitle}` : invoice.matterTitle,
        matterId: invoice.matterId,
      });

      const countryCode = invoice.billingSnapshot?.countryCode?.trim().toUpperCase();

      if (countryCode) {
        countries.set(countryCode, countryCode);
      }
    });

    return {
      clients: Array.from(clients.entries())
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      countries: Array.from(countries.values()).sort((a, b) => a.localeCompare(b)),
      matters: Array.from(mattersById.values()).sort((a, b) => a.label.localeCompare(b.label)),
    };
  }, [invoices]);

  const getInvoicePaymentSummary = (invoiceId: string) => {
    const invoicePayments = payments.filter((payment) => payment.invoiceId === invoiceId);
    const invoiceRefunds = refunds.filter((refund) => refund.invoiceId === invoiceId);
    const paidAmount = invoicePayments
      .filter((payment) => payment.status === 'success')
      .reduce((sum, payment) => sum + payment.amount, 0);
    const refundedAmount = invoiceRefunds
      .filter((refund) => refund.status === 'completed')
      .reduce((sum, refund) => sum + refund.amount, 0);

    return {
      hasPayments: invoicePayments.length > 0,
      hasRefunds: invoiceRefunds.length > 0,
      paidAmount,
      refundedAmount,
    };
  };

  const activeAdvancedFilterCount = useMemo(
    () =>
      [
        clientFilter !== 'all',
        matterFilter !== 'all',
        countryFilter !== 'all',
        Boolean(issueDateFrom),
        Boolean(issueDateTo),
        Boolean(dueDateFrom),
        Boolean(dueDateTo),
        Boolean(amountMin),
        Boolean(amountMax),
        taxFilter !== 'all',
        paymentActivityFilter !== 'all',
      ].filter(Boolean).length,
    [
      amountMax,
      amountMin,
      clientFilter,
      countryFilter,
      dueDateFrom,
      dueDateTo,
      issueDateFrom,
      issueDateTo,
      matterFilter,
      paymentActivityFilter,
      taxFilter,
    ]
  );

  const filteredInvoices = useMemo(() => {
    const minimumAmount = amountMin ? Number(amountMin) : null;
    const maximumAmount = amountMax ? Number(amountMax) : null;

    return invoices.filter(inv => {
      const matchesSearch = 
        inv.id.toLowerCase().includes(searchQuery.toLowerCase()) || 
        inv.clientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inv.matterTitle.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inv.matterRef.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || inv.status === statusFilter || (statusFilter === 'pending' && inv.status === 'sent');
      const matchesClient = clientFilter === 'all' || inv.clientId === clientFilter;
      const matchesMatter = matterFilter === 'all' || inv.matterId === matterFilter;
      const matchesCountry =
        countryFilter === 'all' || inv.billingSnapshot?.countryCode?.toUpperCase() === countryFilter;
      const matchesIssueDateFrom = !issueDateFrom || inv.issueDate >= issueDateFrom;
      const matchesIssueDateTo = !issueDateTo || inv.issueDate <= issueDateTo;
      const matchesDueDateFrom = !dueDateFrom || inv.dueDate >= dueDateFrom;
      const matchesDueDateTo = !dueDateTo || inv.dueDate <= dueDateTo;
      const matchesAmountMin = minimumAmount === null || Number.isNaN(minimumAmount) || inv.totalAmount >= minimumAmount;
      const matchesAmountMax = maximumAmount === null || Number.isNaN(maximumAmount) || inv.totalAmount <= maximumAmount;
      const matchesTax =
        taxFilter === 'all' ||
        (taxFilter === 'taxed' && inv.tax > 0) ||
        (taxFilter === 'not_taxed' && inv.tax <= 0);
      const paymentSummary = getInvoicePaymentSummary(inv.id);
      const balanceDue = Math.max(inv.totalAmount - paymentSummary.paidAmount - paymentSummary.refundedAmount, 0);
      const matchesPaymentActivity =
        paymentActivityFilter === 'all' ||
        (paymentActivityFilter === 'balance_due' && balanceDue > 0 && inv.status !== 'draft') ||
        (paymentActivityFilter === 'paid_in_full' && (inv.status === 'paid' || balanceDue <= 0)) ||
        (paymentActivityFilter === 'has_payments' && paymentSummary.hasPayments) ||
        (paymentActivityFilter === 'has_refunds' && paymentSummary.hasRefunds);
      
      return (
        matchesSearch &&
        matchesStatus &&
        matchesClient &&
        matchesMatter &&
        matchesCountry &&
        matchesIssueDateFrom &&
        matchesIssueDateTo &&
        matchesDueDateFrom &&
        matchesDueDateTo &&
        matchesAmountMin &&
        matchesAmountMax &&
        matchesTax &&
        matchesPaymentActivity
      );
    }).sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime());
  }, [
    amountMax,
    amountMin,
    clientFilter,
    countryFilter,
    dueDateFrom,
    dueDateTo,
    invoices,
    issueDateFrom,
    issueDateTo,
    matterFilter,
    paymentActivityFilter,
    payments,
    refunds,
    searchQuery,
    statusFilter,
    taxFilter,
  ]);

  useEffect(() => {
    if (!filteredInvoices.length) {
      setSelectedInvoiceId(null);
      return;
    }

    if (!filteredInvoices.some((invoice) => invoice.id === selectedInvoiceId)) {
      setSelectedInvoiceId(filteredInvoices[0].id);
    }
  }, [filteredInvoices, selectedInvoiceId]);

  // Metrics
  const metrics = useMemo(() => {
    const totalCollected = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.totalAmount, 0);
    const outstanding = invoices.filter(i => i.status === 'pending' || i.status === 'sent').reduce((sum, i) => sum + i.totalAmount, 0);
    const overdueAmount = invoices.filter(i => i.status === 'overdue').reduce((sum, i) => sum + i.totalAmount, 0);
    const draftAmount = invoices.filter(i => i.status === 'draft').reduce((sum, i) => sum + i.totalAmount, 0);
    
    return { totalCollected, outstanding, overdueAmount, draftAmount };
  }, [invoices]);

  const getStatusColor = (status: string) => {
    switch(status) {
      case 'paid': return 'text-emerald-700 bg-emerald-50 border-emerald-100';
      case 'pending': 
      case 'sent': return 'text-blue-700 bg-blue-50 border-blue-100';
      case 'overdue': return 'text-red-700 bg-red-50 border-red-100';
      case 'draft': return 'text-gray-700 bg-gray-50 border-gray-200';
      case 'refunded': return 'text-amber-700 bg-amber-50 border-amber-100';
      case 'void': return 'text-slate-700 bg-slate-50 border-slate-200';
      default: return 'text-gray-700 bg-gray-50 border-gray-100';
    }
  };

  const resetCreateInvoiceForm = () => {
    setCreateDescription('');
    setCreateAmount('');
    setCreateDueDate('');
    setCreateError(null);
  };

  const handleCreateInvoice = async () => {
    if (!onCreateInvoice) {
      return;
    }

    setCreateError(null);
    setActionMessage(null);
    setActionError(null);
    setIsCreatingInvoice(true);

    try {
      const result = await onCreateInvoice({
        amount: Number(createAmount),
        description: createDescription.trim(),
        dueDate: createDueDate || undefined,
        matterId: createMatterId,
      });

      setSelectedInvoiceId(result.invoiceId);
      setShowCreateInvoiceForm(false);
      resetCreateInvoiceForm();
      setActionMessage('Draft invoice created from live admin billing data.');
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to create the invoice.');
    } finally {
      setIsCreatingInvoice(false);
    }
  };

  const handleSendInvoice = async () => {
    if (!activeInvoice || !onSendInvoice || !canSendInvoice) {
      return;
    }

    setActionMessage(null);
    setActionError(null);
    setIsSendingInvoice(true);

    try {
      const result = await onSendInvoice(activeInvoice.id);
      const emailCopy =
        result.emailDeliveryStatus === 'sent'
          ? ' Email delivery succeeded.'
          : result.emailDeliveryStatus === 'failed'
            ? ' Email delivery failed; the portal invoice notification was still created.'
            : result.emailDeliveryStatus === 'manual'
              ? ' Email delivery is in manual review mode; no email was sent.'
              : '';
      setActionMessage(
        result.status === 'sent'
          ? `Invoice issued to the client.${emailCopy}`
          : `Payment reminder recorded.${emailCopy}`
      );
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to send this invoice right now.');
    } finally {
      setIsSendingInvoice(false);
    }
  };

  const handleOpenPaymentForm = () => {
    if (!canRecordPayment) {
      return;
    }

    setPaymentError(null);
    setPaymentAmount(activeAmountDue ? activeAmountDue.toFixed(2) : '');
    setShowPaymentForm((current) => !current);
  };

  const handleRecordPayment = async () => {
    if (!activeInvoice || !onRecordPayment || !canRecordPayment) {
      return;
    }

    const parsedAmount = Number(paymentAmount);

    if (!paymentAmount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setPaymentError('Enter a payment amount greater than zero.');
      return;
    }

    if (parsedAmount > activeAmountDue) {
      setPaymentError(`Payment cannot exceed the remaining balance of ${formatCurrency(activeAmountDue, activeCurrencyCode)}.`);
      return;
    }

    setPaymentError(null);
    setActionMessage(null);
    setActionError(null);
    setIsRecordingPayment(true);

    try {
      await onRecordPayment({
        amount: parsedAmount,
        invoiceId: activeInvoice.id,
        notes: paymentNotes.trim() || undefined,
        paymentDate,
        paymentMethod,
        referenceNumber: paymentReference.trim() || undefined,
      });
      setShowPaymentForm(false);
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentNotes('');
      setActionMessage('Manual payment recorded and allocated to this invoice.');
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : 'Unable to record this payment.');
    } finally {
      setIsRecordingPayment(false);
    }
  };

  const handleDownloadInvoice = async () => {
    if (!activeInvoice) {
      return;
    }

    setActionMessage(null);
    setActionError(null);
    setIsDownloadingInvoice(true);

    try {
      await adminApi.downloadInvoicePdf(activeInvoice.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to download the invoice PDF right now.');
    } finally {
      setIsDownloadingInvoice(false);
    }
  };

  const clearAdvancedFilters = () => {
    setClientFilter('all');
    setMatterFilter('all');
    setCountryFilter('all');
    setIssueDateFrom('');
    setIssueDateTo('');
    setDueDateFrom('');
    setDueDateTo('');
    setAmountMin('');
    setAmountMax('');
    setTaxFilter('all');
    setPaymentActivityFilter('all');
  };

  return (
    <div className="min-h-[calc(100vh-80px)] -m-6 space-y-6 overflow-x-hidden p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 flex-shrink-0">
        <div>
          <h1 className="text-2xl font-medium text-gray-900" style={{ fontFamily: "'Playfair Display', serif" }}>Billing & Ledger</h1>
          <p className="text-sm text-gray-500 mt-1">Finance operations, invoice tracking, and revenue management.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            className="px-4 py-2 bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm font-medium rounded-lg flex items-center gap-2 transition"
            onClick={() => navigate('/reports?drilldown=outstanding-invoices')}
            type="button"
          >
            <Download className="w-4 h-4" /> Open Reports Export
          </button>
          <button
            className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg flex items-center gap-2 transition hover:bg-gray-800 disabled:opacity-50"
            disabled={!onCreateInvoice || matters.length === 0}
            onClick={() => {
              setActionMessage(null);
              setActionError(null);
              setCreateError(null);
              setShowCreateInvoiceForm((current) => !current);
            }}
            type="button"
          >
            <Plus className="w-4 h-4" /> Create Invoice
          </button>
        </div>
      </div>

      {showCreateInvoiceForm ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Create Draft Invoice</h2>
              <p className="text-sm text-gray-500 mt-1">
                Build a live invoice against a matter, then send it once the line item looks right.
              </p>
            </div>
            <button
              className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
              onClick={() => {
                setShowCreateInvoiceForm(false);
                resetCreateInvoiceForm();
              }}
              type="button"
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Matter</span>
              <select
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
                onChange={(event) => setCreateMatterId(event.target.value)}
                value={createMatterId}
              >
                {matters.map((matter) => (
                  <option key={matter.id} value={matter.id}>
                    {matter.referenceCode} · {matter.clientName} · {matter.title}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Amount</span>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
                onChange={(event) => setCreateAmount(event.target.value)}
                placeholder="25000"
                type="number"
                value={createAmount}
              />
            </label>

            <label className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Due Date</span>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
                onChange={(event) => setCreateDueDate(event.target.value)}
                type="date"
                value={createDueDate}
              />
            </label>

            <label className="space-y-1 md:col-span-2 xl:col-span-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Line Item</span>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-gray-400 bg-white"
                onChange={(event) => setCreateDescription(event.target.value)}
                placeholder="Professional services for matter review"
                type="text"
                value={createDescription}
              />
            </label>
          </div>

          {taxPreview ? (
            <div className="grid gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-sm md:grid-cols-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Taxable</p>
                <p className="font-medium text-gray-900">{formatCurrency(taxPreview.subtotal)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Tax</p>
                <p className="font-medium text-gray-900">{formatCurrency(taxPreview.tax)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Total</p>
                <p className="font-medium text-gray-900">{formatCurrency(taxPreview.total)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400">Mode</p>
                <p className="text-xs text-gray-500">{taxPreview.note}</p>
              </div>
            </div>
          ) : null}

          {createError ? <p className="text-sm text-red-600">{createError}</p> : null}

          <div className="flex items-center gap-3">
            <button
              className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg disabled:opacity-50"
              disabled={
                isCreatingInvoice ||
                !createMatterId ||
                !createDescription.trim() ||
                !createAmount ||
                Number(createAmount) <= 0
              }
              onClick={() => void handleCreateInvoice()}
              type="button"
            >
              {isCreatingInvoice ? 'Creating...' : 'Create Draft Invoice'}
            </button>
            <span className="text-xs text-gray-500">
              The invoice is saved as a draft first, then sent from the detail panel.
            </span>
          </div>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {actionMessage}
        </div>
      ) : null}

      {actionError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 flex-shrink-0">
        <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">Overdue Aging</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(metrics.overdueAmount)}</p>
          <p className="text-xs text-red-600 mt-1 font-medium">Requires immediate action</p>
        </div>
        
        <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <Clock className="w-4 h-4 text-amber-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">Outstanding Balance</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(metrics.outstanding)}</p>
          <p className="text-xs text-gray-500 mt-1">Pending client payments</p>
        </div>
        
        <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <CheckCircle className="w-4 h-4 text-emerald-500" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">Total Collected</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(metrics.totalCollected)}</p>
          <p className="text-xs text-emerald-600 mt-1 font-medium">+12% from last month</p>
        </div>

        <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
          <div className="flex items-center gap-2 text-gray-500 mb-2">
            <FileText className="w-4 h-4 text-gray-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider">Unbilled / Drafts</h3>
          </div>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(metrics.draftAmount)}</p>
          <p className="text-xs text-gray-500 mt-1">Ready for review</p>
        </div>
      </div>

      {/* Top: Invoice list/search */}
      <section className={`flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm ${showAdvancedFilters ? 'max-h-none' : 'max-h-[30rem]'}`}>
        <div className="border-b border-gray-100 bg-gray-50/50 p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Invoice list</h2>
              <p className="text-xs text-gray-500">
                {filteredInvoices.length} shown from {invoices.length} loaded invoice{invoices.length === 1 ? '' : 's'}.
              </p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3 lg:max-w-3xl lg:flex-row lg:items-center lg:justify-end">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm outline-none focus:border-gray-400"
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search invoices..."
                  type="text"
                  value={searchQuery}
                />
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar lg:pb-0">
                {['all', 'overdue', 'pending', 'paid', 'draft'].map((status) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status as FilterStatus)}
                    className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium rounded-full border transition capitalize
                      ${statusFilter === status
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                    type="button"
                  >
                  {status === 'pending' ? 'Unpaid' : status}
                  </button>
                ))}
                <button
                  className={`inline-flex whitespace-nowrap items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    showAdvancedFilters
                      ? 'border-gray-900 bg-gray-900 text-white'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                  }`}
                  onClick={() => setShowAdvancedFilters((current) => !current)}
                  type="button"
                >
                  <Filter className="h-3.5 w-3.5" />
                  Advanced filters
                  {activeAdvancedFilterCount > 0 ? (
                    <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px]">
                      {activeAdvancedFilterCount}
                    </span>
                  ) : null}
                  <ChevronRight className={`h-3.5 w-3.5 transition ${showAdvancedFilters ? 'rotate-90' : ''}`} />
                </button>
              </div>
            </div>
          </div>

          {showAdvancedFilters ? (
            <div className="mt-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Advanced filters</p>
                  <p className="text-xs text-gray-500">Refine the loaded invoice list by client, dates, amount, tax, and payment activity.</p>
                </div>
                <button
                  className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
                  disabled={activeAdvancedFilterCount === 0}
                  onClick={clearAdvancedFilters}
                  type="button"
                >
                  Clear advanced filters
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Client</span>
                  <select
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setClientFilter(event.target.value)}
                    value={clientFilter}
                  >
                    <option value="all">All clients</option>
                    {invoiceFilterOptions.clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Matter</span>
                  <select
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setMatterFilter(event.target.value)}
                    value={matterFilter}
                  >
                    <option value="all">All matters</option>
                    {invoiceFilterOptions.matters.map((matter) => (
                      <option key={matter.matterId} value={matter.matterId}>
                        {matter.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Billing country</span>
                  <select
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setCountryFilter(event.target.value)}
                    value={countryFilter}
                  >
                    <option value="all">All countries</option>
                    {invoiceFilterOptions.countries.map((countryCode) => (
                      <option key={countryCode} value={countryCode}>
                        {countryCode}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Payment activity</span>
                  <select
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setPaymentActivityFilter(event.target.value as PaymentActivityFilter)}
                    value={paymentActivityFilter}
                  >
                    <option value="all">Any activity</option>
                    <option value="balance_due">Balance due</option>
                    <option value="paid_in_full">Paid in full</option>
                    <option value="has_payments">Has payments</option>
                    <option value="has_refunds">Has refunds</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Issued from</span>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setIssueDateFrom(event.target.value)}
                    type="date"
                    value={issueDateFrom}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Issued to</span>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setIssueDateTo(event.target.value)}
                    type="date"
                    value={issueDateTo}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Due from</span>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setDueDateFrom(event.target.value)}
                    type="date"
                    value={dueDateFrom}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Due to</span>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setDueDateTo(event.target.value)}
                    type="date"
                    value={dueDateTo}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Minimum total</span>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    min="0"
                    onChange={(event) => setAmountMin(event.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={amountMin}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Maximum total</span>
                  <input
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    min="0"
                    onChange={(event) => setAmountMax(event.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    type="number"
                    value={amountMax}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Tax</span>
                  <select
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-gray-400"
                    onChange={(event) => setTaxFilter(event.target.value as TaxFilter)}
                    value={taxFilter}
                  >
                    <option value="all">Any tax treatment</option>
                    <option value="taxed">Tax applied</option>
                    <option value="not_taxed">No tax applied</option>
                  </select>
                </label>
              </div>
            </div>
          ) : null}
        </div>

        <div className="min-h-[12rem] flex-1 overflow-y-auto">
          {filteredInvoices.length > 0 ? (
            filteredInvoices.map(inv => (
                <button
                  key={inv.id}
                  onClick={() => setSelectedInvoiceId(inv.id)}
                  className={`relative block w-full cursor-pointer border-b border-gray-50 p-4 text-left transition group ${selectedInvoiceId === inv.id ? 'bg-blue-50/50' : 'hover:bg-gray-50'}`}
                  type="button"
                >
                  {selectedInvoiceId === inv.id && (
                    <div className="absolute bottom-0 left-0 top-0 w-1 bg-blue-600" />
                  )}
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-bold text-gray-900">{inv.id}</h3>
                      <p className="mt-0.5 truncate text-xs text-gray-500">{inv.clientName}</p>
                      <p className="mt-0.5 truncate text-xs text-gray-400">{inv.matterTitle}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(inv.totalAmount, inv.currencyCode || 'USD')}</p>
                      <span className={`inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded border uppercase tracking-wider ${getStatusColor(inv.status)}`}>
                        {inv.status}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-4 text-xs text-gray-500">
                    <span>Due: {formatDate(inv.dueDate)}</span>
                    {inv.status === 'overdue' && (
                      <span className="flex items-center gap-1 font-medium text-red-500">
                        <AlertCircle className="h-3 w-3" /> Late
                      </span>
                    )}
                  </div>
                </button>
              ))
          ) : (
            <div className="flex h-full min-h-[12rem] flex-col items-center justify-center p-8 text-center">
              <FileText className="mb-3 h-10 w-10 text-gray-300" />
              <h3 className="text-sm font-semibold text-gray-900">
                {invoices.length === 0 ? 'No invoices yet' : 'No invoices match these filters'}
              </h3>
              <p className="mt-1 max-w-sm text-sm text-gray-500">
                {invoices.length === 0
                  ? 'Create a draft invoice or select a published package to generate billing records.'
                  : 'Adjust the search or status filter to see more invoices.'}
              </p>
            </div>
          )}
        </div>

        {pagination && onPageOffsetChange ? (
          <div className="border-t border-gray-100 p-4">
            <PaginationControls
              isLoading={isPaginationLoading}
              onOffsetChange={onPageOffsetChange}
              pagination={pagination}
            />
          </div>
        ) : null}
      </section>

      <div className={`grid min-w-0 gap-6 ${activeInvoice ? 'xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]' : 'xl:grid-cols-1'}`}>

        {/* Main: generated invoice PDF preview */}
        <div className="relative flex min-h-[42rem] min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-gray-100/50 shadow-inner">
          {activeInvoice ? (
            <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 sm:p-5">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-900">Generated Invoice PDF</p>
                  <p className="text-xs text-gray-500">
                    Uses the active or snapshotted PDF letterhead and stored invoice data.
                  </p>
                </div>
                <button
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                  disabled={isDownloadingInvoice}
                  onClick={() => void handleDownloadInvoice()}
                  type="button"
                >
                  <Download className="h-4 w-4" />
                  {isDownloadingInvoice ? 'Downloading...' : 'Download PDF'}
                </button>
              </div>
              {isPdfPreviewLoading ? (
                <div className="flex min-h-[36rem] flex-1 items-center justify-center rounded-lg border border-gray-200 bg-white text-sm text-gray-500">
                  Loading invoice preview...
                </div>
              ) : pdfPreviewUrl ? (
                <iframe
                  className="min-h-[36rem] w-full flex-1 rounded-lg border border-gray-200 bg-white"
                  src={pdfPreviewUrl}
                  title={`Invoice PDF ${activeInvoice.id}`}
                />
              ) : (
                <div className="flex min-h-[36rem] flex-1 flex-col items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-center">
                  <AlertCircle className="mb-3 h-10 w-10 text-amber-500" />
                  <h3 className="text-sm font-semibold text-gray-900">Preview unavailable</h3>
                  <p className="mt-1 max-w-sm text-sm text-gray-500">
                    {pdfPreviewError || 'Preview unavailable. Download invoice PDF.'}
                  </p>
                  <button
                    className="mt-4 inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-50"
                    disabled={isDownloadingInvoice}
                    onClick={() => void handleDownloadInvoice()}
                    type="button"
                  >
                    <Download className="h-4 w-4" />
                    Download invoice PDF
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-center p-8">
              <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900">Select an invoice to preview</h3>
              <p className="text-sm text-gray-500 mt-1 max-w-sm">Choose an invoice from the list above to view its generated PDF and manage payments.</p>
            </div>
          )}
        </div>

        {/* Right: Context & Actions */}
        {activeInvoice && (
          <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="p-5 border-b border-gray-100 bg-gray-50/50">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition text-gray-700 disabled:opacity-50"
                  disabled={!canSendInvoice || !onSendInvoice || isSendingInvoice}
                  onClick={() => void handleSendInvoice()}
                  type="button"
                >
                  <Mail className="w-4 h-4 mb-1.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">
                    {activeInvoice.status === 'draft' ? 'Send' : 'Remind'}
                  </span>
                </button>
                <button
                  className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition text-gray-700 disabled:opacity-50"
                  disabled={isDownloadingInvoice}
                  onClick={() => void handleDownloadInvoice()}
                  title="Download the generated invoice PDF."
                  type="button"
                >
                  <Download className="w-4 h-4 mb-1.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Download</span>
                </button>
                <button
                  className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition text-gray-700 disabled:opacity-50"
                  disabled={!pdfPreviewUrl}
                  onClick={() => {
                    if (pdfPreviewUrl) {
                      window.open(pdfPreviewUrl, '_blank', 'noopener,noreferrer');
                    }
                  }}
                  title="Open the generated PDF preview and use your browser print dialog if needed."
                  type="button"
                >
                  <Printer className="w-4 h-4 mb-1.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Print / Save as PDF</span>
                </button>
                <button
                  className="flex flex-col items-center justify-center p-3 border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition text-gray-700 cursor-not-allowed opacity-60"
                  disabled
                  title="Share links are unavailable for this invoice."
                  type="button"
                >
                  <Copy className="w-4 h-4 mb-1.5" />
                  <span className="text-[10px] font-medium uppercase tracking-wide">Copy Link</span>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Payment Status Summary */}
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Financial Status</h3>
                
                {activeInvoice.status === 'paid' ? (
                  <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4 flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-emerald-900">Fully Paid</p>
                      <p className="text-xs text-emerald-700 mt-0.5">Received on {activeInvoice.paidDate ? formatDate(activeInvoice.paidDate) : 'N/A'}</p>
                      <button
                        className="mt-3 text-xs font-medium text-emerald-700 hover:text-emerald-900 bg-white/60 px-3 py-1.5 rounded border border-emerald-200 transition disabled:opacity-50"
                        disabled={!activePayments[0] || isSubmittingRefund}
                        onClick={() => setShowRefundForm((current) => !current)}
                        type="button"
                      >
                        Issue Refund
                      </button>
                      {showRefundForm ? (
                        <div className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-white/70 p-3">
                          <input
                            className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none"
                            onChange={(event) => setRefundAmount(event.target.value)}
                            placeholder="Refund amount"
                            type="number"
                            value={refundAmount}
                          />
                          <textarea
                            className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none"
                            onChange={(event) => setRefundReason(event.target.value)}
                            placeholder="Reason for refund"
                            rows={3}
                            value={refundReason}
                          />
                          <div className="flex gap-2">
                            <button
                              className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded border border-gray-200"
                              onClick={() => {
                                setShowRefundForm(false);
                                setRefundAmount('');
                                setRefundReason('');
                              }}
                              type="button"
                            >
                              Cancel
                            </button>
                            <button
                              className="px-3 py-1.5 text-xs bg-emerald-700 text-white rounded disabled:opacity-50"
                              disabled={!refundAmount || !refundReason.trim() || !onCreateRefund || !activePayments[0]}
                              onClick={() => {
                                if (!activePayments[0] || !onCreateRefund) {
                                  return;
                                }

                                setIsSubmittingRefund(true);
                                void onCreateRefund({
                                  amount: Number(refundAmount),
                                  invoiceId: activeInvoice.id,
                                  paymentId: activePayments[0].id,
                                  reasonText: refundReason.trim(),
                                })
                                  .then(() => {
                                    setRefundAmount('');
                                    setRefundReason('');
                                    setShowRefundForm(false);
                                  })
                                  .finally(() => setIsSubmittingRefund(false));
                              }}
                              type="button"
                            >
                              Submit Refund
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : activeInvoice.status === 'void' ? (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                    <p className="text-sm font-bold text-slate-900">Invoice Voided</p>
                    <p className="text-xs text-slate-600 mt-1">
                      This invoice is preserved for history but is no longer collectible.
                    </p>
                  </div>
                ) : activeInvoice.status === 'refunded' ? (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-4">
                    <p className="text-sm font-bold text-amber-900">Invoice Refunded</p>
                    <p className="text-xs text-amber-700 mt-1">
                      Funds have been returned to the client against this invoice.
                    </p>
                  </div>
                ) : (
                  <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                    <div className="flex justify-between items-end mb-3">
                      <div>
                        <p className="text-xs text-blue-600 font-medium mb-1">Amount Due</p>
                        <p className="text-lg font-bold text-blue-900">{formatCurrency(activeAmountDue, activeCurrencyCode)}</p>
                      </div>
                      <AlertCircle className={`w-5 h-5 ${activeInvoice.status === 'overdue' ? 'text-red-500' : 'text-blue-400'}`} />
                    </div>
                    
                    <div className="space-y-2 mt-4">
                      <button
                        className="w-full py-2 bg-blue-600 text-white text-sm font-medium rounded-lg transition flex items-center justify-center gap-2 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!canRecordPayment || isRecordingPayment}
                        onClick={handleOpenPaymentForm}
                        type="button"
                      >
                        <DollarSign className="w-4 h-4" /> Record Payment
                      </button>
                      <button
                        className="w-full py-2 bg-white text-gray-700 border border-gray-200 text-sm font-medium rounded-lg hover:bg-gray-50 transition flex items-center justify-center gap-2 disabled:opacity-50"
                        disabled={!canSendInvoice || !onSendInvoice || isSendingInvoice}
                        onClick={() => void handleSendInvoice()}
                        type="button"
                      >
                        <Mail className="w-4 h-4" /> {isSendingInvoice ? 'Sending...' : sendInvoiceLabel}
                      </button>
                    </div>

                    {showPaymentForm ? (
                      <div className="mt-4 space-y-3 rounded-lg border border-blue-100 bg-white p-3">
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                              Amount
                            </span>
                            <input
                              className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none"
                              max={activeAmountDue}
                              min="0.01"
                              onChange={(event) => setPaymentAmount(event.target.value)}
                              step="0.01"
                              type="number"
                              value={paymentAmount}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                              Payment Date
                            </span>
                            <input
                              className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none"
                              onChange={(event) => setPaymentDate(event.target.value)}
                              type="date"
                              value={paymentDate}
                            />
                          </label>
                        </div>
                        <label className="space-y-1 block">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                            Method
                          </span>
                          <select
                            className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none bg-white"
                            onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)}
                            value={paymentMethod}
                          >
                            <option value="bank-transfer">Bank transfer</option>
                            <option value="online">Online/manual processor</option>
                            <option value="cash">Cash</option>
                            <option value="cheque">Cheque</option>
                          </select>
                        </label>
                        <input
                          className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none"
                          onChange={(event) => setPaymentReference(event.target.value)}
                          placeholder="Reference or transaction ID"
                          type="text"
                          value={paymentReference}
                        />
                        <textarea
                          className="w-full rounded border border-gray-200 px-3 py-2 text-xs outline-none"
                          onChange={(event) => setPaymentNotes(event.target.value)}
                          placeholder="Internal note"
                          rows={3}
                          value={paymentNotes}
                        />
                        {paymentError ? <p className="text-xs text-red-600">{paymentError}</p> : null}
                        <div className="flex gap-2">
                          <button
                            className="px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 rounded border border-gray-200"
                            onClick={() => {
                              setShowPaymentForm(false);
                              setPaymentError(null);
                            }}
                            type="button"
                          >
                            Cancel
                          </button>
                          <button
                            className="px-3 py-1.5 text-xs bg-blue-700 text-white rounded disabled:opacity-50"
                            disabled={
                              isRecordingPayment ||
                              !paymentAmount ||
                              !paymentDate ||
                              Number(paymentAmount) <= 0
                            }
                            onClick={() => void handleRecordPayment()}
                            type="button"
                          >
                            {isRecordingPayment ? 'Recording...' : 'Save Payment'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Internal Notes */}
              {activeInvoice.internalNote && (
                <div>
                  <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Internal Note</h3>
                  <div className="bg-amber-50 border border-amber-100 p-3 rounded-lg text-sm text-gray-800">
                    {activeInvoice.internalNote}
                  </div>
                </div>
              )}

              {/* Payment & Action History */}
              <div>
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Activity Ledger</h3>
                
                <div className="space-y-4 relative before:absolute before:inset-0 before:ml-2 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gray-100">
                  
                  {/* Show active payments if any */}
                  {activePayments.map(payment => (
                    <div key={payment.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full border-2 border-white bg-emerald-500 text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10" />
                      <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-white border border-gray-100 p-3 rounded-lg shadow-sm">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-gray-900 text-xs">Payment Received</span>
                          <span className="font-bold text-emerald-600 text-xs">{formatCurrency(payment.amount)}</span>
                        </div>
                        <p className="text-[10px] text-gray-500">via {payment.method} • Ref: {payment.reference}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{formatDate(payment.timestamp.split('T')[0])} by {payment.recordedBy}</p>
                      </div>
                    </div>
                  ))}

                  {activeRefunds.map((refund) => (
                    <div key={refund.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full border-2 border-white bg-amber-500 text-white shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10" />
                      <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-white border border-gray-100 p-3 rounded-lg shadow-sm">
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-bold text-gray-900 text-xs">Refund Issued</span>
                          <span className="font-bold text-amber-600 text-xs">{formatCurrency(refund.amount)}</span>
                        </div>
                        <p className="text-[10px] text-gray-500">{refund.reasonText}</p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {formatDate(refund.requestedAt.split('T')[0])} by {refund.requestedBy}
                        </p>
                      </div>
                    </div>
                  ))}

                  {/* Invoice Sent/Draft state */}
                  {activeInvoice.status !== 'draft' && (
                    <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full border-2 border-white bg-blue-400 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10" />
                      <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-white border border-gray-100 p-3 rounded-lg shadow-sm">
                        <span className="font-bold text-gray-900 text-xs block mb-0.5">Invoice Issued</span>
                        <p className="text-[10px] text-gray-500">Sent to {activeInvoice.clientName}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{formatDate(activeInvoice.issueDate)}</p>
                      </div>
                    </div>
                  )}

                  {/* Creation */}
                  <div className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full border-2 border-white bg-gray-300 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10" />
                    <div className="w-[calc(100%-2rem)] md:w-[calc(50%-1.5rem)] bg-white border border-gray-100 p-3 rounded-lg shadow-sm">
                      <span className="font-bold text-gray-900 text-xs block mb-0.5">Draft Created</span>
                      <p className="text-[10px] text-gray-500">System generation</p>
                      <p className="text-[10px] text-gray-400 mt-1">{formatDate(new Date(new Date(activeInvoice.issueDate).getTime() - 2*24*60*60*1000).toISOString().split('T')[0])}</p>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
