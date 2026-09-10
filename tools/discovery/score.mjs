const STRONG_TERMS = [
  'tvアニメ', 'テレビアニメ', '劇場アニメ', '劇場版', 'アニメ化', 'アニメーション制作',
  'キャスト', '声優', 'シリーズ構成', 'キャラクターデザイン', '放送開始', '配信開始',
  'オープニングテーマ', 'エンディングテーマ', 'ティザーpv', '本pv', 'anime', 'animation'
];
const MEDIUM_TERMS = [
  'アニメ', '監督', '原作', '制作会社', '放送', '配信', 'スタッフ', 'キャラクター',
  '主題歌', '挿入歌', '第1話', '新作', '続編', 'ova', 'ona'
];
const NEGATIVE_TERMS = [
  '採用情報', '求人', '会社概要', 'お問い合わせ', 'プライバシーポリシー', '利用規約',
  'カート', 'ログイン', '会員登録', '不動産', '保険', '金融', '天気'
];

function countHits(text, terms) {
  const lower = String(text || '').normalize('NFKC').toLocaleLowerCase('ja');
  let score = 0;
  for (const term of terms) if (lower.includes(term.toLocaleLowerCase('ja'))) score += 1;
  return score;
}

export function scoreAnimeDocument(document) {
  const headline = `${document.title || ''}\n${document.ogTitle || ''}\n${document.description || ''}`;
  const body = `${headline}\n${String(document.text || '').slice(0, 120000)}`;
  let score = countHits(headline, STRONG_TERMS) * 20;
  score += countHits(body, STRONG_TERMS) * 7;
  score += countHits(headline, MEDIUM_TERMS) * 8;
  score += countHits(body, MEDIUM_TERMS) * 2;
  score -= countHits(headline, NEGATIVE_TERMS) * 12;
  score -= countHits(body.slice(0, 5000), NEGATIVE_TERMS) * 3;
  score += (document.candidates?.length || 0) * 35;
  return Math.max(-100, Math.min(500, score));
}

export function scoreDiscoveredLink(link, parentScore, candidateTitles = []) {
  const url = String(link.url || '').normalize('NFKC').toLocaleLowerCase('ja');
  const anchor = String(link.anchor || '').normalize('NFKC').toLocaleLowerCase('ja');
  const haystack = `${url} ${anchor}`;
  let score = Math.max(0, Math.min(100, parentScore / 4));

  const positive = [
    ['anime', 25], ['アニメ', 25], ['works', 16], ['作品', 18], ['news', 8], ['ニュース', 8],
    ['cast', 24], ['キャスト', 24], ['voice', 18], ['声優', 24], ['character', 24], ['キャラクター', 24],
    ['staff', 26], ['スタッフ', 26], ['director', 18], ['監督', 20],
    ['onair', 24], ['broadcast', 22], ['放送', 24], ['schedule', 18], ['放送日時', 22],
    ['stream', 24], ['delivery', 20], ['配信', 24], ['vod', 18],
    ['music', 24], ['song', 18], ['主題歌', 24], ['オープニング', 20], ['エンディング', 20], ['挿入歌', 20],
    ['episode', 24], ['story', 22], ['各話', 24], ['エピソード', 24], ['あらすじ', 18],
    ['production', 22], ['studio', 22], ['制作', 22], ['製作', 20], ['制作会社', 26],
    ['original', 20], ['manga', 16], ['novel', 16], ['原作', 22], ['出版社', 18], ['連載', 18],
    ['series', 22], ['season', 20], ['sequel', 20], ['prequel', 20], ['続編', 22], ['前作', 18],
    ['movie', 16], ['劇場', 18], ['special', 16], ['特別編', 18], ['ova', 18], ['ona', 18],
    ['official', 45], ['公式サイト', 45], ['公式', 30], ['profile', 14], ['data', 12],
    ['pv', 12]
  ];
  const negative = [
    ['privacy', -45], ['policy', -35], ['terms', -35], ['contact', -40], ['recruit', -50],
    ['採用', -50], ['求人', -50], ['問い合わせ', -40], ['login', -50], ['signup', -50], ['cart', -50]
  ];
  for (const [term, value] of positive) if (haystack.includes(term)) score += value;
  for (const [term, value] of negative) if (haystack.includes(term)) score += value;

  for (const title of candidateTitles) {
    const normalized = String(title || '').normalize('NFKC').toLocaleLowerCase('ja').replace(/\s+/g, '');
    if (normalized.length >= 2 && haystack.replace(/\s+/g, '').includes(normalized)) score += 45;
  }
  return Math.max(-100, Math.min(500, score));
}

export function isRelevantDocument(score) {
  return score >= 22;
}
