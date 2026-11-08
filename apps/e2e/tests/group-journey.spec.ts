import { devices, type Browser, type Page } from '@playwright/test';
import { expect, expectAccessible, linkPath, test } from './fixtures';

/**
 * Parcours complet d'un week-end, sur téléphone : création, partage du lien, dépense déclarée
 * par une participante, validation par l'admin, remboursements, clôture.
 */

async function newPhone(browser: Browser, baseURL: string): Promise<Page> {
  // Contexte séparé = autre téléphone (stockage local distinct).
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    baseURL,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  });
  return context.newPage();
}

test('un week-end entre amis, de la création à la clôture', async ({ page, browser, baseURL }) => {
  // ── L'organisateur crée le nikount ───────────────────────────────────────────────────────
  await page.goto('/');
  await expectAccessible(page, 'accueil');
  await page.goto('/new');
  await page.getByLabel('Nom de l’événement').fill('Weekend Chamonix');
  await page.getByLabel('Votre prénom').fill('Nicolas');
  for (const name of ['Alice', 'Bob']) {
    await page.getByLabel('Participants', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Ajouter ce participant' }).click();
  }
  await expectAccessible(page, 'création');
  await page.getByRole('button', { name: 'Créer le nikount' }).click();

  await expect(page.getByRole('heading', { name: /est prêt/ })).toBeVisible();
  await expectAccessible(page, 'liens créés');
  const groupPath = await linkPath(page, 'Lien du groupe');
  const adminPath = await linkPath(page, 'Votre lien administrateur');
  expect(groupPath).toMatch(/^\/n\/p_/);
  expect(adminPath).toMatch(/^\/a\/a_/);

  // ── Alice ouvre le lien du groupe et déclare une dépense ─────────────────────────────────
  const alice = await newPhone(browser, baseURL ?? '');
  await alice.goto(groupPath);
  await expect(alice.getByRole('heading', { name: 'Qui êtes-vous ?' })).toBeVisible();
  await expectAccessible(alice, 'choix du participant');
  await alice.getByRole('button', { name: 'Alice', exact: true }).click();

  await alice.getByRole('link', { name: /Ajouter une dépense/ }).click();
  await alice.getByLabel('Montant', { exact: true }).fill('90');
  await alice.getByLabel('Description').fill('Courses Carrefour');
  await expectAccessible(alice, 'formulaire de dépense');
  await alice.getByRole('button', { name: /^Ajouter 90,00/ }).click();
  await expect(alice.getByText('Courses Carrefour')).toBeVisible();
  await expect(alice.getByText(/en attente/i).first()).toBeVisible();
  await expectAccessible(alice, 'accueil participant');

  // ── L'admin valide ───────────────────────────────────────────────────────────────────────
  await page.goto(`${adminPath}/review`);
  await expect(page.getByRole('heading', { name: 'À valider' })).toBeVisible();
  await expectAccessible(page, 'à valider');
  await page.getByRole('button', { name: 'Valider Courses Carrefour' }).click();
  await expect(page.getByText('Rien à valider. ✅')).toBeVisible();

  // Alice voit sa dépense validée : 90 € payés, 30 € chacun → +60 €.
  await alice.goto(groupPath);
  await expect(alice.getByText(/\+\s?60,00/).first()).toBeVisible();

  // ── Bob et Nicolas remboursent Alice (saisie admin, validée d'office) ────────────────────
  for (const debtor of ['Bob', 'Nicolas (moi)']) {
    await page.goto(`${adminPath}/reimbursements/new`);
    await page.getByLabel('Qui rembourse ?').selectOption({ label: debtor });
    await page.getByLabel('À qui ?').selectOption({ label: 'Alice' });
    await page.getByLabel('Montant', { exact: true }).fill('30');
    await page.getByRole('button', { name: /^Enregistrer|^Ajouter/ }).click();
    await expect(page).toHaveURL(new RegExp(`${adminPath}$`));
  }
  await expect(page.getByText(/à l’équilibre/).first()).toBeVisible();

  // ── Clôture : fin de l'événement, puis clôture des comptes ───────────────────────────────
  await page.goto(`${adminPath}/settings`);
  await expectAccessible(page, 'gestion du nikount');
  for (const action of ['Terminer l’événement', 'Clôturer les comptes']) {
    await page.getByRole('button', { name: action }).click();
    await page.getByRole('button', { name: 'Confirmer' }).click();
    await expect(page.getByRole('status')).toBeVisible();
  }

  // Le groupe voit un nikount clôturé, sans possibilité d'ajouter une dépense.
  await alice.goto(groupPath);
  await expect(alice.getByText(/clôturé/i).first()).toBeVisible();
  await expect(alice.getByRole('link', { name: /Ajouter une dépense/ })).toHaveCount(0);
  await expectAccessible(alice, 'nikount clôturé');
  await alice.context().close();
});

test('un lien invalide affiche un message clair', async ({ page }) => {
  await page.goto('/n/p_inexistant0000000000000');
  await expect(page.getByRole('heading', { name: 'Lien invalide' })).toBeVisible();
  await expectAccessible(page, 'lien invalide');
});

test('les écrans admin desktop sont accessibles', async ({ page }) => {
  const created = await page.request.post('/api/v1/nikounts', {
    data: { name: 'Asso', adminLabel: 'Trésorier', participants: ['Alice', 'Bob'] },
  });
  const { adminToken } = (await created.json()) as { adminToken: string };
  const auth = { authorization: `Bearer ${adminToken}` };
  const participants = (await (
    await page.request.get('/api/v1/participants', { headers: auth })
  ).json()) as { participants: { id: string }[] };
  const ids = participants.participants.map((p) => p.id);
  for (const [i, description] of ['Location salle', 'Boissons', 'Affiches'].entries()) {
    await page.request.post('/api/v1/transactions', {
      headers: auth,
      data: {
        clientRequestId: crypto.randomUUID(),
        type: 'EXPENSE',
        amount: 1000 * (i + 1),
        description,
        occurredOn: '2026-11-01',
        payerId: ids[i % ids.length],
        distribution: { mode: 'EQUAL', participantIds: ids },
      },
    });
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/a/${adminToken}/operations`);
  await expect(page.getByRole('heading', { name: 'Opérations' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Location salle/ })).toBeVisible();
  await expectAccessible(page, 'table des opérations');

  await page.getByRole('button', { name: 'Ouvrir le détail de Boissons' }).click();
  await expect(page.getByRole('heading', { name: 'Boissons' })).toBeVisible();
  await expectAccessible(page, 'panneau latéral');

  await page.goto(`/a/${adminToken}/audit`);
  await expect(page.getByText(/a ajouté une dépense/).first()).toBeVisible();
  await expectAccessible(page, 'journal');
});
