import crypto from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { nowUtc, toMysqlDateTime } from '../../lib/datetime.js';
import { formatCurrencyAmount } from '../../lib/currencyFormat.js';
import { badRequest, conflict, serviceUnavailable, unauthorized } from '../../lib/httpErrors.js';
import { createPublicId } from '../../lib/ids.js';
import { getIdempotencyKey } from '../../lib/idempotency.js';
import { getMysqlPool } from '../../lib/mysql.js';
import { executeResult, selectAll, selectOne, withTransaction } from '../../lib/mysqlUtils.js';
import { getRequestContext, logEvent } from '../../lib/observability.js';

const PROVIDER = 'razorpay';
const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF',
  'CLP',
  'DJF',
  'GNF',
  'JPY',
  'KMF',
  'KRW',
  'MGA',
  'PYG',
  'RWF',
  'UGX',
  'VND',
  'VUV',
  'XAF',
  'XOF',
  'XPF',
]);

type InvoicePaymentRow = RowDataPacket & {
  amount_due: number | string;
  amount_paid: number | string;
  amount_refunded: number | string;
  billing_email: string | null;
  billing_name: string | null;
  billing_phone: string | null;
  client_account_id: number;
  client_email: string;
  client_name: string;
  client_phone: string | null;
  currency_code: string;
  invoice_id: number;
  invoice_number: string;
  matter_id: number | null;
  public_id: string;
  status_code: string;
  total_amount: number | string;
};

type GatewayOrderRow = RowDataPacket & {
  amount: number | string;
  amount_minor: number | string;
  client_account_id: number;
  currency_code: string;
  id: number;
  invoice_id: number | null;
  provider_order_id: string;
  public_id: string;
  status_code: string;
};

type InstallmentRow = RowDataPacket & {
  amount_remaining: number | string;
  id: number;
  installment_no: number;
};

type PaymentTransactionRow = RowDataPacket & {
  id: number;
  public_id: string;
  status_code: string;
};

type RazorpayOrder = {
  amount: number;
  amount_due?: number;
  amount_paid?: number;
  currency: string;
  id: string;
  receipt?: string;
  status: string;
};

type RazorpayPayment = {
  amount: number;
  captured?: boolean;
  currency: string;
  id: string;
  order_id: string;
  status: string;
};

export type InvoicePaymentOrderResponse = {
  amount: number;
  amountMinor: number;
  currencyCode: string;
  customer: {
    email: string;
    name: string;
    phone: string | null;
  };
  invoiceId: string;
  invoiceNumber: string;
  keyId: string;
  orderId: string;
  provider: 'razorpay';
  receipt: string;
};

export type InvoicePaymentVerifyResponse = {
  amountDue: number;
  amountPaid: number;
  invoiceId: string;
  invoiceStatus: string;
  paymentId: string | null;
  status: 'authorized' | 'paid';
};

const toNumber = (value: unknown) => Number(value ?? 0);

const getCurrencyExponent = (currencyCode: string) =>
  ZERO_DECIMAL_CURRENCIES.has(currencyCode.toUpperCase()) ? 0 : 2;

const toMinorUnits = (amount: number | string, currencyCode = 'USD') => {
  const numeric = Number(amount);

  if (!Number.isFinite(numeric)) {
    throw badRequest('invalid_payment_amount', 'Payment amount must be a valid number.');
  }

  const multiplier = 10 ** getCurrencyExponent(currencyCode);
  return Math.round(numeric * multiplier);
};

const fromMinorUnits = (minorUnits: number, currencyCode = 'USD') => {
  const divisor = 10 ** getCurrencyExponent(currencyCode);
  return Number((minorUnits / divisor).toFixed(getCurrencyExponent(currencyCode)));
};

const formatAmount = (minorUnits: number, currencyCode = 'USD') =>
  fromMinorUnits(minorUnits, currencyCode).toFixed(getCurrencyExponent(currencyCode));

const assertProviderEnabled = () => {
  if (env.PAYMENT_PROVIDER_MODE !== 'razorpay') {
    throw serviceUnavailable(
      'online_payments_disabled',
      'Online payments are not available right now. Please contact the billing team.'
    );
  }

  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw serviceUnavailable(
      'payment_provider_not_configured',
      'Online payments are not configured yet. Please contact the billing team.'
    );
  }
};

const HMAC_SHA256_HEX_LENGTH = 64;

export const createSignature = (message: string, secret: string) =>
  crypto.createHmac('sha256', secret).update(message).digest('hex');

const isValidSha256HexSignature = (value: string) =>
  value.length === HMAC_SHA256_HEX_LENGTH && /^[a-f0-9]+$/i.test(value);

const timingSafeEqualHex = (left: string, right: string) => {
  if (!isValidSha256HexSignature(left) || !isValidSha256HexSignature(right)) {
    return false;
  }

  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');

  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyRazorpaySignature = (input: {
  message: string;
  secret: string;
  signature: string;
}) => timingSafeEqualHex(createSignature(input.message, input.secret), input.signature);

const hashValue = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const razorpayRequest = async <TBody>(
  path: string,
  options: {
    body?: unknown;
    method?: 'GET' | 'POST';
  } = {}
) => {
  assertProviderEnabled();
  const authorization = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/json',
    },
    method: options.method || 'GET',
  });

  const responseText = await response.text();
  const responseBody = responseText ? JSON.parse(responseText) : {};

  if (!response.ok) {
    logEvent('warn', 'payment.razorpay_api_error', {
      path,
      providerStatusCode: response.status,
      providerError: responseBody?.error?.code || responseBody?.error?.description || 'unknown',
    });

    throw serviceUnavailable(
      'payment_provider_unavailable',
      'Online payments are temporarily unavailable. Please try again shortly.'
    );
  }

  return responseBody as TBody;
};

