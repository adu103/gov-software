import assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import Papa from 'papaparse';
import {
  importSnapshot, parseDollars, parseRetrievalTimestamp, parseSnapshot, prepareSnapshot, sha256,
} from '../scripts/snapshot.mjs';

const header = 'agencyCode,agencyName,bureauCode,bureauName,previousUIIs,currentUII,changeInStatus,sharedServicesCategory,sharedServicesIdentifier,missionSupportInvestmentCategories,partOfITPortfolio,missionDeliveryAndManagementSupportArea,typeOfInvestment,nationalSecuritySystemIdentifier,itInfrastructureAndManagementType,investmentTitle,investmentDescription,publicUrls';
const head = years => `${header},${years.map(y => `FY${y} Internal Funding`).join(',')},${years.map(y => `FY${y} Contribution`).join(',')},updatedTime`;
const base = ['001', 'Agency, Inc', '02', 'Bureau', '', '0001', 'New', '', '', '', '', '', 'Major', '', '', 'Line one\nLine "two"', 'Description', ''];
const row = (fields, amounts = ['0.001', '', '0', '0', '']) => Papa.unparse([[...fields, ...amounts]]);
const valid = `${head([2025, 2023])}\r\n${row(base)}\r\n`;
const parse = csv => parseSnapshot(Buffer.from(csv));

test('CSV preserves IDs, quoted fields, dynamic years, null and zero', () => {
  const second = [...base]; second[5] = '0002'; second[15] = 'Other';
  const snapshot = parse(valid + `${row(second, ['0', '0.001234', '0', '0', ''])}\r\n`);
  assert.deepEqual(snapshot.years, [2023, 2025]);
  assert.deepEqual(snapshot.records[0], {
    uii: '0001', agencyCode: '001', agency: 'Agency, Inc', bureauCode: '02', bureau: 'Bureau',
    title: 'Line one\nLine "two"', description: 'Description', investmentType: 'Major',
    changeInStatus: 'New', funding: { 2023: null, 2025: 1000 },
  });
  assert.deepEqual(snapshot.records[1].funding, { 2023: 1234, 2025: 0 });
  const missingBureau = [...base]; missingBureau[3] = '';
  missingBureau[2] = ''; missingBureau[6] = ''; missingBureau[12] = ''; missingBureau[16] = '';
  const missing = parse(`${head([2024])}\n${row(missingBureau, ['6.0E-5', 'ignored', ''])}`).records[0];
  assert.equal(missing.bureau, '');
  assert.equal(missing.bureauCode, '');
  assert.equal(missing.description, null);
  assert.equal(missing.investmentType, 'Unavailable');
  assert.equal(missing.changeInStatus, null);
  assert.equal(missing.funding[2024], 60);
  const eliminated = [...base]; eliminated[5] = '0003'; eliminated[6] = '06: Eliminated by funding';
  assert.equal(parse(`${head([2024])}\n${row(eliminated, ['1', '', ''])}`).records[0].changeInStatus, '06: Eliminated by funding');
});

test('exact dollar parser handles bounds and rejects malformed, sub-dollar and overflow', () => {
  for (const [value, expected] of [['', null], ['0', 0], ['-0', 0], ['1.20e-5', 12],
    ['9.007199254740991e9', Number.MAX_SAFE_INTEGER], ['-9007199254.740991', -Number.MAX_SAFE_INTEGER]]) {
    assert.equal(parseDollars(value), expected);
  }
  for (const value of ['0.0000001', '1e-7', '9007199254.740992', '-9007199254.740992',
    'Infinity', 'NaN', '1,23', '1e', '$1', '0x10', '1e9999999999999999',
    '1e-9999999999999999', '1.0000000000000000000000000001']) {
    assert.throws(() => parseDollars(value), /dollar amount/);
  }
});

