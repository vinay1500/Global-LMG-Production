import { createHash } from 'node:crypto';
import { expect, request, test, type APIRequestContext, type APIResponse } from '@playwright/test';

const adminApiBase = process.env.E2E_ADMIN_API_BASE || 'http://127.0.0.1:3005/api/v1/admin';
const adminWebBase = process.env.E2E_ADMIN_WEB_BASE || 'http://127.0.0.1:5174';
const clientApiBase = process.env.E2E_CLIENT_API_BASE || 'http://127.0.0.1:3001/api/v1';
const clientWebBase = process.env.E2E_CLIENT_WEB_BASE || 'http://127.0.0.1:5173';
const runLiveE2e = process.env.E2E_RUN_LIVE === 'true';
const runMutations = process.env.E2E_RUN_MUTATIONS === 'true';

const adminEmail = process.env.E2E_ADMIN_EMAIL || process.env.BETA_SMOKE_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD || process.env.BETA_SMOKE_ADMIN_PASSWORD;
const clientEmail = process.env.E2E_CLIENT_EMAIL || process.env.BETA_SMOKE_CLIENT_EMAIL;
const clientPassword = process.env.E2E_CLIENT_PASSWORD || process.env.BETA_SMOKE_CLIENT_PASSWORD;

type JsonResponse = Record<string, unknown>;
type RequestPricingConfig = {
  consultationModes: Array<{ id: string }>;
  legalDomains: Array<{ id: string }>;
  services: Array<{ id: string }>;
  urgencyOptions: Array<{ allowedConsultationModes?: string[]; id: string }>;
};

const json = async <T = JsonResponse>(response: APIResponse) => (await response.json()) as T;
const apiBase = (value: string) => (value.endsWith('/') ? value : `${value}/`);
const apiPath = (value: string) => value.replace(/^\/+/, '');

type CookieJar = Map<string, string>;

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
const pickUrgencyForMode = (config: RequestPricingConfig, mode?: string) =>
  config.urgencyOptions.find((option) => !option.allowedConsultationModes || option.allowedConsultationModes.includes(mode || '')) ??
  config.urgencyOptions[0];

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

test.describe.configure({ mode: 'serial' });

