import { z } from 'zod';

/** Caractères de contrôle et de contrôle bidirectionnel (usurpation visuelle). */
const UNSAFE_CHARS = /[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu;

/**
 * Normalise un texte saisi par un utilisateur : NFC, suppression des caractères de contrôle,
 * espaces multiples réduits, bords rognés (docs/security.md §4).
 */
export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(UNSAFE_CHARS, ' ').replace(/\s+/gu, ' ').trim();
}

/** Texte libre court, normalisé puis borné (longueur comptée après normalisation). */
export function cleanText(min: number, max: number) {
  return z
    .string()
    .max(max * 4)
    .transform(normalizeText)
    .pipe(z.string().min(min).max(max));
}
