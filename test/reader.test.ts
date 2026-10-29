import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { readNight } from '../src/digest/reader.js'

const fixtures = fileURLToPath(new URL('../runs/', import.meta.url))
const night = '2026-10-28'
const tempDirs: string[] = []
const event = { at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook' }

function tempNight(lines: unknown[] | string): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-reader-'))
  tempDirs.push(dir)
  writeFileSync(join(dir, `${night}.jsonl`), typeof lines === 'string' ? lines : lines.map(line => JSON.stringify(line)).join('\n'))
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('readNight', () => {
  it('aggregates the real October 28 fixture without changing it', () => {
    const result = readNight(fixtures, night)
    expect(result).toMatchObject({ night, badLines: 1, totals: { ok: 10, retry: 4, fail: 1 } })
    expect(result?.rows.map(row => row.job)).toEqual(['digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs'])
    expect(result?.rows[0]).toMatchObject({ owner: null, runs: 1, retries: 0, lastStatus: 'ok', lastError: null })
    expect(result?.rows[1]).toEqual({
      job: 'fixtures/refresh', owner: 'rook', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00', lastAt: '2026-10-29T01:37:00+01:00',
    })
    expect(result?.rows[2]).toMatchObject({ runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' })
    expect(result?.rows[3]).toMatchObject({ runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded' })
  })

  it('counts events rather than final job statuses in the October 27 fixture', () => {
    const result = readNight(fixtures, '2026-10-27')
    expect(result?.rows).toHaveLength(4)
    expect(result).toMatchObject({ badLines: 0, totals: { ok: 7, retry: 0, fail: 0 } })
  })

  it('distinguishes missing files from empty and blank files', () => {
    const dir = tempNight(' \n\r\n\t')
    expect(readNight(dir, night)).toEqual({ night, rows: [], badLines: 0, totals: { ok: 0, retry: 0, fail: 0 } })
    expect(readNight(dir, '2026-10-27')).toBeNull()
    writeFileSync(join(dir, `${night}.jsonl`), '')
    expect(readNight(dir, night)?.rows).toEqual([])
  })

  it.each(['../2026-10-28', '/2026-10-28', '2026-10-28/../2026-10-28', '2026-10-28\u0000', '2026-10-28.jsonl', '2026-1-28', '2026-02-29', '2026-04-31', '2026-13-01', '2026-00-01', '2026-10-00', ''])('rejects unsafe or invalid night %j', value => {
    expect(readNight(fixtures, value)).toBeNull()
  })

  it('accepts leap-day calendar dates', () => {
    const dir = tempNight([])
    writeFileSync(join(dir, '2024-02-29.jsonl'), '')
    expect(readNight(dir, '2024-02-29')?.night).toBe('2024-02-29')
  })

  it('counts nonblank malformed and invalid events while continuing to read', () => {
    const invalid = [
      null, [], 4, 'event', {}, { ...event, at: 'yesterday' },
      { ...event, at: '2026-10-28T23:00:00' }, { ...event, at: '2026-02-30T23:00:00Z' },
      { ...event, at: '2026-10-28T24:00:00Z' }, { ...event, at: '2026-10-28T23:00:00+24:00' },
      { ...event, job: '' }, { ...event, job: '  ' }, { ...event, job: 1 },
      { ...event, status: 'unknown' }, { ...event, owner: undefined }, { ...event, owner: 1 },
      { ...event, error: null }, { ...event, error: 1 },
    ]
    const lines = ['  ', '{broken', JSON.stringify(event), ...invalid.map(value => JSON.stringify(value)), JSON.stringify({ ...event, owner: null }), '']
    const result = readNight(tempNight(lines.join('\r\n')), night)
    expect(result).toMatchObject({ badLines: invalid.length + 1, totals: { ok: 2, retry: 0, fail: 0 } })
    expect(result?.rows[0]).toMatchObject({ owner: null, runs: 2 })
  })

  it('uses chronological instants across offsets, retaining original timestamps and the latest error', () => {
    const result = readNight(tempNight([
      { ...event, at: '2026-10-29T00:00:00Z', status: 'ok', owner: null },
      { ...event, at: '2026-10-29T01:00:00+02:00', status: 'retry', error: 'new error' },
      { ...event, at: '2026-10-28T18:00:00-04:00', status: 'fail', error: 'old error' },
    ]), night)
    expect(result?.rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'new error',
      firstAt: '2026-10-28T18:00:00-04:00', lastAt: '2026-10-29T00:00:00Z',
    }])
    expect(result?.totals).toEqual({ ok: 1, retry: 1, fail: 1 })
  })

  it('breaks timestamp ties in log order, including equivalent offsets and fractions', () => {
    const result = readNight(tempNight([
      { ...event, at: '2026-10-28T23:00:00.100+01:00', status: 'fail', error: 'first' },
      { ...event, at: '2026-10-28T22:00:00.1Z', status: 'retry', error: '' },
      { ...event, at: '2026-10-28T22:00:00.10+00:00', owner: null },
    ]), night)
    expect(result?.rows[0]).toMatchObject({
      firstAt: '2026-10-28T23:00:00.100+01:00', lastAt: '2026-10-28T22:00:00.10+00:00',
      lastStatus: 'ok', owner: null, lastError: '', runs: 3, retries: 1,
    })
  })

  it('preserves ordering for sub-millisecond timestamps', () => {
    const result = readNight(tempNight([
      { ...event, at: '2026-10-28T23:00:00.0002Z', status: 'ok' },
      { ...event, at: '2026-10-28T23:00:00.0001Z', status: 'fail', error: 'earlier' },
    ]), night)
    expect(result?.rows[0]).toMatchObject({ firstAt: '2026-10-28T23:00:00.0001Z', lastAt: '2026-10-28T23:00:00.0002Z', lastStatus: 'ok', lastError: 'earlier' })
  })

  it('surfaces filesystem errors other than missing files', () => {
    const dir = tempNight([])
    mkdirSync(join(dir, '2026-10-27.jsonl'))
    expect(() => readNight(dir, '2026-10-27')).toThrow()
  })
})