const insertAuditEvent = async (
  connection: PoolConnection,
  input: {
    actionCode: string;
    actionLabel: string;
    actorRoleCodeSnapshot: string;
    actorUserId: number | null;
    entityPk: number | null;
    entityTableName: string;
    sourceModule: string;
    summaryNewValue?: string | null;
    summaryOldValue?: string | null;
  }
) => {
  const context = getRequestContext();

  await connection.execute(
    `INSERT INTO audit_events (
       public_id,
       actor_user_id,
       actor_role_code_snapshot,
       entity_table_name,
       entity_pk,
       action_code,
       action_label,
       source_module,
       request_correlation_id,
       ip_address,
       user_agent,
       summary_old_value,
       summary_new_value,
       occurred_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
    [
      createPublicId(),
      input.actorUserId,
      input.actorRoleCodeSnapshot,
      input.entityTableName,
      input.entityPk,
      input.actionCode,
      input.actionLabel,
      input.sourceModule,
      context?.requestId ?? null,
      context?.ipAddress ?? null,
      context?.userAgent ?? null,
      input.summaryOldValue ?? null,
      input.summaryNewValue ?? null,
    ]
  );
};

const insertClientNotification = async (
  connection: PoolConnection,
  input: {
    bodyText: string;
    clientAccountId: number;
    invoiceId: number;
    matterId: number | null;
    title: string;
  }
) => {
  const recipients = await selectAll<RowDataPacket & { user_id: number }>(
    connection,
    `SELECT DISTINCT user_id
     FROM client_account_contacts
     WHERE client_account_id = ?
       AND portal_access_enabled = 1
       AND archived_at IS NULL`,
    [input.clientAccountId]
  );

  for (const recipient of recipients) {
    await connection.execute(
      `INSERT INTO notifications (
         public_id,
         recipient_user_id,
         notification_type_code,
         title,
         body_text,
         priority_code,
         matter_id,
         invoice_id,
         thread_id,
         event_id,
         document_id,
         is_read,
         read_at,
         dismissed_at,
         created_at,
         expires_at
       ) VALUES (?, ?, 'payment_reminder', ?, ?, 'normal', ?, ?, NULL, NULL, NULL, 0, NULL, NULL, UTC_TIMESTAMP(6), NULL)`,
      [
        createPublicId(),
        Number(recipient.user_id),
        input.title,
        input.bodyText,
        input.matterId,
        input.invoiceId,
      ]
    );
  }
};

const getInvoiceForPayment = async (
  connection: PoolConnection,
  clientAccountId: number,
  invoicePublicId: string
) => {
  const invoice = await selectOne<InvoicePaymentRow>(
    connection,
    `SELECT
       inv.id AS invoice_id,
       inv.public_id,
       inv.invoice_number,
       inv.client_account_id,
       inv.matter_id,
       inv.status_code,
       inv.currency_code,
       inv.total_amount,
       inv.amount_paid,
       inv.amount_refunded,
       inv.amount_due,
       ca.display_name AS client_name,
       ca.primary_email AS client_email,
       ca.primary_phone AS client_phone,
       snapshot.billing_name,
       snapshot.billing_email,
       snapshot.billing_phone
     FROM invoices inv
     INNER JOIN client_accounts ca ON ca.id = inv.client_account_id
     LEFT JOIN invoice_billing_snapshots snapshot ON snapshot.invoice_id = inv.id
     WHERE inv.public_id = ?
       AND inv.client_account_id = ?
       AND inv.archived_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [invoicePublicId, clientAccountId]
  );

  if (!invoice) {
    throw badRequest('invoice_not_found', 'Invoice not found.');
  }

  return invoice;
};

const getInvoiceInstallments = async (connection: PoolConnection, invoiceId: number) =>
  selectAll<InstallmentRow>(
    connection,
    `SELECT id, installment_no, amount_remaining
     FROM invoice_installments
     WHERE invoice_id = ?
       AND amount_remaining > 0
     ORDER BY installment_no ASC
     FOR UPDATE`,
    [invoiceId]
  );

const resolvePaymentAmountMinor = async (
  connection: PoolConnection,
  invoice: InvoicePaymentRow,
  requestedAmount?: number | string | null
) => {
  const currencyCode = invoice.currency_code || 'USD';
  const amountDueMinor = toMinorUnits(invoice.amount_due, currencyCode);

  if (amountDueMinor <= 0 || invoice.status_code === 'paid') {
    throw badRequest('invoice_already_paid', 'This invoice is already paid.');
  }

  if (invoice.status_code === 'draft' || invoice.status_code === 'void') {
    throw badRequest('invoice_payment_not_allowed', 'This invoice cannot receive online payment.');
  }

  const installments = await getInvoiceInstallments(connection, Number(invoice.invoice_id));
  const unpaidInstallments = installments.filter(
    (installment) => toMinorUnits(installment.amount_remaining, currencyCode) > 0
  );
  const allowsPartial = unpaidInstallments.length > 1;
  const nextInstallmentMinor = unpaidInstallments[0]
    ? toMinorUnits(unpaidInstallments[0].amount_remaining, currencyCode)
    : amountDueMinor;
  const requestedMinor =
    requestedAmount === undefined || requestedAmount === null || requestedAmount === ''
      ? amountDueMinor
      : toMinorUnits(requestedAmount, currencyCode);

  if (requestedMinor <= 0) {
    throw badRequest('invalid_payment_amount', 'Payment amount must be greater than zero.');
  }

  if (requestedMinor > amountDueMinor) {
    throw badRequest('payment_exceeds_invoice_balance', 'Payment exceeds the remaining invoice balance.');
  }

  if (!allowsPartial && requestedMinor !== amountDueMinor) {
    throw badRequest('partial_payment_not_allowed', 'This invoice requires full payment.');
  }

  if (allowsPartial && requestedMinor !== amountDueMinor && requestedMinor !== nextInstallmentMinor) {
    throw badRequest(
      'unsupported_partial_payment_amount',
      'Partial payment must match the next installment or the full invoice balance.'
    );
  }

  return {
    allowsPartial,
    amountDueMinor,
    nextInstallmentMinor,
    requestedMinor,
  };
};

