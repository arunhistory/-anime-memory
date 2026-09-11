import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyDiscoveryState, loadDiscoveryState, saveDiscoveryState } from './state.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-state-shards-'));
const crawlerDir = path.join(temp, 'crawler');
const statePath = path.join(crawlerDir, 'state.json');
fs.mkdirSync(crawlerDir, { recursive: true });

const legacy = {
  version: 1,
  frontier: [{ url: 'https://legacy.example.test/start', priority: 10, depth: 0, discoveredFrom: '', candidateHints: ['旧作品'] }],
  visited: ['legacy-visited'],
  documents: [{ url: 'https://legacy.example.test/work', title: '旧作品', score: 9, candidateTitles: ['旧作品'], discoveryOnly: false, lastChecked: '2026-09-10T00:00:00.000Z' }],
  candidates: [{ key: '旧作品', title: '旧作品', sources: [], evidence: [], facts: {}, series: {}, research: {}, lastSeen: '' }],
  researchStrategy: { version: 1, operations: {}, trust: {}, updatedAt: '' },
  calibrationSeen: ['00000000000000000000000000000001'],
  wikidataBootstrap: { version: 1, offset: 0, completed: false, lastRunAt: '' },
  wikidataSeriesExpansion: { version: 1, expandedRefs: [], lastRunAt: '' },
  updatedAt: '2026-09-10T00:00:00.000Z'
};
fs.writeFileSync(statePath, `${JSON.stringify(legacy, null, 2)}\n`, 'utf8');
const legacyLoaded = loadDiscoveryState(statePath);
assert.equal(legacyLoaded.version, 1);
assert.equal(legacyLoaded.candidates[0].title, '旧作品');
assert.equal(legacyLoaded.frontier[0].url, 'https://legacy.example.test/start');

const state = emptyDiscoveryState();
const count = 20001;
for (let index = 0; index < count; index += 1) {
  const suffix = String(index).padStart(5, '0');
  state.frontier.push({
    url: `https://frontier.example.test/work/${suffix}`,
    priority: index % 1000,
    depth: index % 4,
    discoveredFrom: '',
    candidateHints: [
      `長期保存検証作品${suffix} 第一候補タイトル`,
      `長期保存検証作品${suffix} 第二候補タイトル`,
      `長期保存検証作品${suffix} 第三候補タイトル`
    ]
  });
  state.visited.push(`visited-${suffix}`);
  state.documents.push({
    url: `https://document.example.test/work/${suffix}`,
    title: `資料作品${suffix}`,
    score: index,
    candidateTitles: [`資料作品${suffix}`],
    discoveryOnly: false,
    lastChecked: '2026-09-11T00:00:00.000Z'
  });
  state.candidates.push({
    key: `scale-work-${suffix}`,
    title: `Scale Work ${suffix}`,
    sources: [],
    verifiedPrimaryUrls: index === 0 ? ['https://official.example.test/scale/0'] : [],
    evidence: [],
    facts: {},
    series: {},
    research: {},
    lastSeen: ''
  });
  state.calibrationSeen.push(index.toString(16).padStart(32, '0'));
}

const operationCount = 20001;
const trustCount = 50001;
state.researchStrategy = { version: 1, operations: {}, trust: {}, updatedAt: '2026-09-11T00:00:00.000Z' };
for (let index = 0; index < operationCount; index += 1) {
  state.researchStrategy.operations[`host-${index}.test\u0000general`] = {
    attempts: 1,
    fetched: 1,
    evidencePages: index % 2,
    evidenceClaims: index % 3,
    failures: 0,
    blocked: 0,
    lastUpdated: '2026-09-11T00:00:00.000Z'
  };
}
for (let index = 0; index < trustCount; index += 1) {
  state.researchStrategy.trust[`host\u0000source-${index}.test`] = {
    strongMatches: 0,
    weakMatches: 1,
    strongConflicts: 0,
    weakConflicts: 0,
    samples: 1,
    lastUpdated: '2026-09-11T00:00:00.000Z'
  };
}

const firstManifest = saveDiscoveryState(statePath, state);
assert.equal(firstManifest.version, 2);
assert.equal(firstManifest.storage, 'sharded-v1');
assert.match(firstManifest.revision, /^r-\d{14}-[a-f0-9]{12}$/);
assert.equal(firstManifest.researchStrategy.version, 1);
assert.equal(Object.hasOwn(firstManifest.researchStrategy, 'operations'), false, 'large operations map must not be embedded in state.json');
assert.equal(Object.hasOwn(firstManifest.researchStrategy, 'trust'), false, 'large trust map must not be embedded in state.json');

