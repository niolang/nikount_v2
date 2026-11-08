import type { MinorUnits } from '@nikount/core';

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, signed: boolean): Intl.NumberFormat {
  const key = `${currency}:${String(signed)}`;
  let instance = formatters.get(key);
  if (!instance) {
    instance = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency,
      signDisplay: signed ? 'exceptZero' : 'auto',
    });
    formatters.set(key, instance);
  }
  return instance;
}

/**
 * Formate un montant en unités mineures (« 12450 » → « 124,50 € »).
 * `signed` affiche toujours le signe (soldes : « +124,50 € », « −42,00 € »).
 */
export function formatMoney(
  amount: MinorUnits,
  currency = 'EUR',
  { signed = false }: { signed?: boolean } = {},
): string {
  return formatter(currency, signed).format(amount / 100);
}

/** Montant en unités mineures → texte saisissable (« 3000 » → « 30,00 »). */
export function toAmountInput(minor: MinorUnits): string {
  return (minor / 100).toFixed(2).replace('.', ',');
}
