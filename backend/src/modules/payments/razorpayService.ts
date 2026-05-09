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
import { providerFetch } from '../../lib/providerHttp.js';
import { domainEventService } from '../domainEvents/service.js';
import { allocateBusinessNumber } from '../platform/sequences.js';

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
  service_request_id: number | null;
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

type ServiceRequestPaymentRow = RowDataPacket & {
  client_account_id: number;
  client_email: string;
  client_name: string;
  client_phone: string | null;
  currency_code: string;
  quote_total_amount: number | string;
  request_id: number;
  request_number: string;
  request_public_id: string;
  status_code: string;
  total_amount: number | string;
};

type ServiceRequestFinalizeRow = RowDataPacket & {
  client_account_id: number;
  detailed_description: string | null;
  domain_name: string;
  issue_summary: string;
  legal_domain_id: number;
  owner_actor_type_code: string | null;
  owner_user_id: number | null;
  past_legal_action_flag: number;
  preferred_end_at: string | Date | null;
  preferred_start_at: string | Date | null;
  requested_by_user_id: number;
  request_number: string;
  request_public_id: string;
  status_code: string;
  title: string;
  urgency_code: string;
  urgency_rule_id: number;
  consultation_mode_code: string;
  quote_total_amount: number | string;
};

type RequestServiceFinalizeRow = RowDataPacket & {
  quoted_base_fee: number | string;
  service_id: number;
};