test.describe('Global LMG production happy path', () => {
  test.skip(
    !runLiveE2e,
    'Set E2E_RUN_LIVE=true with disposable E2E_* credentials and running local/staging servers.'
  );

  let adminApi: APIRequestContext;
  let clientApi: APIRequestContext;
  const adminJar: CookieJar = new Map();
  const clientJar: CookieJar = new Map();
  let disposableClientId = '';
  let disposableMatterId = '';
  let disposableInvoiceId = '';

  const getRequestConfig = async () =>
    json<RequestPricingConfig>(await clientApi.get(apiPath('/dashboard/request-config')));

  test.beforeAll(async () => {
    adminApi = await request.newContext({ baseURL: apiBase(adminApiBase) });
    clientApi = await request.newContext({ baseURL: apiBase(clientApiBase) });
  });

  test.afterAll(async () => {
    await adminApi?.dispose();
    await clientApi?.dispose();
  });

  test('admin login', async ({ page }) => {
    test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.');

    await page.goto(`${adminWebBase}/login`);
    await expect(page.getByRole('heading', { name: /admin sign in/i })).toBeVisible();

    await login(adminApi, adminJar, {
      csrfCookieName: 'global_lmg_admin_csrf',
      identifier: adminEmail!,
      password: adminPassword!,
    });
    await expectStatus(
      await adminApi.get(apiPath('/auth/session'), { headers: { cookie: cookieHeader(adminJar) } }),
      [200]
    );
  });

  test('client signup or login', async ({ page }) => {
    test.skip(!clientEmail || !clientPassword, 'Set E2E_CLIENT_EMAIL and E2E_CLIENT_PASSWORD.');

    await page.goto(clientWebBase);
    await expect(page.locator('body')).toBeVisible();

    await login(clientApi, clientJar, {
      csrfCookieName: 'global_lmg_csrf',
      identifier: clientEmail!,
      password: clientPassword!,
    });
    await expectStatus(
      await clientApi.get(apiPath('/dashboard'), { headers: { cookie: cookieHeader(clientJar) } }),
      [200]
    );
  });

  test('admin creates disposable client and matter', async () => {
    test.skip(!runMutations, 'Set E2E_RUN_MUTATIONS=true to create disposable records.');
    test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.');

    await login(adminApi, adminJar, {
      csrfCookieName: 'global_lmg_admin_csrf',
      identifier: adminEmail!,
      password: adminPassword!,
    });

    const suffix = Date.now();
    const disposablePhone = `+919${String(suffix).slice(-9)}`;
    const clientResponse = await adminApi.post(apiPath('/clients'), {
      data: {
        city: 'Mumbai',
        clientType: 'individual',
        displayName: `E2E Disposable Client ${suffix}`,
        email: `e2e.client.${suffix}@example.test`,
        notes: 'Disposable Playwright E2E client.',
        phone: disposablePhone,
        portalAccessEnabled: false,
        primaryContactName: `E2E Client ${suffix}`,
        state: 'Maharashtra',
      },
      headers: {
        'Idempotency-Key': `e2e-client-${suffix}`,
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(clientResponse, [201, 200]);
    const client = await json<{ client?: { id?: string }; id?: string }>(clientResponse);
    disposableClientId = client.client?.id || client.id || '';
    expect(disposableClientId).toBeTruthy();

    const config = await getRequestConfig();
    const mode = config.consultationModes[0]?.id;
    const service = config.services[0]?.id;
    const legalDomain = config.legalDomains[0]?.id;
    const urgency = pickUrgencyForMode(config, mode);

    test.skip(!mode || !service || !legalDomain || !urgency, 'Request pricing config has no active options.');

    const matterResponse = await adminApi.post(apiPath('/matters'), {
      data: {
        clientAccountPublicId: disposableClientId,
        clientVisible: true,
        consultationModeCode: mode,
        legalDomainCode: legalDomain,
        priorityCode: 'in-progress',
        serviceCodes: [service],
        summary: 'Disposable E2E matter summary for automated testing.',
        title: `E2E Disposable Matter ${suffix}`,
        urgencyCode: urgency.id,
      },
      headers: {
        'Idempotency-Key': `e2e-matter-${suffix}`,
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(matterResponse, [201, 200]);
    const matter = await json<{ id?: string; matter?: { id?: string } }>(matterResponse);
    disposableMatterId = matter.matter?.id || matter.id || '';
    expect(disposableMatterId).toBeTruthy();
  });

  test('client submits request and admin can inspect request workspace', async () => {
    test.skip(!runMutations, 'Set E2E_RUN_MUTATIONS=true to submit disposable requests.');
    test.skip(!clientEmail || !clientPassword, 'Set E2E_CLIENT_EMAIL and E2E_CLIENT_PASSWORD.');

    await login(clientApi, clientJar, {
      csrfCookieName: 'global_lmg_csrf',
      identifier: clientEmail!,
      password: clientPassword!,
    });
    if (adminEmail && adminPassword) {
      await login(adminApi, adminJar, {
        csrfCookieName: 'global_lmg_admin_csrf',
        identifier: adminEmail,
        password: adminPassword,
      });
    }

    const config = await getRequestConfig();

    const mode = config.consultationModes[0]?.id;
    const service = config.services[0]?.id;
    const legalDomain = config.legalDomains[0]?.id;
    const urgency = pickUrgencyForMode(config, mode);

    test.skip(!mode || !service || !legalDomain || !urgency, 'Request pricing config has no active options.');

    const suffix = Date.now();
    const disposablePhone = `+919${String(suffix).slice(-9)}`;
    const requestResponse = await clientApi.post(apiPath('/dashboard/requests'), {
      data: {
        caseDetails: 'Disposable Playwright request submission for automated happy-path coverage.',
        consultationMode: mode,
        documentUploadIds: [],
        documents: [],
        email: clientEmail,
        fullName: 'Disposable E2E Client',
        legalDomain,
        mobile: disposablePhone,
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
        'Idempotency-Key': `e2e-request-${suffix}`,
        cookie: cookieHeader(clientJar),
        'x-csrf-token': clientCsrf(clientJar),
      },
    });
    await expectStatus(requestResponse, [200, 201]);
    await expectStatus(
      await adminApi.get(apiPath('/requests/workspace'), { headers: { cookie: cookieHeader(adminJar) } }),
      [200]
    );
  });

  test('admin creates invoice, records payment, and creates event', async () => {
    test.skip(!runMutations, 'Set E2E_RUN_MUTATIONS=true to create disposable billing/event records.');
    test.skip(!adminEmail || !adminPassword, 'Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD.');
    test.skip(!disposableMatterId, 'Disposable matter was not created.');

    await login(adminApi, adminJar, {
      csrfCookieName: 'global_lmg_admin_csrf',
      identifier: adminEmail!,
      password: adminPassword!,
    });

    const suffix = Date.now();
    const invoiceResponse = await adminApi.post(apiPath('/billing/invoices'), {
      data: {
        amount: 1000,
        description: 'Disposable E2E invoice',
        matterId: disposableMatterId,
      },
      headers: {
        'Idempotency-Key': `e2e-invoice-${suffix}`,
        cookie: cookieHeader(adminJar),
        'x-csrf-token': adminCsrf(adminJar),
      },
    });
    await expectStatus(invoiceResponse, [201, 200]);
    const invoice = await json<{ id?: string; invoice?: { id?: string }; invoiceId?: string }>(invoiceResponse);
    disposableInvoiceId = invoice.invoice?.id || invoice.invoiceId || invoice.id || '';
    expect(disposableInvoiceId).toBeTruthy();

    await expectStatus(
      await adminApi.post(apiPath(`/billing/invoices/${disposableInvoiceId}/send`), {
        data: {},
        headers: {
          'Idempotency-Key': `e2e-invoice-send-${suffix}`,
          cookie: cookieHeader(adminJar),
          'x-csrf-token': adminCsrf(adminJar),
        },
      }),
      [200, 201]
    );

    await expectStatus(
      await adminApi.post(apiPath('/billing/payments'), {
        data: {
          amount: 100,
          invoiceId: disposableInvoiceId,
          notes: 'Disposable E2E payment.',
          paymentDate: '2026-05-07',
          paymentMethod: 'bank-transfer',
          referenceNumber: `E2E-${suffix}`,
        },
        headers: {
          'Idempotency-Key': `e2e-payment-${suffix}`,
          cookie: cookieHeader(adminJar),
          'x-csrf-token': adminCsrf(adminJar),
        },
      }),
      [201, 200]
    );

    await expectStatus(
      await adminApi.post(apiPath('/events'), {
        data: {
          date: '2026-06-16',
          durationMinutes: 30,
          matterId: disposableMatterId,
          mode: 'video',
          notes: 'Disposable E2E event.',
          time: '10:30',
          title: 'Disposable E2E coordination call',
          type: 'consultation',
          visibleToClient: true,
        },
        headers: { cookie: cookieHeader(adminJar), 'x-csrf-token': adminCsrf(adminJar) },
      }),
      [201, 200]
    );
  });

  test('client uploads disposable document', async () => {
    test.skip(!runMutations, 'Set E2E_RUN_MUTATIONS=true to upload a disposable document.');
    test.skip(!clientEmail || !clientPassword, 'Set E2E_CLIENT_EMAIL and E2E_CLIENT_PASSWORD.');

    await login(clientApi, clientJar, {
      csrfCookieName: 'global_lmg_csrf',
      identifier: clientEmail!,
      password: clientPassword!,
    });

    const uploadContent = Buffer.from('Disposable Playwright document upload.\n', 'utf8');
    const uploadIntent = await json<{ upload?: { id?: string }; id?: string }>(
      await clientApi.post(apiPath('/uploads/intents'), {
        data: {
          checksumSha256: createHash('sha256').update(uploadContent).digest('hex'),
          mimeType: 'text/plain',
          originalName: 'e2e-disposable-upload.txt',
          sizeBytes: uploadContent.length,
          sourceModule: 'playwright-e2e',
        },
        headers: {
          'Idempotency-Key': `e2e-upload-${Date.now()}`,
          cookie: cookieHeader(clientJar),
          'x-csrf-token': clientCsrf(clientJar),
        },
      })
    );
    const uploadId = uploadIntent.upload?.id || uploadIntent.id;
    expect(uploadId).toBeTruthy();
    await expectStatus(
      await clientApi.put(apiPath(`/uploads/${uploadId}/content`), {
        data: uploadContent,
        headers: {
          cookie: cookieHeader(clientJar),
          'content-type': 'application/octet-stream',
          'x-csrf-token': clientCsrf(clientJar),
        },
      }),
      [200]
    );
  });

  test('package selection and messaging are covered when disposable fixtures exist', async () => {
    test.skip(
      !runMutations,
      'Set E2E_RUN_MUTATIONS=true and create published package/message fixtures for this extended path.'
    );
    test.skip(!clientEmail || !clientPassword, 'Set E2E_CLIENT_EMAIL and E2E_CLIENT_PASSWORD.');

    await login(clientApi, clientJar, {
      csrfCookieName: 'global_lmg_csrf',
      identifier: clientEmail!,
      password: clientPassword!,
    });

    const snapshot = await json<{
      matters?: Array<{ id: string; packages?: Array<{ id: string; proposalVersion: number; statusCode?: string }> }>;
      messages?: Array<{ id: string }>;
    }>(await clientApi.get(apiPath('/dashboard'), { headers: { cookie: cookieHeader(clientJar) } }));
    const matterWithPackage = snapshot.matters?.find((matter) =>
      matter.packages?.some((pkg) => pkg.statusCode === 'published' || pkg.statusCode === 'recommended')
    );
    const publishedPackage = matterWithPackage?.packages?.[0];

    test.skip(!matterWithPackage || !publishedPackage, 'No published package fixture exists for selection.');

    await expectStatus(
      await clientApi.post(apiPath(`/dashboard/matters/${matterWithPackage.id}/package-selection`), {
        data: {
          matterPackageId: publishedPackage.id,
          proposalVersion: publishedPackage.proposalVersion,
        },
        headers: { cookie: cookieHeader(clientJar), 'x-csrf-token': clientCsrf(clientJar) },
      }),
      [200]
    );

    const threadId = snapshot.messages?.[0]?.id;
    test.skip(!threadId, 'No message thread fixture exists for send/reply/read.');
    await expectStatus(
      await clientApi.post(apiPath('/dashboard/messages'), {
        data: { attachmentUploadIds: [], content: 'Disposable E2E message reply.', threadId },
        headers: { cookie: cookieHeader(clientJar), 'x-csrf-token': clientCsrf(clientJar) },
      }),
      [200]
    );
    await expectStatus(
      await clientApi.post(apiPath(`/dashboard/messages/${threadId}/read`), {
        data: {},
        headers: { cookie: cookieHeader(clientJar), 'x-csrf-token': clientCsrf(clientJar) },
      }),
      [200]
    );
  });
});
