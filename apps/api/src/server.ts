import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase, isDatabaseUp } from './db/client.js';

const config = loadConfig();
const database = createDatabase(config.DATABASE_URL);
const app = await buildApp({ config, checkDatabase: () => isDatabaseUp(database.db) });

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, 'Arrêt en cours');
  await app.close();
  await database.close();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'Démarrage impossible');
  await database.close();
  process.exit(1);
}
