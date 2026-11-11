import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';
import Papa from 'papaparse';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const METADATA_PATH = path.join(DATA_DIR, 'snapshot.metadata.json');
export const OUTPUT_PATH = path.join(ROOT, 'src/generated/snapshot.json');

const REQUIRED_HEADERS = ['agencyCode', 'agencyName', 'currentUII', 'investmentTitle'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const MAX_SAFE = new Decimal(Number.MAX_SAFE_INTEGER);

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function parseDollars(value, context = 'amount') {
  const text = value.trim();
  if (text === '') return null;
  // Group separators are accepted only in the conventional thousands positions.
  const numberPattern = /^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
  if (!numberPattern.test(text)) throw new Error(`${context}: malformed dollar amount "${text}"`);
  let amount;
  try {
    const [mantissa, exponent = '0'] = text.replaceAll(',', '').split(/[eE]/);
    amount = new Decimal(`${mantissa}e${BigInt(exponent) + 6n}`);
  } catch {
    throw new Error(`${context}: malformed dollar amount "${text}"`);
  }
  const mantissa = text.split(/[eE]/)[0];
  if (amount.isZero() && /[1-9]/.test(mantissa)) {
    throw new Error(`${context}: dollar amount must be a whole integer`);
  }
  if (!amount.isFinite() || !amount.isInteger()) {
    throw new Error(`${context}: dollar amount must be a whole integer`);
  }
  if (amount.abs().greaterThan(MAX_SAFE)) {
    throw new Error(`${context}: dollar amount exceeds the safe integer range`);
  }
  return amount.isZero() ? 0 : amount.toNumber();
}

export function parseSnapshot(bytes) {
  let csv;
  try {
    csv = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error('CSV must be valid UTF-8');
  }
  const parsed = Papa.parse(csv, { skipEmptyLines: 'greedy' });
  if (parsed.errors.length) {
    throw new Error(`Invalid CSV: ${parsed.errors.map(error => error.message).join('; ')}`);
  }
  const [headers, ...rows] = parsed.data;
  if (!headers || REQUIRED_HEADERS.some(header => !headers.includes(header))) {
    throw new Error(`CSV schema mismatch: required headers are ${REQUIRED_HEADERS.join(',')}`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error('CSV schema mismatch: duplicate column headers');
  }
  const years = headers.flatMap((header, index) => {
    const match = /^FY(\d{4}) Internal Funding$/.exec(header);
    return match ? [{ year: Number(match[1]), index, header }] : [];
  });
  if (!years.length) throw new Error('CSV schema mismatch: expected FYyyyy Internal Funding columns');
  if (!rows.length) throw new Error('CSV must contain at least one data row');
  const fiscalYears = years.map(({ year }) => year).sort((a, b) => a - b);
  const indexes = new Map(headers.map((header, index) => [header, index]));
  const investments = new Set();
  const agencies = new Map();
  const bureaus = new Map();
  const aggregates = new Map(fiscalYears.map(year => [year, { positive: 0n, negative: 0n }]));
  const records = rows.map((row, index) => {
    const line = `CSV row ${index + 2}`;
    if (row.length !== headers.length) {
      throw new Error(`${line}: expected ${headers.length} columns, got ${row.length}`);
    }
    const field = name => indexes.has(name) ? row[indexes.get(name)].trim() : '';
    const uii = field('currentUII'), agencyCode = field('agencyCode'), agency = field('agencyName');
    const bureauCode = field('bureauCode'), bureau = field('bureauName'), title = field('investmentTitle');
    const description = field('investmentDescription') || null;
    const investmentType = field('typeOfInvestment') || 'Unavailable';
    const changeInStatus = field('changeInStatus') || null;
    const aggregateLabel = /^(?:(?:total\s*[-:]?\s*)?(?:government[\s-]*wide|all[\s-]*agencies)(?:\s+total)?)$/i;
    if (aggregateLabel.test(agency) || aggregateLabel.test(agencyCode)) {
      throw new Error(`${line}: government-wide or all-agencies aggregate row is not an investment detail`);
    }
    for (const [label, value] of [['currentUII', uii], ['agencyCode', agencyCode]]) {
      if (!ID.test(value)) throw new Error(`${line}: invalid ${label}`);
    }
    if (bureauCode && !ID.test(bureauCode)) throw new Error(`${line}: invalid bureauCode`);
    if (!agency || !title) throw new Error(`${line}: agency and title must not be empty`);
    if (investments.has(uii)) throw new Error(`${line}: duplicate uii "${uii}"`);
    investments.add(uii);
    if (agencies.has(agencyCode) && agencies.get(agencyCode) !== agency) {
      throw new Error(`${line}: inconsistent name for agencyCode "${agencyCode}"`);
    }
    agencies.set(agencyCode, agency);
    const bureauKey = JSON.stringify([agencyCode, bureauCode]);
    if (bureauCode && bureau && bureaus.has(bureauKey) && bureaus.get(bureauKey) !== bureau) {
      throw new Error(`${line}: inconsistent name for bureauCode "${bureauCode}"`);
    }
    if (bureauCode && bureau) bureaus.set(bureauKey, bureau);
    const byYear = new Map(years.map(({ year, index: i, header }) => [
      year, parseDollars(row[i], `${line} ${header}`),
    ]));
    for (const [year, value] of byYear) {
      if (value === null) continue;
      const aggregate = aggregates.get(year);
      if (value >= 0) aggregate.positive += BigInt(value);
      else aggregate.negative += BigInt(value);
      if (aggregate.positive > BigInt(Number.MAX_SAFE_INTEGER) ||
          aggregate.negative < -BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`${line}: FY${year} aggregate funding exceeds the safe integer range`);
      }
    }
    const funding = Object.fromEntries(fiscalYears.map(year => [String(year), byYear.get(year)]));
    return { uii, agencyCode, agency, bureauCode, bureau, title, description, investmentType, changeInStatus, funding };
  });
  records.sort((a, b) => a.uii < b.uii ? -1 : a.uii > b.uii ? 1 : 0);
  return { years: fiscalYears, records };
}

export function parseRetrievalTimestamp(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) throw new Error('Retrieval timestamp must be UTC, e.g. 2026-01-02T03:04:05Z');
  const canonical = `${match[1]}.${(match[2] || '').padEnd(3, '0')}Z`;
  const date = new Date(canonical);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== canonical) {
    throw new Error('Retrieval timestamp is not a valid UTC date');
  }
  return canonical;
}

