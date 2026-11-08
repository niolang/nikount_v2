// Copie les migrations SQL à côté du code compilé (dist/db/migrations), utilisées par db:migrate.
import { cpSync, rmSync } from 'node:fs';

rmSync('dist/db/migrations', { recursive: true, force: true });
cpSync('src/db/migrations', 'dist/db/migrations', { recursive: true });
