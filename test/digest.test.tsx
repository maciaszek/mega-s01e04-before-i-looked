import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const night = '2026-10-28';
const scratchDirs: string[] = [];

async function appWithLog(contents: string, fileNight = night) {
  const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-'));
  scratchDirs.push(runsDir);
  await writeFile(join(runsDir, `${fileNight}.jsonl`), contents, 'utf8');
  return createApp({
    adapter: 'shim',
    installed: '2026-10-29T14:06:00+01:00',
    beatEverySeconds: 60,
    runsDir,
  });
}

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const event = (at: string, job: string, status: 'ok' | 'retry' | 'fail', owner: string | null, error?: string) =>
  JSON.stringify({ at, job, status, owner, ...(error === undefined ? {} : { error }) });

describe('digest routes', () => {
  it('renders a valid night as HTML with sorted jobs, missing owners, warnings, and original offsets', async () => {
    const app = await appWithLog([
      event('2026-10-28T09:00:00-04:00', 'zeta', 'ok', 'lee'),
      event('2026-10-28T09:01:00-04:00', 'alpha', 'retry', null, 'first problem'),
      event('2026-10-28T09:02:00-04:00', 'alpha', 'retry', 'sam', 'second problem'),
      event('2026-10-28T09:03:00-04:00', 'alpha', 'retry', 'sam', 'latest problem'),
      event('2026-10-28T09:04:00-04:00', 'alpha', 'retry', 'sam'),
      event('2026-10-28T09:05:00-04:00', 'omega', 'fail', 'ari', 'disk full'),
      '',
    ].join('\n'));

    const response = await app.request(`/digest/${night}`);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain(`digest · ${night}`);
    expect(html.indexOf('<td>alpha</td>')).toBeLessThan(html.indexOf('<td>omega</td>'));
    expect(html.indexOf('<td>omega</td>')).toBeLessThan(html.indexOf('<td>zeta</td>'));
    expect(html).toContain('—');
    expect(html).toContain('2026-10-28T09:00:00-04:00');
    expect(html).toContain('2026-10-28T09:04:00-04:00');
    expect(html).toContain('latest problem');
    expect(html).toContain('disk full');
    expect(html).toMatch(/<tr class="warn"><td>alpha<\/td>/);
    expect(html).toMatch(/<tr class="warn"><td>omega<\/td>/);
  });

  it('returns the shared NightDigest shape and valid-event totals as JSON', async () => {
    const app = await appWithLog([
      event('2026-10-28T09:00:00+02:00', 'worker', 'retry', 'jo', 'temporary'),
      event('2026-10-28T09:10:00+02:00', 'worker', 'ok', null),
      'not json',
      JSON.stringify({ at: '2026-10-28T09:20:00+02:00', job: 'invalid', status: 'unknown', owner: null }),
      '',
    ].join('\n'));

    const response = await app.request(`/api/digest/${night}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      night,
      rows: [{
        job: 'worker', owner: null, runs: 2, retries: 1, lastStatus: 'ok', lastError: 'temporary',
        firstAt: '2026-10-28T09:00:00+02:00', lastAt: '2026-10-28T09:10:00+02:00',
      }],
      badLines: 2,
      totals: { ok: 1, retry: 1, fail: 0 },
    });
  });

  it('returns the same sorted jobs and order from HTML and JSON', async () => {
    const app = await appWithLog([
      event('2026-10-28T12:00:00+01:00', 'z-last', 'ok', 'zoe'),
      event('2026-10-28T11:00:00+01:00', 'a-first', 'ok', 'ana'),
      event('2026-10-28T10:00:00+01:00', 'm-middle', 'ok', 'max'),
    ].join('\n'));

    const [htmlResponse, jsonResponse] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    const html = await htmlResponse.text();
    const json = await jsonResponse.json() as { rows: Array<{ job: string }> };
    const htmlJobs = [...html.matchAll(/<td>([^<]+)<\/td>/g)].map((match) => match[1]).filter((value) =>
      ['a-first', 'm-middle', 'z-last'].includes(value),
    );
    expect(json.rows.map((row) => row.job)).toEqual(['a-first', 'm-middle', 'z-last']);
    expect(htmlJobs).toEqual(json.rows.map((row) => row.job));
  });

  it('returns 404 for a missing night in both formats', async () => {
    const runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-'));
    scratchDirs.push(runsDir);
    const app = createApp({ adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir });
    expect((await app.request(`/digest/${night}`)).status).toBe(404);
    expect((await app.request(`/api/digest/${night}`)).status).toBe(404);
  });

  it('renders an existing empty night and returns empty rows in JSON', async () => {
    const app = await appWithLog('');
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('nothing ran');
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ night, rows: [], badLines: 0, totals: { ok: 0, retry: 0, fail: 0 } });
  });

  it('reports malformed nonblank lines without dropping valid rows', async () => {
    const app = await appWithLog([
      event('2026-10-28T08:00:00-05:00', 'survivor', 'ok', 'pat'),
      '{broken',
      JSON.stringify({ at: 'bad timestamp', job: 'wrong', status: 'fail', owner: null }),
      '',
    ].join('\n'));
    const [page, api] = await Promise.all([
      app.request(`/digest/${night}`),
      app.request(`/api/digest/${night}`),
    ]);
    expect((await page.text())).toContain('2 unreadable lines');
    const result = await api.json() as { rows: Array<{ job: string }>; badLines: number };
    expect(result.badLines).toBe(2);
    expect(result.rows.map((row) => row.job)).toEqual(['survivor']);
  });

  it('returns 404 for unsafe or invalid calendar night input', async () => {
    const app = await appWithLog('');
    for (const path of ['/digest/2026-02-30', '/api/digest/2026-02-30', '/digest/not-a-date', '/api/digest/not-a-date']) {
      expect((await app.request(path)).status, path).toBe(404);
    }
  });
});
