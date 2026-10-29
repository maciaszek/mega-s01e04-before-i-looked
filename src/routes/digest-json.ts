import type { Hono } from 'hono';
import type { ReadNight } from '../digest/types.js';
import type { RigConfig } from '../config.js';

export function registerDigestJson(
  app: Hono,
  config: RigConfig,
  readNight: ReadNight,
): void {
  app.get('/api/digest/:night', (c) => {
    const { night } = c.req.param();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) {
      return c.json({ error: 'not found' }, 404);
    }

    const digest = readNight(config.runsDir, night);
    if (digest === null) return c.json({ error: 'not found' }, 404);
    return c.json(digest);
  });
}
