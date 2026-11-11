import { describe, expect, it } from 'vitest'
import { byAgency, compact, exact, filterRecords, totalFor } from './domain'
import type { Investment } from './domain'

const records: Investment[] = [
  { uii: '001-1', agencyCode: '001', agency: 'Alpha', bureauCode: '01', bureau: 'One', title: 'Systems', description: null, investmentType: 'Major', changeInStatus: 'Eliminated', funding: { 2024: 60, 2025: 0 } },
  { uii: '002-2', agencyCode: '002', agency: 'Beta', bureauCode: '02', bureau: 'Two', title: 'Network', description: null, investmentType: 'Other', changeInStatus: null, funding: { 2024: null, 2025: 100 } },
]

describe('portfolio calculations', () => {
  it('filters title and UII case-insensitively with agency and type', () => {
    expect(filterRecords(records, { agency: 'Alpha', type: 'Major', search: '001-1' })).toEqual([records[0]])
    expect(filterRecords(records, { agency: '', type: '', search: 'SYSTEMS' })).toEqual([records[0]])
    expect(filterRecords(records, { agency: 'Beta', type: 'Major', search: '' })).toEqual([])
  })
  it('includes eliminated records, preserves missing and zero, and sorts agencies', () => {
    expect(totalFor(records, 2024)).toEqual({ amount: 60, missing: 1 })
    expect(totalFor([records[0]], 2025)).toEqual({ amount: 0, missing: 0 })
    expect(totalFor([records[1]], 2024)).toEqual({ amount: null, missing: 1 })
    expect(byAgency(records, 2025).map((a) => a.agency)).toEqual(['Beta', 'Alpha'])
    expect(compact(60)).toBe('$60')
    expect(exact(null)).toBe('Unavailable')
  })
  it('rejects unsafe aggregates', () => {
    expect(() => totalFor([{ ...records[0], funding: { 2025: Number.MAX_SAFE_INTEGER } }, records[1]], 2025)).toThrow('safe integer')
  })
})
