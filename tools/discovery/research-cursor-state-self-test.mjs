import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyDiscoveryState, loadDiscoveryState, saveDiscoveryState } from './state.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-research-cursor-'));
const statePath = path.join(temp, 'crawler', 'state.json');
const state = emptyDiscoveryState();
state.researchSearchCursor = 12345;

const manifest = saveDiscoveryState(statePath, state);
assert.equal(manifest.version, 3);
assert.equal(manifest.researchSearchCursor, 12345, 'rotation cursor must be stored in the state manifest');
const loaded = loadDiscoveryState(statePath);
assert.equal(loaded.researchSearchCursor, 12345, 'rotation cursor must survive save/load');

loaded.researchSearchCursor = -50;
const sanitizedManifest = saveDiscoveryState(statePath, loaded);
assert.equal(sanitizedManifest.researchSearchCursor, 0, 'negative/corrupt cursor must sanitize to zero');

fs.rmSync(temp, { recursive: true, force: true });
console.log('Deep-search cursor persistence self-test: PASS');
console.log('manifest persistence: PASS');
console.log('round-trip persistence: PASS');
console.log('invalid cursor sanitization: PASS');
