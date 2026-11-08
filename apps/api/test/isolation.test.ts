/**
 * Isolation entre nikounts, route par route (docs/security.md §3.7).
 *
 * Pour CHAQUE route de l'API (la liste est relue depuis Fastify : une route ajoutée sans cas
 * ici fait échouer le test) :
 * - sans token → 401 ; avec le lien participant sur une route admin → 403 ;
 * - avec les liens (admin et participant) d'un nikount B, en visant les ressources d'un
 *   nikount A : jamais de succès, jamais un identifiant ou un nom de A dans la réponse ;
 * - à la fin, l'état complet de A (vu par son admin) est strictement inchangé.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AdminListResponse,
  CreateAdminResponse,
  NikountView,
  ParticipantListResponse,
  TransactionView,
} from '@nikount/contracts';
import type { AppInstance } from '../src/lib/types.js';
import {
  bearer,
  buildTestApp,
  createNikountViaApi,
  createTestDatabase,
  type TestDatabase,
} from './helpers.js';

let testDb: TestDatabase;
let app: AppInstance;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

async function call(method: Method, url: string, token?: string, payload?: unknown) {
  return app.inject({
    method,
    url,
    ...(token ? { headers: bearer(token) } : {}),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function ok<T>(method: Method, url: string, token: string, payload?: unknown): Promise<T> {
  const response = await call(method, url, token, payload);
  if (response.statusCode >= 300) {
    throw new Error(`${method} ${url} → ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<T>();
}

async function makeNikount(name: string, adminLabel: string, people: [string, string]) {
  const created = await createNikountViaApi(app, {
    name,
    adminLabel,
    adminIsParticipant: false,
    participants: people,
  });
  const { participants } = ParticipantListResponse.parse(
    await ok('GET', '/api/v1/participants', created.adminToken),
  );
  const [first, second] = participants.map((p) => p.id);
  if (!first || !second) throw new Error('Participants manquants');
  return { ...created, first, second };
}

const expense = (payerId: string, concerned: string[], extra: Record<string, unknown> = {}) => ({
  clientRequestId: randomUUID(),
  type: 'EXPENSE',
  amount: 1000,
  description: 'Essai',
  occurredOn: '2026-11-01',
  payerId,
  distribution: { mode: 'EQUAL', participantIds: concerned },
  ...extra,
});

let A: Awaited<ReturnType<typeof makeNikount>> & {
  pendingTx: string;
  validatedTx: string;
  otherAdminId: string;
  otherAdminToken: string;
};
let B: Awaited<ReturnType<typeof makeNikount>>;

/** Tout ce qui, appartenant à A, ne doit jamais apparaître dans une réponse faite à B. */
let secretsOfA: string[];

/** État complet de A vu par son admin, sans les horodatages d'usage (modifiés par la lecture). */
async function snapshotOfA(): Promise<string> {
  const urls = [
    '/api/v1/nikount',
    '/api/v1/participants',
    '/api/v1/transactions',
    `/api/v1/transactions/${A.pendingTx}/revisions`,
    `/api/v1/transactions/${A.validatedTx}/revisions`,
    '/api/v1/admins',
    '/api/v1/audit',
    '/api/v1/balances',
    '/api/v1/nikount/participant-link',
  ];
  const parts = await Promise.all(urls.map((url) => ok<unknown>('GET', url, A.adminToken)));
  return JSON.stringify(parts, (key, value: unknown) => (key === 'lastUsedAt' ? undefined : value));
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  app = await buildTestApp(testDb.db);
  await app.ready();

  const a = await makeNikount('Alpha-secret', 'Ophélie', ['Zoé', 'Yann']);
  const pending = TransactionView.parse(
    await ok('POST', '/api/v1/transactions', a.participantToken, expense(a.first, [a.second])),
  );
  const validated = TransactionView.parse(
    await ok('POST', '/api/v1/transactions', a.adminToken, expense(a.second, [a.first, a.second])),
  );
  const other = CreateAdminResponse.parse(
    await ok('POST', '/api/v1/admins', a.adminToken, { label: 'Quentin' }),
  );
  A = {
    ...a,
    pendingTx: pending.id,
    validatedTx: validated.id,
    otherAdminId: other.admin.id,
    otherAdminToken: other.adminToken,
  };
  B = await makeNikount('Beta', 'Bruno', ['Bob', 'Carla']);

  secretsOfA = [
    'Alpha-secret',
    'Ophélie',
    'Zoé',
    'Yann',
    'Quentin',
    A.first,
    A.second,
    A.pendingTx,
    A.validatedTx,
    A.admin.id,
    A.otherAdminId,
    A.adminToken,
    A.otherAdminToken,
    A.participantToken,
  ];
});

