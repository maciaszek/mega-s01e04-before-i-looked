/** Status of one valid run-log event. */
export type DigestStatus = 'ok' | 'retry' | 'fail'

/** One job's valid events, ordered by timestamp (then log order for ties). */
export type DigestRow = {
  job: string
  /** Owner on the most recent event, including an explicit null. */
  owner: string | null
  /** Total valid events for this job, including retries and failures. */
  runs: number
  /** Number of this job's events with status retry. */
  retries: number
  /** Status on the most recent event. */
  lastStatus: DigestStatus
  /** Most recent error present, retained after later successes; null if none. */
  lastError: string | null
  /** Earliest event timestamp, preserving its original string and offset. */
  firstAt: string
  /** Latest event timestamp, preserving its original string and offset. */
  lastAt: string
}

/** Shared data consumed by the digest page, JSON API, and status board. */
export type NightDigest = {
  /** Calendar date identifying the runs/<night>.jsonl file: YYYY-MM-DD. */
  night: string
  /** One row per job, sorted by job in ascending string order. */
  rows: DigestRow[]
  /** Nonblank lines that cannot be parsed or fail event validation. */
  badLines: number
  /** Counts of valid events by status, not counts of jobs' final statuses. */
  totals: {
    ok: number
    retry: number
    fail: number
  }
}

/**
 * Synchronously read a night's log. The runtime implementation is readNight in
 * src/digest/reader.ts; this module exports only the shared type contract.
 *
 * A missing file returns null. An existing empty file returns the requested
 * night, empty rows, zero badLines, and zero totals. Blank lines are ignored;
 * malformed or invalid events count toward badLines without aborting the read.
 * The reader may reject invalid calendar dates or unsafe night/path values.
 */
export type ReadNight = (runsDir: string, night: string) => NightDigest | null