type ClientPaymentActorRow = RowDataPacket & {
  client_account_id: number;
  user_id: number;
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

export type ServiceRequestPaymentOrderResponse = {
  amount: number;
  amountMinor: number;
  currencyCode: string;
  customer: {
    email: string;
    name: string;
    phone: string | null;
  };
  keyId: string;
  orderId: string;
  provider: 'razorpay';
  receipt: string;
  requestId: string;
  requestNumber: string;
};

export type ServiceRequestPaymentVerifyResponse = {
  matterId: string | null;
  paymentId: string | null;
  requestId: string;
  status: 'authorized' | 'submitted';
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

const getAllowedRazorpayCurrencies = () =>
  new Set(
    String(env.RAZORPAY_ALLOWED_CURRENCIES || 'USD')
      .split(',')
      .map((currencyCode) => currencyCode.trim().toUpperCase())
      .filter(Boolean)
  );

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

  if (!getAllowedRazorpayCurrencies().has('USD')) {
    throw serviceUnavailable(
      'payment_provider_currency_not_enabled',
      'Online payments are configured without USD support. Please contact the billing team.'
    );
  }
};

export const assertRazorpayPaymentProviderReady = assertProviderEnabled;

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

export const createOpaqueRazorpayReceipt = (receiptId = createPublicId()) =>
  `glmg_${receiptId.toLowerCase()}`.slice(0, 40);

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
  const method = options.method || 'GET';
  const response = await providerFetch(`https://api.razorpay.com/v1${path}`, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      Authorization: `Basic ${authorization}`,
      'Content-Type': 'application/json',
    },
    method,
    operation: `razorpay_${method.toLowerCase()}`,
    providerCode: PROVIDER,
    retryDelayMs: 250,
    safeToRetry: method === 'GET',
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

const selectClientPaymentActor = async (
  connection: PoolConnection,
  userPublicId: string,
  clientAccountId?: number
) =>
  selectOne<ClientPaymentActorRow>(
    connection,
    `SELECT
       u.id AS user_id,
       ca.id AS client_account_id
     FROM users u
     INNER JOIN user_roles ur
       ON ur.user_id = u.id
      AND ur.role_code = 'client'
      AND ur.is_active = 1
      AND (ur.starts_at IS NULL OR ur.starts_at <= UTC_TIMESTAMP(6))
      AND (ur.ends_at IS NULL OR ur.ends_at > UTC_TIMESTAMP(6))
     INNER JOIN client_account_contacts cac
       ON cac.user_id = u.id
      ${clientAccountId ? 'AND cac.client_account_id = ?' : ''}
      AND cac.portal_access_enabled = 1
      AND cac.archived_at IS NULL
     INNER JOIN client_accounts ca
       ON ca.id = cac.client_account_id
      AND ca.archived_at IS NULL
     WHERE u.public_id = ?
       AND u.actor_type_code = 'client'
       AND u.login_enabled = 1
       AND u.archived_at IS NULL
     LIMIT 1`,
    clientAccountId ? [clientAccountId, userPublicId] : [userPublicId]
  );

const resolveClientPaymentActor = async (userPublicId: string) => {
  const actor = await withTransaction(getMysqlPool(), async (connection) =>
    selectClientPaymentActor(connection, userPublicId)
  );

  if (!actor) {
    throw unauthorized('auth_required', 'Authentication is required.');
  }

  return {
    clientAccountId: Number(actor.client_account_id),
    userId: Number(actor.user_id),
  };
};

const assertClientPaymentActorAccess = async (
  connection: PoolConnection,
  input: {
    actorUserId: number;
    actorUserPublicId: string;
    clientAccountId: number;
  }
) => {
  const actor = await selectClientPaymentActor(
    connection,
    input.actorUserPublicId,
    input.clientAccountId
  );

  if (
    !actor ||
    Number(actor.user_id) !== input.actorUserId ||
    Number(actor.client_account_id) !== input.clientAccountId
  ) {
    throw unauthorized('auth_required', 'Authentication is required.');
  }

  return {
    clientAccountId: Number(actor.client_account_id),
    userId: Number(actor.user_id),
  };
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
     INNER JOIN client_accounts ca
       ON ca.id = inv.client_account_id
      AND ca.archived_at IS NULL
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
  const currencyCode = (invoice.currencyCode || 'USD').toUpperCase();
  const amountDue = Number(invoice.amountDue || 0);
  const statusCode = String(invoice.statusCode || '').toLowerCase();
  const unpaidInstallments = invoice.installments.filter(
    (installment) => installment.amountRemaining > 0 && installment.statusCode !== 'paid'
  );
  const allowsPartial = unpaidInstallments.length > 1;
  const minimumPaymentAmount = allowsPartial
    ? Number(unpaidInstallments[0]?.amountRemaining || amountDue)
    : amountDue;
  const invoicePayable =
    amountDue > 0 && currencyCode === 'USD' && !['draft', 'paid', 'void', 'cancelled'].includes(statusCode);
  const providerReady =
    env.PAYMENT_PROVIDER_MODE === 'razorpay' &&
    Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET) &&
    getAllowedRazorpayCurrencies().has('USD');
  const onlineEnabled = invoicePayable && providerReady;
  const paymentProvider: 'razorpay' | null = onlineEnabled ? 'razorpay' : null;
  const paymentDisabledReason = (() => {
    if (amountDue <= 0 || statusCode === 'paid') {
      return 'This invoice is fully paid.';
    }

    if (['draft', 'void', 'cancelled'].includes(statusCode)) {
      return 'Online payment is not available for this invoice. Please contact billing support.';
    }

    if (currencyCode !== 'USD') {
      return 'Online payment is available only for USD invoices. Please contact billing support.';
    }

    if (!providerReady) {
      return 'Online payment is not available for this invoice. Please contact billing support.';
    }

    return null;
  })();

  return {
    allowsPartial,
    amountDue,
    currencyCode,
    minimumPaymentAmount,
    offlineEnabled: true,
    onlineEnabled,
    payable: invoicePayable,
    paymentDisabledReason,
    paymentProvider,
    suggestedPaymentAmount: allowsPartial ? minimumPaymentAmount : amountDue,
  };
};