async function atomicWrite(destination, bytes) {
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

function validateMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object' ||
      typeof metadata.source !== 'string' || !metadata.source.trim() ||
      ![true, null].includes(metadata.synthetic) ||
      metadata.schemaVersion !== 1 ||
      !Array.isArray(metadata.years) || !metadata.years.length ||
      metadata.years.some((year, index) => !Number.isInteger(year) || year < 0 || year > 9999 ||
        (index > 0 && metadata.years[index - 1] >= year)) ||
      !Number.isSafeInteger(metadata.rowCount) || metadata.rowCount < 1 ||
      !/^[a-f0-9]{64}$/.test(metadata.sha256) ||
      typeof metadata.csvFile !== 'string' ||
      !(metadata.csvFile === 'synthetic.csv' || metadata.csvFile === `imports/${metadata.sha256}.csv`)) {
    throw new Error('Invalid snapshot metadata');
  }
  if (metadata.synthetic === true) {
    if (metadata.retrievedAt !== null || metadata.csvFile !== 'synthetic.csv') {
      throw new Error('Synthetic snapshot must have a null retrieval time and synthetic CSV');
    }
  } else {
    if (metadata.csvFile === 'synthetic.csv' || typeof metadata.retrievedAt !== 'string' ||
        parseRetrievalTimestamp(metadata.retrievedAt) !== metadata.retrievedAt) {
      throw new Error('Manual snapshot requires a canonical UTC retrieval time and imported CSV');
    }
  }
}

export async function prepareSnapshot({
  dataDir = DATA_DIR,
  metadataPath = path.join(dataDir, 'snapshot.metadata.json'),
  outputPath = OUTPUT_PATH,
} = {}) {
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  validateMetadata(metadata);
  const bytes = await readFile(path.join(dataDir, metadata.csvFile));
  if (sha256(bytes) !== metadata.sha256) throw new Error('Snapshot CSV SHA-256 does not match metadata');
  const { years, records } = parseSnapshot(bytes);
  if (metadata.rowCount !== records.length || JSON.stringify(metadata.years) !== JSON.stringify(years)) {
    throw new Error('Snapshot metadata years or rowCount do not match CSV');
  }
  const snapshot = {
    meta: {
      sourceType: metadata.synthetic === true ? 'synthetic' : 'manual',
      sourcePage: '',
      schemaVersion: metadata.schemaVersion,
      retrievedAt: metadata.retrievedAt,
      years,
      rowCount: records.length,
    },
    records,
  };
  await atomicWrite(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  return snapshot;
}

export async function importSnapshot(csvPath, retrievedAt, { dataDir = DATA_DIR } = {}) {
  const timestamp = parseRetrievalTimestamp(retrievedAt);
  const bytes = await readFile(csvPath);
  const { years, records } = parseSnapshot(bytes);
  const hash = sha256(bytes);
  const metadata = {
    source: 'Manual import; provenance and official schema compatibility unverified',
    synthetic: null,
    retrievedAt: timestamp,
    schemaVersion: 1,
    years,
    rowCount: records.length,
    sha256: hash,
    csvFile: `imports/${hash}.csv`,
  };
  await atomicWrite(path.join(dataDir, metadata.csvFile), bytes);
  // The metadata rename is the commit point; it only references a complete CSV.
  await atomicWrite(path.join(dataDir, 'snapshot.metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  return metadata;
}
