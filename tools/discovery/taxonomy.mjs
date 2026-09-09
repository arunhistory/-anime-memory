export const ANIME_GENRES = Object.freeze([
  'アクション',
  'バトル',
  'アドベンチャー',
  'コメディ',
  'ギャグ',
  'ドラマ',
  '恋愛',
  'ラブコメ',
  '百合',
  'BL',
  'ファンタジー',
  'ダークファンタジー',
  'SF',
  'ロボット',
  'ミステリー',
  'サスペンス',
  'ホラー',
  'サイコ',
  '日常',
  'ほのぼの',
  '癒し',
  '学園',
  '青春',
  'スポーツ',
  '音楽',
  'アイドル',
  'ダンス',
  '魔法少女',
  '異世界',
  '転生',
  'ゲーム',
  '歴史',
  '時代劇',
  '戦争',
  'ミリタリー',
  '犯罪',
  '探偵',
  '警察',
  '料理',
  '医療',
  '職業',
  '家族',
  '子育て',
  '動物',
  '妖怪',
  'オカルト',
  '超能力',
  'デスゲーム',
  'サバイバル',
  '復讐',
  '群像劇',
  'ハーレム',
  '逆ハーレム',
  'その他'
]);

export const ORIGINAL_TYPES = Object.freeze([
  'オリジナル',
  '漫画系',
  '4コマ漫画系',
  'ライトノベル系',
  'Web小説系',
  'なろう系',
  'カクヨム系',
  '一般小説系',
  '児童文学系',
  'ゲーム系',
  'ソーシャルゲーム系',
  'ノベルゲーム系',
  'カードゲーム系',
  '玩具系',
  '特撮系',
  '舞台系',
  '音楽系',
  'キャラクター企画系',
  'メディアミックス',
  'その他'
]);

export const ANIME_GENRE_SET = new Set(ANIME_GENRES);
export const ORIGINAL_TYPE_SET = new Set(ORIGINAL_TYPES);

const GENRE_ALIASES = new Map([
  ['アクション', ['アクション', 'action']],
  ['バトル', ['バトル', 'battle', '戦闘もの', '戦闘モノ']],
  ['アドベンチャー', ['アドベンチャー', 'adventure', '冒険もの', '冒険モノ']],
  ['コメディ', ['コメディ', 'comedy']],
  ['ギャグ', ['ギャグ', 'gag']],
  ['ドラマ', ['ドラマ', 'drama']],
  ['恋愛', ['恋愛', 'romance', 'ラブストーリー']],
  ['ラブコメ', ['ラブコメ', 'ラブコメディ', 'romantic comedy']],
  ['百合', ['百合', '百合系', '百合もの', '百合モノ', 'ガールズラブ', 'girls love']],
  ['BL', ['BL', 'BL系', 'BLもの', 'BLモノ', 'ボーイズラブ', 'boys love']],
  ['ファンタジー', ['ファンタジー', 'fantasy']],
  ['ダークファンタジー', ['ダークファンタジー', 'dark fantasy']],
  ['SF', ['SF', 'science fiction', 'サイエンスフィクション']],
  ['ロボット', ['ロボット', 'robot', 'メカもの', 'メカモノ']],
  ['ミステリー', ['ミステリー', 'mystery', '推理もの', '推理モノ']],
  ['サスペンス', ['サスペンス', 'suspense']],
  ['ホラー', ['ホラー', 'horror']],
  ['サイコ', ['サイコ', 'psychological']],
  ['日常', ['日常', '日常系']],
  ['ほのぼの', ['ほのぼの', 'ほのぼの系']],
  ['癒し', ['癒し', '癒やし', '癒し系', '癒やし系']],
  ['学園', ['学園', '学園もの', '学園モノ', '学園系', 'スクールもの', 'スクールモノ']],
  ['青春', ['青春', '青春もの', '青春モノ']],
  ['スポーツ', ['スポーツ', 'sports']],
  ['音楽', ['音楽', 'music']],
  ['アイドル', ['アイドル', 'idol']],
  ['ダンス', ['ダンス', 'dance']],
  ['魔法少女', ['魔法少女', 'magical girl']],
  ['異世界', ['異世界', 'isekai']],
  ['転生', ['転生', 'reincarnation']],
  ['ゲーム', ['ゲームもの', 'ゲームモノ', 'ゲーム系', 'game']],
  ['歴史', ['歴史', 'historical']],
  ['時代劇', ['時代劇']],
  ['戦争', ['戦争', 'war']],
  ['ミリタリー', ['ミリタリー', 'military']],
  ['犯罪', ['犯罪', 'crime']],
  ['探偵', ['探偵', 'detective']],
  ['警察', ['警察', 'police']],
  ['料理', ['料理', 'グルメ', 'cooking']],
  ['医療', ['医療', 'medical']],
  ['職業', ['職業もの', '職業モノ', 'お仕事もの', 'お仕事モノ']],
  ['家族', ['家族', 'family']],
  ['子育て', ['子育て', '育児']],
  ['動物', ['動物', 'animal']],
  ['妖怪', ['妖怪']],
  ['オカルト', ['オカルト', 'occult']],
  ['超能力', ['超能力', 'psychic']],
  ['デスゲーム', ['デスゲーム', 'death game']],
  ['サバイバル', ['サバイバル', 'survival']],
  ['復讐', ['復讐', 'revenge']],
  ['群像劇', ['群像劇', 'ensemble drama']],
  ['ハーレム', ['ハーレム', 'harem']],
  ['逆ハーレム', ['逆ハーレム', 'reverse harem']]
]);