afterAll(async () => {
  await app.close();
  await testDb.close();
});

// ─── Table des cas ─────────────────────────────────────────────────────────────────────────

interface Attempt {
  label: string;
  url: () => string;
  body?: () => unknown;
  /** La tentative vise une ressource de A : elle doit échouer. Sinon, elle agit sur B seul. */
  targetsA: boolean;
  /** Champ ignoré pour un admin (l'auteur déclaré est alors son propre participant lié). */
  ignoredForAdmin?: boolean;
}

interface RouteCase {
  route: string;
  admin: boolean;
  attempts: Attempt[];
}

const PREFIX = '/api/v1';
const bVersion = async () => NikountView.parse(await ok('GET', `${PREFIX}/nikount`, B.adminToken));
const bParticipantVersion = async () => {
  const { participants } = ParticipantListResponse.parse(
    await ok('GET', `${PREFIX}/participants`, B.adminToken),
  );
  return participants.find((p) => p.id === B.first)?.version ?? 1;
};
const own = (label: string, url: string, body?: () => unknown): Attempt => ({
  label,
  url: () => `${PREFIX}${url}`,
  ...(body ? { body } : {}),
  targetsA: false,
});
const onA = (label: string, url: () => string, body?: () => unknown): Attempt => ({
  label,
  url: () => `${PREFIX}${url()}`,
  ...(body ? { body } : {}),
  targetsA: true,
});

const statusRoute = (action: 'validate' | 'reject' | 'cancel'): RouteCase => ({
  route: `POST ${PREFIX}/transactions/:id/${action}`,
  admin: true,
  attempts: [
    onA(
      'opération en attente de A',
      () => `/transactions/${A.pendingTx}/${action}`,
      () => ({}),
    ),
    onA(
      'opération validée de A',
      () => `/transactions/${A.validatedTx}/${action}`,
      () => ({}),
    ),
  ],
});

