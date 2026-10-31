import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const NIGHT = '2026-01-02';

describe('readNight on runs/2026-10-28.jsonl', () => {
  const digest = readNight('runs', '2026-10-28');

  it('finds 5 jobs and 1 bad line', () => {
    expect(digest?.night).toBe('2026-10-28');
    expect(digest?.rows).toHaveLength(5);
    expect(digest?.badLines).toBe(1);
  });

  it('sorts rows by job', () => {
    expect(digest?.rows.map((row) => row.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
  });

  it('keeps the row of a job with a null owner', () => {
    expect(digest?.rows[0]).toMatchObject({ job: 'digest/render', owner: null, runs: 1 });
  });

  it('aggregates a job and keeps the offset on its times', () => {
    expect(digest?.rows[1]).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('counts lines per status across jobs', () => {
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });
});

describe('readNight on other logs', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'digest-read-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const read = (content: string) => {
    writeFileSync(join(dir, `${NIGHT}.jsonl`), content);
    return readNight(dir, NIGHT);
  };

  const line = (fields: Record<string, unknown>) =>
    JSON.stringify({ at: '2026-01-02T23:00:00+01:00', job: 'a', status: 'ok', ...fields });

  it('returns null when the file is missing', () => {
    expect(readNight(dir, NIGHT)).toBeNull();
    expect(readNight(join(dir, 'nope'), NIGHT)).toBeNull();
  });

  it.each(['', '2026-1-2', '20260102', '2026-01-02.jsonl', '2026-01-02\n', 'x2026-01-02'])(
    'returns null for the malformed night %j',
    (night) => {
      expect(readNight(dir, night)).toBeNull();
    },
  );

  it('does not follow a night that traverses to a real file', () => {
    const inner = join(dir, 'runs');
    mkdirSync(inner);
    writeFileSync(join(dir, `${NIGHT}.jsonl`), line({}));
    expect(readNight(inner, `../${NIGHT}`)).toBeNull();
  });

  it('gives an empty night for an empty file', () => {
    expect(read('')).toEqual({
      night: NIGHT,
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('ignores blank lines and tolerates CRLF', () => {
    const digest = read(`\n${line({})}\r\n   \n\r\n${line({})}\n\n`);
    expect(digest?.rows[0]?.runs).toBe(2);
    expect(digest?.badLines).toBe(0);
  });

  it.each([
    ['a truncated line', '{"at":"x","job":"a"'],
    ['not JSON', 'nope'],
    ['a null', 'null'],
    ['a number', '42'],
    ['a string', '"ok"'],
    ['an array', '[]'],
    ['a missing at', JSON.stringify({ job: 'a', status: 'ok' })],
    ['a non-string at', line({ at: 1 })],
    ['a missing job', JSON.stringify({ at: 'x', status: 'ok' })],
    ['a non-string job', line({ job: null })],
    ['a missing status', JSON.stringify({ at: 'x', job: 'a' })],
    ['an unknown status', line({ status: 'skipped' })],
    ['an inherited-name status', line({ status: 'constructor' })],
    ['a numeric owner', line({ owner: 7 })],
    ['an object owner', line({ owner: {} })],
  ])('counts %s as bad and leaves rows and counts alone', (_name, bad) => {
    expect(read(`${bad}\n`)).toEqual({
      night: NIGHT,
      rows: [],
      badLines: 1,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('accepts an absent owner as null', () => {
    expect(read(`${line({})}\n`)?.rows[0]?.owner).toBeNull();
  });

  it('takes the last non-null owner of the job', () => {
    const digest = read(
      [
        line({ owner: null }),
        line({ owner: 'first' }),
        line({ owner: 'second' }),
        line({ owner: null }),
        line({}),
      ].join('\n'),
    );
    expect(digest?.rows[0]?.owner).toBe('second');
  });

  it('keeps the last error when later lines have none', () => {
    const digest = read(
      [
        line({ status: 'retry', error: 'one' }),
        line({ status: 'retry', error: 'two' }),
        line({ status: 'ok' }),
      ].join('\n'),
    );
    expect(digest?.rows[0]).toMatchObject({ lastError: 'two', lastStatus: 'ok', retries: 2 });
  });

  it('has a null last error when the job never had one', () => {
    expect(read(line({}))?.rows[0]?.lastError).toBeNull();
  });

  it('keeps times as written, in file order, across offsets', () => {
    const digest = read(
      [
        line({ at: '2026-01-03T00:30:00+02:00' }),
        line({ at: '2026-01-02T23:45:00+01:00' }),
      ].join('\n'),
    );
    expect(digest?.rows[0]).toMatchObject({
      firstAt: '2026-01-03T00:30:00+02:00',
      lastAt: '2026-01-02T23:45:00+01:00',
    });
  });

  it('sorts by code unit, not by locale', () => {
    const jobs = ['b', 'a', 'B', 'é', 'a/b', 'a-b'];
    const digest = read(jobs.map((job) => line({ job })).join('\n'));
    expect(digest?.rows.map((row) => row.job)).toEqual(['B', 'a', 'a-b', 'a/b', 'b', 'é']);
  });

  it('handles a job named like an Object.prototype key', () => {
    const digest = read(`${line({ job: '__proto__' })}\n${line({ job: 'constructor' })}\n`);
    expect(digest?.rows.map((row) => row.job)).toEqual(['__proto__', 'constructor']);
  });
});
