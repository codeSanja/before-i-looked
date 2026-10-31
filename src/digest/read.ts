import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestNight, DigestRow, ReadNight, RunStatus } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly unknown[] = ['ok', 'retry', 'fail'] satisfies RunStatus[];

type LogLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error: string | null;
};

function isStatus(value: unknown): value is RunStatus {
  return STATUSES.includes(value);
}

function parseLine(line: string): LogLine | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || typeof job !== 'string' || !isStatus(status)) return null;
  if (owner !== undefined && owner !== null && typeof owner !== 'string') return null;

  return {
    at,
    job,
    status,
    owner: owner ?? null,
    error: typeof error === 'string' ? error : null,
  };
}

function readLog(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export const readNight: ReadNight = (runsDir, night) => {
  // Checked first: `night` becomes part of a path.
  if (!NIGHT.test(night)) return null;

  const log = readLog(join(runsDir, `${night}.jsonl`));
  if (log === null) return null;

  const rows = new Map<string, DigestRow>();
  const counts: DigestNight['counts'] = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of log.split('\n')) {
    if (line.trim() === '') continue;

    const parsed = parseLine(line);
    if (parsed === null) {
      badLines += 1;
      continue;
    }

    counts[parsed.status] += 1;

    // First, last and latest follow file order; times are kept as written, never compared.
    const row = rows.get(parsed.job);
    if (row === undefined) {
      rows.set(parsed.job, {
        job: parsed.job,
        owner: parsed.owner,
        runs: 1,
        retries: parsed.status === 'retry' ? 1 : 0,
        fails: parsed.status === 'fail' ? 1 : 0,
        lastStatus: parsed.status,
        lastError: parsed.error,
        firstAt: parsed.at,
        lastAt: parsed.at,
      });
      continue;
    }

    row.runs += 1;
    if (parsed.status === 'retry') row.retries += 1;
    if (parsed.status === 'fail') row.fails += 1;
    row.lastStatus = parsed.status;
    row.lastAt = parsed.at;
    row.owner = parsed.owner ?? row.owner;
    row.lastError = parsed.error ?? row.lastError;
  }

  return {
    night,
    rows: [...rows.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0)),
    badLines,
    counts,
  };
};