export const createInvoicePaymentOrder = async (
  input: {
    actorUserId: number;
    actorUserPublicId: string;
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
    await assertClientPaymentActorAccess(connection, {
      actorUserId: input.actorUserId,
      actorUserPublicId: input.actorUserPublicId,
      clientAccountId: input.clientAccountId,
    });

    const invoice = await getInvoiceForPayment(connection, input.clientAccountId, input.invoicePublicId);
    if ((invoice.currency_code || 'USD').toUpperCase() !== 'USD') {
      throw conflict(
        'unsupported_invoice_currency',
        'Online invoice payments are available only for USD invoices.'
      );
    }
    const currencyCode = 'USD';
    const { requestedMinor } = await resolvePaymentAmountMinor(connection, invoice, input.amount);
    const amount = fromMinorUnits(requestedMinor, currencyCode);
    const receipt = createOpaqueRazorpayReceipt();

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

const getServiceRequestForPayment = async (
  connection: PoolConnection,
  clientAccountId: number,
  requestPublicId: string
) => {
  const request = await selectOne<ServiceRequestPaymentRow>(
    connection,
    `SELECT
       sr.id AS request_id,
       sr.public_id AS request_public_id,
       sr.request_number,
       sr.client_account_id,
       sr.status_code,
       sr.quote_total_amount,
       sr.currency_code,
       pq.total_amount,
       ca.display_name AS client_name,
       ca.primary_email AS client_email,
       ca.primary_phone AS client_phone
     FROM service_requests sr
     INNER JOIN pricing_quotes pq
       ON pq.service_request_id = sr.id
      AND pq.version_no = 1
     INNER JOIN client_accounts ca
       ON ca.id = sr.client_account_id
      AND ca.archived_at IS NULL
     WHERE sr.public_id = ?
       AND sr.client_account_id = ?
       AND sr.archived_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [requestPublicId, clientAccountId]
  );

  if (!request) {
    throw badRequest('request_not_found', 'Request payment draft not found.');
  }

  if (request.status_code !== 'draft_payment_pending') {
    throw conflict('request_payment_not_pending', 'This request is not awaiting payment.');
  }

  return request;
};

export const createServiceRequestPaymentOrder = async (
  input: {
    actorUserId: number;
    actorUserPublicId: string;
    clientAccountId: number;
    idempotencyKey: string | null;
    requestPublicId: string;
  }
): Promise<ServiceRequestPaymentOrderResponse> => {
  assertProviderEnabled();

  if (!input.idempotencyKey) {
    throw badRequest('idempotency_key_required', 'Idempotency-Key is required to create a payment order.');
  }

  const idempotencyKeyHash = hashValue(`${input.clientAccountId}:${input.idempotencyKey}`);
  const orderInput = await withTransaction(getMysqlPool(), async (connection) => {
    await assertClientPaymentActorAccess(connection, {
      actorUserId: input.actorUserId,
      actorUserPublicId: input.actorUserPublicId,
      clientAccountId: input.clientAccountId,
    });

    const request = await getServiceRequestForPayment(
      connection,
      input.clientAccountId,
      input.requestPublicId
    );
    if ((request.currency_code || 'USD').toUpperCase() !== 'USD') {
      throw conflict(
        'unsupported_request_currency',
        'Online request payments are available only for USD requests.'
      );
    }
    const currencyCode = 'USD';
    const amountMinor = toMinorUnits(request.total_amount, currencyCode);

    if (amountMinor <= 0) {
      throw badRequest('invalid_request_payment_amount', 'Request payment amount must be greater than zero.');
    }

    const existingOrder = await selectOne<GatewayOrderRow & { receipt: string }>(
      connection,
      `SELECT
         id,
         public_id,
         provider_order_id,
         invoice_id,
         service_request_id,
         client_account_id,
         amount,
         amount_minor,
         currency_code,
         status_code,
         receipt
       FROM payment_gateway_orders
       WHERE provider_code = ?
         AND service_request_id = ?
         AND idempotency_key_hash = ?
       ORDER BY id DESC
       LIMIT 1`,
      [PROVIDER, Number(request.request_id), idempotencyKeyHash]
    );

    return {
      amount: fromMinorUnits(amountMinor, currencyCode),
      amountMinor,
      clientAccountId: Number(request.client_account_id),
      currencyCode,
      customer: {
        email: request.client_email,
        name: request.client_name,
        phone: request.client_phone,
      },
      existingOrder,
      requestDbId: Number(request.request_id),
      requestId: request.request_public_id,
      requestNumber: request.request_number,
      receipt: createOpaqueRazorpayReceipt(),
    };
  });

  if (orderInput.existingOrder) {
    return {
      amount: Number(orderInput.existingOrder.amount),
      amountMinor: Number(orderInput.existingOrder.amount_minor),
      currencyCode: orderInput.existingOrder.currency_code,
      customer: orderInput.customer,
      keyId: env.RAZORPAY_KEY_ID || '',
      orderId: orderInput.existingOrder.provider_order_id,
      provider: PROVIDER,
      receipt: orderInput.existingOrder.receipt,
      requestId: orderInput.requestId,
      requestNumber: orderInput.requestNumber,
    };
  }

  const providerOrder = await razorpayRequest<RazorpayOrder>('/orders', {
    body: {
      amount: orderInput.amountMinor,
      currency: orderInput.currencyCode,
      notes: {
        client_account_id: String(orderInput.clientAccountId),
        request_number: orderInput.requestNumber,
        service_request_id: orderInput.requestId,
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
       ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
      [
        createPublicId(),
        PROVIDER,
        providerOrder.id,
        orderInput.requestDbId,
        orderInput.clientAccountId,
        orderInput.amount.toFixed(2),
        orderInput.amountMinor,
        orderInput.currencyCode,
        providerOrder.status || 'created',
        orderInput.receipt,
        idempotencyKeyHash,
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
      sourceModule: 'client_request',
      summaryNewValue: `${providerOrder.id} for request ${orderInput.requestNumber}`,
    });

    return {
      amount: orderInput.amount,
      amountMinor: orderInput.amountMinor,
      currencyCode: orderInput.currencyCode,
      customer: orderInput.customer,
      keyId: env.RAZORPAY_KEY_ID || '',
      orderId: providerOrder.id,
      provider: PROVIDER,
      receipt: orderInput.receipt,
      requestId: orderInput.requestId,
      requestNumber: orderInput.requestNumber,
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
       service_request_id,
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

const finalizePaidServiceRequest = async (
  connection: PoolConnection,
  input: {
    actorUserId: number | null;
    serviceRequestId: number;
  }
) => {
  const existingMatter = await selectOne<RowDataPacket & {
    matter_id: number;
    matter_number: string;
    matter_public_id: string;
    thread_id: number | null;
  }>(
    connection,
    `SELECT
       m.id AS matter_id,
       m.public_id AS matter_public_id,
       m.matter_number,
       ct.id AS thread_id
     FROM matters m
     LEFT JOIN conversation_threads ct
       ON ct.matter_id = m.id
      AND ct.archived_at IS NULL
     WHERE m.service_request_id = ?
       AND m.archived_at IS NULL
     ORDER BY m.id ASC
     LIMIT 1
     FOR UPDATE`,
    [input.serviceRequestId]
  );

  if (existingMatter) {
    await executeResult(
      connection,
      `UPDATE pricing_quotes
       SET is_final = 1,
           accepted_at = COALESCE(accepted_at, UTC_TIMESTAMP(6))
       WHERE service_request_id = ?
         AND version_no = 1`,
      [input.serviceRequestId]
    );
    await executeResult(
      connection,
      `UPDATE service_requests
       SET status_code = CASE WHEN status_code = 'draft_payment_pending' THEN 'submitted' ELSE status_code END,
           submitted_at = COALESCE(submitted_at, UTC_TIMESTAMP(6)),
           updated_at = UTC_TIMESTAMP(6),
           row_version = row_version + 1
       WHERE id = ?`,
      [input.serviceRequestId]
    );

    return {
      matterDbId: Number(existingMatter.matter_id),
      matterId: existingMatter.matter_public_id,
      matterNumber: existingMatter.matter_number,
      threadDbId: existingMatter.thread_id ? Number(existingMatter.thread_id) : null,
    };
  }

  const request = await selectOne<ServiceRequestFinalizeRow>(
    connection,
    `SELECT
       sr.public_id AS request_public_id,
       sr.request_number,
       sr.client_account_id,
       sr.requested_by_user_id,
       sr.status_code,
       sr.title,
       sr.issue_summary,
       sr.detailed_description,
       sr.legal_domain_id,
       sr.consultation_mode_code,
       sr.urgency_rule_id,
       sr.preferred_start_at,
       sr.preferred_end_at,
       sr.past_legal_action_flag,
       sr.quote_total_amount,
       ld.domain_name,
       pur.urgency_code,
       ca.owner_user_id,
       owner.actor_type_code AS owner_actor_type_code
     FROM service_requests sr
     INNER JOIN legal_domains ld ON ld.id = sr.legal_domain_id
     INNER JOIN pricing_urgency_rules pur ON pur.id = sr.urgency_rule_id
     INNER JOIN client_accounts ca ON ca.id = sr.client_account_id
     LEFT JOIN users owner ON owner.id = ca.owner_user_id
     WHERE sr.id = ?
       AND sr.archived_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [input.serviceRequestId]
  );

  if (!request) {
    throw badRequest('request_not_found', 'Request payment draft not found.');
  }

  if (request.status_code !== 'draft_payment_pending') {
    throw conflict('request_payment_not_pending', 'This request is not awaiting payment finalization.');
  }

  const createdAt = toMysqlDateTime(nowUtc());
  const matterNumber = await allocateBusinessNumber(connection, 'matter', 'GLMG');
  const threadNumber = await allocateBusinessNumber(connection, 'thread', 'THR');
  const matterPublicId = createPublicId();
  const threadPublicId = createPublicId();
  const requestedByUserId = Number(request.requested_by_user_id);
  const rawOwnerUserId = request.owner_user_id ? Number(request.owner_user_id) : null;
  const internalOwnerUserId =
    rawOwnerUserId && request.owner_actor_type_code !== 'client' ? rawOwnerUserId : null;
  const ownerUserId = internalOwnerUserId || requestedByUserId;
  const quotedAmount = Number(request.quote_total_amount || 0);

  await executeResult(
    connection,
    `UPDATE service_requests
     SET status_code = 'submitted',
         submitted_at = COALESCE(submitted_at, ?),
         updated_at = ?,
         row_version = row_version + 1
     WHERE id = ?`,
    [createdAt, createdAt, input.serviceRequestId]
  );

  await executeResult(
    connection,
    `INSERT INTO request_status_history (
       service_request_id,
       from_status_code,
       to_status_code,
       changed_by_user_id,
       change_note,
       changed_at
     ) VALUES (?, 'draft_payment_pending', 'submitted', ?, ?, ?)`,
    [
      input.serviceRequestId,
      input.actorUserId || requestedByUserId,
      'Request submitted after online payment confirmation.',
      createdAt,
    ]
  );

  await executeResult(
    connection,
    `UPDATE pricing_quotes
     SET is_final = 1,
         accepted_at = COALESCE(accepted_at, ?)
     WHERE service_request_id = ?
       AND version_no = 1`,
    [createdAt, input.serviceRequestId]
  );

  const [matterInsert] = await connection.execute(
    `INSERT INTO matters (
       public_id, matter_number, service_request_id, client_account_id, opened_by_user_id, legal_domain_id,
       title, issue_summary, detailed_description, current_stage_code, operational_status_code,
       consultation_mode_code, urgency_rule_id, priority_code, quoted_total_amount, paid_total_amount,
       refunded_total_amount, due_total_amount, opened_at, last_activity_at, closed_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      matterPublicId,
      matterNumber,
      input.serviceRequestId,
      Number(request.client_account_id),
      requestedByUserId,
      Number(request.legal_domain_id),
      request.title,
      request.issue_summary,
      request.detailed_description || '',
      'request-received',
      'paid',
      request.consultation_mode_code,
      Number(request.urgency_rule_id),
      request.urgency_code === 'standard' ? 'in-progress' : 'immediate-6h',
      quotedAmount,
      quotedAmount,
      0,
      0,
      createdAt,
      createdAt,
      null,
      createdAt,
      createdAt,
    ]
  );
  const matterId = Number((matterInsert as { insertId: number }).insertId);

  const services = await selectAll<RequestServiceFinalizeRow>(
    connection,
    `SELECT service_id, quoted_base_fee
     FROM request_services
     WHERE service_request_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [input.serviceRequestId]
  );

  for (const service of services) {
    await executeResult(
      connection,
      `INSERT INTO matter_services (
         matter_id, service_id, final_fee, service_status_code, completed_at, created_at
       ) VALUES (?, ?, ?, 'selected', NULL, ?)`,
      [matterId, Number(service.service_id), Number(service.quoted_base_fee || 0), createdAt]
    );
  }

  await executeResult(
    connection,
    `INSERT INTO matter_stage_history (
       matter_id, stage_code, entered_at, exited_at, changed_by_user_id, visible_to_client, change_note
     ) VALUES (?, 'request-received', ?, NULL, ?, 1, 'Matter created from paid client request.')`,
    [matterId, createdAt, requestedByUserId]
  );

  await executeResult(
    connection,
    `INSERT INTO matter_updates (
       matter_id, update_type_code, title, body_text, visible_to_client, created_by_user_id, created_at
     ) VALUES (?, 'note', 'Request Submitted', ?, 1, ?, ?)`,
    [
      matterId,
      'Your request has been submitted. Our intake team is reviewing the details.',
      ownerUserId,
      createdAt,
    ]
  );

  await executeResult(
    connection,
    `INSERT INTO matter_updates (
       matter_id, update_type_code, title, body_text, visible_to_client, created_by_user_id, created_at
     ) VALUES (?, 'note', 'Internal Intake Note', ?, 0, ?, ?)`,
    [
      matterId,
      Number(request.past_legal_action_flag) === 1
        ? 'Client reported prior legal action in the intake flow.'
        : 'Client reported no prior legal action.',
      ownerUserId,
      createdAt,
    ]
  );

  await executeResult(
    connection,
    `INSERT INTO matter_assignments (
       matter_id, assignment_role_code, internal_user_id, counsel_partner_id, is_primary,
       fee_agreed_amount, fee_paid_amount, fee_due_amount, assigned_by_user_id, assigned_at,
       removed_at, assignment_status_code, notes
     ) VALUES (?, 'case_manager', ?, NULL, 1, NULL, NULL, NULL, ?, ?, NULL, 'active', 'Auto-assigned account owner for intake.')`,
    [matterId, ownerUserId, ownerUserId, createdAt]
  );

  const [threadInsert] = await connection.execute(
    `INSERT INTO conversation_threads (
       public_id, thread_number, thread_type_code, client_account_id, matter_id, subject, status_code,
       created_by_user_id, assigned_owner_user_id, last_message_at, created_at, updated_at
     ) VALUES (?, ?, 'matter', ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    [
      threadPublicId,
      threadNumber,
      Number(request.client_account_id),
      matterId,
      request.title,
      requestedByUserId,
      internalOwnerUserId,
      createdAt,
      createdAt,
      createdAt,
    ]
  );
  const threadId = Number((threadInsert as { insertId: number }).insertId);

  await executeResult(
    connection,
    `INSERT INTO thread_participants (
       thread_id, participant_role_code, internal_user_id, client_contact_user_id, counsel_partner_id,
       is_active, joined_at, left_at, last_read_message_id, last_read_at
     ) VALUES (?, 'client', NULL, ?, NULL, 1, ?, NULL, NULL, NULL)`,
    [threadId, requestedByUserId, createdAt]
  );

  if (internalOwnerUserId) {
    await executeResult(
      connection,
      `INSERT INTO thread_participants (
         thread_id, participant_role_code, internal_user_id, client_contact_user_id, counsel_partner_id,
         is_active, joined_at, left_at, last_read_message_id, last_read_at
       ) VALUES (?, 'staff', ?, NULL, NULL, 1, ?, NULL, NULL, NULL)`,
      [threadId, internalOwnerUserId, createdAt]
    );
  }

  const systemMessage = await connection.execute(
    `INSERT INTO messages (
       public_id, thread_id, sender_user_id, sender_counsel_partner_id, sender_system_code,
       message_type_code, body_text, visible_to_client, reply_to_message_id, sent_at, edited_at, deleted_at
     ) VALUES (?, ?, NULL, NULL, 'system', 'system', ?, 1, NULL, ?, NULL, NULL)`,
    [createPublicId(), threadId, `New request created: ${request.title}`, createdAt]
  );
  const systemMessageId = Number((systemMessage[0] as { insertId: number }).insertId);
  await executeResult(
    connection,
    `INSERT INTO message_reads (message_id, user_id, read_at) VALUES (?, ?, ?)`,
    [systemMessageId, requestedByUserId, createdAt]
  );

  await executeResult(
    connection,
    `INSERT INTO messages (
       public_id, thread_id, sender_user_id, sender_counsel_partner_id, sender_system_code,
       message_type_code, body_text, visible_to_client, reply_to_message_id, sent_at, edited_at, deleted_at
     ) VALUES (?, ?, ?, NULL, ?, 'text', ?, 1, NULL, ?, NULL, NULL)`,
    [
      createPublicId(),
      threadId,
      internalOwnerUserId,
      internalOwnerUserId ? null : 'global_lmg',
      'We have received your request. A case manager will confirm the next step shortly.',
      createdAt,
    ]
  );

  if (request.preferred_start_at && request.preferred_end_at) {
    await executeResult(
      connection,
      `INSERT INTO events (
         public_id, client_account_id, matter_id, title, event_type_code, status_code,
         scheduled_start_at, scheduled_end_at, timezone_name, mode_code, location_text,
         meeting_provider_code, external_meeting_id, join_url, host_url, client_visible_flag,
         notes, created_by_user_id, cancelled_by_user_id, created_at, updated_at, cancelled_at
       ) VALUES (?, ?, ?, ?, 'consultation', 'upcoming', ?, ?, 'UTC', ?, ?, ?, NULL, NULL, NULL, 1, ?, ?, NULL, ?, ?, NULL)`,
      [
        createPublicId(),
        Number(request.client_account_id),
        matterId,
        `${request.domain_name} Intake Consultation`,
        request.preferred_start_at,
        request.preferred_end_at,
        request.consultation_mode_code,
        request.consultation_mode_code === 'in-person' ? 'Global LMG office visit to be confirmed' : null,
        request.consultation_mode_code === 'video' ? 'google-meet' : request.consultation_mode_code,
        'Preferred consultation slot requested from dashboard intake.',
        ownerUserId,
        createdAt,
        createdAt,
      ]
    );
  }

  await executeResult(
    connection,
    `INSERT INTO matter_documents (matter_id, document_id, link_role_code, created_at)
     SELECT ?, rd.document_id, 'client', ?
     FROM request_documents rd
     WHERE rd.service_request_id = ?`,
    [matterId, createdAt, input.serviceRequestId]
  );

  await executeResult(
    connection,
    `UPDATE document_upload_intents
     SET matter_public_id = ?
     WHERE request_public_id = ?
       AND (matter_public_id IS NULL OR matter_public_id = ?)`,
    [matterPublicId, request.request_public_id, matterPublicId]
  );

  await domainEventService.publishRequestSubmitted(connection, {
    actorUserId: requestedByUserId,
    clientAccountId: Number(request.client_account_id),
    matterId,
    matterNumber,
    threadId,
    title: request.title,
  });

  return {
    matterDbId: matterId,
    matterId: matterPublicId,
    matterNumber,
    threadDbId: threadId,
  };
};

const updateServiceRequestAfterCapturedPayment = async (
  connection: PoolConnection,
  input: {
    actorUserId: number | null;
    amountMinor: number;
    currencyCode: string;
    gatewayOrderDbId: number;
    providerOrderId: string;
    providerPaymentId: string;
    serviceRequestDbId: number;
    sourceModule: string;
  }
): Promise<ServiceRequestPaymentVerifyResponse> => {
  const request = await selectOne<RowDataPacket & {
    client_account_id: number;
    currency_code: string;
    public_id: string;
    quote_total_amount: number | string;
    status_code: string;
  }>(
    connection,
    `SELECT public_id, client_account_id, status_code, quote_total_amount, currency_code
     FROM service_requests
     WHERE id = ?
       AND archived_at IS NULL
     LIMIT 1
     FOR UPDATE`,
    [input.serviceRequestDbId]
  );

  if (!request) {
    throw badRequest('request_not_found', 'Request payment draft not found.');
  }

  const requestCurrency = (request.currency_code || 'USD').toUpperCase();
  if (requestCurrency !== input.currencyCode.toUpperCase()) {
    throw badRequest('payment_currency_mismatch', 'Payment currency does not match the request.');
  }

  const expectedAmountMinor = toMinorUnits(request.quote_total_amount, requestCurrency);
  if (input.amountMinor !== expectedAmountMinor) {
    throw badRequest('payment_amount_mismatch', 'Payment amount does not match the request quote.');
  }

  const existingPayment = await getExistingPayment(connection, input.providerPaymentId);
  const paymentPublicId = existingPayment?.public_id || createPublicId();
  const capturedAt = toMysqlDateTime(nowUtc());
  const amountDecimal = formatAmount(input.amountMinor, requestCurrency);
  let paymentTransactionId = existingPayment?.id || 0;

  if (existingPayment?.status_code === 'captured') {
    const finalized = await finalizePaidServiceRequest(connection, {
      actorUserId: input.actorUserId,
      serviceRequestId: input.serviceRequestDbId,
    });

    return {
      matterId: finalized.matterId,
      paymentId: existingPayment.public_id,
      requestId: request.public_id,
      status: 'submitted',
    };
  }

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
        requestCurrency,
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
        Number(request.client_account_id),
        input.gatewayOrderDbId,
        PROVIDER,
        input.providerOrderId,
        input.providerPaymentId,
        requestCurrency,
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
    summaryNewValue: `${requestCurrency} ${amountDecimal} captured for request ${request.public_id}`,
  });

  const finalized = await finalizePaidServiceRequest(connection, {
    actorUserId: input.actorUserId,
    serviceRequestId: input.serviceRequestDbId,
  });

  return {
    matterId: finalized.matterId,
    paymentId: paymentPublicId,
    requestId: request.public_id,
    status: 'submitted',
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
    throw badRequest('payment_verification_mismatch', 'Payment details do not match the payment order.');
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
    actorUserPublicId: string;
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
    await assertClientPaymentActorAccess(connection, {
      actorUserId: input.actorUserId,
      actorUserPublicId: input.actorUserPublicId,
      clientAccountId: input.clientAccountId,
    });

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
         AND archived_at IS NULL
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

export const verifyServiceRequestPayment = async (
  input: {
    actorUserPublicId: string;
    requestPublicId: string;
    razorpayOrderId: string;
    razorpayPaymentId: string;
    razorpaySignature: string;
  }
): Promise<ServiceRequestPaymentVerifyResponse> => {
  assertProviderEnabled();
  const actor = await resolveClientPaymentActor(input.actorUserPublicId);

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
        actorUserId: actor.userId,
        entityPk: null,
        entityTableName: 'payment_transactions',
        sourceModule: 'client_request',
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
    if (
      !gatewayOrder.service_request_id ||
      gatewayOrder.invoice_id
    ) {
      throw badRequest('payment_order_not_found', 'Payment order not found.');
    }

    const actorAccess = await assertClientPaymentActorAccess(connection, {
      actorUserId: actor.userId,
      actorUserPublicId: input.actorUserPublicId,
      clientAccountId: Number(gatewayOrder.client_account_id),
    });

    const request = await selectOne<RowDataPacket & { public_id: string }>(
      connection,
      `SELECT public_id
       FROM service_requests
       WHERE id = ?
         AND client_account_id = ?
         AND archived_at IS NULL
       LIMIT 1`,
      [gatewayOrder.service_request_id, actorAccess.clientAccountId]
    );

    if (!request || request.public_id !== input.requestPublicId) {
      throw badRequest('payment_order_request_mismatch', 'Payment order does not match this request.');
    }

    verifyPaymentAmounts(gatewayOrder, providerOrder, payment);

    if (payment.status === 'captured' || payment.captured === true) {
      return updateServiceRequestAfterCapturedPayment(connection, {
        actorUserId: actor.userId,
        amountMinor: payment.amount,
        currencyCode: payment.currency.toUpperCase(),
        gatewayOrderDbId: Number(gatewayOrder.id),
        providerOrderId: input.razorpayOrderId,
        providerPaymentId: input.razorpayPaymentId,
        serviceRequestDbId: Number(gatewayOrder.service_request_id),
        sourceModule: 'client_request',
      });
    }

    if (payment.status === 'authorized') {
      const authorized = await recordAuthorizedPayment(connection, {
        actorUserId: actor.userId,
        amountMinor: payment.amount,
        currencyCode: payment.currency.toUpperCase(),
        gatewayOrderDbId: Number(gatewayOrder.id),
        providerOrderId: input.razorpayOrderId,
        providerPaymentId: input.razorpayPaymentId,
        sourceModule: 'client_request',
      });

      return {
        matterId: null,
        paymentId: authorized.paymentId,
        requestId: input.requestPublicId,
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
      actorUserId: actor.userId,
      entityPk: Number(gatewayOrder.id),
      entityTableName: 'payment_gateway_orders',
      sourceModule: 'client_request',
      summaryNewValue: payment.status,
    });

    throw badRequest('payment_not_captured', 'Payment was not captured. Please try again.');
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

      if (gatewayOrder.service_request_id && !gatewayOrder.invoice_id) {
        const result = await updateServiceRequestAfterCapturedPayment(connection, {
          actorUserId: null,
          amountMinor: payment.amount,
          currencyCode: payment.currency.toUpperCase(),
          gatewayOrderDbId: Number(gatewayOrder.id),
          providerOrderId: payment.order_id,
          providerPaymentId: payment.id,
          serviceRequestDbId: Number(gatewayOrder.service_request_id),
          sourceModule: 'razorpay_webhook',
        });

        return {
          duplicate: false,
          paymentId: result.paymentId,
          requestId: result.requestId,
          status: 'processed' as const,
        };
      }

      if (!gatewayOrder.invoice_id) {
        throw conflict('webhook_payment_order_unscoped', 'Webhook payment order is not linked to an invoice or request.');
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
