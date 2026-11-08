import { describe, expect, it } from 'vitest';
import type { AuditEventView } from '@nikount/contracts';
import { people } from '../test/utils';
import { auditActor, describeAuditEvent, type AuditContext } from './audit';

const TX = '0193f0aa-0000-7000-8000-000000000900';

const ctx: AuditContext = {
  currency: 'EUR',
  names: new Map(Object.values(people).map((p) => [p.id, p.name])),
  descriptions: new Map([[TX, 'Essence']]),
};

const event = (overrides: Partial<AuditEventView>): AuditEventView => ({
  id: 1,
  occurredAt: '2026-11-08T10:00:00.000Z',
  actor: { kind: 'ADMIN', admin: { id: 'x', label: 'Nicolas' }, participantId: null },
  action: 'nikount.created',
  entityType: null,
  entityId: null,
  data: {},
  ...overrides,
});
const say = (overrides: Partial<AuditEventView>) => describeAuditEvent(event(overrides), ctx);

describe('auditActor', () => {
  it('admin, participant déclaré, lien du groupe', () => {
    expect(auditActor(event({}), ctx.names)).toBe('Nicolas');
    expect(
      auditActor(
        event({ actor: { kind: 'PARTICIPANT', admin: null, participantId: people.bob.id } }),
        ctx.names,
      ),
    ).toBe('Bob');
    expect(
      auditActor(
        event({ actor: { kind: 'PARTICIPANT', admin: null, participantId: null } }),
        ctx.names,
      ),
    ).toBe('Lien du groupe');
  });
});

describe('describeAuditEvent', () => {
  it('nikount', () => {
    expect(say({ data: { name: 'Weekend' } })).toBe('a créé le nikount « Weekend »');
    expect(say({ action: 'nikount.renamed', data: { from: 'A', to: 'B' } })).toBe(
      'a renommé le nikount « A » → « B »',
    );
    expect(
      say({ action: 'nikount.state_changed', data: { transition: 'REOPEN', reason: 'Oubli' } }),
    ).toBe('a réouvert le nikount clôturé — motif : « Oubli »');
    expect(say({ action: 'nikount.participant_link_rotated' })).toMatch(/remplacé le lien/);
  });

  it('participants', () => {
    expect(say({ action: 'participant.created', data: { name: 'Zoé' } })).toBe('a ajouté Zoé');
    expect(
      say({
        action: 'participant.updated',
        entityId: people.bob.id,
        data: { isActive: { from: true, to: false } },
      }),
    ).toBe('a désactivé Bob');
    expect(
      say({
        action: 'participant.updated',
        entityId: people.bob.id,
        data: { name: { from: 'Bobby', to: 'Bob' } },
      }),
    ).toBe('a renommé Bobby en Bob');
  });

  it('admins', () => {
    expect(say({ action: 'admin.created', data: { label: 'Alice' } })).toBe(
      'a créé le lien admin « Alice »',
    );
    expect(say({ action: 'admin.revoked', data: { label: 'Alice', self: true } })).toBe(
      'a révoqué son propre lien admin',
    );
  });

  it('opérations : création, statuts, en masse', () => {
    expect(
      say({
        action: 'transaction.created',
        data: { type: 'EXPENSE', description: 'Pizza', amount: 4250, status: 'PENDING' },
      }),
    ).toBe('a ajouté une dépense : « Pizza », 42,50\u00a0€ (en attente de validation)');
    expect(say({ action: 'transaction.validated', entityId: TX })).toBe('a validé « Essence »');
    expect(
      say({
        action: 'transaction.rejected',
        entityId: TX,
        data: { bulk: true, count: 3, reason: 'Doublon' },
      }),
    ).toBe('a refusé « Essence » (en masse, 3 opérations) — motif : « Doublon »');
    expect(say({ action: 'transaction.cancelled', entityId: 'inconnu' })).toBe(
      'a annulé une opération',
    );
  });

  it('opérations : modification avec le détail des champs', () => {
    expect(
      say({
        action: 'transaction.updated',
        entityId: TX,
        data: {
          changed: ['amount', 'payerId', 'occurredOn', 'shares'],
          before: { amount: 9000, payerId: people.alice.id, occurredOn: '2026-09-27' },
          after: { amount: 6000, payerId: people.bob.id, occurredOn: '2026-09-28' },
          reason: 'Ticket',
        },
      }),
    ).toBe(
      'a modifié « Essence » : montant 90,00\u00a0€ → 60,00\u00a0€, payeur Alice → Bob, date 27 sept. → 28 sept., répartition — motif : « Ticket »',
    );
  });

  it('action inconnue : affichée telle quelle', () => {
    expect(say({ action: 'futur.truc' })).toBe('futur.truc');
  });
});
