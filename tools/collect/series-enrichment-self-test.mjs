import assert from 'node:assert/strict';
import { splitStructured } from '../normalize/record.mjs';
import { discoveryExternalIdForKey, seriesIdForRef } from '../discovery/series-record.mjs';
import { applySeriesMetadataToCollection } from './series-enrichment.mjs';

const columns = ['id', 'title_ja', 'series_id', 'animation_studio', 'relations', 'external_ids', 'updated_at'];
const originalExisting = [{
  fileName: 'initial-001.csv',
  record: {
    id: 'A00000001',
    title_ja: 'Series One',
    series_id: '',
    animation_studio: '',
    relations: '',
    external_ids: discoveryExternalIdForKey('seriesone'),
    updated_at: '2026-09-10'
  }
}];
const workingExisting = [{
  fileName: 'initial-001.csv',
  record: {
    ...originalExisting[0].record,
    animation_studio: 'Studio A',
    updated_at: '2026-09-11'
  }
}];
const selected = [{
  id: 'A00000002',
  title_ja: 'Series Two',
  series_id: '',
  animation_studio: 'Studio A',
  relations: '',
  external_ids: discoveryExternalIdForKey('seriestwo'),
  updated_at: '2026-09-11'
}];
const series = {
  ref: 'https://www.wikidata.org/entity/Q500',
  title: 'Series',
  members: [
    { title: 'Series One', url: '', kind: 'OTHER' },
    { title: 'Series Two', url: '', kind: 'SEQUEL' }
  ],
  relations: [
    { sourceTitle: 'Series One', targetTitle: 'Series Two', kind: 'SEQUEL' },
    { sourceTitle: 'Series Two', targetTitle: 'Series One', kind: 'PREQUEL' }
  ]
};
const candidates = [
  { key: 'seriesone', title: 'Series One', series },
  { key: 'seriestwo', title: 'Series Two', series }
];

const result = applySeriesMetadataToCollection({
  originalExisting,
  workingExisting,
  selected,
  targetName: 'initial-002.csv',
  candidates,
  columns
});
assert.equal(result.existingUpdates.length, 1);
assert.equal(result.seriesStats.seriesIdsAdded, 2);
assert.equal(result.seriesStats.relationsAdded, 2);
assert.equal(result.existingUpdates[0].record.animation_studio, 'Studio A', 'ordinary blank-field enrichment must survive series staging');
assert.equal(result.existingUpdates[0].record.series_id, seriesIdForRef(series.ref));
assert.deepEqual(splitStructured(result.existingUpdates[0].record.relations), [['SEQUEL', 'A00000002']]);
assert.equal(selected[0].series_id, seriesIdForRef(series.ref));
assert.deepEqual(splitStructured(selected[0].relations), [['PREQUEL', 'A00000001']]);

console.log('Collection series metadata transaction self-test: PASS');
console.log('ordinary enrichment + series metadata composition: PASS');
console.log('cross-file relation staging: PASS');