const ORIGINAL_TYPE_RULES = [
  ['なろう系', /小説家になろう|なろう系|なろう発/i],
  ['カクヨム系', /カクヨム|カクヨム系|カクヨム発/i],
  ['4コマ漫画系', /4\s*コマ(?:漫画)?(?:系)?|四コマ(?:漫画)?(?:系)?/i],
  ['ライトノベル系', /ライトノベル(?:系)?|ラノベ(?:系)?|light\s*novel/i],
  ['Web小説系', /web\s*小説(?:系)?|ウェブ小説(?:系)?|オンライン小説(?:系)?/i],
  ['ソーシャルゲーム系', /ソーシャルゲーム(?:系)?|スマホゲーム|スマートフォンゲーム|アプリゲーム/i],
  ['ノベルゲーム系', /ノベルゲーム(?:系)?|ビジュアルノベル|visual\s*novel|adv(?:ゲーム)?|アドベンチャーゲーム/i],
  ['カードゲーム系', /カードゲーム(?:系)?|tcg|トレーディングカード/i],
  ['ゲーム系', /ゲーム系|ゲーム原作|ゲーム作品|ゲームを原作|原作\s*[:：][^\n]{0,80}ゲーム|game\s*original/i],
  ['児童文学系', /児童文学(?:系)?|児童書|原作\s*[:：][^\n]{0,80}児童(?:文学|書)/i],
  ['一般小説系', /一般小説系|小説原作|小説を原作|一般小説|文芸作品|原作\s*[:：][^\n]{0,80}(?:小説|文芸)/i],
  ['漫画系', /漫画系|漫画原作|コミック原作|漫画を原作|コミックを原作|原作\s*[:：][^\n]{0,80}(?:漫画|コミック)/i],
  ['玩具系', /玩具系|玩具原作|玩具企画|おもちゃ原作|原作\s*[:：][^\n]{0,80}(?:玩具|おもちゃ)/i],
  ['特撮系', /特撮系|特撮原作|特撮作品|原作\s*[:：][^\n]{0,80}特撮/i],
  ['舞台系', /舞台系|舞台原作|演劇原作|舞台作品|原作\s*[:：][^\n]{0,80}(?:舞台|演劇)/i],
  ['音楽系', /音楽系|楽曲原作|音楽原作|音楽企画|原作\s*[:：][^\n]{0,80}(?:楽曲|音楽)/i],
  ['キャラクター企画系', /キャラクター企画系|キャラクター企画|キャラクター原作/i],
  ['メディアミックス', /メディアミックス/i],
  ['オリジナル', /オリジナルアニメ|アニメオリジナル|完全オリジナル/i]
];

function normalizeText(value) {
  return String(value || '').normalize('NFKC').toLocaleLowerCase('ja-JP');
}

function containsAlias(text, alias) {
  const source = normalizeText(text);
  const needle = normalizeText(alias).trim();
  if (!needle) return false;
  if (/^[a-z0-9]{1,3}$/.test(needle)) {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(source);
  }
  return source.includes(needle);
}

export function normalizeGenresFromText(value) {
  const found = new Set();
  for (const [genre, aliases] of GENRE_ALIASES) {
    if (aliases.some((alias) => containsAlias(value, alias))) found.add(genre);
  }

  if (found.has('ラブコメ')) {
    found.add('恋愛');
    found.add('コメディ');
  }
  if (found.has('ダークファンタジー')) found.add('ファンタジー');

  return ANIME_GENRES.filter((genre) => found.has(genre));
}

export function sortGenres(values) {
  const input = new Set((Array.isArray(values) ? values : []).filter((value) => ANIME_GENRE_SET.has(value)));
  return ANIME_GENRES.filter((genre) => input.has(genre));
}

export function detectOriginalType(value) {
  const text = String(value || '').normalize('NFKC');
  for (const [type, regex] of ORIGINAL_TYPE_RULES) {
    if (regex.test(text)) return type;
  }
  return '';
}

export function isAnimeGenre(value) {
  return ANIME_GENRE_SET.has(String(value || ''));
}

export function isOriginalType(value) {
  return ORIGINAL_TYPE_SET.has(String(value || ''));
}
