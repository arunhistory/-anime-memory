import fs from 'node:fs';
import path from 'node:path';

const statePath = path.join(process.cwd(), 'crawler', 'state.json');
if (!fs.existsSync(statePath)) {
  console.log('Crawler state footprint: NONE');
  process.exit(0);
}

const text = fs.readFileSync(statePath, 'utf8');
const state = JSON.parse(text);
const bytes = (value) => Buffer.byteLength(JSON.stringify(value ?? null), 'utf8');
const report = {
  fileBytes: Buffer.byteLength(text, 'utf8'),
  frontierCount: Array.isArray(state.frontier) ? state.frontier.length : 0,
  frontierBytes: bytes(state.frontier),
  visitedCount: Array.isArray(state.visited) ? state.visited.length : 0,
  visitedBytes: bytes(state.visited),
  documentsCount: Array.isArray(state.documents) ? state.documents.length : 0,
  documentsBytes: bytes(state.documents),
  candidatesCount: Array.isArray(state.candidates) ? state.candidates.length : 0,
  candidatesBytes: bytes(state.candidates),
  researchStrategyBytes: bytes(state.researchStrategy),
  calibrationSeenCount: Array.isArray(state.calibrationSeen) ? state.calibrationSeen.length : 0,
  calibrationSeenBytes: bytes(state.calibrationSeen),
  wikidataBootstrapBytes: bytes(state.wikidataBootstrap),
  wikidataSeriesExpansionBytes: bytes(state.wikidataSeriesExpansion)
};
console.log('Crawler state footprint:');
console.log(JSON.stringify(report));
