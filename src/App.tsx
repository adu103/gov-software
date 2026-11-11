import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import snapshotJson from './generated/snapshot.json'
import { byAgency, compact, describeTotal, exact, filterRecords, totalFor } from './domain'
import type { Filters, Investment, Snapshot } from './domain'

const snapshot = snapshotJson as Snapshot
const pageSize = 10
type SortKey = 'title' | 'uii' | 'agency' | 'bureau' | 'investmentType' | 'changeInStatus' | 'funding'
const columns: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Investment' }, { key: 'uii', label: 'UII' },
  { key: 'agency', label: 'Agency' }, { key: 'bureau', label: 'Bureau' },
  { key: 'investmentType', label: 'Type' }, { key: 'changeInStatus', label: 'Reported status' },
  { key: 'funding', label: 'Internal funding' },
]

function App() {
  const years = [...snapshot.meta.years].sort((a, b) => a - b)
  const initialYear = [...years].reverse().find((year) => snapshot.records.some((r) => r.funding[year] != null)) ?? years[years.length - 1]
  const [year, setYear] = useState(initialYear)
  const [filters, setFilters] = useState<Filters>({ agency: '', type: '', search: '' })
  const [sort, setSort] = useState<{ key: SortKey; ascending: boolean }>({ key: 'title', ascending: true })
  const [page, setPage] = useState(1)
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system')
  const agencies = [...new Set(snapshot.records.map((r) => r.agency))].sort()
  const types = [...new Set(snapshot.records.map((r) => r.investmentType))].sort()
  const matching = useMemo(() => filterRecords(snapshot.records, filters), [filters])
  const total = totalFor(matching, year)
  const agencyTotals = byAgency(matching, year)
  const trend = years.map((item) => ({ year: item, ...totalFor(matching, item) }))
  const sorted = [...matching].sort((a, b) => {
    const av = sort.key === 'funding' ? a.funding[year] : a[sort.key]
    const bv = sort.key === 'funding' ? b.funding[year] : b[sort.key]
    if (av == null) return bv == null ? a.uii.localeCompare(b.uii) : 1
    if (bv == null) return -1
    const comparison = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
    return (sort.ascending ? comparison : -comparison) || a.uii.localeCompare(b.uii)
  })
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const shown = sorted.slice((page - 1) * pageSize, page * pageSize)
  const setFilter = (key: keyof Filters, value: string) => { setFilters((prev) => ({ ...prev, [key]: value })); setPage(1) }
  const toggleSort = (key: SortKey) => {
    setSort((prev) => ({ key, ascending: prev.key === key ? !prev.ascending : true }))
    setPage(1)
  }
  const demo = snapshot.meta.sourceType === 'synthetic'

  return <div className="app" data-theme={theme}>
    <header className="topbar"><div className="wrap topbar-inner">
      <a className="brand" href="#main"><span className="brand-icon" aria-hidden="true">▦</span><span>PUBLIC DATA LAB <small>Independent data presentation</small></span></a>
      <label className="theme-control">Appearance <select value={theme} onChange={(e) => setTheme(e.target.value as typeof theme)}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
    </div></header>
    <main id="main" className="wrap">
      <section className="intro">
        <p className="eyebrow">FEDERAL TECHNOLOGY / PORTFOLIO EXPLORER</p>
        <h1>Explore IT funding<span>.</span></h1>
        <p className="lead">A clearer view of technology investments across federal agencies.</p>
      </section>
      <aside className="notice" aria-label="Data notice">
        <strong>{demo ? 'Demo data only — not actual government data' : 'Manually imported snapshot — not live data'}</strong>
        <p>{demo ? 'All agencies, investments, and amounts shown are fictional. Do not use these figures for analysis or decisions.' : 'The provenance of this manually imported snapshot has not been independently verified by this application. This is not an official government site.'}</p>
        <p>Snapshot retrieval: {snapshot.meta.retrievedAt ? `${snapshot.meta.retrievedAt} (UTC)` : 'Not applicable to synthetic data'} · Available years: {years.map((y) => `FY${y}`).join(', ')} · <a href="https://itdashboard.gov/data-feeds">IT Dashboard data feeds</a></p>
      </aside>
      <section className="filters panel" aria-labelledby="filters-heading">
        <div className="section-heading"><div><p className="eyebrow">REFINE THE VIEW</p><h2 id="filters-heading">Filters</h2></div><button className="text-button" onClick={() => { setFilters({ agency: '', type: '', search: '' }); setYear(initialYear); setPage(1) }}>Reset filters</button></div>
        <div className="filter-grid">
          <label>Fiscal year<select value={year} onChange={(e) => { setYear(Number(e.target.value)); setPage(1) }}>{years.map((y) => <option key={y} value={y}>FY{y}</option>)}</select></label>
          <label>Agency<select value={filters.agency} onChange={(e) => setFilter('agency', e.target.value)}><option value="">All agencies</option>{agencies.map((a) => <option key={a}>{a}</option>)}</select></label>
          <label>Investment type<select value={filters.type} onChange={(e) => setFilter('type', e.target.value)}><option value="">All types</option>{types.map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Search title or UII<input type="search" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} placeholder="Search investments" /></label>
        </div>
      </section>
      <section aria-labelledby="overview-heading">
        <div className="section-heading"><div><p className="eyebrow">AT A GLANCE</p><h2 id="overview-heading">Portfolio overview</h2></div><span className="year-tag">FY {year}</span></div>
        <div className="metrics">
          <article className="metric"><span>Internal funding</span><strong title={exact(total.amount)}>{compact(total.amount)}</strong><small>{describeTotal(total)}</small></article>
          <article className="metric"><span>Matching records</span><strong>{matching.length.toLocaleString()}</strong><small>Snapshot records, not necessarily active</small></article>
          <article className="metric"><span>Agencies represented</span><strong>{new Set(matching.map((r) => r.agency)).size.toLocaleString()}</strong><small>Across matching records</small></article>
        </div>
      </section>
      {!matching.length && <p className="empty" role="status">No records match these filters. Try broadening your search.</p>}
      <div className="dashboard-grid">
        <section className="panel" aria-labelledby="agency-heading">
          <p className="eyebrow">WHERE FUNDING GOES</p><h2 id="agency-heading">Agency comparison</h2><p className="muted">Internal funding by agency, FY{year}.</p>
          {agencyTotals.length > 0 && <div className="chart" aria-hidden="true"><ResponsiveContainer width="100%" height={Math.max(180, Math.min(agencyTotals.length, 10) * 35)}><BarChart accessibilityLayer={false} layout="vertical" data={agencyTotals.filter((a) => a.amount !== null).slice(0, 10)}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" tickFormatter={(v: number) => compact(v)} /><YAxis type="category" dataKey="agency" width={130} tickFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v} /><Tooltip formatter={(v) => exact(typeof v === 'number' ? v : null)} /><Bar dataKey="amount" fill="var(--cp-chart)" name="Internal funding" /></BarChart></ResponsiveContainer></div>}
          <p className="muted chart-note">Chart shows up to 10 agencies. Complete values are listed below.</p>
          <div className="table-scroll"><table><caption>Agency funding, FY{year}</caption><thead><tr><th scope="col">Agency</th><th scope="col">Internal funding</th><th scope="col">Coverage</th></tr></thead><tbody>{agencyTotals.map((a) => <tr key={a.agency}><th scope="row">{a.agency}</th><td>{exact(a.amount)}</td><td>{describeTotal(a)}</td></tr>)}</tbody></table></div>
        </section>
        <section className="panel" aria-labelledby="trend-heading">
          <p className="eyebrow">ACROSS THE SNAPSHOT</p><h2 id="trend-heading">Funding by fiscal year</h2><p className="muted">Records present in this snapshot; not a complete historical series or necessarily comparable budget phases.</p>
          {matching.length > 0 && <div className="chart" aria-hidden="true"><ResponsiveContainer width="100%" height={220}><BarChart accessibilityLayer={false} data={trend}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="year" /><YAxis tickFormatter={(v: number) => compact(v)} width={70} /><Tooltip formatter={(v) => exact(typeof v === 'number' ? v : null)} /><Bar dataKey="amount" name="Internal funding">{trend.map((item) => <Cell key={item.year} fill={item.year === year ? 'var(--cp-accent)' : 'var(--cp-chart-muted)'} />)}</Bar></BarChart></ResponsiveContainer></div>}
          <div className="table-scroll"><table><caption>Funding for matching snapshot records by fiscal year</caption><thead><tr><th scope="col">Fiscal year</th><th scope="col">Internal funding</th><th scope="col">Coverage</th></tr></thead><tbody>{trend.map((item) => <tr key={item.year}><th scope="row">FY{item.year}{item.year === year ? ' (selected)' : ''}</th><td>{exact(item.amount)}</td><td>{describeTotal(item)}</td></tr>)}</tbody></table></div>
        </section>
      </div>
      <section className="panel explorer" aria-labelledby="explorer-heading">
        <div className="section-heading"><div><p className="eyebrow">EXPLORE THE DETAILS</p><h2 id="explorer-heading">Investment explorer</h2><p className="muted">Showing {matching.length ? (page - 1) * pageSize + 1 : 0}–{Math.min(page * pageSize, matching.length)} of {matching.length.toLocaleString()} matching records</p></div><span className="year-tag">FY {year}</span></div>
        <div className="table-scroll"><table><caption>Investment records and reported internal funding</caption><thead><tr>{columns.map((col) => <th key={col.key} scope="col" aria-sort={sort.key === col.key ? (sort.ascending ? 'ascending' : 'descending') : undefined}><button className="sort-button" onClick={() => toggleSort(col.key)}>{col.label} {sort.key === col.key ? (sort.ascending ? '↑' : '↓') : '↕'}</button></th>)}</tr></thead>
          <tbody>{shown.map((r: Investment) => <tr key={r.uii}><th scope="row"><details><summary>{r.title}</summary><p>{r.description || 'Description unavailable'}</p><p>Agency code: {r.agencyCode} · Bureau code: {r.bureauCode || 'Unavailable'}</p></details></th><td>{r.uii}</td><td>{r.agency}</td><td>{r.bureau || 'Unavailable'}</td><td>{r.investmentType}</td><td>{r.changeInStatus || 'Unavailable'}</td><td>{exact(r.funding[year] ?? null)}</td></tr>)}</tbody></table></div>
        {!matching.length && <p className="muted">No investments to display.</p>}
        <div className="pagination"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} of {pageCount}</span><button disabled={page === pageCount} onClick={() => setPage(page + 1)}>Next</button></div>
      </section>
      <section className="methodology" aria-labelledby="method-heading"><h2 id="method-heading">About the numbers</h2><p>Totals sum reported internal funding only; contributions are excluded. All matching records are included, including funding transfers and those reported as eliminated. Missing values are excluded, not treated as zero. Coverage may be incomplete, and derived totals may differ from IT Dashboard headlines.</p><p>Funding is not necessarily actual spending. Individual source record update times, when available, have no verified timezone and do not establish dataset freshness. This site is an independent presentation, not an official government site.</p></section>
    </main>
    <footer><div className="wrap">PUBLIC DATA LAB <span>Independent exploration of public data</span></div></footer>
  </div>
}

export default App
