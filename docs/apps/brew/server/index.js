import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as defaultConfig } from './config.js';
import { createLogger } from './logger.js';
import { Metrics } from './metrics.js';
import { createAuthProvider } from './auth/devAuthProvider.js';
import { PlayerStore } from './persistence/playerStore.js';
import { RoomManager } from './rooms/roomManager.js';
import { GameServer } from './gameServer.js';
import { createHttpServer } from './httpServer.js';

export async function createApp(overrides = {}) {
  const config = overrides.config || defaultConfig;
  const logger = overrides.logger || createLogger(config);
  const metrics = overrides.metrics || new Metrics();
  const auth = overrides.auth || createAuthProvider(config);
  const store =
    overrides.store ||
    new PlayerStore({
      filePath: config.database.path,
      enabled: config.database.enabled,
      flushIntervalMs: config.database.flushIntervalMs,
      logger,
    });
  if (!overrides.store) await store.init();
  const roomManager = new RoomManager({ config, logger, metrics, store });
  const gameServer = new GameServer({ config, logger, metrics, auth, store, roomManager });
  const httpServer = createHttpServer({ config, logger, metrics, auth, store, gameServer });

  const app = {
    config,
    logger,
    metrics,
    auth,
    store,
    roomManager,
    gameServer,
    httpServer,
    async start() {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          httpServer.off('listening', onListening);
          reject(err);
        };
        const onListening = () => {
          httpServer.off('error', onError);
          resolve();
        };
        httpServer.once('error', onError);
        httpServer.once('listening', onListening);
        httpServer.listen(config.port, config.host);
      });
      gameServer.start();
      const address = httpServer.address();
      logger.info('brew server listening', {
        host: config.host,
        port: address && address.port,
        profile: config.profile,
        static: config.serveStatic,
        ws: '/ws',
      });
      return app;
    },
    async stop() {
      await gameServer.shutdown();
      await new Promise((resolve) => httpServer.close(() => resolve()));
      await store.close();
      logger.info('brew server closed');
      return app;
    },
  };
  return app;
}

function installSignals(app) {
  let closing = false;
  const shutdown = (signal) => async () => {
    if (closing) return;
    closing = true;
    app.logger.info('shutdown signal received', { signal });
    try {
      await app.stop();
    } catch (err) {
      app.logger.error('shutdown failed', { error: err.message });
    }
    process.exit(0);
  };
  process.once('SIGINT', shutdown('SIGINT'));
  process.once('SIGTERM', shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    app.logger.error('uncaught exception', { error: err.message, stack: err.stack });
  });
  process.on('unhandledRejection', (reason) => {
    app.logger.error('unhandled rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
  const app = await createApp();
  installSignals(app);
  await app.start();
}
