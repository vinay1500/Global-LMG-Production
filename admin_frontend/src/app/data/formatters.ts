export const formatCurrency = (amount: number, currencyCode = 'USD') => {
  const normalizedCurrency = /^[A-Z]{3}$/.test(String(currencyCode || '').trim().toUpperCase())
    ? String(currencyCode || '').trim().toUpperCase()
    : 'USD';

  try {
    return new Intl.NumberFormat('en-US', {
      currency: normalizedCurrency,
      currencyDisplay: 'symbol',
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
      style: 'currency',
    }).format(Number(amount || 0));
  } catch {
    const formattedAmount = Number(amount || 0).toLocaleString('en-US', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });

    return normalizedCurrency === 'USD' ? `$${formattedAmount}` : `${normalizedCurrency} ${formattedAmount}`;
  }
};

export const formatDate = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

export const formatDateTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};
