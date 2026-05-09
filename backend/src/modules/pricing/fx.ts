import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { selectOne } from '../../lib/mysqlUtils.js';
import { providerFetch } from '../../lib/providerHttp.js';

type ExchangeRateRow = RowDataPacket & {
  provider: string;
  rate: string | number;
  rate_date: string | Date;
};

type FawazExchangeApiResponse = {
  date?: string;
  [baseCurrency: string]: unknown;
};

type FetchedExchangeRate = {
  provider: string;
  rate: number;
  rateDate: string;
};

export type PricingFxSource = 'base_currency' | 'exchange_rate' | 'exact_country_override';

export type PricingFxSnapshot = {
  amount: number;
  currencyCode: string;
  exchangeRate: number | null;
  exchangeRateDate: string | null;
  exchangeRateProvider: string | null;
  originalAmount: number | null;
  originalCurrencyCode: string | null;
  source: PricingFxSource;
};

export const normalizeCurrencyCode = (value: string | null | undefined) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .slice(0, 3);

export const toMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const todayDate = () => new Date().toISOString().slice(0, 10);

const toDateOnly = (value: string | Date | null | undefined) => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
};

export const getFxBaseCurrency = () =>
  normalizeCurrencyCode(env.FX_BASE_CURRENCY) || normalizeCurrencyCode(env.DEFAULT_PRICING_CURRENCY) || 'USD';

const getLatestExchangeRate = async (
  connection: PoolConnection,
  baseCurrency: string,
  quoteCurrency: string,
  rateDate = todayDate()
) =>
  selectOne<ExchangeRateRow>(
    connection,
    `SELECT rate, rate_date, provider
     FROM exchange_rates
     WHERE base_currency = ?
       AND quote_currency = ?
       AND rate_date <= ?
     ORDER BY rate_date DESC, fetched_at DESC, id DESC
     LIMIT 1`,
    [baseCurrency, quoteCurrency, rateDate]
  );

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

const fetchAutomaticExchangeRate = async (
  baseCurrency: string,
  quoteCurrency: string
): Promise<FetchedExchangeRate> => {
  const baseLower = baseCurrency.toLowerCase();
  const quoteLower = quoteCurrency.toLowerCase();
  const failures: string[] = [];

  for (const url of buildProviderUrls(baseCurrency)) {
    try {
      const response = await providerFetch(url, {
        headers: { accept: 'application/json' },
        operation: 'fetch_exchange_rate',
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
      const rate = rates && typeof rates === 'object' ? Number((rates as Record<string, unknown>)[quoteLower]) : NaN;

      if (Number.isFinite(rate) && rate > 0) {
        return {
          provider: url.includes('currency-api.pages.dev') ? 'fawaz-exchange-api-cloudflare' : 'fawaz-exchange-api-jsdelivr',
          rate,
          rateDate: typeof payload.date === 'string' ? payload.date : todayDate(),
        };
      }

      failures.push(`${new URL(url).host}: missing ${baseLower}/${quoteLower} rate`);
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : 'request failed'}`);
    }
  }

  throw new Error(`Automatic FX provider unavailable. ${failures.join('; ')}`);
};

const refreshAutomaticExchangeRate = async (
  connection: PoolConnection,
  baseCurrency: string,
  quoteCurrency: string
) => {
  const fetched = await fetchAutomaticExchangeRate(baseCurrency, quoteCurrency);

  await connection.execute(
    `INSERT INTO exchange_rates (
       base_currency, quote_currency, rate, rate_date, provider, fetched_at, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE
       rate = VALUES(rate),
       fetched_at = VALUES(fetched_at),
       updated_at = VALUES(updated_at)`,
    [baseCurrency, quoteCurrency, fetched.rate, fetched.rateDate, fetched.provider]
  );
};

export const convertBaseAmount = async (
  _connection: PoolConnection,
  amount: number,
  _targetCurrencyCode: string
): Promise<PricingFxSnapshot> => {
  const baseCurrency = getFxBaseCurrency();
  const baseAmount = toMoney(amount);

  return {
    amount: baseAmount,
    currencyCode: baseCurrency,
    exchangeRate: null,
    exchangeRateDate: null,
    exchangeRateProvider: null,
    originalAmount: null,
    originalCurrencyCode: null,
    source: 'base_currency',
  };
};

export const exactOverrideAmount = (
  amount: number,
  currencyCode: string
): PricingFxSnapshot => ({
  amount: toMoney(amount),
  currencyCode: normalizeCurrencyCode(currencyCode) || getFxBaseCurrency(),
  exchangeRate: null,
  exchangeRateDate: null,
  exchangeRateProvider: null,
  originalAmount: null,
  originalCurrencyCode: null,
  source: 'exact_country_override',
});

export const summarizeFxSnapshots = (snapshots: PricingFxSnapshot[]) => {
  const convertedSnapshots = snapshots.filter((snapshot) => snapshot.source === 'exchange_rate');
  const firstConverted = convertedSnapshots[0];

  return {
    exchangeRate:
      convertedSnapshots.length > 0 &&
      convertedSnapshots.every((snapshot) => snapshot.exchangeRate === firstConverted.exchangeRate)
        ? firstConverted.exchangeRate
        : null,
    exchangeRateDate:
      convertedSnapshots.length > 0 &&
      convertedSnapshots.every((snapshot) => snapshot.exchangeRateDate === firstConverted.exchangeRateDate)
        ? firstConverted.exchangeRateDate
        : null,
    exchangeRateProvider:
      convertedSnapshots.length > 0 &&
      convertedSnapshots.every((snapshot) => snapshot.exchangeRateProvider === firstConverted.exchangeRateProvider)
        ? firstConverted.exchangeRateProvider
        : convertedSnapshots.length > 0
          ? 'mixed'
          : null,
    originalCurrencyCode:
      convertedSnapshots.length > 0 &&
      convertedSnapshots.every((snapshot) => snapshot.originalCurrencyCode === firstConverted.originalCurrencyCode)
        ? firstConverted.originalCurrencyCode
        : null,
    snapshotJson: JSON.stringify(
      snapshots.map((snapshot) => ({
        currencyCode: snapshot.currencyCode,
        exchangeRate: snapshot.exchangeRate,
        exchangeRateDate: snapshot.exchangeRateDate,
        exchangeRateProvider: snapshot.exchangeRateProvider,
        originalAmount: snapshot.originalAmount,
        originalCurrencyCode: snapshot.originalCurrencyCode,
        source: snapshot.source,
      }))
    ),
  };
};
