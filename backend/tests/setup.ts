import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Optional: put TEST_MONGODB_URI in backend/.env.test instead of exporting it in your shell.
const file = resolve(process.cwd(), '.env.test');
if (existsSync(file)) process.loadEnvFile(file);