test('rejects schema mismatches, malformed rows, duplicates, IDs and inconsistent names', () => {
  const oneYear = head([2024]);
  const good = row(base, ['1', '0', '']);
  const invalidId = [...base]; invalidId[5] = '!';
  const otherAgency = [...base]; otherAgency[5] = '0002'; otherAgency[1] = 'Changed';
  const otherBureau = [...base]; otherBureau[5] = '0002'; otherBureau[3] = 'Changed';
  for (const csv of [
    'Official,unknown\nfoo,1\n',
    `${head([2024, 2024])}\n${good}\n`,
    `${head([24])}\n${good}\n`,
    `${oneYear}\n${row(base, ['1', '0'])}\n`,
    `${oneYear}\n${good},extra\n`,
    `${oneYear}\n${good}\n${good}\n`,
    `${oneYear}\n${row(invalidId, ['1', '0', ''])}\n`,
    `${oneYear}\n${good}\n${row(otherAgency, ['1', '0', ''])}\n`,
    `${oneYear}\n${good}\n${row(otherBureau, ['1', '0', ''])}\n`,
    `${oneYear}\n"unterminated,1\n`,
    `${oneYear}\n${row(base, ['invalid', '0', ''])}\n`,
  ]) assert.throws(() => parse(csv));
  assert.throws(() => parseSnapshot(Buffer.from([0xff])), /UTF-8/);
});

test('accepts reordered, minimal and extra columns and ignores contribution values', () => {
  const csv = Papa.unparse([
    ['FY2024 Contribution', 'investmentTitle', 'FY2024 Internal Funding', 'agencyName', 'currentUII', 'unused', 'agencyCode'],
    ['not numeric', 'Example', '6.0E-5', 'Agency', '001-000001', 'ignored', '001'],
  ]);
  const snapshot = parse(csv);
  assert.deepEqual(snapshot.records[0], {
    uii: '001-000001', agencyCode: '001', agency: 'Agency', bureauCode: '', bureau: '',
    title: 'Example', description: null, investmentType: 'Unavailable', changeInStatus: null, funding: { 2024: 60 },
  });
  assert.throws(() => parse(csv.replace('unused', 'agencyCode')), /duplicate column/);
});

test('rejects positive and negative aggregate overflow even when cancellation is possible', () => {
  const next = [...base]; next[5] = '0002';
  const cancellation = [...base]; cancellation[5] = '0003';
  for (const sign of ['', '-']) {
    const reverse = sign ? '' : '-';
    const lines = [
      row(base, [`${sign}9007199254.740991`, '0', '']),
      row(cancellation, [`${reverse}0.000001`, '0', '']),
      row(next, [`${sign}0.000001`, '0', '']),
    ];
    for (const ordered of [lines, [...lines].reverse()]) {
      assert.throws(() => parse(`${head([2024])}\n${ordered.join('\n')}`), /aggregate funding exceeds/);
    }
  }
});

test('rejects government-wide and all-agencies aggregate rows with row context', () => {
  for (const label of ['Government-wide', 'All Agencies', 'Government-wide total']) {
    const aggregate = [...base]; aggregate[5] = '0002'; aggregate[1] = label;
    assert.throws(
      () => parse(`${head([2024])}\n${row(base, ['1', '', ''])}\n${row(aggregate, ['1', '', ''])}`),
      /CSV row 3: government-wide or all-agencies aggregate row/,
    );
  }
});

test('timestamps must be real UTC instants', () => {
  assert.equal(parseRetrievalTimestamp('2024-02-29T01:02:03Z'), '2024-02-29T01:02:03.000Z');
  assert.equal(parseRetrievalTimestamp('2024-02-29T01:02:03.12Z'), '2024-02-29T01:02:03.120Z');
  for (const invalid of ['2023-02-29T01:02:03Z', '2024-01-01', '2024-01-01T00:00:00+00:00', '2024-13-01T00:00:00Z']) {
    assert.throws(() => parseRetrievalTimestamp(invalid));
  }
});

test('checked-in synthetic fixture includes an eliminated record with funding', async () => {
  const { records } = parseSnapshot(await readFile(new URL('../data/synthetic.csv', import.meta.url)));
  assert.ok(records.some(record => /eliminated/i.test(record.changeInStatus ?? '') &&
    Object.values(record.funding).some(amount => amount !== null && amount !== 0)));
});

