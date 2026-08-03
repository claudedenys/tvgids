import type { MiddlewareHandler } from 'astro';

/**
 * Start bij productie een automatische EPG-updater in de server.
 * Uitschakelen met AUTO_UPDATE=false.
 */
let started = false;

export const onRequest: MiddlewareHandler = async (context, next) => {
  if (!started && process.env.NODE_ENV === 'production' && process.env.AUTO_UPDATE !== 'false') {
    started = true;
    const { startAutoUpdate } = await import('./lib/schedule');
    startAutoUpdate();
  }
  return next();
};
