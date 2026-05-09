import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { closeMysqlPool, getMysqlPool } from '../lib/mysql.js';
import { providerFetch } from '../lib/providerHttp.js';
import { normalizeCurrencyCode } from '../modules/pricing/fx.js';

type CurrencyRow = RowDataPacket & {
  currency_code: string;
};

type FawazExchangeApiResponse = {
  date?: string;
  [baseCurrency: string]: unknown;
};

const todayDate = () => new Date().toISOString().slice(0, 10);

const buildProviderUrls = (baseCurrency: string) => {
  const baseLower = baseCurrency.toLowerCase();
  const endpoint = `currencies/${baseLower}.min.json`;
  const template = env.FX_PROVIDER_URL_TEMPLATE;

  if (template) {
    return [
      template
        .replaceAll('{apiVersion}', 'v1')
        .replaceAll('{base}', baseCurrency)
        .replaceAll('{baseLower}', baseLower)
        .replaceAll('{date}', 'latest')
        .replaceAll('{endpoint}', endpoint),
    ];
  }

  return [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/${endpoint}`,
    `https://latest.currency-api.pages.dev/v1/${endpoint}`,
  ];
};

const fetchRates = async (baseCurrency: string) => {
  const urls = buildProviderUrls(baseCurrency);
  const baseLower = baseCurrency.toLowerCase();
  const failures: string[] = [];

  for (const url of urls) {
    try {
      const response = await providerFetch(url, {
        headers: { accept: 'application/json' },
        operation: 'refresh_fx_rates',
        providerCode: 'fx',
        retryDelayMs: 200,
        safeToRetry: true,
      });
      if (!response.ok) {
        failures.push(`${new URL(url).host}: HTTP ${response.status}`);
        continue;
      }

      const payload = (await response.json()) as FawazExchangeApiResponse;
      const rates = payload[baseLower];

      if (rates && typeof rates === 'object') {
        return {
          provider: url.includes('currency-api.pages.dev') ? 'fawaz-exchange-api-cloudflare' : 'fawaz-exchange-api-jsdelivr',
          rateDate: typeof payload.date === 'string' ? payload.date : todayDate(),
          rates: rates as Record<string, number>,
        };
      }

      failures.push(`${new URL(url).host}: missing ${baseLower} rates`);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : 'request failed'}`);
    }
  }

  throw new Error(`FX provider request failed. ${failures.join('; ')}`);
};

const main = async () => {
  const baseCurrency = normalizeCurrencyCode(env.FX_BASE_CURRENCY) || 'USD';
  const pool = getMysqlPool();
  const connection = await pool.getConnection();

  try {
    const [rows] = await connection.query<CurrencyRow[]>(
      `SELECT DISTINCT currency_code
       FROM country_pricing_overrides
       WHERE is_active = 1
         AND archived_at IS NULL
         AND currency_code IS NOT NULL
       UNION
       SELECT DISTINCT currency_code
       FROM pricing_country_price_overrides
       WHERE is_active = 1
         AND archived_at IS NULL
         AND currency_code IS NOT NULL`
    );
    const targetCurrencies = [...new Set(rows.map((row) => normalizeCurrencyCode(row.currency_code)))]
      .filter((currency) => currency && currency !== baseCurrency)
      .sort();

    if (targetCurrencies.length === 0) {
      console.log('No non-base pricing currencies configured; no FX rates refreshed.');
      return;
    }

    const payload = await fetchRates(baseCurrency);
    let upserted = 0;

    for (const quoteCurrency of targetCurrencies) {
      const rate = Number(payload.rates[quoteCurrency.toLowerCase()]);
      if (!Number.isFinite(rate) || rate <= 0) {
        console.warn(`No valid ${baseCurrency}/${quoteCurrency} rate returned by provider.`);
        continue;
      }

      await connection.execute(
        `INSERT INTO exchange_rates (
           base_currency, quote_currency, rate, rate_date, provider, fetched_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE
           rate = VALUES(rate),
           fetched_at = VALUES(fetched_at),
           updated_at = VALUES(updated_at)`,
        [baseCurrency, quoteCurrency, rate, payload.rateDate, payload.provider]
      );
      upserted += 1;
    }

    console.log(`FX refresh complete. Rates upserted: ${upserted}.`);
  } finally {
    connection.release();
    await closeMysqlPool();
  }
};

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : 'FX refresh failed.');
  await closeMysqlPool();
  process.exitCode = 1;
});
