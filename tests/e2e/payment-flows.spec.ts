import { expect, request, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test';

const adminApiBase = process.env.E2E_ADMIN_API_BASE || 'http://127.0.0.1:3005/api/v1/admin';
const clientApiBase = process.env.E2E_CLIENT_API_BASE || 'http://127.0.0.1:3001/api/v1';
const clientWebBase = process.env.E2E_CLIENT_WEB_BASE || 'http://127.0.0.1:5173';
const runLiveE2e = process.env.E2E_RUN_LIVE === 'true';
const runMutations = process.env.E2E_RUN_MUTATIONS === 'true';

const adminEmail = process.env.E2E_ADMIN_EMAIL || process.env.BETA_SMOKE_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.BETA_SMOKE_ADMIN_PASSWORD;
const clientEmail = process.env.E2E_CLIENT_EMAIL || process.env.BETA_SMOKE_CLIENT_EMAIL;
const clientPassword = process.env.E2E_CLIENT_PASSWORD || process.env.BETA_SMOKE_CLIENT_PASSWORD;

const razorpayKeyId = process.env.RAZORPAY_KEY_ID || '';
const razorpayTestModeReady =
  process.env.PAYMENT_PROVIDER_MODE === 'razorpay' &&
  razorpayKeyId.startsWith('rzp_test_') &&
  Boolean(process.env.RAZORPAY_KEY_SECRET) &&
  Boolean(process.env.RAZORPAY_WEBHOOK_SECRET) &&
  String(process.env.RAZORPAY_ALLOWED_CURRENCIES || '')
    .split(',')
    .map((entry) => entry.trim().toUpperCase())
    .includes('USD');

type JsonResponse = Record<string, unknown>;
type CookieJar = Map<string, string>;
type RequestPricingConfig = {
  consultationModes: Array<{ id: string }>;
  legalDomains: Array<{ id: string }>;
  services: Array<{ id: string }>;
  urgencyOptions: Array<{ allowedConsultationModes?: string[]; id: string }>;
};
type ClientInvoice = {
  amountDue: number;
  currencyCode: string;
  id: string;
  paymentOptions?: {
    onlineEnabled: boolean;
    payable: boolean;
    paymentDisabledReason: string | null;
    paymentProvider: 'razorpay' | null;
  };
  status: string;
  totalAmount: number;
};
type DashboardSnapshot = {
  currentClient?: { email?: string; id: string };
  invoices: ClientInvoice[];
  matters: Array<{ id: string; title: string }>;
  packages: Array<{ id: string; matterId: string; proposalVersion: number; proposalStatus: string }>;
};
type InvoiceDetail = {
  amountDue: number;
  currencyCode: string;
  id: string;
  paymentOptions: {
    onlineEnabled: boolean;
    payable: boolean;
    paymentDisabledReason: string | null;
    paymentProvider: 'razorpay' | null;
  };
  statusCode: string;
};

const json = async <T = JsonResponse>(response: APIResponse) => (await response.json()) as T;
const apiBase = (value: string) => (value.endsWith('/') ? value : `${value}/`);
const apiPath = (value: string) => value.replace(/^\/+/, '');

const splitSetCookie = (header?: string) => {
  if (!header) {
    return [];
  }

  return header.split(/,(?=\s*[^;,\s]+=)/g).map((entry) => entry.trim());
};

const setCookiesFromResponse = (jar: CookieJar, response: APIResponse) => {
  const setCookieHeaders = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    .flatMap((header) => splitSetCookie(header.value));

  for (const header of setCookieHeaders) {
    const firstPart = header.split(';')[0];
    const index = firstPart.indexOf('=');

    if (index <= 0) {
      continue;
    }

    const name = firstPart.slice(0, index).trim();
    const value = firstPart.slice(index + 1).trim();

    if (!value || /max-age=0/i.test(header)) {
      jar.delete(name);
    } else {
      jar.set(name, value);
    }
  }
};

const cookieHeader = (jar: CookieJar) =>
  Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');

const expectStatus = async (response: APIResponse, statuses: number[]) => {
  if (!statuses.includes(response.status())) {
    throw new Error(`${response.url()} returned ${response.status()}: ${await response.text()}`);
  }
};

const adminCsrf = (jar: CookieJar) => jar.get('global_lmg_admin_csrf') || '';
const clientCsrf = (jar: CookieJar) => jar.get('global_lmg_csrf') || '';

const login = async (
  context: APIRequestContext,
  jar: CookieJar,
  input: { csrfCookieName: 'global_lmg_admin_csrf' | 'global_lmg_csrf'; identifier: string; password: string }
) => {
  const sessionResponse = await context.get(apiPath('/auth/session'), {
    headers: { cookie: cookieHeader(jar) },
  });
  setCookiesFromResponse(jar, sessionResponse);
  await expectStatus(sessionResponse, [200]);

  const csrfToken =
    input.csrfCookieName === 'global_lmg_admin_csrf' ? adminCsrf(jar) : clientCsrf(jar);
  const response = await context.post(apiPath('/auth/sign-in'), {
    data: { identifier: input.identifier, password: input.password, rememberMe: false },
    headers: { cookie: cookieHeader(jar), 'x-csrf-token': csrfToken },
  });
  setCookiesFromResponse(jar, response);
  await expectStatus(response, [200]);
};

const pickUrgencyForMode = (config: RequestPricingConfig, mode?: string) =>
  config.urgencyOptions.find((option) => !option.allowedConsultationModes || option.allowedConsultationModes.includes(mode || '')) ??
  config.urgencyOptions[0];

const addSessionCookiesToPage = async (page: Page, jar: CookieJar, webBase: string) => {
  await page.context().addCookies(
    Array.from(jar.entries()).map(([name, value]) => ({
      name,
      url: new URL(webBase).origin,
      value,
    }))
  );
};

const expectNoPageOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);
};

