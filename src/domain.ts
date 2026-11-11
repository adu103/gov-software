export type Investment = {
  uii: string
  agencyCode: string
  agency: string
  bureauCode: string
  bureau: string
  title: string
  description: string | null
  investmentType: string
  changeInStatus: string | null
  funding: Record<string, number | null>
}

export type Snapshot = {
  meta: { sourceType: string; sourcePage: string; retrievedAt: string | null; years: number[]; rowCount: number }
  records: Investment[]
}

export type Filters = { agency: string; type: string; search: string }
export type Total = { amount: number | null; missing: number }

export function filterRecords(records: Investment[], filters: Filters): Investment[] {
  const search = filters.search.trim().toLocaleLowerCase()
  return records.filter((record) =>
    (!filters.agency || record.agency === filters.agency) &&
    (!filters.type || record.investmentType === filters.type) &&
    (!search || record.title.toLocaleLowerCase().includes(search) || record.uii.toLocaleLowerCase().includes(search)),
  )
}

export function totalFor(records: Investment[], year: number): Total {
  let amount = 0
  let known = 0
  for (const record of records) {
    const value = record.funding[year]
    if (value == null) continue
    amount += value
    if (!Number.isSafeInteger(amount)) throw new Error('Funding total exceeds the safe integer range.')
    known++
  }
  return { amount: known ? amount : null, missing: records.length - known }
}

export function byAgency(records: Investment[], year: number) {
  const groups = new Map<string, Investment[]>()
  for (const record of records) {
    const group = groups.get(record.agency)
    if (group) group.push(record)
    else groups.set(record.agency, [record])
  }
  return [...groups].map(([agency, group]) => ({ agency, ...totalFor(group, year) }))
    .sort((a, b) => (b.amount ?? -Infinity) - (a.amount ?? -Infinity) || a.agency.localeCompare(b.agency))
}

export const exact = (amount: number | null) =>
  amount === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)

export function compact(amount: number | null): string {
  if (amount === null) return 'Unavailable'
  if (Math.abs(amount) < 1000) return exact(amount)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(amount)
}

export function describeTotal(total: Total): string {
  return total.missing ? `${total.missing} record${total.missing === 1 ? '' : 's'} with missing funding excluded` : 'All matching records have reported funding'
}
