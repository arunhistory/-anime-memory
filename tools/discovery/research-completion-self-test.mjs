import assert from 'node:assert/strict';
import {
  candidateInformationReadiness,
  corroborationPriorityBoost,
  recordCandidateResearch
} from './research-completion.mjs';
import { researchRouteKind } from './research-strategy.mjs';
import { scoreDiscoveredLink } from './score.mjs';

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

const marked = recordCandidateResearch({
  wikidataArticleCheckedAt: '2026-09-11T00:00:00.000Z',
  wikidataArticleUrl: 'https://ja.wikipedia.org/wiki/Dr.STONE'
}, {
  url: 'https://dr-stone.jp/staff/',
  evidence: [{ field: 'director', value: 'fixture' }],
  observedAt: '2026-09-11T00:01:00.000Z'
});
assert.equal(marked.wikidataArticleCheckedAt, '2026-09-11T00:00:00.000Z');
assert.equal(marked.wikidataArticleUrl, 'https://ja.wikipedia.org/wiki/Dr.STONE');

const observedCandidate = {
  ...sparse,
  evidence: [
    { field: 'release_start', value: '2025-01-09', sourceUrl: 'https://www.wikidata.org/entity/Q1' },
    { field: 'animation_studio', value: 'TMS Entertainment', sourceUrl: 'https://www.wikidata.org/entity/Q1' }
  ],
  facts: {
    ...sparse.facts,
    release_start: { status: 'observed', value: '2025-01-09' },
    animation_studio: { status: 'observed', value: 'TMS Entertainment' }
  },
  research: {}
};
const independentBroadcast = corroborationPriorityBoost(
  { url: 'https://network.example.jp/broadcast/', anchor: '放送情報' },
  observedCandidate
);
assert.ok(independentBroadcast >= 125, 'new-family route matching an observed field must receive strong corroboration priority');
assert.equal(
  corroborationPriorityBoost({ url: 'https://ja.wikipedia.org/wiki/Dr.STONE', anchor: '放送情報' }, observedCandidate),
  0,
  'same Wikimedia family must not count as independent corroboration'
);
assert.equal(
  corroborationPriorityBoost({ url: 'https://news.example.jp/interview', anchor: 'インタビュー' }, observedCandidate),
  0,
  'broad news corroboration requires explicit candidate scope'
);
assert.ok(
  corroborationPriorityBoost({ url: 'https://news.example.jp/interview', anchor: 'Dr.STONE インタビュー' }, observedCandidate, { allowBroad: true }) > 0,
  'explicit candidate-scoped independent news may be used for corroboration research'
);

const kodanshaProduct = 'https://kc.kodansha.co.jp/product?item=0000042408';
const lineThemeProduct = 'https://store.line.me/themeshop/product/fc75bb55-e804-41dc-937b-af3ca322378e';
assert.equal(researchRouteKind(kodanshaProduct), 'works', 'commerce product pages remain available to normal discovery routing');
assert.equal(researchRouteKind(lineThemeProduct), 'works', 'theme-store product pages remain available to normal discovery routing');
assert.equal(
  corroborationPriorityBoost({ url: kodanshaProduct, anchor: '' }, observedCandidate, { allowBroad: true }),
  0,
  'publisher product pages must not become focused independent corroboration sources'
);
assert.equal(
  corroborationPriorityBoost({ url: lineThemeProduct, anchor: '' }, observedCandidate, { allowBroad: true }),
  0,
  'merchandise/theme-store pages must not become focused independent corroboration sources'
);
assert.ok(
  corroborationPriorityBoost({ url: 'https://catalog.example.jp/works/dr-stone/', anchor: '作品情報' }, observedCandidate, { allowBroad: true }) > 0,
  'non-commerce work overview pages must remain eligible for corroboration'
);

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

const detailScore = scoreDiscoveredLink({ url: 'https://dr-stone.jp/music/', anchor: 'MUSIC / 主題歌' }, 40, ['Dr.STONE']);
const contactScore = scoreDiscoveredLink({ url: 'https://dr-stone.jp/contact/', anchor: 'お問い合わせ' }, 40, ['Dr.STONE']);
assert.ok(detailScore > contactScore, 'information-rich detail routes must outrank irrelevant utility pages');

console.log('Information research completion self-test: PASS');
console.log('name-only publication: BLOCKED');
console.log('information-rich publication: PASS');
console.log('Wikipedia backfill research metadata persistence: PASS');
console.log('independent observed-field corroboration priority: PASS');
console.log('same-family corroboration: BLOCKED');
console.log('commerce corroboration focus: BLOCKED');
console.log('commerce discovery routing: PRESERVED');
console.log('researched-to-exhaustion fallback: PASS');
console.log('detailed information route priority: PASS');
