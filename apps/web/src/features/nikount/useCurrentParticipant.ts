import { useState } from 'react';
import type { MeResponse, ParticipantView } from '@nikount/contracts';
import {
  clearDeclaredIdentity,
  getDeclaredIdentity,
  setDeclaredIdentity,
} from '../../lib/identity';

/**
 * Identité de la personne sur cet appareil :
 * - admin : le participant lié à son lien admin (identité forte) ;
 * - participant : l'identité déclarée « Je suis… », si elle désigne un participant actif.
 */
export function useCurrentParticipant(
  token: string,
  me: MeResponse,
  participants: ParticipantView[],
) {
  const [declaredId, setDeclaredId] = useState(() => getDeclaredIdentity(token));
  const active = participants.filter((p) => p.isActive);
  const id = me.role === 'ADMIN' ? (me.admin?.participantId ?? null) : declaredId;
  const current = active.find((p) => p.id === id) ?? null;

  return {
    current,
    declare: (participantId: string) => {
      setDeclaredIdentity(token, participantId);
      setDeclaredId(participantId);
    },
    reset: () => {
      clearDeclaredIdentity(token);
      setDeclaredId(null);
    },
  };
}
