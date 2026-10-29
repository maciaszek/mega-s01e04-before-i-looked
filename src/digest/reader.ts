import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DigestRow, DigestStatus, ReadNight } from './types.js'

type Event = {
  at: string
  job: string
  status: DigestStatus
  owner: string | null
  error?: string
  instant: number
  fraction: string
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const instant = Date.parse(`${date}T00:00:00Z`)
  return Number.isFinite(instant) && new Date(instant).toISOString().slice(0, 10) === date
}

function parseEvent(value: unknown): Event | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const { at, job, status, owner, error } = record
  if (typeof at !== 'string' || typeof job !== 'string' || !job.trim()) return null
  if (status !== 'ok' && status !== 'retry' && status !== 'fail') return null
  if (owner !== null && typeof owner !== 'string') return null
  if ('error' in record && typeof error !== 'string') return null

  const time = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d+))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(at)
  if (!time || !validDate(time[1])) return null
  // Compare whole seconds separately so sub-millisecond fractions remain ordered.
  const instant = Date.parse(`${time[1]}T${time[2]}:${time[3]}:${time[4]}${time[6]}`)
  if (!Number.isFinite(instant)) return null
  return { at, job, status, owner, error: typeof error === 'string' ? error : undefined, instant, fraction: (time[5] ?? '').replace(/0+$/, '') }
}

export const readNight: ReadNight = (runsDir, night) => {
  if (!validDate(night)) return null

  let contents: string
  try {
    contents = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
    throw error
  }

  const events: Event[] = []
  let badLines = 0
  for (const line of contents.split(/\r?\n/)) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      badLines++
      continue
    }
    const event = parseEvent(value)
    if (event) events.push(event)
    else badLines++
  }

  // Stable sorting preserves log order when two events represent the same instant.
  events.sort((a, b) => a.instant - b.instant || (a.fraction < b.fraction ? -1 : a.fraction > b.fraction ? 1 : 0))
  const jobs = new Map<string, DigestRow>()
  const totals = { ok: 0, retry: 0, fail: 0 }
  for (const event of events) {
    totals[event.status]++
    let row = jobs.get(event.job)
    if (!row) {
      row = {
        job: event.job,
        owner: event.owner,
        runs: 0,
        retries: 0,
        lastStatus: event.status,
        lastError: null,
        firstAt: event.at,
        lastAt: event.at,
      }
      jobs.set(event.job, row)
    }
    row.runs++
    if (event.status === 'retry') row.retries++
    row.owner = event.owner
    row.lastStatus = event.status
    row.lastAt = event.at
    if (event.error !== undefined) row.lastError = event.error
  }

  const rows = [...jobs.values()].sort((a, b) => a.job < b.job ? -1 : a.job > b.job ? 1 : 0)
  return { night, rows, badLines, totals }
}
