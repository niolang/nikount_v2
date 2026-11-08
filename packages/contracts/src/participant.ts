import { z } from 'zod';
import { cleanText } from './text.js';

/** Nombre maximal de participants (actifs et inactifs) par nikount. */
export const MAX_PARTICIPANTS = 200;

export const ParticipantName = cleanText(1, 40);

/** Clé de comparaison des noms : deux participants actifs ne peuvent pas avoir la même. */
export function participantNameKey(name: string): string {
  return name.toLowerCase();
}

export const ParticipantView = z.object({
  id: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** Version pour le verrouillage optimiste (à renvoyer lors d'une modification). */
  version: z.number().int(),
});
export type ParticipantView = z.infer<typeof ParticipantView>;

export const ParticipantListResponse = z.object({
  participants: z.array(ParticipantView),
});
export type ParticipantListResponse = z.infer<typeof ParticipantListResponse>;

export const CreateParticipantRequest = z.strictObject({
  name: ParticipantName,
});
export type CreateParticipantRequest = z.input<typeof CreateParticipantRequest>;

export const UpdateParticipantRequest = z
  .strictObject({
    name: ParticipantName.optional(),
    isActive: z.boolean().optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    version: z.number().int().min(1),
  })
  .refine(
    (body) =>
      body.name !== undefined || body.isActive !== undefined || body.sortOrder !== undefined,
    { message: 'Aucune modification demandée' },
  );
export type UpdateParticipantRequest = z.input<typeof UpdateParticipantRequest>;

export const ParticipantIdParams = z.strictObject({ id: z.uuid() });
