import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const NIGHT_ROWS = '2026-10-28';
const NIGHT_EMPTY = '2026-10-29';
const NIGHT_BAD = '2026-10-30';
const NIGHT_MISSING = '2026-11-01';

const goodLines = [
  { at: '2026-10-28T02:00:05+01:00', job: 'rotate-logs', owner: 'ops', status: 'ok' },
  { at: '2026-10-28T02:10:00+01:00', job: 'backup-db', owner: null, status: 'retry', error: 'timeout' },
  { at: '2026-10-28T02:12:00+01:00', job: 'backup-db', owner: null, status: 'fail', error: 'disk full' },
  { at: '2026-10-28T01:30:00+01:00', job: 'build-index', owner: 'search', status: 'ok' },
  { at: '2026-10-28T03:00:00+01:00', job: 'send-digest', owner: 'mail', status: 'ok' },
];

let runsDir: string;

const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: '',
};

function appFor(dir: string) {
  return createApp({ ...config, runsDir: dir });
}

beforeAll(() => {
  runsDir = mkdtempSync(join(tmpdir(), 'digest-routes-'));
  writeFileSync(
    join(runsDir, `${NIGHT_ROWS}.jsonl`),
    goodLines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
  writeFileSync(join(runsDir, `${NIGHT_EMPTY}.jsonl`), '');
  writeFileSync(
    join(runsDir, `${NIGHT_BAD}.jsonl`),
    [
      JSON.stringify({ at: '2026-10-30T02:00:00+01:00', job: 'rotate-logs', owner: 'ops', status: 'ok' }),
      '{this is not json',
      JSON.stringify({ at: '2026-10-30T02:05:00+01:00', job: 'send-digest', owner: 'mail', status: 'ok' }),
    ].join('\n') + '\n',
  );
});

afterAll(() => {
  rmSync(runsDir, { recursive: true, force: true });
});

// Job names in the order they appear in the HTML page.
function jobsInHtml(html: string, jobs: string[]): string[] {
  return jobs
    .map((job) => ({ job, at: html.indexOf(job) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map((x) => x.job);
}

describe('digest page: GET /digest/:night', () => {
  it('returns 200 for a night with rows', async () => {
    const res = await appFor(runsDir).request(`/digest/${NIGHT_ROWS}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('rotate-logs');
    expect(html).toContain('backup-db');
    expect(html).toContain('build-index');
    expect(html).toContain('send-digest');
  });

  it('returns 404 for a night with no file', async () => {
    const res = await appFor(runsDir).request(`/digest/${NIGHT_MISSING}`);
    expect(res.status).toBe(404);
  });

  it('says "nothing ran" for an empty night', async () => {
    const res = await appFor(runsDir).request(`/digest/${NIGHT_EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('renders a night with a bad line, keeping the good rows', async () => {
    const res = await appFor(runsDir).request(`/digest/${NIGHT_BAD}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('rotate-logs');
    expect(html).toContain('send-digest');
  });
});

describe('digest JSON: GET /api/digest/:night', () => {
  it('returns 200 and the digest shape for a night with rows', async () => {
    const res = await appFor(runsDir).request(`/api/digest/${NIGHT_ROWS}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.night).toBe(NIGHT_ROWS);
    expect(body.badLines).toBe(0);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.length).toBe(4);
    for (const row of body.rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['firstAt', 'job', 'lastAt', 'lastError', 'lastStatus', 'owner', 'retries', 'runs'].sort(),
      );
    }
    const backup = body.rows.find((r: { job: string }) => r.job === 'backup-db');
    expect(backup).toMatchObject({ owner: null, runs: 2, retries: 1, lastStatus: 'fail', lastError: 'disk full' });
    expect(body.counts).toEqual({ ok: 3, retry: 1, fail: 1 });
  });

  it('returns 404 with an error body for a night with no file', async () => {
    const res = await appFor(runsDir).request(`/api/digest/${NIGHT_MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no such night' });
  });

  it('returns rows: [] for an empty night', async () => {
    const res = await appFor(runsDir).request(`/api/digest/${NIGHT_EMPTY}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([]);
    expect(body.badLines).toBe(0);
  });

  it('counts a bad line and still returns the good rows', async () => {
    const res = await appFor(runsDir).request(`/api/digest/${NIGHT_BAD}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r: { job: string }) => r.job)).toEqual(['rotate-logs', 'send-digest']);
  });
});

describe('page and JSON agree', () => {
  it.each([NIGHT_ROWS, NIGHT_BAD])('lists the same jobs in the same order for %s', async (night) => {
    const app = appFor(runsDir);
    const json = await (await app.request(`/api/digest/${night}`)).json();
    const jobs: string[] = json.rows.map((r: { job: string }) => r.job);
    const html = await (await app.request(`/digest/${night}`)).text();
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobsInHtml(html, jobs)).toEqual(jobs);
  });
});
