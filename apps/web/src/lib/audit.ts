import type { AuditEventView } from '@nikount/contracts';
import { formatShortDate } from './dates';
import { formatMoney } from './format';

/*
 * Mise en phrases du journal d'audit (admin). Le serveur stocke des faits bruts (action +
 * données) ; on les rend lisibles ici, sans jamais inventer : un événement inconnu s'affiche tel
 * quel plutôt que d'être masqué.
 */

export const AUDIT_FAMILIES = [
  { value: null, label: 'Tout' },
  { value: 'transaction', label: 'Opérations' },
  { value: 'participant', label: 'Participants' },
  { value: 'admin', label: 'Admins' },
  { value: 'nikount', label: 'Nikount' },
] as const;

export interface AuditContext {
  currency: string;
  /** Noms des participants, par identifiant. */
  names: Map<string, string>;
  /** Description des opérations connues, par identifiant. */
  descriptions: Map<string, string>;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const amount = (value: unknown, currency: string) =>
  typeof value === 'number' ? formatMoney(value, currency) : '?';

/** Qui a agi : libellé de l'admin, participant déclaré, ou lien du groupe. */
export function auditActor(event: AuditEventView, names: Map<string, string>): string {
  if (event.actor.admin) return event.actor.admin.label || 'Un admin';
  if (event.actor.kind === 'SYSTEM') return 'Système';
  if (event.actor.participantId) return names.get(event.actor.participantId) ?? 'Un participant';
  return 'Lien du groupe';
}

const FIELD_LABELS: Record<string, string> = {
  amount: 'montant',
  description: 'description',
  category: 'catégorie',
  occurredOn: 'date',
  payerId: 'payeur',
  distributionMode: 'mode de répartition',
  shares: 'répartition',
};

function changeDetails(event: AuditEventView, ctx: AuditContext): string {
  const changed = Array.isArray(event.data['changed']) ? event.data['changed'].map(text) : [];
  const before = (event.data['before'] ?? {}) as Record<string, unknown>;
  const after = (event.data['after'] ?? {}) as Record<string, unknown>;
  const detail = (key: string): string => {
    const label = FIELD_LABELS[key] ?? key;
    switch (key) {
      case 'amount':
        return `${label} ${amount(before[key], ctx.currency)} → ${amount(after[key], ctx.currency)}`;
      case 'occurredOn':
        return `${label} ${formatShortDate(text(before[key]))} → ${formatShortDate(text(after[key]))}`;
      case 'payerId':
        return `${label} ${ctx.names.get(text(before[key])) ?? '?'} → ${ctx.names.get(text(after[key])) ?? '?'}`;
      case 'description':
        return `${label} « ${text(before[key])} » → « ${text(after[key])} »`;
      default:
        return label;
    }
  };
  return changed.map(detail).join(', ');
}

const TRANSITIONS: Record<string, string> = {
  FINISH: 'a terminé l’événement (passage en règlement)',
  UNLOCK: 'a rouvert le nikount aux dépenses',
  CLOSE: 'a clôturé le nikount',
  REOPEN: 'a réouvert le nikount clôturé',
};

/** Phrase décrivant l'action, sans le sujet : « a validé « Essence » ». */
export function describeAuditEvent(event: AuditEventView, ctx: AuditContext): string {
  const d = event.data;
  const subject = (fallback = 'une opération') => {
    const description = event.entityId ? ctx.descriptions.get(event.entityId) : undefined;
    return description ? `« ${description} »` : fallback;
  };
  const reason = typeof d['reason'] === 'string' ? ` — motif : « ${d['reason']} »` : '';
  const bulk = d['bulk'] === true ? ` (en masse, ${String(d['count'])} opérations)` : '';
  const person = () =>
    (event.entityId ? ctx.names.get(event.entityId) : undefined) ?? (text(d['name']) || '?');

  switch (event.action) {
    case 'nikount.created':
      return `a créé le nikount « ${text(d['name'])} »`;
    case 'nikount.renamed':
      return `a renommé le nikount « ${text(d['from'])} » → « ${text(d['to'])} »`;
    case 'nikount.state_changed':
      return `${TRANSITIONS[text(d['transition'])] ?? 'a changé l’état du nikount'}${reason}`;
    case 'nikount.participant_link_rotated':
      return 'a remplacé le lien du groupe (l’ancien ne fonctionne plus)';
    case 'participant.created':
      return `a ajouté ${text(d['name']) || person()}`;
    case 'participant.updated': {
      const parts: string[] = [];
      const name = d['name'] as { from?: unknown; to?: unknown } | undefined;
      const active = d['isActive'] as { to?: unknown } | undefined;
      if (name) parts.push(`a renommé ${text(name.from)} en ${text(name.to)}`);
      if (active) parts.push(`a ${active.to === true ? 'réactivé' : 'désactivé'} ${person()}`);
      if (d['sortOrder']) parts.push(`a changé la place de ${person()}`);
      return parts.length > 0 ? parts.join(' et ') : `a modifié ${person()}`;
    }
    case 'admin.created':
      return `a créé le lien admin « ${text(d['label'])} »`;
    case 'admin.revoked':
      return d['self'] === true
        ? 'a révoqué son propre lien admin'
        : `a révoqué le lien admin « ${text(d['label'])} »`;
    case 'transaction.created': {
      const what = d['type'] === 'REIMBURSEMENT' ? 'un remboursement' : 'une dépense';
      const pending = d['status'] === 'PENDING' ? ' (en attente de validation)' : '';
      return `a ajouté ${what} : « ${text(d['description'])} », ${amount(d['amount'], ctx.currency)}${pending}`;
    }
    case 'transaction.validated':
      return `a validé ${subject()}${bulk}`;
    case 'transaction.rejected':
      return `a refusé ${subject()}${bulk}${reason}`;
    case 'transaction.cancelled':
      return `a annulé ${subject()}${bulk}${reason}`;
    case 'transaction.updated': {
      const details = changeDetails(event, ctx);
      return `a modifié ${subject()}${details ? ` : ${details}` : ''}${reason}`;
    }
    default:
      return event.action;
  }
}
