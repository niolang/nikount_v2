import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

/**
 * Chaque page ouverte échoue le test si la console affiche une erreur (violation de CSP,
 * exception, requête refusée inattendue).
 */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      // Violations de CSP : certaines (eval tenté puis rattrapé) n'apparaissent pas en console.
      await context.exposeBinding('__reportCspViolation', ({ page }, violation: string) => {
        errors.push(`${page.url()} : CSP ${violation}`);
      });
      await context.addInitScript(() => {
        document.addEventListener('securitypolicyviolation', (event) => {
          const report = (window as unknown as Record<string, (v: string) => void>)[
            '__reportCspViolation'
          ];
          report?.(`${event.violatedDirective} ${event.blockedURI} (${event.sourceFile})`);
        });
      });
      context.on('page', (page) => {
        watch(page, errors);
      });
      for (const page of context.pages()) watch(page, errors);
      await use(errors);
      expect(errors, 'erreurs dans la console du navigateur').toEqual([]);
    },
    { auto: true },
  ],
});

/** Statuts HTTP attendus dans un parcours (refus métier affichés à l'utilisateur). */
const EXPECTED_STATUS = /status of (401|409|429)/;

function watch(page: Page, errors: string[]) {
  page.on('console', (message) => {
    if (message.type() === 'error' && !EXPECTED_STATUS.test(message.text())) {
      errors.push(`${page.url()} : ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`${page.url()} : ${error.message}`);
  });
}

export { expect };

/**
 * Audit d'accessibilité (axe-core, WCAG 2.1 A et AA) de l'écran affiché : aucune violation
 * grave ou critique tolérée.
 */
export async function expectAccessible(page: Page, screen: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? '?'}) : ${violation.help} — ${violation.nodes
          .slice(0, 3)
          .map((node) => node.target.join(' '))
          .join(' | ')}`,
    );
  expect(blocking, `accessibilité de « ${screen} »`).toEqual([]);
}

/** Chemin d'un lien de partage affiché par l'application (l'origine dépend de la config). */
export async function linkPath(page: Page, label: string): Promise<string> {
  const url = await page.getByLabel(label, { exact: true }).inputValue();
  return new URL(url).pathname;
}
