import { ApiError } from '../../api/client';

/** Message lisible pour un échec de validation, refus ou annulation. */
export function statusErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'INVALID_STATUS_TRANSITION':
      case 'VERSION_CONFLICT':
        return 'Quelqu’un a déjà traité cette opération : la liste a été rechargée.';
      case 'INVALID_STATE':
        return error.message;
      case 'NOT_FOUND':
        return 'Opération introuvable : la liste a été rechargée.';
      case 'VALIDATION_ERROR':
        return 'Motif trop long (200 caractères au plus).';
    }
  }
  return 'L’opération a échoué. Vérifiez votre connexion et réessayez.';
}
