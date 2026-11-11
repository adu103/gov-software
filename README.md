# gov-software

The checked-in snapshot in this React MVP is a **synthetic-data demo**, not
actual IT Dashboard data. It has no retrieval time, and the app makes no
runtime calls to the IT Dashboard or other data sources. Funding figures are
internal to the demo, eliminated entries are included, and figures across
years are not comparable. Do not use the demo for official reporting or
decisions.

## Local development

Use Node.js 22 and pnpm 10.34.9 via Corepack:

```sh
corepack enable
corepack prepare pnpm@10.34.9 --activate
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

The build produces a self-contained `dist/index.html`.

## Refreshing the demo data

The importer uses headers from the historical
[GSA BY 2026 IT Portfolio feed](https://github.com/GSA/ITDB-schema/blob/f0b9c6edc7e6901bf4cfc9f731d1d238bc299ef1/IT%20Collect%20Docs/BY%202026/Public%20ITDB%20Data%20Feeds/IT%20Portfolio.csv).
Verify the official schema and its current field definitions before use;
future schemas may differ.

The UTF-8 CSV must contain `agencyCode`, `agencyName`, `currentUII`,
`investmentTitle` and at least one `FYyyyy Internal Funding` column. Columns
may appear in any order. `bureauCode`, `bureauName`,
`investmentDescription`, `typeOfInvestment` and `changeInStatus` are optional;
other fields, including contributions, are ignored. Duplicate column names,
UIIs and government-wide aggregate rows are rejected. Required identifiers and
any bureau code must begin with a letter or digit and contain only letters,
digits, `.`, `_` or `-`. Names must be consistent for each agency and, when
provided, bureau code.

CSV funding inputs are in millions of dollars; generated internal funding
amounts are exact whole dollars. Blank amounts mean unknown, not zero. Each
converted amount and the separate positive and negative annual totals must fit
the safe integer range. Before importing, check headers, encoding, required
fields and values, missing or duplicate records, year coverage, funding units
and eliminated entries. Confirm the input is suitable for the demo and the
timestamp is accurate UTC. The user-supplied timestamp is unverified metadata,
not proof of an official retrieval.

```sh
pnpm import <csv> <UTC timestamp>
pnpm prepare:data
```

Import validates before atomically updating metadata to point to a
content-addressed CSV; a failed metadata update can leave an unused import
file. Preparation checks the CSV's SHA-256 hash, metadata schema version,
years and row count, validates the data and atomically writes
`src/generated/snapshot.json`. To restore the original fixture, restore
`data/snapshot.metadata.json` from version control and run `pnpm prepare:data`
again.

Review the resulting changes and run the checks and build above before
publishing. Source coverage and definitions can change; the demo's internal
funding and cross-year limitations still apply.

## GitHub Pages

The workflow runs the checks, including browser tests, on pull requests,
pushes to `main`, and manual dispatches. A push to `main` or a workflow
dispatch on `main` can deploy a Pages artifact after the checks pass. Only
authorized users can dispatch the workflow, and any `github-pages`
environment protection rules also apply.

The repository owner must enable GitHub Pages with **GitHub Actions** as the
source and promote or approve the deployment as required by repository and
environment settings. This repository does not imply that a deployment has
already occurred.
