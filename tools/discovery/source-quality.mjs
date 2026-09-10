import { normalizeTitleKey } from './html.mjs';

export const SOURCE_CLASSES = new Set(['primary', 'secondary']);

function normalizedHeadline(document) {
  return `${document?.ogTitle || ''}\n${document?.title || ''}\n${document?.description || ''}`
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

export function evidenceDirectness(document, candidate) {
  if (!document || !candidate) return 0;
  const subjectKey = normalizeTitleKey(document.subjectCandidate?.title || document.subjectCandidate?.key || '');
  const candidateKey = normalizeTitleKey(candidate.title || candidate.key || '');
  if (!candidateKey) return 0;

  const headline = normalizedHeadline(document);
  const official = /(?:公式(?:サイト|ページ|ホームページ)?|official(?:\s+site|\s+website)?)/i.test(headline);
  if (subjectKey && subjectKey === candidateKey) return official ? 100 : 88;

  const title = String(candidate.title || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (title && headline.includes(title)) return official ? 82 : 72;
  if (candidateKey.length >= 4 && normalizeTitleKey(headline).includes(candidateKey)) return official ? 76 : 66;
  return 35;
}

export function classifyEvidenceSource(document, candidate) {
  if (!document || !candidate) return 'secondary';
  const subjectKey = normalizeTitleKey(document.subjectCandidate?.title || document.subjectCandidate?.key || '');
  const candidateKey = normalizeTitleKey(candidate.title || candidate.key || '');
  if (!subjectKey || !candidateKey || subjectKey !== candidateKey) return 'secondary';

  const heading = normalizedHeadline(document);
  if (/(?:公式(?:サイト|ページ|ホームページ)?|official(?:\s+site|\s+website)?)/i.test(heading)) return 'primary';
  return 'secondary';
}

export function normalizeSourceClass(value) {
  return SOURCE_CLASSES.has(value) ? value : 'secondary';
}
