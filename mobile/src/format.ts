import { formatMoney } from '../../src/ui/format.ts';

/** Un importe con el signo de pesos, como en el comprobante: "$ 1.234,50". */
export function money(amount: number): string {
  return amount < 0 ? `-$ ${formatMoney(-amount)}` : `$ ${formatMoney(amount)}`;
}

export function plural(count: number, singular: string, pluralForm: string): string {
  return `${String(count)} ${count === 1 ? singular : pluralForm}`;
}
