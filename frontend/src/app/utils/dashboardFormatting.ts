import { REQUEST_WIZARD_SERVICES } from '../data/requestWizardData';
import { formatCurrencyAmount } from './currency';

export const formatCurrency = (amount: number, currencyCode = 'USD') => {
  return formatCurrencyAmount(amount, currencyCode);
};

export const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

export const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const getServiceName = (id: string) =>
  REQUEST_WIZARD_SERVICES.find((service) => service.id === id)?.name ?? id;
