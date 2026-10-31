import mongoose from 'mongoose';
import { setServers } from 'node:dns';
import { log, redact } from '../utils/logger';
import { AllModels } from '../models';

mongoose.set('strictQuery', true);
// Fail fast instead of queueing queries for 10 seconds while the database is down.
mongoose.set('bufferCommands', false);

export function isDbReady(): boolean {
  return mongoose.connection.readyState === 1;
}

export interface DbOptions {
  uri: string;
  dbName?: string;
  dnsServers?: string[];
}

/** Connects once. Throws the driver error on failure. */
export async function connectOnce(opts: DbOptions): Promise<void> {
  if (opts.dnsServers?.length) setServers(opts.dnsServers);
  await mongoose.connect(opts.uri, {
    serverSelectionTimeoutMS: 8000,
    dbName: opts.dbName,
  });
  // Build indexes before serving traffic so unique constraints are active.
  await Promise.all(AllModels.map((m) => m.init()));
}

export interface DbConnector {
  stop(): Promise<void>;
}

/**
 * Connects in the background with exponential backoff. The HTTP server starts either way:
 * /health reports the process, /health/ready reports the database, and API calls answer
 * 503 DB_UNAVAILABLE until the connection is established.
 */
export function connectWithRetry(opts: DbOptions): DbConnector {
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let attempt = 0;

  const run = async () => {
    attempt += 1;
    try {
      await connectOnce(opts);
      log.info('MongoDB connected.');
    } catch (err) {
      const delay = Math.min(30_000, 2_000 * 2 ** Math.min(attempt - 1, 4));
      log.error(
        `MongoDB connection failed (attempt ${attempt}). Check that MONGODB_URI in backend/.env is ` +
          `correct and that the database is running and reachable. Retrying in ${delay / 1000}s.`,
        err,
      );
      if (!stopped) {
        timer = setTimeout(run, delay);
        timer.unref();
      }
    }
  };

  mongoose.connection.on('disconnected', () => {
    if (!stopped) log.warn('MongoDB disconnected. The driver will try to reconnect automatically.');
  });
  mongoose.connection.on('reconnected', () => log.info('MongoDB reconnected.'));
  mongoose.connection.on('error', (err) => log.error('MongoDB connection error', err));

  void run();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await mongoose.disconnect().catch((e) => log.warn(`Error closing MongoDB: ${redact(String(e))}`));
    },
  };
}
