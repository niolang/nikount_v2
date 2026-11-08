import { z } from 'zod';
import { AccessRole, NikountState } from './enums.js';
import { ParticipantName, participantNameKey } from './participant.js';
import { cleanText } from './text.js';
import { ADMIN_TOKEN_PATTERN, PARTICIPANT_TOKEN_PATTERN } from './tokens.js';

export const NikountName = cleanText(1, 60);
export const PersonLabel = cleanText(1, 40);

/** Code ISO 4217 connu du moteur Intl (une devise par nikount, sans conversion : D16). */
export const CurrencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .refine((code) => Intl.supportedValuesOf('currency').includes(code), 'Devise inconnue');

export const ParticipantToken = z.string().regex(PARTICIPANT_TOKEN_PATTERN);
export const AdminToken = z.string().regex(ADMIN_TOKEN_PATTERN);

// --- Requêtes -------------------------------------------------------------

/** Participants saisis à la création (le créateur s'y ajoute s'il participe). */
const MAX_INITIAL_PARTICIPANTS = 100;

export const CreateNikountRequest = z
  .strictObject({
    name: NikountName,
    currency: CurrencyCode.default('EUR'),
    /** Nom de l'admin créateur, affiché dans « Validée par … ». */
    adminLabel: PersonLabel,
    /** Le créateur participe-t-il aux dépenses ? Si oui, il devient aussi participant. */
    adminIsParticipant: z.boolean().default(true),
    participants: z.array(ParticipantName).max(MAX_INITIAL_PARTICIPANTS).default([]),
  })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    if (body.adminIsParticipant) seen.add(participantNameKey(body.adminLabel));
    body.participants.forEach((name, index) => {
      const key = participantNameKey(name);
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['participants', index],
          message: `Nom en double : ${name}`,
        });
      }
      seen.add(key);
    });
  });
export type CreateNikountRequest = z.input<typeof CreateNikountRequest>;

// --- Réponses -------------------------------------------------------------

/** Vue publique d'un nikount. Son identifiant interne n'est jamais exposé (inutile au client). */
export const NikountView = z.object({
  name: z.string(),
  currency: z.string(),
  timezone: z.string(),
  state: NikountState,
  createdAt: z.iso.datetime({ offset: true }),
});
export type NikountView = z.infer<typeof NikountView>;

export const AdminView = z.object({
  id: z.uuid(),
  label: z.string(),
  /** Participant que représente cet admin, s'il participe aux dépenses. */
  participantId: z.uuid().nullable(),
});
export type AdminView = z.infer<typeof AdminView>;

/**
 * Réponse de création. Les deux tokens ne sont renvoyés qu'ici : le lien admin n'est
 * plus jamais affichable ensuite (D11).
 */
export const CreateNikountResponse = z.object({
  nikount: NikountView,
  admin: AdminView,
  participantToken: ParticipantToken,
  adminToken: AdminToken,
});
export type CreateNikountResponse = z.infer<typeof CreateNikountResponse>;

export const MeResponse = z.object({
  role: AccessRole,
  /** Renseigné uniquement pour un accès admin. */
  admin: AdminView.nullable(),
  nikount: NikountView,
});
export type MeResponse = z.infer<typeof MeResponse>;

export const ParticipantLinkResponse = z.object({
  participantToken: ParticipantToken,
});
export type ParticipantLinkResponse = z.infer<typeof ParticipantLinkResponse>;
