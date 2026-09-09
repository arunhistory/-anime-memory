import { normalizeTitleKey } from './html.mjs';

export const SOURCE_CLASSES = new Set(['primary', 'secondary']);

export function classifyEvidenceSource(document, candidate) {
  if (!document || !candidate) return 'secondary';
  const subjectKey = normalizeTitleKey(document.subjectCandidate?.title || document.subjectCandidate?.key || '');
  const candidateKey = normalizeTitleKey(candidate.title || candidate.key || '');
  if (!subjectKey || !candidateKey || subjectKey !== candidateKey) return 'secondary';

  const heading = `${document.ogTitle || ''}\n${document.title || ''}`.normalize('NFKC');
  if (/(?:公式(?:サイト|ページ|ホームページ)?|official(?:\s+site|\s+website)?)/i.test(heading)) return 'primary';
  return 'secondary';
}

export function normalizeSourceClass(value) {
  return SOURCE_CLASSES.has(value) ? value : 'secondary';
}