test.describe.configure({ mode: 'serial' });

test.describe('Global LMG payment flow regression', () => {
  test.skip(
    !runLiveE2e,
    'Set E2E_RUN_LIVE=true with disposable E2E_* credentials and running local/staging servers.'
  );
  test.skip(!runMutations, 'Set E2E_RUN_MUTATIONS=true to create disposable payment-flow fixtures.');
  test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.');
  test.skip(!clientEmail || !clientPassword, 'Set E2E_CLIENT_EMAIL and E2E_CLIENT_PASSWORD.');

  let adminApi: APIRequestContext;
  let clientApi: APIRequestContext;
  const adminJar: CookieJar = new Map();
  const clientJar: CookieJar = new Map();
  let clientAccountId = '';
  let matterId = '';
  let matterTitle = '';
  let issuedInvoiceId = '';

  const getRequestConfig = async () =>
    json<RequestPricingConfig>(await clientApi.get(apiPath('/dashboard/request-config')));

  const getClientSnapshot = async () =>
    json<DashboardSnapshot>(
      await clientApi.get(apiPath('/dashboard'), { headers: { cookie: cookieHeader(clientJar) } })
    );

  const getClientInvoiceDetail = async (invoiceId: string) =>
    json<InvoiceDetail>(
      await clientApi.get(apiPath(`/me/invoices/${invoiceId}`), {
        headers: { cookie: cookieHeader(clientJar) },
      })
    );

  const resolveClientAccountId = async () => {
    const response = await adminApi.get(apiPath(`/clients?limit=10&search=${encodeURIComponent(clientEmail || '')}`), {
      headers: { cookie: cookieHeader(adminJar) },
    });
    await expectStatus(response, [200]);
    const body = await json<{ clients?: Array<{ email?: string; id?: string }> }>(response);
    return (
      body.clients?.find((client) => client.email?.toLowerCase() === clientEmail?.toLowerCase())?.id ||
      ''
    );
  };

  const createMatterForClient = async (title: string) => {
    const config = await getRequestConfig();
    const mode = config.consultationModes[0]?.id;
    const service = config.services[0]?.id;
    const legalDomain = config.legalDomains[0]?.id;
    const urgency = pickUrgencyForMode(config, mode);

    test.skip(!mode || !service || !legalDomain || !urgency, 'Request pricing config has no active options.');

    const suffix = Date.now();
    const response = await adminApi.post(apiPath('/matters'), {
      data: {
        clientAccountPublicId: clientAccountId,
        clientVisible: true,
        consultationModeCode: mode,
        legalDomainCode: legalDomain,
        priorityCode: 'in-progress',
        serviceCodes: [service],
        summary: 'Disposable payment-flow regression matter.',
        title,
        urgencyCode: urgency.id,
      },
      headers: {
        'Idempotency-Key': `e2e-payment-matter-${suffix}`,
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(response, [201, 200]);
    const body = await json<{ id?: string; matter?: { id?: string } }>(response);
    const id = body.matter?.id || body.id || '';
    expect(id).toBeTruthy();
    return id;
  };

  const createIssuedInvoice = async (input: { amount: number; matterId: string }) => {
    const suffix = Date.now();
    const createResponse = await adminApi.post(apiPath('/billing/invoices'), {
      data: {
        amount: input.amount,
        description: `Disposable E2E USD invoice ${suffix}`,
        matterId: input.matterId,
      },
      headers: {
        'Idempotency-Key': `e2e-payment-invoice-${suffix}`,
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(createResponse, [201, 200]);
    const invoice = await json<{ id?: string; invoice?: { id?: string }; invoiceId?: string }>(createResponse);
    const invoiceId = invoice.invoice?.id || invoice.invoiceId || invoice.id || '';
    expect(invoiceId).toBeTruthy();

    const sendResponse = await adminApi.post(apiPath(`/billing/invoices/${invoiceId}/send`), {
      data: {},
      headers: {
        'Idempotency-Key': `e2e-payment-invoice-send-${suffix}`,
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(sendResponse, [200, 201]);
    return invoiceId;
  };

  test.beforeAll(async () => {
    adminApi = await request.newContext({ baseURL: apiBase(adminApiBase) });
    clientApi = await request.newContext({ baseURL: apiBase(clientApiBase) });

    await login(adminApi, adminJar, {
      csrfCookieName: 'global_lmg_admin_csrf',
      identifier: adminEmail!,
      password: adminPassword!,
    });
    await login(clientApi, clientJar, {
      csrfCookieName: 'global_lmg_csrf',
      identifier: clientEmail!,
      password: clientPassword!,
    });

    clientAccountId = await resolveClientAccountId();
    if (!clientAccountId) {
      throw new Error('E2E client fixture was not found in the admin client directory.');
    }
  });

  test.afterAll(async () => {
    await adminApi?.dispose();
    await clientApi?.dispose();
  });

  test('admin-created matter appears in the client dashboard and stays responsive', async ({ page }) => {
    matterTitle = `E2E Payment Matter ${Date.now()}`;
    matterId = await createMatterForClient(matterTitle);

    const snapshot = await getClientSnapshot();
    expect(snapshot.matters.some((matter) => matter.id === matterId || matter.title === matterTitle)).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await addSessionCookiesToPage(page, clientJar, clientWebBase);
    await page.goto(`${clientWebBase}/dashboard?panel=cases`);
    await expect(page.getByText(matterTitle).first()).toBeVisible();
    await expectNoPageOverflow(page);
    await page.getByText(matterTitle).first().click();
    await expect(page.getByRole('button', { name: /chat/i })).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test('issued USD invoice appears client-side with Pay Online and creates a Razorpay test order', async ({ page }) => {
    test.skip(!razorpayTestModeReady, 'Set Razorpay test-mode env with rzp_test_ key and USD allowed.');
    test.skip(!matterId, 'Disposable client-owned matter was not created.');

    issuedInvoiceId = await createIssuedInvoice({ amount: 120, matterId });
    const detail = await getClientInvoiceDetail(issuedInvoiceId);

    expect(detail.currencyCode).toBe('USD');
    expect(detail.amountDue).toBeGreaterThan(0);
    expect(detail.paymentOptions).toMatchObject({
      onlineEnabled: true,
      payable: true,
      paymentDisabledReason: null,
      paymentProvider: 'razorpay',
    });

    await page.setViewportSize({ width: 390, height: 844 });
    await addSessionCookiesToPage(page, clientJar, clientWebBase);
    await page.goto(`${clientWebBase}/dashboard?panel=billing&invoice=${issuedInvoiceId}`);
    await expect(page.getByRole('button', { name: /pay online/i })).toBeVisible();
    await expect(page.getByText(/secure online payment/i)).toBeVisible();
    await expectNoPageOverflow(page);

    const idempotencyKey = `e2e-invoice-order-${issuedInvoiceId}-${Date.now()}`;
    const orderResponse = await clientApi.post(apiPath(`/me/invoices/${issuedInvoiceId}/payment-order`), {
      data: {},
      headers: {
        'Idempotency-Key': idempotencyKey,
        cookie: cookieHeader(clientJar),
        'x-csrf-token': clientCsrf(clientJar),
      },
    });
    await expectStatus(orderResponse, [200, 201]);
    const order = await json<{ amount: number; amountMinor: number; currencyCode: string; keyId: string; orderId: string }>(
      orderResponse
    );
    expect(order.currencyCode).toBe('USD');
    expect(order.amount).toBe(detail.amountDue);
    expect(order.amountMinor).toBeGreaterThan(0);
    expect(order.keyId).toBe(razorpayKeyId);
    expect(order.orderId).toBeTruthy();

    const replayResponse = await clientApi.post(apiPath(`/me/invoices/${issuedInvoiceId}/payment-order`), {
      data: {},
      headers: {
        'Idempotency-Key': idempotencyKey,
        cookie: cookieHeader(clientJar),
        'x-csrf-token': clientCsrf(clientJar),
      },
    });
    await expectStatus(replayResponse, [200, 201]);
    const replayOrder = await json<{ orderId: string }>(replayResponse);
    expect(replayOrder.orderId).toBe(order.orderId);
  });

  test('package selection creates a client-visible USD invoice', async () => {
    test.skip(!matterId, 'Disposable client-owned matter was not created.');

    const proposalVersion = 1;
    const draft = await adminApi.put(apiPath(`/matters/${matterId}/package-proposals/draft`), {
      data: {
        packages: [
          {
            description: 'Disposable package for payment-flow regression.',
            displayOrder: 0,
            featurePoints: ['Disposable E2E package feature'],
            isRecommended: true,
            name: `E2E Payment Package ${Date.now()}`,
            price: 150,
          },
        ],
        proposalVersion,
      },
      headers: {
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(draft, [200]);

    const publish = await adminApi.post(apiPath(`/matters/${matterId}/package-proposals/publish`), {
      data: { note: 'Disposable package proposal for E2E.', proposalVersion },
      headers: {
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(publish, [200]);
    const published = await json<{
      active?: { packages?: Array<{ id: string; proposalVersion: number }> };
    }>(publish);
    const packageId = published.active?.packages?.[0]?.id || '';
    expect(packageId).toBeTruthy();

    const selection = await clientApi.post(apiPath(`/dashboard/matters/${matterId}/package-selection`), {
      data: { matterPackageId: packageId, proposalVersion },
      headers: {
        cookie: cookieHeader(clientJar),
        'x-csrf-token': clientCsrf(clientJar),
      },
    });
    await expectStatus(selection, [200]);
    const selectionBody = await json<{ generatedInvoiceId?: string }>(selection);
    expect(selectionBody.generatedInvoiceId).toBeTruthy();

    const invoice = await getClientInvoiceDetail(selectionBody.generatedInvoiceId!);
    expect(invoice.currencyCode).toBe('USD');
    expect(invoice.amountDue).toBeGreaterThan(0);

    const adminBilling = await adminApi.get(apiPath('/billing/workspace'), {
      headers: { cookie: cookieHeader(adminJar) },
    });
    await expectStatus(adminBilling, [200]);
    expect(await adminBilling.text()).toContain(selectionBody.generatedInvoiceId!);
  });

  test('New Request Pay & Submit creates a USD draft payment order', async () => {
    test.skip(!razorpayTestModeReady, 'Set Razorpay test-mode env with rzp_test_ key and USD allowed.');

    const config = await getRequestConfig();
    const mode = config.consultationModes[0]?.id;
    const service = config.services[0]?.id;
    const legalDomain = config.legalDomains[0]?.id;
    const urgency = pickUrgencyForMode(config, mode);

    test.skip(!mode || !service || !legalDomain || !urgency, 'Request pricing config has no active options.');

    const suffix = Date.now();
    const response = await clientApi.post(apiPath('/dashboard/requests'), {
      data: {
        caseDetails: 'Disposable Pay & Submit request for payment-flow regression.',
        consultationMode: mode,
        documentUploadIds: [],
        documents: [],
        legalDomain,
        pastLegalAction: false,
        preferredDate: '2026-06-15',
        preferredEndAtUtc: '2026-06-15T10:45:00.000Z',
        preferredStartAtUtc: '2026-06-15T10:00:00.000Z',
        preferredTime: '10:00-10:45',
        preferredTimezone: 'UTC',
        services: [service],
        urgency: urgency.id,
      },
      headers: {
        'Idempotency-Key': `e2e-request-pay-submit-${suffix}`,
        cookie: cookieHeader(clientJar),
        'x-csrf-token': clientCsrf(clientJar),
      },
    });
    await expectStatus(response, [200, 201]);
    const body = await json<{
      paymentOrder?: { amountMinor: number; currencyCode: string; keyId: string; orderId: string };
      requestId?: string;
    }>(response);
    expect(body.requestId).toBeTruthy();
    expect(body.paymentOrder).toMatchObject({
      currencyCode: 'USD',
      keyId: razorpayKeyId,
    });
    expect(body.paymentOrder?.amountMinor).toBeGreaterThan(0);
    expect(body.paymentOrder?.orderId).toBeTruthy();
  });

  test('paid and foreign invoices are not payable by the logged-in client', async () => {
    test.skip(!matterId, 'Disposable client-owned matter was not created.');

    const paidInvoiceId = await createIssuedInvoice({ amount: 80, matterId });
    const paymentResponse = await adminApi.post(apiPath('/billing/payments'), {
      data: {
        amount: 80,
        invoiceId: paidInvoiceId,
        notes: 'Disposable E2E manual payment for paid-invoice negative case.',
        paymentDate: '2026-06-01',
        paymentMethod: 'bank-transfer',
        referenceNumber: `E2E-PAID-${Date.now()}`,
      },
      headers: {
        'Idempotency-Key': `e2e-paid-invoice-${paidInvoiceId}-${Date.now()}`,
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(paymentResponse, [201, 200]);
    const paidDetail = await getClientInvoiceDetail(paidInvoiceId);
    expect(paidDetail.currencyCode).toBe('USD');
    expect(paidDetail.amountDue).toBe(0);
    expect(paidDetail.paymentOptions.onlineEnabled).toBe(false);

    const suffix = Date.now();
    const foreignClient = await adminApi.post(apiPath('/clients'), {
      data: {
        city: 'Disposable City',
        clientType: 'individual',
        displayName: `E2E Foreign Invoice Client ${suffix}`,
        email: `e2e.foreign.${suffix}@example.test`,
        phone: `+1555${String(suffix).slice(-7)}`,
        portalAccessEnabled: false,
        primaryContactName: `E2E Foreign ${suffix}`,
        state: 'Disposable State',
      },
      headers: {
        'Idempotency-Key': `e2e-foreign-client-${suffix}`,
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(foreignClient, [201, 200]);
    const foreignClientBody = await json<{ client?: { id?: string }; id?: string }>(foreignClient);
    const foreignClientId = foreignClientBody.client?.id || foreignClientBody.id || '';
    expect(foreignClientId).toBeTruthy();

    const foreignMatterId = await (async () => {
      const config = await getRequestConfig();
      const mode = config.consultationModes[0]?.id;
      const service = config.services[0]?.id;
      const legalDomain = config.legalDomains[0]?.id;
      const urgency = pickUrgencyForMode(config, mode);
      const response = await adminApi.post(apiPath('/matters'), {
        data: {
          clientAccountPublicId: foreignClientId,
          clientVisible: true,
          consultationModeCode: mode,
          legalDomainCode: legalDomain,
          priorityCode: 'in-progress',
          serviceCodes: [service],
          summary: 'Disposable foreign invoice matter.',
          title: `E2E Foreign Invoice Matter ${suffix}`,
          urgencyCode: urgency.id,
        },
        headers: {
          'Idempotency-Key': `e2e-foreign-matter-${suffix}`,
          cookie: cookieHeader(adminJar),
          'x-csrf-token': adminCsrf(adminJar),
        },
      });
      await expectStatus(response, [201, 200]);
      const body = await json<{ id?: string; matter?: { id?: string } }>(response);
      return body.matter?.id || body.id || '';
    })();
    expect(foreignMatterId).toBeTruthy();
    const foreignInvoiceId = await createIssuedInvoice({ amount: 95, matterId: foreignMatterId });

    const detailResponse = await clientApi.get(apiPath(`/me/invoices/${foreignInvoiceId}`), {
      headers: { cookie: cookieHeader(clientJar) },
    });
    expect([403, 404]).toContain(detailResponse.status());

    if (razorpayTestModeReady) {
      const orderResponse = await clientApi.post(apiPath(`/me/invoices/${foreignInvoiceId}/payment-order`), {
        data: {},
        headers: {
          'Idempotency-Key': `e2e-foreign-order-${foreignInvoiceId}-${Date.now()}`,
          cookie: cookieHeader(clientJar),
          'x-csrf-token': clientCsrf(clientJar),
        },
      });
      expect(orderResponse.status()).not.toBe(200);
      expect(orderResponse.status()).not.toBe(201);
    }
  });
});