const CASES: RouteCase[] = [
  { route: `GET ${PREFIX}/me`, admin: false, attempts: [own('lecture', '/me')] },
  { route: `GET ${PREFIX}/nikount`, admin: false, attempts: [own('lecture', '/nikount')] },
  {
    route: `PATCH ${PREFIX}/nikount`,
    admin: true,
    attempts: [
      own('renommer son nikount', '/nikount', async () => ({
        name: 'Beta bis',
        version: (await bVersion()).version,
      })),
    ],
  },
  {
    route: `GET ${PREFIX}/nikount/participant-link`,
    admin: true,
    attempts: [own('lecture', '/nikount/participant-link')],
  },
  {
    route: `POST ${PREFIX}/nikount/participant-link/rotate`,
    admin: true,
    attempts: [own('rotation', '/nikount/participant-link/rotate', () => ({}))],
  },
  {
    route: `POST ${PREFIX}/nikount/state`,
    admin: true,
    attempts: [
      own('passer en règlement', '/nikount/state', async () => ({
        to: 'SETTLEMENT',
        version: (await bVersion()).version,
      })),
    ],
  },
  { route: `GET ${PREFIX}/admins`, admin: true, attempts: [own('lecture', '/admins')] },
  {
    route: `POST ${PREFIX}/admins`,
    admin: true,
    attempts: [
      onA(
        'admin lié à un participant de A',
        () => '/admins',
        () => ({
          label: 'Intrus',
          participantId: A.first,
        }),
      ),
      own('admin simple', '/admins', () => ({ label: 'Bea' })),
    ],
  },
  {
    route: `POST ${PREFIX}/admins/:id/revoke`,
    admin: true,
    attempts: [
      onA(
        'révoquer un admin de A',
        () => `/admins/${A.otherAdminId}/revoke`,
        () => ({}),
      ),
    ],
  },
  {
    route: `GET ${PREFIX}/audit`,
    admin: true,
    attempts: [
      own('lecture', '/audit'),
      // Un filtre est permis (200), mais la réponse ne doit rien contenir de A.
      {
        ...own('filtré sur une opération de A', ''),
        url: () => `${PREFIX}/audit?entityId=${A.pendingTx}`,
      },
      {
        ...own('filtré sur un admin de A', ''),
        url: () => `${PREFIX}/audit?entityId=${A.otherAdminId}`,
      },
    ],
  },
  { route: `GET ${PREFIX}/balances`, admin: false, attempts: [own('lecture', '/balances')] },
  {
    route: `GET ${PREFIX}/participants`,
    admin: false,
    attempts: [own('lecture', '/participants')],
  },
  {
    route: `POST ${PREFIX}/participants`,
    admin: true,
    attempts: [own('ajout', '/participants', () => ({ name: 'Dora' }))],
  },
  {
    route: `PATCH ${PREFIX}/participants/:id`,
    admin: true,
    attempts: [
      onA(
        'renommer un participant de A',
        () => `/participants/${A.first}`,
        () => ({
          name: 'Pirate',
          version: 1,
        }),
      ),
      onA(
        'désactiver un participant de A',
        () => `/participants/${A.second}`,
        () => ({
          isActive: false,
          version: 1,
        }),
      ),
      own('renommer le sien', '/participants/' + '__B_FIRST__', async () => ({
        name: 'Bobby',
        version: await bParticipantVersion(),
      })),
    ],
  },
  {
    route: `GET ${PREFIX}/transactions`,
    admin: false,
    attempts: [own('liste', '/transactions')],
  },
  {
    route: `POST ${PREFIX}/transactions`,
    admin: false,
    attempts: [
      onA(
        'payeur de A',
        () => '/transactions',
        () => expense(A.first, [B.first]),
      ),
      onA(
        'concerné de A',
        () => '/transactions',
        () => expense(B.first, [B.second, A.second]),
      ),
      onA(
        'parts avec un participant de A',
        () => '/transactions',
        () => ({
          ...expense(B.first, []),
          distribution: {
            mode: 'SHARES',
            shares: [
              { participantId: B.first, value: 1 },
              { participantId: A.first, value: 1 },
            ],
          },
        }),
      ),
      {
        ...onA(
          'déclarée au nom d’un participant de A',
          () => '/transactions',
          () => expense(B.first, [B.second], { declaredByParticipantId: A.first }),
        ),
        ignoredForAdmin: true,
      },
    ],
  },
  {
    route: `GET ${PREFIX}/transactions/:id`,
    admin: false,
    attempts: [
      onA('opération de A', () => `/transactions/${A.pendingTx}`),
      onA('opération validée de A', () => `/transactions/${A.validatedTx}`),
    ],
  },
  {
    route: `GET ${PREFIX}/transactions/:id/revisions`,
    admin: false,
    attempts: [onA('révisions de A', () => `/transactions/${A.validatedTx}/revisions`)],
  },
  {
    route: `PUT ${PREFIX}/transactions/:id`,
    admin: true,
    attempts: [
      onA(
        'modifier une opération de A avec ses propres participants',
        () => `/transactions/${A.validatedTx}`,
        () => {
          const { clientRequestId: _ignored, type: _type, ...body } = expense(B.first, [B.second]);
          return { ...body, category: null, version: 1 };
        },
      ),
    ],
  },
  statusRoute('validate'),
  statusRoute('reject'),
  statusRoute('cancel'),
  {
    route: `POST ${PREFIX}/transactions/bulk`,
    admin: true,
    attempts: [
      onA(
        'valider en masse des opérations de A',
        () => '/transactions/bulk',
        () => ({
          action: 'validate',
          ids: [A.pendingTx],
        }),
      ),
      onA(
        'annuler en masse des opérations de A',
        () => '/transactions/bulk',
        () => ({
          action: 'cancel',
          ids: [A.validatedTx, A.pendingTx],
        }),
      ),
    ],
  },
];

/** Routes publiques : pas de token, pas de données d'un nikount. */
const PUBLIC_ROUTES = [`GET ${PREFIX}/health`, `POST ${PREFIX}/nikounts`];

/** Lit l'arbre de `printRoutes` et renvoie « MÉTHODE /chemin » pour chaque route (sans HEAD). */
function registeredRoutes(): string[] {
  const stack: string[] = [];
  const routes: string[] = [];
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = /^([│ ]*)[├└]── (\S+)(?: \(([^)]+)\))?/.exec(line);
    if (!match) continue;
    const depth = (match[1] ?? '').length / 4;
    stack.length = depth;
    stack.push(match[2] ?? '');
    for (const method of (match[3] ?? '').split(', ')) {
      if (method && method !== 'HEAD') routes.push(`${method} ${stack.join('')}`);
    }
  }
  return routes.sort();
}