test('import validates before committing, prepare verifies hash and writes deterministically', async () => {
  const dir = await mkdtemp(path.resolve('tests/data-work-'));
  try {
    const dataDir = path.join(dir, 'data');
    const csvPath = path.join(dir, 'input.csv');
    const outputPath = path.join(dir, 'generated', 'snapshot.json');
    await mkdir(dataDir);
    await writeFile(csvPath, valid);
    const metadata = await importSnapshot(csvPath, '2026-01-02T03:04:05Z', { dataDir });
    assert.equal(metadata.sha256, sha256(Buffer.from(valid)));
    assert.equal(metadata.synthetic, null);
    assert.equal(metadata.schemaVersion, 1);
    assert.deepEqual(metadata.years, [2023, 2025]);
    assert.equal(metadata.rowCount, 1);
    const metadataPath = path.join(dataDir, 'snapshot.metadata.json');
    const committed = await readFile(metadataPath, 'utf8');
    const snapshot = await prepareSnapshot({ dataDir, outputPath });
    assert.equal(snapshot.records.length, 1);
    const generated = await readFile(outputPath, 'utf8');
    await prepareSnapshot({ dataDir, outputPath });
    assert.equal(await readFile(outputPath, 'utf8'), generated);
    for (const altered of [
      { ...metadata, schemaVersion: 2 },
      { ...metadata, years: [2023] },
      { ...metadata, rowCount: 2 },
    ]) {
      await writeFile(metadataPath, JSON.stringify(altered));
      await assert.rejects(prepareSnapshot({ dataDir, outputPath }), /metadata/i);
      assert.equal(await readFile(outputPath, 'utf8'), generated);
    }
    await writeFile(metadataPath, committed);
    await writeFile(csvPath, 'wrong,schema\n1,2\n');
    await assert.rejects(importSnapshot(csvPath, '2026-01-02T03:04:05Z', { dataDir }), /schema mismatch/);
    await assert.rejects(importSnapshot(csvPath, 'not a timestamp', { dataDir }), /timestamp/);
    assert.equal(await readFile(metadataPath, 'utf8'), committed);
    const overflow = [...base]; overflow[5] = '0002';
    await writeFile(csvPath, `${head([2024])}\n${row(base, ['9007199254.740991', '', ''])}\n${row(overflow, ['0.000001', '', ''])}`);
    await assert.rejects(importSnapshot(csvPath, '2026-01-02T03:04:05Z', { dataDir }), /aggregate funding exceeds/);
    assert.equal(await readFile(metadataPath, 'utf8'), committed);
    await writeFile(path.join(dataDir, metadata.csvFile), 'tampered');
    await assert.rejects(prepareSnapshot({ dataDir, outputPath }), /SHA-256/);
    assert.equal(await readFile(outputPath, 'utf8'), generated);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('synthetic metadata verifies independently of the active snapshot and CLI reports errors', async () => {
  const dir = await mkdtemp(path.resolve('tests/data-work-'));
  try {
    await writeFile(path.join(dir, 'synthetic.csv'), valid);
    await writeFile(path.join(dir, 'snapshot.metadata.json'), JSON.stringify({
      source: 'Fictional test data',
      synthetic: true,
      retrievedAt: null,
      schemaVersion: 1,
      years: [2023, 2025],
      rowCount: 1,
      sha256: sha256(Buffer.from(valid)),
      csvFile: 'synthetic.csv',
    }));
    const snapshot = await prepareSnapshot({ dataDir: dir, outputPath: path.join(dir, 'snapshot.json') });
    assert.deepEqual(snapshot.meta, {
      sourceType: 'synthetic', sourcePage: '', schemaVersion: 1, retrievedAt: null, years: [2023, 2025], rowCount: 1,
    });
    assert.ok(snapshot.records.length);
    const result = spawnSync(process.execPath, ['scripts/import.mjs'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('import and prepare CLI work together without modifying the fixture', async () => {
  const dir = await mkdtemp(path.resolve('tests/data-work-'));
  try {
    await cp('scripts', path.join(dir, 'scripts'), { recursive: true });
    await symlink(path.resolve('node_modules'), path.join(dir, 'node_modules'), 'dir');
    const csvPath = path.join(dir, 'input.csv');
    await writeFile(csvPath, valid);
    const imported = spawnSync(process.execPath, [
      path.join(dir, 'scripts/import.mjs'), csvPath, '2026-01-02T03:04:05Z',
    ], { encoding: 'utf8' });
    assert.equal(imported.status, 0, imported.stderr);
    const prepared = spawnSync(process.execPath, [path.join(dir, 'scripts/prepare.mjs')], { encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stderr);
    const snapshot = JSON.parse(await readFile(path.join(dir, 'src/generated/snapshot.json'), 'utf8'));
    assert.equal(snapshot.meta.retrievedAt, '2026-01-02T03:04:05.000Z');
    assert.equal(snapshot.meta.sourceType, 'manual');
    assert.equal(snapshot.meta.sourcePage, '');
    assert.equal(snapshot.meta.rowCount, 1);
    assert.equal(snapshot.records[0].uii, '0001');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
