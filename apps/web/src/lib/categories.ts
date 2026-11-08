import type { TransactionCategory, TransactionType } from '@nikount/contracts';

export const CATEGORIES: { value: TransactionCategory; emoji: string; label: string }[] = [
  { value: 'FOOD', emoji: '🍕', label: 'Repas' },
  { value: 'GROCERIES', emoji: '🛒', label: 'Courses' },
  { value: 'TRANSPORT', emoji: '⛽', label: 'Transport' },
  { value: 'LODGING', emoji: '🏠', label: 'Hébergement' },
  { value: 'ACTIVITY', emoji: '🎟️', label: 'Activité' },
  { value: 'OTHER', emoji: '📦', label: 'Autre' },
];

/** Emoji affiché dans l'historique (docs/product.md §8). */
export function transactionEmoji(
  type: TransactionType,
  category: TransactionCategory | null,
): string {
  if (type === 'REIMBURSEMENT') return '💸';
  return CATEGORIES.find((c) => c.value === category)?.emoji ?? '💶';
}
