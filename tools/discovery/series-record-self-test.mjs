import assert from 'node:assert/strict';
import { splitStructured } from '../normalize/record.mjs';
import {
  applySeriesMetadata,
  discoveryExternalIdForKey,
  seriesIdForRef
} from './series-record.mjs';

const seriesRef = 'https://www.wikidata.org/entity/Q456';
const sharedSeries = {
  ref: seriesRef,
  title: 'Test Series',
  members: [
    { title: 'Test Series', url: '', kind: 'OTHER' },
    { title: 'Test Series 2', url: '', kind: 'SEQUEL' },
    { title: 'Test Series Special', url: '', kind: 'SPECIAL' }
  ],
  relations: [
    { sourceTitle: 'Test Series', targetTitle: 'Test Series 2', kind: 'SEQUEL' },
    { sourceTitle: 'Test Series 2', targetTitle: 'Test Series', kind: 'PREQUEL' },
    { sourceTitle: 'Test Series', targetTitle: 'Test Series Special', kind: 'SPECIAL' }
  ]
};
const candidates = [
  { key: 'testseries', title: 'Test Series', series: sharedSeries },
  { key: 'testseries2', title: 'Test Series 2', series: sharedSeries },
  { key: 'testseriesspecial', title: 'Test Series Special', series: sharedSeries }
];
const entries = [
  {
    fileName: 'initial-001.csv',
    record: {
      id: 'A00000001',
      external_ids: discoveryExternalIdForKey('testseries'),
      series_id: '',
      relations: ''
    }
  },
  {
    fileName: 'initial-002.csv',
    record: {
      id: 'A00000002',
      external_ids: discoveryExternalIdForKey('testseries2'),
      series_id: '',
      relations: ''
    }
  }
];

const first = applySeriesMetadata(entries, candidates);
assert.equal(first.seriesIdsAdded, 2);
assert.equal(first.seriesIdConflicts, 0);
assert.equal(first.relationsAdded, 2);
assert.equal(first.unresolvedRelations, 1);
assert.equal(first.ambiguousDiscoveryIds, 0);
assert.equal(entries[0].record.series_id, seriesIdForRef(seriesRef));
assert.equal(entries[1].record.series_id, seriesIdForRef(seriesRef));
assert.deepEqual(splitStructured(entries[0].record.relations), [['SEQUEL', 'A00000002']]);
assert.deepEqual(splitStructured(entries[1].record.relations), [['PREQUEL', 'A00000001']]);

const second = applySeriesMetadata(entries, candidates);
assert.equal(second.seriesIdsAdded, 0);
assert.equal(second.relationsAdded, 0, 'series relation application must be idempotent');
assert.equal(splitStructured(entries[0].record.relations).length, 1);

entries[0].record.series_id = 'Spreexisting';
const conflict = applySeriesMetadata(entries, candidates);
assert.equal(conflict.seriesIdConflicts, 1);
assert.equal(entries[0].record.series_id, 'Spreexisting', 'non-empty conflicting series_id must not be overwritten');

const duplicateIdentityEntries = [
  { fileName: 'a.csv', record: { id: 'A00000003', external_ids: discoveryExternalIdForKey('testseries'), series_id: '', relations: '' } },
  { fileName: 'b.csv', record: { id: 'A00000004', external_ids: discoveryExternalIdForKey('testseries'), series_id: '', relations: '' } }
];
const ambiguous = applySeriesMetadata(duplicateIdentityEntries, candidates);
assert.equal(ambiguous.ambiguousDiscoveryIds, 1);
assert.equal(duplicateIdentityEntries[0].record.series_id, '');
assert.equal(duplicateIdentityEntries[1].record.series_id, '');

console.log('Series CSV metadata bridge self-test: PASS');
console.log('stable common series_id: PASS');
console.log('registered-target-only relations: PASS');
console.log('relation idempotency: PASS');
console.log('non-empty series_id overwrite: BLOCKED');
console.log('ambiguous discovery identity mutation: BLOCKED');
