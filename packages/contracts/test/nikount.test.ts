import { describe, expect, it } from 'vitest';
import { CreateNikountRequest, normalizeText, tokenRole } from '../src/index.js';

describe('normalizeText', () => {
  it('rogne, réduit les espaces et retire les caractères de contrôle', () => {
    expect(normalizeText('  Weekend \t\n Chamonix  ')).toBe('Weekend Chamonix');
    expect(normalizeText('A\u0000B\u0007C')).toBe('A B C');
  });

  it('retire les caractères de contrôle bidirectionnel (usurpation visuelle)', () => {
    expect(normalizeText('Alice\u202eecila')).toBe('Alice ecila');
  });

  it('normalise en NFC', () => {
    // « e » suivi de l'accent aigu combinant U+0301 (forme décomposée, NFD).
    const decomposed = `Cafe${String.fromCodePoint(0x301)}`;
    expect(decomposed).toHaveLength(5);
    expect(normalizeText(decomposed)).toBe('Café');
    expect(normalizeText(decomposed)).toHaveLength(4);
  });

  it('conserve les emoji composés', () => {
    expect(normalizeText('🏔️ Chamonix 👨‍👩‍👧')).toBe('🏔️ Chamonix 👨‍👩‍👧');
  });
});

describe('CreateNikountRequest', () => {
  it('normalise et complète la devise par défaut', () => {
    expect(CreateNikountRequest.parse({ name: '  Weekend  ', adminLabel: ' Nicolas ' })).toEqual({
      name: 'Weekend',
      adminLabel: 'Nicolas',
      currency: 'EUR',
    });
  });

  it.each([
    ['nom vide', { name: '   ', adminLabel: 'Nicolas' }],
    ['nom trop long', { name: 'x'.repeat(61), adminLabel: 'Nicolas' }],
    ['admin vide', { name: 'Weekend', adminLabel: '' }],
    ['devise inconnue', { name: 'Weekend', adminLabel: 'Nicolas', currency: 'XYZ' }],
    ['devise mal formée', { name: 'Weekend', adminLabel: 'Nicolas', currency: 'eur' }],
    ['champ inconnu', { name: 'Weekend', adminLabel: 'Nicolas', nikountId: 'x' }],
  ])('refuse : %s', (_label, input) => {
    expect(CreateNikountRequest.safeParse(input).success).toBe(false);
  });
});

describe('tokenRole', () => {
  it('reconnaît les formats', () => {
    expect(tokenRole(`p_${'A'.repeat(22)}`)).toBe('PARTICIPANT');
    expect(tokenRole(`a_${'A'.repeat(43)}`)).toBe('ADMIN');
  });

  it.each([
    '',
    'p_',
    `p_${'A'.repeat(21)}`,
    `a_${'A'.repeat(22)}`,
    `x_${'A'.repeat(22)}`,
    `p_${'+'.repeat(22)}`,
  ])('refuse « %s »', (token) => {
    expect(tokenRole(token)).toBeNull();
  });
});
