import type { z } from 'zod';
import type { AdminView, CreateNikountRequest, NikountView } from '@nikount/contracts';
import type { Database } from '../../db/client.js';
import { DomainError } from '../../lib/errors.js';
import type { SecretBox } from '../../lib/secret-box.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { uuidv7 } from '../../lib/uuid.js';
import { recordAuditEvent } from '../audit/repository.js';
import { insertParticipants } from '../participants/repository.js';
import * as repo from './repository.js';

/** Données de création après validation et normalisation par le schéma Zod. */
export type CreateNikountInput = z.output<typeof CreateNikountRequest>;

export interface RequestMeta {
  requestId: string;
}

export function toNikountView(row: repo.NikountRow): NikountView {
  return {
    name: row.name,
    currency: row.currency,
    timezone: row.timezone,
    state: row.state,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Crée un nikount, son lien participant et le lien admin de son créateur, en une seule
 * transaction avec l'événement d'audit. Les tokens en clair ne sont renvoyés qu'ici.
 */
export async function createNikount(
  db: Database,
  secretBox: SecretBox,
  input: CreateNikountInput,
  meta: RequestMeta,
) {
  const participantToken = generateToken('PARTICIPANT');
  const adminToken = generateToken('ADMIN');
  const nikountId = uuidv7();
  const adminId = uuidv7();

  // Le créateur, s'il participe, est le premier participant (ordre d'affichage 0).
  const names = [...(input.adminIsParticipant ? [input.adminLabel] : []), ...input.participants];
  const participantRows = names.map((name, sortOrder) => ({
    id: uuidv7(),
    nikountId,
    name,
    sortOrder,
  }));
  const adminParticipantId = input.adminIsParticipant ? (participantRows[0]?.id ?? null) : null;

  const { nikountRow, adminRow } = await db.transaction(async (tx) => {
    const nikountRow = await repo.insertNikount(tx, {
      id: nikountId,
      name: input.name,
      currency: input.currency,
      participantTokenHash: hashToken(participantToken),
      participantTokenCiphertext: secretBox.seal(participantToken, nikountId),
    });
    await insertParticipants(tx, participantRows);
    const adminRow = await repo.insertAdminAccess(tx, {
      id: adminId,
      nikountId,
      label: input.adminLabel,
      participantId: adminParticipantId,
      tokenHash: hashToken(adminToken),
    });
    await recordAuditEvent(tx, {
      nikountId,
      actorKind: 'ADMIN',
      actorAdminId: adminId,
      action: 'nikount.created',
      entityType: 'nikount',
      entityId: nikountId,
      data: {
        name: input.name,
        currency: input.currency,
        adminLabel: input.adminLabel,
        participants: names,
      },
      requestId: meta.requestId,
    });
    return { nikountRow, adminRow };
  });

  return {
    nikount: toNikountView(nikountRow),
    admin: toAdminView(adminRow),
    participantToken,
    adminToken,
  };
}

export function toAdminView(row: repo.AdminAccessRow): AdminView {
  return { id: row.id, label: row.label, participantId: row.participantId };
}

export async function getNikount(db: Database, nikountId: string): Promise<repo.NikountRow> {
  const row = await repo.findNikount(db, nikountId);
  // Ne peut arriver que si le nikount a disparu entre l'authentification et la lecture.
  if (!row) throw new DomainError(404, 'NOT_FOUND', 'Ressource introuvable.');
  return row;
}

/** Réaffiche le lien participant à un admin (déchiffrement du token stocké). */
export async function getParticipantToken(
  db: Database,
  secretBox: SecretBox,
  nikountId: string,
): Promise<string> {
  const row = await getNikount(db, nikountId);
  return secretBox.open(row.participantTokenCiphertext, row.id);
}
