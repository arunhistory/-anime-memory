import assert from 'node:assert/strict';
import { loadColumns } from '../csv/csv.mjs';
import { deduplicateIncoming } from './deduplicate.mjs';

const columns = loadColumns(process.cwd());
const empty = () => Object.fromEntries(columns.map((column) => [column, '']));

const existingRecord = {
  ...empty(),
  id: 'A00000001',
  title_ja: 'Dr.STONE SCIENCE FUTURE',
  media_type: 'TV',
  release_start: '',
  animation_studio: '',
  external_ids: 'discovery-key::dr-stone-science-future',
  updated_at: '2026-09-10'
};
const incoming = {
  ...empty(),
  title_ja: '別名で上書きしてはいけない',
  media_type: 'MOVIE',
  release_start: '2025-01-09',
  animation_studio: 'TMS Entertainment',
  external_ids: 'discovery-key::dr-stone-science-future',
  updated_at: '2026-09-11'
};

const result = deduplicateIncoming([incoming], [{ fileName: 'initial-001.csv', record: existingRecord }], columns, { warn: () => {} });
assert.equal(result.accepted.length, 0, 'registered work must not be appended as a duplicate');
assert.equal(result.enrichments.length, 1, 'registered work with verified blank fields must be staged for enrichment');
assert.equal(result.stats.exactExisting, 1);
assert.equal(result.stats.existingEnriched, 1);
const enriched = result.enrichments[0].record;
assert.equal(enriched.id, 'A00000001');
assert.equal(enriched.title_ja, 'Dr.STONE SCIENCE FUTURE', 'existing non-empty title must not be overwritten');
assert.equal(enriched.media_type, 'TV', 'existing non-empty media type must not be overwritten');
assert.equal(enriched.release_start, '2025-01-09');
assert.equal(enriched.animation_studio, 'TMS Entertainment');
assert.equal(enriched.updated_at, '2026-09-11', 'metadata date may advance only when an actual blank-field enrichment occurs');

const conflictingOnly = { ...incoming, release_start: '', animation_studio: '', updated_at: '2026-09-12' };
const conflictResult = deduplicateIncoming([conflictingOnly], [{ fileName: 'initial-001.csv', record: existingRecord }], columns, { warn: () => {} });
assert.equal(conflictResult.enrichments.length, 0, 'conflicting non-empty fields alone must not rewrite a registered record');

console.log('Registered-work enrichment self-test: PASS');
console.log('blank-field fill: PASS');
console.log('non-empty overwrite protection: PASS');
console.log('duplicate append protection: PASS');
