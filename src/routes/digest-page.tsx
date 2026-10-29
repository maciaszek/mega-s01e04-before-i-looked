import type { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import type { ReadNight } from '../digest/types.js';
import { lane } from '../lane.js';
import { DigestPage } from '../views/digest.js';
import { Layout } from '../views/layout.js';

function isCalendarNight(night: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(night)) return false;
  const instant = Date.parse(`${night}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === night;
}

export function registerDigestPage(app: Hono, config: RigConfig, readNight: ReadNight): void {
  app.get('/digest/:night', (c) => {
    const night = c.req.param('night');
    if (!isCalendarNight(night)) return c.notFound();

    const digest = readNight(config.runsDir, night);
    if (!digest) return c.notFound();

    return c.html(
      <Layout title={`digest · ${night}`} lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });
}
