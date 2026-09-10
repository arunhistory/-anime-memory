import {
  hasExactExternalId,
  isCompositeDuplicateCandidate,
  mergeOnlyBlank,
  normalizeText
} from '../normalize/record.mjs';

function hasSameDiscoveryIdentity(left, right) {
  const leftTitle = normalizeText(left?.title_ja);
  const rightTitle = normalizeText(right?.title_ja);
  return Boolean(leftTitle)
    && leftTitle === rightTitle
    && Boolean(left?.media_type)
    && left.media_type === right.media_type;
}

export function deduplicateIncoming(incoming, existing, columns, { warn = console.warn } = {}) {
  const accepted = [];
  const stats = { exactExisting: 0, candidateExisting: 0, exactIncomingMerged: 0, identityIncomingMerged: 0, candidateIncoming: 0 };

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
    const identityIncomingIndex = accepted.findIndex((record) => hasSameDiscoveryIdentity(record, item));
    if (identityIncomingIndex >= 0) {
      accepted[identityIncomingIndex] = mergeOnlyBlank(accepted[identityIncomingIndex], item, columns);
      stats.identityIncomingMerged += 1;
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
