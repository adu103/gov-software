import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import App from './App'

vi.mock('./generated/snapshot.json', () => ({
  default: {
    meta: { sourceType: 'synthetic', sourcePage: '', retrievedAt: null, years: [2024, 2025], rowCount: 12 },
    records: Array.from({ length: 12 }, (_, i) => ({
      uii: `001-${String(i).padStart(3, '0')}`, agencyCode: '001', agency: i === 0 ? 'Alpha' : 'Beta',
      bureauCode: '01', bureau: 'Bureau', title: i === 0 ? '<img src=x>' : `Investment ${i}`,
      description: i === 0 ? '<script>unsafe</script>' : null, investmentType: i === 0 ? 'Major' : 'Other',
      changeInStatus: i === 0 ? 'Eliminated' : 'Active', funding: { 2024: i === 0 ? null : 10, 2025: i === 0 ? 0 : 100 },
    })),
  },
}))

afterEach(cleanup)

describe('dashboard', () => {
  it('uses the latest year, calculates totals before pagination, and labels synthetic data', () => {
    render(<App />)
    expect(screen.getByText('Demo data only — not actual government data')).toBeInTheDocument()
    expect(screen.getByLabelText('Fiscal year')).toHaveValue('2025')
    expect(screen.getByText('$1.10K')).toBeInTheDocument()
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.change(screen.getByLabelText('Agency'), { target: { value: 'Alpha' } })
    expect(screen.getByText('Page 1 of 1')).toBeInTheDocument()
    expect(screen.getByText('Eliminated')).toBeInTheDocument()
    expect(screen.getByText('<img src=x>')).toBeInTheDocument()
    fireEvent.click(screen.getByText('<img src=x>'))
    expect(screen.getByText('<script>unsafe</script>')).toBeInTheDocument()
    expect(document.querySelector('img')).toBeNull()
  })
  it('applies filters while retaining all years in the trend and distinguishes missing from zero', () => {
    render(<App />)
    fireEvent.change(screen.getByLabelText('Investment type'), { target: { value: 'Major' } })
    fireEvent.change(screen.getByLabelText('Search title or UII'), { target: { value: '001-000' } })
    const trend = screen.getByRole('table', { name: /Funding for matching snapshot records/ })
    expect(within(trend).getByText('Unavailable')).toBeInTheDocument()
    expect(within(trend).getByText('$0')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Fiscal year'), { target: { value: '2024' } })
    expect(within(trend).getByText('FY2024 (selected)')).toBeInTheDocument()
    expect(within(trend).getByText('FY2025')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search title or UII'), { target: { value: 'no match' } })
    expect(screen.getByRole('status')).toHaveTextContent('No records match')
  })
})
