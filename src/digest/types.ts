// Plan morning-digest. The contract every part of the digest works against.
export type RunStatus = 'ok' | 'retry' | 'fail';

// One job's night. Times keep the log's offset, as written.
export type DigestRow = {
  job: string;
  owner: string | null; // null renders as —
  runs: number; // lines for this job
  retries: number; // lines with status "retry"
  lastStatus: RunStatus;
  lastError: string | null; // error of the job's last line that has one
  firstAt: string;
  lastAt: string;
};

export type DigestNight = {
  night: string;
  rows: DigestRow[]; // sorted by job
  badLines: number; // lines that don't parse: counted, never thrown
  counts: Record<RunStatus, number>; // lines per status, all jobs
};

// null: no file for this night, or `night` isn't YYYY-MM-DD. An empty file gives rows: [].
// The implementation is `readNight` in src/digest/read.ts.
export type ReadNight = (runsDir: string, night: string) => DigestNight | null;
