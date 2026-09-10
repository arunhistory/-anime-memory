import {
  hasExactExternalId,
  isCompositeDuplicateCandidate,
  mergeOnlyBlank
} from '../normalize/record.mjs';

export function deduplicateIncoming(incoming, existing, columns, { warn = console.warn } = {}) {
  const accepted = [];
  const stats = { exactExisting: 0, candidateExisting: 0, exactIncomingMerged: 0, candidateIncoming: 0 };

  for (const item of incoming) {
    const exactExisting = existing.find(({ record }) => hasExactExternalId(record, item));
    if (exactExisting) {
      stats.exactExisting += 1;
      continue;
    }
    const candidateExisting = existing.find(({ record }) => isCompositeDuplicateCandidate(record, item));
    if (candidateExisting) {
      stats.candidateExisting += 1;
      warn(`重複候補のため自動登録しません: source title=${item.title_ja || '(empty)'} / existing=${candidateExisting.record.id}`);
      continue;
    }

    const exactIncomingIndex = accepted.findIndex((record) => hasExactExternalId(record, item));
    if (exactIncomingIndex >= 0) {
      accepted[exactIncomingIndex] = mergeOnlyBlank(accepted[exactIncomingIndex], item, columns);
      stats.exactIncomingMerged += 1;
      continue;
    }
    const candidateIncoming = accepted.find((record) => isCompositeDuplicateCandidate(record, item));
    if (candidateIncoming) {
      stats.candidateIncoming += 1;
      warn(`取得内の重複候補を自動統合しません: ${item.title_ja || '(empty)'}`);
      continue;
    }
    accepted.push({ ...item });
  }
  return { accepted, stats };
}
