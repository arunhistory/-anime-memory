import assert from 'node:assert/strict';
import {
  candidateInformationReadiness,
  informationPriorityBoost,
  recordCandidateResearch
} from './research-completion.mjs';

function confirmed(value) {
  return { status: 'confirmed', value, sourceCount: 2, hostCount: 2, confidence: 90 };
}

const sparse = {
  title: 'Dr.STONE SCIENCE FUTURE',
  facts: {
    title_ja: confirmed('Dr.STONE SCIENCE FUTURE'),
    media_type: confirmed('TV'),
    origin_country: confirmed('JP')
  },
  research: {}
};
assert.equal(candidateInformationReadiness(sparse).ready, false, 'name/media/origin only must never be publishable');

const rich = {
  ...sparse,
  facts: {
    ...sparse.facts,
    release_start: confirmed('2025-01-09'),
    episode_count: confirmed('24'),
    animation_studio: confirmed('TMS Entertainment'),
    production_name: confirmed('Dr.STONE Project'),
    director: confirmed('Director A'),
    series_composition: confirmed('Writer B'),
    characters: confirmed('千空::MAIN::Actor A'),
    music: confirmed('Composer A'),
    opening_themes: confirmed('OP::Song A::Artist A::::::'),
    original_type: confirmed('漫画'),
    original_author: confirmed('Author A'),
    official_url: confirmed('https://dr-stone.jp/'),
    broadcast_networks: confirmed('TOKYO MX')
  },
  research: {}
};
let research = {};
for (const [url, field] of [
  ['https://dr-stone.jp/', 'official_url'],
  ['https://anime.example.net/staff', 'director']
]) {
  research = recordCandidateResearch(research, {
    url,
    evidence: [{ field, value: 'fixture' }],
    observedAt: '2026-09-11T00:00:00.000Z'
  });
}
rich.research = research;
const richStatus = candidateInformationReadiness(rich);
assert.equal(richStatus.ready, true, 'broad confirmed information from multiple source families should be publishable');
assert.equal(richStatus.mode, 'information-rich');

const scarce = {
  ...sparse,
  facts: {
    ...sparse.facts,
    release_start: confirmed('1970-01-01'),
    animation_studio: confirmed('Studio A'),
    director: confirmed('Director A'),
    original_author: confirmed('Author A'),
    broadcast_networks: confirmed('Network A'),
    official_url: confirmed('https://archive.example.jp/work')
  },
  research: {}
};
let scarceResearch = {};
const routes = ['staff', 'original', 'music', 'streaming', 'episode', 'official', 'production', 'character'];
for (let index = 0; index < routes.length; index += 1) {
  const host = ['a.example.jp', 'b.example.net', 'c.example.org'][index % 3];
  scarceResearch = recordCandidateResearch(scarceResearch, {
    url: `https://${host}/${routes[index]}`,
    evidence: index < 6 ? [{ field: `fixture_${index}`, value: 'x' }] : [],
    observedAt: `2026-09-11T00:${String(index).padStart(2, '0')}:00.000Z`
  });
}
scarce.research = scarceResearch;
const scarceStatus = candidateInformationReadiness(scarce);
assert.equal(scarceStatus.ready, true, 'scarce historical works may publish after broad research is demonstrably exhausted');
assert.equal(scarceStatus.mode, 'researched-to-exhaustion');

assert.ok(informationPriorityBoost({ url: 'https://dr-stone.jp/music/', anchor: 'MUSIC' }, sparse) >= 80, 'missing information routes must be prioritized');
assert.equal(informationPriorityBoost({ url: 'https://dr-stone.jp/contact/', anchor: 'お問い合わせ' }, rich), 0);

console.log('Information research completion self-test: PASS');
console.log('name-only publication: BLOCKED');
console.log('information-rich publication: PASS');
console.log('researched-to-exhaustion fallback: PASS');
console.log('missing-category route priority: PASS');