export const getInvoicePaymentOptions = (invoice: {
  amountDue: number;
  currencyCode: string;
  installments: Array<{ amountRemaining: number; statusCode: string }>;
  statusCode: string;
}) => {
  const unpaidInstallments = invoice.installments.filter(
    (installment) => installment.amountRemaining > 0 && installment.statusCode !== 'paid'
  );
  const allowsPartial = unpaidInstallments.length > 1;
  const minimumPaymentAmount = allowsPartial
    ? Number(unpaidInstallments[0]?.amountRemaining || invoice.amountDue)
    : Number(invoice.amountDue || 0);

  return {
    allowsPartial,
    amountDue: Number(invoice.amountDue || 0),
    currencyCode: invoice.currencyCode || 'USD',
    minimumPaymentAmount,
    offlineEnabled: true,
    onlineEnabled: env.PAYMENT_PROVIDER_MODE === 'razorpay' && Boolean(env.RAZORPAY_KEY_ID),
    suggestedPaymentAmount: allowsPartial ? minimumPaymentAmount : Number(invoice.amountDue || 0),
  };
};

export const createInvoicePaymentOrder = async (
  input: {
    actorUserId: number;
    amount?: number | string | null;
    clientAccountId: number;
    idempotencyKey: string | null;
    invoicePublicId: string;
  }
): Promise<InvoicePaymentOrderResponse> => {
  assertProviderEnabled();

  if (!input.idempotencyKey) {
    throw badRequest('idempotency_key_required', 'Idempotency-Key is required to create a payment order.');
  }

  const orderInput = await withTransaction(getMysqlPool(), async (connection) => {
    const invoice = await getInvoiceForPayment(connection, input.clientAccountId, input.invoicePublicId);
    const currencyCode = (invoice.currency_code || 'USD').toUpperCase();
    const { requestedMinor } = await resolvePaymentAmountMinor(connection, invoice, input.amount);
    const amount = fromMinorUnits(requestedMinor, currencyCode);
    const receipt = `glmg_${invoice.public_id.slice(0, 18)}_${Date.now().toString(36)}`.slice(0, 40);

    return {
      amount,
      amountMinor: requestedMinor,
      clientAccountId: Number(invoice.client_account_id),
      currencyCode,
      customer: {
        email: invoice.billing_email || invoice.client_email,
        name: invoice.billing_name || invoice.client_name,
        phone: invoice.billing_phone || invoice.client_phone,
      },
      invoiceDbId: Number(invoice.invoice_id),
      invoiceId: invoice.public_id,
      invoiceNumber: invoice.invoice_number,
      receipt,
    };
  });

  const providerOrder = await razorpayRequest<RazorpayOrder>('/orders', {
    body: {
      amount: orderInput.amountMinor,
      currency: orderInput.currencyCode,
      notes: {
        client_account_id: String(orderInput.clientAccountId),
        invoice_id: orderInput.invoiceId,
        invoice_number: orderInput.invoiceNumber,
      },
      receipt: orderInput.receipt,
    },
    method: 'POST',
  });

  if (
    providerOrder.amount !== orderInput.amountMinor ||
    providerOrder.currency.toUpperCase() !== orderInput.currencyCode ||
    !providerOrder.id
  ) {
    throw serviceUnavailable(
      'payment_provider_order_mismatch',
      'Online payment order could not be verified. Please try again.'
    );
  }

  return withTransaction(getMysqlPool(), async (connection) => {
    const insertResult = await executeResult(
      connection,
      `INSERT INTO payment_gateway_orders (
         public_id,
         provider_code,
         provider_order_id,
         invoice_id,
         service_request_id,
         client_account_id,
         amount,
         amount_minor,
         currency_code,
         status_code,
         receipt,
         idempotency_key_hash,
         provider_payload_json,
         created_by_user_id,
         created_at,
         updated_at
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        createPublicId(),
        PROVIDER,
        providerOrder.id,
        orderInput.invoiceDbId,
        orderInput.clientAccountId,
        orderInput.amount.toFixed(2),
        orderInput.amountMinor,
        orderInput.currencyCode,
        providerOrder.status || 'created',
        orderInput.receipt,
        hashValue(`${input.clientAccountId}:${input.idempotencyKey}`),
        JSON.stringify(providerOrder),
        input.actorUserId,
      ]
    );

    await insertAuditEvent(connection, {
      actionCode: 'payment.gateway_order_created',
      actionLabel: 'Online payment order created',
      actorRoleCodeSnapshot: 'client',
      actorUserId: input.actorUserId,
      entityPk: insertResult.insertId,
      entityTableName: 'payment_gateway_orders',
      sourceModule: 'client_billing',
      summaryNewValue: `${providerOrder.id} for invoice ${orderInput.invoiceNumber}`,
    });

    return {
      amount: orderInput.amount,
      amountMinor: orderInput.amountMinor,
      currencyCode: orderInput.currencyCode,
      customer: orderInput.customer,
      invoiceId: orderInput.invoiceId,
      invoiceNumber: orderInput.invoiceNumber,
      keyId: env.RAZORPAY_KEY_ID || '',
      orderId: providerOrder.id,
      provider: PROVIDER,
      receipt: orderInput.receipt,
    };
  });
};

const getGatewayOrderForUpdate = async (connection: PoolConnection, providerOrderId: string) => {
  const order = await selectOne<GatewayOrderRow>(
    connection,
    `SELECT
       id,
       public_id,
       provider_order_id,
       invoice_id,
       client_account_id,
       amount,
       amount_minor,
       currency_code,
       status_code
     FROM payment_gateway_orders
     WHERE provider_code = ?
       AND provider_order_id = ?
     LIMIT 1
     FOR UPDATE`,
    [PROVIDER, providerOrderId]
  );

  if (!order) {
    throw badRequest('payment_order_not_found', 'Payment order not found.');
  }

  return order;
};

const getExistingPayment = async (connection: PoolConnection, providerPaymentId: string) =>
  selectOne<PaymentTransactionRow>(
    connection,
    `SELECT id, public_id, status_code
     FROM payment_transactions
     WHERE gateway_provider_code = ?
       AND gateway_payment_ref = ?
     LIMIT 1
     FOR UPDATE`,
    [PROVIDER, providerPaymentId]
  );

const updateInvoiceAfterCapturedPayment = async (
  connection: PoolConnection,
  input: {
    actorUserId: number | null;
    amountMinor: number;
    currencyCode: string;
    gatewayOrderDbId: number;
    invoiceDbId: number;
    providerOrderId: string;
    providerPaymentId: string;
    sourceModule: string;
  }
) => {
  const invoice = await selectOne<InvoicePaymentRow>(
    connection,
    `SELECT
       inv.id AS invoice_id,
       inv.public_id,
       inv.invoice_number,
       inv.client_account_id,
       inv.matter_id,
       inv.status_code,
       inv.currency_code,
       inv.total_amount,
       inv.amount_paid,
       inv.amount_refunded,
       inv.amount_due,
       ca.display_name AS client_name,
       ca.primary_email AS client_email,
       ca.primary_phone AS client_phone,
       snapshot.billing_name,
       snapshot.billing_email,
       snapshot.billing_phone
     FROM invoices inv
     INNER JOIN client_accounts ca ON ca.id = inv.client_account_id
     LEFT JOIN invoice_billing_snapshots snapshot ON snapshot.invoice_id = inv.id
     WHERE inv.id = ?
       AND inv.archived_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [input.invoiceDbId]
  );

  if (!invoice) {
    throw badRequest('invoice_not_found', 'Invoice not found.');
  }

  const invoiceCurrency = (invoice.currency_code || 'USD').toUpperCase();
  if (invoiceCurrency !== input.currencyCode.toUpperCase()) {
    throw badRequest('payment_currency_mismatch', 'Payment currency does not match the invoice.');
  }

  const existingPayment = await getExistingPayment(connection, input.providerPaymentId);
  if (existingPayment?.status_code === 'captured') {
    return {
      amountDue: toNumber(invoice.amount_due),
      amountPaid: toNumber(invoice.amount_paid),
      invoiceId: invoice.public_id,
      invoiceStatus: invoice.status_code,
      paymentId: existingPayment.public_id,
      status: 'paid' as const,
    };
  }

  const amountDueMinor = toMinorUnits(invoice.amount_due, invoiceCurrency);
  if (input.amountMinor > amountDueMinor) {
    throw badRequest('payment_exceeds_invoice_balance', 'Payment exceeds the remaining invoice balance.');
  }

  const paymentPublicId = existingPayment?.public_id || createPublicId();
  const capturedAt = toMysqlDateTime(nowUtc());
  const amountDecimal = formatAmount(input.amountMinor, invoiceCurrency);
  let paymentTransactionId = existingPayment?.id || 0;

  if (existingPayment) {
    await executeResult(
      connection,
      `UPDATE payment_transactions
       SET payment_gateway_order_id = ?,
           gateway_order_ref = ?,
           status_code = 'captured',
           currency_code = ?,
           gross_amount = ?,
           net_amount = ?,
           captured_at = ?,
           updated_at = UTC_TIMESTAMP(6),
           row_version = row_version + 1
       WHERE id = ?`,
      [
        input.gatewayOrderDbId,
        input.providerOrderId,
        invoiceCurrency,
        amountDecimal,
        amountDecimal,
        capturedAt,
        existingPayment.id,
      ]
    );
  } else {
    const paymentResult = await executeResult(
      connection,
      `INSERT INTO payment_transactions (
         public_id,
         client_account_id,
         payment_method_id,
         payment_gateway_order_id,
         gateway_provider_code,
         gateway_order_ref,
         gateway_payment_ref,
         status_code,
         currency_code,
         gross_amount,
         gateway_fee_amount,
         net_amount,
         failure_reason,
         initiated_at,
         authorized_at,
         captured_at,
         failed_at,
         created_by_user_id,
         created_at,
         updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'captured', ?, ?, 0, ?, NULL, ?, ?, ?, NULL, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        paymentPublicId,
        Number(invoice.client_account_id),
        input.gatewayOrderDbId,
        PROVIDER,
        input.providerOrderId,
        input.providerPaymentId,
        invoiceCurrency,
        amountDecimal,
        amountDecimal,
        capturedAt,
        capturedAt,
        capturedAt,
        input.actorUserId,
      ]
    );
    paymentTransactionId = paymentResult.insertId;
  }

  const allocationResult = await executeResult(
    connection,
    `INSERT INTO payment_allocations (
       payment_transaction_id,
       invoice_id,
       invoice_installment_id,
       amount_applied,
       created_at
     ) VALUES (?, ?, NULL, ?, UTC_TIMESTAMP(6))`,
    [paymentTransactionId, Number(invoice.invoice_id), amountDecimal]
  );

  let remainingToApply = input.amountMinor;
  const installments = await getInvoiceInstallments(connection, Number(invoice.invoice_id));

  for (const installment of installments) {
    if (remainingToApply <= 0) {
      break;
    }

    const installmentRemainingMinor = toMinorUnits(installment.amount_remaining, invoiceCurrency);
    const amountForInstallmentMinor = Math.min(remainingToApply, installmentRemainingMinor);
    const nextRemainingMinor = installmentRemainingMinor - amountForInstallmentMinor;
    const nextInstallmentStatus = nextRemainingMinor === 0 ? 'paid' : 'pending';

    await executeResult(
      connection,
      `UPDATE invoice_installments
       SET amount_paid = amount_paid + ?,
           amount_remaining = ?,
           status_code = ?,
           paid_at = CASE WHEN ? = 'paid' THEN ? ELSE paid_at END
       WHERE id = ?`,
      [
        formatAmount(amountForInstallmentMinor, invoiceCurrency),
        formatAmount(nextRemainingMinor, invoiceCurrency),
        nextInstallmentStatus,
        nextInstallmentStatus,
        capturedAt,
        installment.id,
      ]
    );

    remainingToApply -= amountForInstallmentMinor;
  }

  const nextPaidMinor = toMinorUnits(invoice.amount_paid, invoiceCurrency) + input.amountMinor;
  const nextDueMinor = Math.max(
    toMinorUnits(invoice.total_amount, invoiceCurrency) -
      toMinorUnits(invoice.amount_refunded, invoiceCurrency) -
      nextPaidMinor,
    0
  );
  const nextInvoiceStatus =
    nextDueMinor === 0 ? 'paid' : invoice.status_code === 'overdue' ? 'overdue' : 'pending';

  await executeResult(
    connection,
    `UPDATE invoices
     SET amount_paid = ?,
         amount_due = ?,
         status_code = ?,
         updated_at = UTC_TIMESTAMP(6),
         row_version = row_version + 1
     WHERE id = ?`,
    [
      formatAmount(nextPaidMinor, invoiceCurrency),
      formatAmount(nextDueMinor, invoiceCurrency),
      nextInvoiceStatus,
      Number(invoice.invoice_id),
    ]
  );

  if (invoice.matter_id) {
    await executeResult(
      connection,
      `UPDATE matters m
       JOIN (
         SELECT
           matter_id,
           COALESCE(SUM(amount_paid), 0) AS paid_total,
           COALESCE(SUM(amount_due), 0) AS due_total
         FROM invoices
         WHERE matter_id = ?
           AND archived_at IS NULL
         GROUP BY matter_id
       ) totals ON totals.matter_id = m.id
       SET m.paid_total_amount = totals.paid_total,
           m.due_total_amount = totals.due_total,
           m.operational_status_code = CASE
             WHEN m.operational_status_code IN ('completed', 'archived') THEN m.operational_status_code
             WHEN totals.due_total <= 0 THEN 'paid'
             ELSE 'awaiting-payment'
           END,
           m.last_activity_at = UTC_TIMESTAMP(6),
           m.updated_at = UTC_TIMESTAMP(6),
           m.row_version = m.row_version + 1
       WHERE m.id = ?`,
      [Number(invoice.matter_id), Number(invoice.matter_id)]
    );
  }

  await executeResult(
    connection,
    `UPDATE payment_gateway_orders
     SET status_code = 'paid',
         updated_at = UTC_TIMESTAMP(6)
     WHERE id = ?`,
    [input.gatewayOrderDbId]
  );

  await insertAuditEvent(connection, {
    actionCode: 'payment.gateway_verified',
    actionLabel: 'Online payment verified',
    actorRoleCodeSnapshot: input.actorUserId ? 'client' : 'system',
    actorUserId: input.actorUserId,
    entityPk: paymentTransactionId,
    entityTableName: 'payment_transactions',
    sourceModule: input.sourceModule,
    summaryNewValue: `${invoiceCurrency} ${amountDecimal} captured for invoice ${invoice.invoice_number}`,
  });

  await insertAuditEvent(connection, {
    actionCode: 'payment.allocated',
    actionLabel: 'Payment allocated to invoice',
    actorRoleCodeSnapshot: input.actorUserId ? 'client' : 'system',
    actorUserId: input.actorUserId,
    entityPk: allocationResult.insertId,
    entityTableName: 'payment_allocations',
    sourceModule: input.sourceModule,
    summaryNewValue: `${invoiceCurrency} ${amountDecimal} allocated to invoice ${invoice.invoice_number}`,
  });

  if (nextInvoiceStatus !== invoice.status_code) {
    await insertAuditEvent(connection, {
      actionCode: 'invoice.status_changed',
      actionLabel: 'Invoice status changed',
      actorRoleCodeSnapshot: input.actorUserId ? 'client' : 'system',
      actorUserId: input.actorUserId,
      entityPk: Number(invoice.invoice_id),
      entityTableName: 'invoices',
      sourceModule: input.sourceModule,
      summaryNewValue: nextInvoiceStatus,
      summaryOldValue: invoice.status_code,
    });
  }

  await insertClientNotification(connection, {
    bodyText: `Payment of ${invoiceCurrency} ${amountDecimal} has been received for invoice ${invoice.invoice_number}.`,
    clientAccountId: Number(invoice.client_account_id),
    invoiceId: Number(invoice.invoice_id),
    matterId: invoice.matter_id ? Number(invoice.matter_id) : null,
    title: nextInvoiceStatus === 'paid' ? 'Invoice paid' : 'Payment received',
  });

  return {
    amountDue: fromMinorUnits(nextDueMinor, invoiceCurrency),
    amountPaid: fromMinorUnits(nextPaidMinor, invoiceCurrency),
    invoiceId: invoice.public_id,
    invoiceStatus: nextInvoiceStatus,
    paymentId: paymentPublicId,
    status: 'paid' as const,
  };
};

const recordAuthorizedPayment = async (
  connection: PoolConnection,
  input: {
    actorUserId: number | null;
    amountMinor: number;
    currencyCode: string;
    gatewayOrderDbId: number;
    providerOrderId: string;
    providerPaymentId: string;
    sourceModule: string;
  }
) => {
  const existingPayment = await getExistingPayment(connection, input.providerPaymentId);
  const paymentPublicId = existingPayment?.public_id || createPublicId();
  const authorizedAt = toMysqlDateTime(nowUtc());
  const amountDecimal = formatAmount(input.amountMinor, input.currencyCode);
  let paymentTransactionId = existingPayment?.id || 0;

  if (existingPayment) {
    await executeResult(
      connection,
      `UPDATE payment_transactions
       SET payment_gateway_order_id = ?,
           gateway_order_ref = ?,
           status_code = 'authorized',
           authorized_at = COALESCE(authorized_at, ?),
           updated_at = UTC_TIMESTAMP(6),
           row_version = row_version + 1
       WHERE id = ?`,
      [input.gatewayOrderDbId, input.providerOrderId, authorizedAt, existingPayment.id]
    );
  } else {
    const gatewayOrder = await selectOne<GatewayOrderRow>(
      connection,
      `SELECT client_account_id
       FROM payment_gateway_orders
       WHERE id = ?
       LIMIT 1`,
      [input.gatewayOrderDbId]
    );

    const result = await executeResult(
      connection,
      `INSERT INTO payment_transactions (
         public_id,
         client_account_id,
         payment_method_id,
         payment_gateway_order_id,
         gateway_provider_code,
         gateway_order_ref,
         gateway_payment_ref,
         status_code,
         currency_code,
         gross_amount,
         gateway_fee_amount,
         net_amount,
         failure_reason,
         initiated_at,
         authorized_at,
         captured_at,
         failed_at,
         created_by_user_id,
         created_at,
         updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, 'authorized', ?, ?, 0, ?, NULL, ?, ?, NULL, NULL, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        paymentPublicId,
        Number(gatewayOrder?.client_account_id),
        input.gatewayOrderDbId,
        PROVIDER,
        input.providerOrderId,
        input.providerPaymentId,
        input.currencyCode,
        amountDecimal,
        amountDecimal,
        authorizedAt,
        authorizedAt,
        input.actorUserId,
      ]
    );
    paymentTransactionId = result.insertId;
  }

  await executeResult(
    connection,
    `UPDATE payment_gateway_orders
     SET status_code = 'authorized',
         updated_at = UTC_TIMESTAMP(6)
     WHERE id = ?`,
    [input.gatewayOrderDbId]
  );

  await insertAuditEvent(connection, {
    actionCode: 'payment.gateway_verified',
    actionLabel: 'Online payment authorized',
    actorRoleCodeSnapshot: input.actorUserId ? 'client' : 'system',
    actorUserId: input.actorUserId,
    entityPk: paymentTransactionId,
    entityTableName: 'payment_transactions',
    sourceModule: input.sourceModule,
    summaryNewValue: `${formatCurrencyAmount(Number(amountDecimal), input.currencyCode)} authorized through Razorpay`,
  });

  return {
    paymentId: paymentPublicId,
    status: 'authorized' as const,
  };
};

const verifyPaymentAmounts = (
  gatewayOrder: GatewayOrderRow,
  providerOrder: RazorpayOrder,
  payment: RazorpayPayment
) => {
  const expectedAmount = Number(gatewayOrder.amount_minor);
  const expectedCurrency = gatewayOrder.currency_code.toUpperCase();

  if (
    payment.order_id !== gatewayOrder.provider_order_id ||
    payment.amount !== expectedAmount ||
    payment.currency.toUpperCase() !== expectedCurrency ||
    providerOrder.amount !== expectedAmount ||
    providerOrder.currency.toUpperCase() !== expectedCurrency
  ) {
    throw badRequest('payment_verification_mismatch', 'Payment details do not match the invoice order.');
  }
};

const resolveCapturedPayment = async (payment: RazorpayPayment) => {
  if (payment.status === 'authorized' && env.RAZORPAY_CAPTURE_MODE === 'auto') {
    return razorpayRequest<RazorpayPayment>(`/payments/${payment.id}/capture`, {
      body: {
        amount: payment.amount,
        currency: payment.currency,
      },
      method: 'POST',
    });
  }

  return payment;
};

export const verifyInvoicePayment = async (
  input: {
    actorUserId: number;
    clientAccountId: number;
    invoicePublicId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }
): Promise<InvoicePaymentVerifyResponse> => {
  assertProviderEnabled();

  if (
    !verifyRazorpaySignature({
      message: `${input.razorpayOrderId}|${input.razorpayPaymentId}`,
      secret: env.RAZORPAY_KEY_SECRET || '',
      signature: input.razorpaySignature,
    })
  ) {
    await withTransaction(getMysqlPool(), async (connection) => {
      await insertAuditEvent(connection, {
        actionCode: 'payment.gateway_failed',
        actionLabel: 'Online payment signature rejected',
        actorRoleCodeSnapshot: 'client',
        actorUserId: input.actorUserId,
        entityPk: null,
        entityTableName: 'payment_transactions',
        sourceModule: 'client_billing',
        summaryNewValue: input.razorpayOrderId,
      });
    });
    throw unauthorized('invalid_payment_signature', 'Payment verification failed.');
  }

  const [providerOrder, providerPayment] = await Promise.all([
    razorpayRequest<RazorpayOrder>(`/orders/${encodeURIComponent(input.razorpayOrderId)}`),
    razorpayRequest<RazorpayPayment>(`/payments/${encodeURIComponent(input.razorpayPaymentId)}`),
  ]);
  const payment = await resolveCapturedPayment(providerPayment);

  return withTransaction(getMysqlPool(), async (connection) => {
    const gatewayOrder = await getGatewayOrderForUpdate(connection, input.razorpayOrderId);
    if (gatewayOrder.client_account_id !== input.clientAccountId) {
      throw badRequest('payment_order_not_found', 'Payment order not found.');
    }

    const invoice = await selectOne<RowDataPacket & { public_id: string }>(
      connection,
      `SELECT public_id
       FROM invoices
       WHERE id = ?
         AND client_account_id = ?
       LIMIT 1`,
      [gatewayOrder.invoice_id, input.clientAccountId]
    );

    if (!invoice || invoice.public_id !== input.invoicePublicId) {
      throw badRequest('payment_order_invoice_mismatch', 'Payment order does not match this invoice.');
    }

    verifyPaymentAmounts(gatewayOrder, providerOrder, payment);

    if (payment.status === 'captured' || payment.captured === true) {
      return updateInvoiceAfterCapturedPayment(connection, {
        actorUserId: input.actorUserId,
        amountMinor: payment.amount,
        currencyCode: payment.currency.toUpperCase(),
        gatewayOrderDbId: Number(gatewayOrder.id),
        invoiceDbId: Number(gatewayOrder.invoice_id),
        providerOrderId: input.razorpayOrderId,
        providerPaymentId: input.razorpayPaymentId,
        sourceModule: 'client_billing',
      });
    }

    if (payment.status === 'authorized') {
      const authorized = await recordAuthorizedPayment(connection, {
        actorUserId: input.actorUserId,
        amountMinor: payment.amount,
        currencyCode: payment.currency.toUpperCase(),
        gatewayOrderDbId: Number(gatewayOrder.id),
        providerOrderId: input.razorpayOrderId,
        providerPaymentId: input.razorpayPaymentId,
        sourceModule: 'client_billing',
      });

      return {
        amountDue: fromMinorUnits(Number(gatewayOrder.amount_minor), gatewayOrder.currency_code),
        amountPaid: 0,
        invoiceId: input.invoicePublicId,
        invoiceStatus: 'pending',
        paymentId: authorized.paymentId,
        status: 'authorized',
      };
    }

    await executeResult(
      connection,
      `UPDATE payment_gateway_orders
       SET status_code = ?,
           updated_at = UTC_TIMESTAMP(6)
       WHERE id = ?`,
      [payment.status || 'failed', Number(gatewayOrder.id)]
    );

    await insertAuditEvent(connection, {
      actionCode: 'payment.gateway_failed',
      actionLabel: 'Online payment not captured',
      actorRoleCodeSnapshot: 'client',
      actorUserId: input.actorUserId,
      entityPk: Number(gatewayOrder.id),
      entityTableName: 'payment_gateway_orders',
      sourceModule: 'client_billing',
      summaryNewValue: payment.status,
    });

    throw badRequest('payment_not_captured', 'Payment was not captured. Please try again or contact billing.');
  });
};

const parseWebhookPayload = (rawBody: Buffer) => {
  try {
    return JSON.parse(rawBody.toString('utf8')) as {
      event?: string;
      id?: string;
      payload?: {
        order?: { entity?: RazorpayOrder };
        payment?: { entity?: RazorpayPayment };
      };
    };
  } catch {
    throw badRequest('invalid_webhook_payload', 'Webhook payload must be valid JSON.');
  }
};

const getWebhookEventId = (
  headers: {
    eventId?: string | null;
  },
  payload: unknown,
  rawBody: Buffer
) => {
  if (headers.eventId?.trim()) {
    return headers.eventId.trim();
  }

  if (payload && typeof payload === 'object' && 'id' in payload && typeof payload.id === 'string') {
    return payload.id;
  }

  return hashValue(rawBody.toString('utf8'));
};

const insertGatewayEvent = async (
  connection: PoolConnection,
  input: {
    eventType: string;
    payload: unknown;
    providerEventId: string;
    providerOrderId?: string | null;
    providerPaymentId?: string | null;
    signatureValid: boolean;
  }
) => {
  const result = await executeResult(
    connection,
    `INSERT IGNORE INTO payment_gateway_events (
       public_id,
       provider_code,
       event_type,
       provider_event_id,
       signature_valid,
       provider_order_id,
       provider_payment_id,
       payload_json,
       received_at,
       created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
    [
      createPublicId(),
      PROVIDER,
      input.eventType,
      input.providerEventId,
      input.signatureValid ? 1 : 0,
      input.providerOrderId || null,
      input.providerPaymentId || null,
      JSON.stringify(input.payload),
    ]
  );

  return result.affectedRows === 1;
};

export const handleRazorpayWebhook = async (
  input: {
    eventId?: string | null;
    rawBody: Buffer;
    signature?: string | null;
  }
) => {
  if (env.PAYMENT_PROVIDER_MODE !== 'razorpay') {
    throw serviceUnavailable('online_payments_disabled', 'Razorpay webhook handling is disabled.');
  }

  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw serviceUnavailable('webhook_secret_not_configured', 'Razorpay webhook secret is not configured.');
  }

  const payload = parseWebhookPayload(input.rawBody);
  const payment = payload.payload?.payment?.entity;
  const order = payload.payload?.order?.entity;
  const providerEventId = getWebhookEventId({ eventId: input.eventId }, payload, input.rawBody);
  const eventType = payload.event || 'unknown';
  const signatureValid = Boolean(
    input.signature &&
      verifyRazorpaySignature({
        message: input.rawBody.toString('utf8'),
        secret: env.RAZORPAY_WEBHOOK_SECRET,
        signature: input.signature,
      })
  );

  if (!signatureValid) {
    await withTransaction(getMysqlPool(), async (connection) => {
      await insertGatewayEvent(connection, {
        eventType,
        payload,
        providerEventId,
        providerOrderId: payment?.order_id || order?.id || null,
        providerPaymentId: payment?.id || null,
        signatureValid: false,
      });
      await insertAuditEvent(connection, {
        actionCode: 'payment.gateway_webhook_invalid_signature',
        actionLabel: 'Razorpay webhook signature rejected',
        actorRoleCodeSnapshot: 'system',
        actorUserId: null,
        entityPk: null,
        entityTableName: 'payment_gateway_events',
        sourceModule: 'webhook',
        summaryNewValue: eventType,
      });
    });

    throw unauthorized('invalid_webhook_signature', 'Webhook signature verification failed.');
  }

  return withTransaction(getMysqlPool(), async (connection) => {
    const inserted = await insertGatewayEvent(connection, {
      eventType,
      payload,
      providerEventId,
      providerOrderId: payment?.order_id || order?.id || null,
      providerPaymentId: payment?.id || null,
      signatureValid: true,
    });

    if (!inserted) {
      return {
        duplicate: true,
        status: 'ignored' as const,
      };
    }

    await insertAuditEvent(connection, {
      actionCode: 'payment.gateway_webhook_received',
      actionLabel: 'Razorpay webhook received',
      actorRoleCodeSnapshot: 'system',
      actorUserId: null,
      entityPk: null,
      entityTableName: 'payment_gateway_events',
      sourceModule: 'webhook',
      summaryNewValue: eventType,
    });

    if (payment?.order_id && payment.status === 'captured') {
      const gatewayOrder = await getGatewayOrderForUpdate(connection, payment.order_id);
      if (Number(gatewayOrder.amount_minor) !== payment.amount) {
        throw conflict('webhook_payment_amount_mismatch', 'Webhook payment amount does not match the stored order.');
      }

      const result = await updateInvoiceAfterCapturedPayment(connection, {
        actorUserId: null,
        amountMinor: payment.amount,
        currencyCode: payment.currency.toUpperCase(),
        gatewayOrderDbId: Number(gatewayOrder.id),
        invoiceDbId: Number(gatewayOrder.invoice_id),
        providerOrderId: payment.order_id,
        providerPaymentId: payment.id,
        sourceModule: 'razorpay_webhook',
      });

      return {
        duplicate: false,
        invoiceId: result.invoiceId,
        paymentId: result.paymentId,
        status: 'processed' as const,
      };
    }

    if (payment?.order_id && ['failed', 'cancelled'].includes(payment.status)) {
      const gatewayOrder = await getGatewayOrderForUpdate(connection, payment.order_id);
      await executeResult(
        connection,
        `UPDATE payment_gateway_orders
         SET status_code = ?,
             updated_at = UTC_TIMESTAMP(6)
         WHERE id = ?`,
        [payment.status, Number(gatewayOrder.id)]
      );
      await insertAuditEvent(connection, {
        actionCode: 'payment.gateway_failed',
        actionLabel: 'Online payment failed',
        actorRoleCodeSnapshot: 'system',
        actorUserId: null,
        entityPk: Number(gatewayOrder.id),
        entityTableName: 'payment_gateway_orders',
        sourceModule: 'razorpay_webhook',
        summaryNewValue: payment.status,
      });
    }

    return {
      duplicate: false,
      status: 'received' as const,
    };
  });
};

export const requireInvoicePaymentIdempotencyKey = (request: Parameters<typeof getIdempotencyKey>[0]) =>
  getIdempotencyKey(request);
