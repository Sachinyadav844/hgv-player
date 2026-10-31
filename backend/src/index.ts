import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError, loadConfig } from './config/env';
import { connectWithRetry } from './config/db';
import { buildServer } from './server';
import { log } from './utils/logger';

// Load backend/.env (or a root .env) for local development. Real environment variables win, so
// hosting platforms that inject variables are unaffected. Secrets are never logged.
for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../.env')]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch (err) {
      console.error(`Could not read ${candidate}:`, err instanceof Error ? err.message : err);
    }
    break;
  }
}

let config;
try {
  config = loadConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const db = connectWithRetry({ uri: config.mongoUri, dnsServers: config.mongoDnsServers });
const { httpServer, close } = buildServer(config);

httpServer.listen(config.port, () => {
  log.info(`HGV Player server listening on port ${config.port} (${config.nodeEnv}).`);
  log.info(`Allowed client origin(s): ${config.clientOrigins.join(', ')}`);
});
httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${config.port} is already in use. Change PORT in backend/.env or stop the other process.`);
  } else {
    console.error('HTTP server error:', err.message);
  }
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`${signal} received. Shutting down gracefully...`);
  const force = setTimeout(() => {
    log.error('Forced exit after shutdown timeout.');
    process.exit(1);
  }, 10_000);
  force.unref();
  try {
    await close();
    await db.stop();
    log.info('Shutdown complete.');
    process.exit(0);
  } catch (err) {
    log.error('Error during shutdown', err);
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => log.error('Unhandled promise rejection', reason));