for (const kind of ['frontier', 'visited', 'documents', 'candidates', 'calibrationSeen']) {
  assert.equal(firstManifest.counts[kind], count, `${kind} count must not be silently truncated`);
  assert.ok(Array.isArray(firstManifest.shards[kind]));
  for (let index = 0; index < firstManifest.shards[kind].length; index += 1) {
    const descriptor = firstManifest.shards[kind][index];
    assert.equal(descriptor.file, `state-shards/${kind}-${String(index).padStart(5, '0')}.json`);
    assert.ok(descriptor.bytes <= 4 * 1024 * 1024 + 2, `${kind} shard exceeds target for bounded fixtures`);
    assert.match(descriptor.sha256, /^[a-f0-9]{64}$/);
    assert.ok(fs.existsSync(path.join(crawlerDir, descriptor.file)));
  }
}
assert.equal(firstManifest.counts.researchOperations, operationCount);
assert.equal(firstManifest.counts.researchTrust, trustCount);
assert.ok(firstManifest.shards.researchOperations.length >= 1);
assert.ok(firstManifest.shards.researchTrust.length >= 2, 'large learned trust map must be physically sharded');
assert.ok(firstManifest.shards.frontier.length >= 2, 'large frontier must be physically sharded');
assert.ok(fs.statSync(statePath).size < 1024 * 1024, 'state.json must remain a small manifest');
assert.equal(fs.readdirSync(path.join(crawlerDir, 'state-shards')).some((name) => name.startsWith('g-')), false, 'random generation directories must not inflate Git history');

const roundTrip = loadDiscoveryState(statePath);
assert.equal(roundTrip.version, 1, 'callers keep the existing in-memory state contract');
assert.equal(roundTrip.frontier.length, count);
assert.equal(roundTrip.visited.length, count);
assert.equal(roundTrip.documents.length, count, 'document metadata over the old 20k cap must survive');
assert.equal(roundTrip.candidates.length, count);
assert.equal(roundTrip.calibrationSeen.length, count);
assert.equal(Object.keys(roundTrip.researchStrategy.operations).length, operationCount);
assert.equal(Object.keys(roundTrip.researchStrategy.trust).length, trustCount);
assert.equal(roundTrip.candidates[0].title, 'Scale Work 00000');
assert.deepEqual(roundTrip.candidates[0].verifiedPrimaryUrls, ['https://official.example.test/scale/0'], 'verified primary provenance must survive sharded save/load');
assert.equal(roundTrip.candidates.at(-1).title, 'Scale Work 20000');
assert.equal(roundTrip.documents[0].title, '資料作品20000');
assert.equal(roundTrip.documents.at(-1).title, '資料作品00000');
assert.equal(roundTrip.researchStrategy.operations['host-0.test\u0000general'].attempts, 1);
assert.equal(roundTrip.researchStrategy.trust['host\u0000source-50000.test'].samples, 1);

const firstPaths = Object.fromEntries(Object.entries(firstManifest.shards).map(([kind, descriptors]) => [kind, descriptors.map((item) => item.file)]));
const staleShard = path.join(crawlerDir, 'state-shards', 'candidates-99999.json');
fs.writeFileSync(staleShard, '[]\n', 'utf8');
const secondManifest = saveDiscoveryState(statePath, roundTrip);
assert.notEqual(secondManifest.revision, firstManifest.revision);
for (const [kind, paths] of Object.entries(firstPaths)) {
  assert.deepEqual(secondManifest.shards[kind].map((item) => item.file), paths, `${kind} shard paths must remain stable for Git delta efficiency`);
}
assert.equal(fs.existsSync(staleShard), false, 'unreferenced recognized shard must be removed after a valid manifest switch');

const manifestText = fs.readFileSync(statePath, 'utf8');
const manifest = JSON.parse(manifestText);
const candidateShard = manifest.shards.candidates[0];
const candidateShardPath = path.join(crawlerDir, candidateShard.file);
fs.appendFileSync(candidateShardPath, 'corruption', 'utf8');
assert.throws(() => loadDiscoveryState(statePath), /state-shard-(?:size|hash)-mismatch:candidates:0/);

manifest.shards.candidates[0].file = 'state-shards/../escape.json';
fs.writeFileSync(statePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
assert.throws(() => loadDiscoveryState(statePath), /state-shard-path-invalid:candidates:0/);

fs.rmSync(temp, { recursive: true, force: true });
console.log('Crawler state sharding self-test: PASS');
console.log('legacy version-1 load compatibility: PASS');
console.log('20k+ frontier/visited/documents/candidates/calibration state: PRESERVED');
console.log('verified primary provenance: PRESERVED');
console.log('20k+ research operations: PRESERVED');
console.log('50k+ research trust entries: PRESERVED');
console.log('4 MiB compact shard target: PASS');
console.log('stable shard paths for Git delta efficiency: PASS');
console.log('manifest-last revision switch + post-write reload: PASS');
console.log('stale shard cleanup: PASS');
console.log('shard count/bytes/SHA-256 integrity: PASS');
console.log('shard path traversal: BLOCKED');