const resolveUrl = (attempt: Attempt) => attempt.url().replace('__B_FIRST__', B.first);
const methodOf = (route: string) => route.split(' ')[0] as Method;
const routeUrlFor = (c: RouteCase) => {
  const attempt = c.attempts[0];
  if (!attempt) throw new Error(`Aucun essai pour ${c.route}`);
  return resolveUrl(attempt);
};

// ─── Tests ─────────────────────────────────────────────────────────────────────────────────

describe('isolation des nikounts, route par route', () => {
  it('chaque route de l’API a son cas d’isolation', () => {
    const covered = [...CASES.map((c) => c.route), ...PUBLIC_ROUTES].sort();
    expect(registeredRoutes()).toEqual(covered);
  });

  it('sans token : 401 sur toutes les routes protégées', async () => {
    for (const c of CASES) {
      const response = await call(methodOf(c.route), routeUrlFor(c));
      expect(response.statusCode, c.route).toBe(401);
    }
  });

  it('avec le lien participant : 403 sur toutes les routes admin', async () => {
    for (const c of CASES.filter((x) => x.admin)) {
      const attempt = c.attempts[0];
      const body = attempt?.body ? await attempt.body() : undefined;
      const response = await call(methodOf(c.route), routeUrlFor(c), B.participantToken, body);
      expect(response.statusCode, c.route).toBe(403);
    }
  });

  it('les liens de B n’atteignent jamais A, et A reste strictement inchangé', async () => {
    const before = await snapshotOfA();
    // En dernier : la rotation invalide le lien participant de B, le changement d'état bloque
    // la création d'opérations.
    const last = (c: RouteCase) => /\/(rotate|state)$/.test(c.route);
    const ordered = [...CASES.filter((c) => !last(c)), ...CASES.filter(last)];
    let ownSuccesses = 0;

    for (const c of ordered) {
      for (const attempt of c.attempts) {
        for (const [who, token] of [
          ['admin B', B.adminToken],
          ['participant B', B.participantToken],
        ] as const) {
          const body = attempt.body ? await attempt.body() : undefined;
          const response = await call(methodOf(c.route), resolveUrl(attempt), token, body);
          const where = `${c.route} — ${attempt.label} (${who}) → ${String(response.statusCode)}`;

          // Un identifiant envoyé par B peut être cité dans l'erreur : ce n'est pas une fuite.
          const sent = resolveUrl(attempt) + JSON.stringify(body ?? null);
          for (const secret of secretsOfA.filter((s) => !sent.includes(s))) {
            expect(response.body.includes(secret), `${where} : contient « ${secret} »`).toBe(false);
          }
          if (attempt.ignoredForAdmin && who === 'admin B') {
            expect(response.statusCode, where).toBe(201);
            const created = TransactionView.parse(response.json());
            expect(created.createdBy.declaredParticipantId, where).toBeNull();
          } else if (attempt.targetsA) {
            expect(response.statusCode, where).toBeGreaterThanOrEqual(400);
            expect(response.statusCode, where).toBeLessThan(500);
          } else if (who === 'admin B' || !c.admin) {
            // Vérifie que le cas « propre à B » s'exécute vraiment (sinon il ne prouve rien).
            expect(response.statusCode, where).toBeLessThan(300);
            ownSuccesses += 1;
          }
        }
      }
    }

    expect(ownSuccesses).toBeGreaterThan(10);
    expect(await snapshotOfA()).toBe(before);
  });

  it('un filtre d’audit sur une ressource de A ne renvoie rien à B', async () => {
    const { events } = await ok<{ events: unknown[] }>(
      'GET',
      `${PREFIX}/audit?entityId=${A.validatedTx}`,
      B.adminToken,
    );
    expect(events).toEqual([]);
  });

  it('les admins de B ne voient que les leurs', async () => {
    const { admins } = AdminListResponse.parse(await ok('GET', `${PREFIX}/admins`, B.adminToken));
    expect(admins.map((admin) => admin.label).sort()).toEqual(['Bea', 'Bruno']);
  });
});
