import { escapeVariable } from '../normalize/record.mjs';
import { normalizeTitleKey } from './html.mjs';

export const RELATION_HINT_FIELD = 'relation_hint';
export const RELATION_TYPES = new Set([
  'PREQUEL', 'SEQUEL', 'SPINOFF', 'MOVIE', 'OVA', 'ONA', 'SPECIAL',
  'REMAKE', 'REBOOT', 'COMPILATION', 'ALTERNATIVE', 'OTHER'
]);

const LABEL_TYPES = [
  ['前作', 'PREQUEL'],
  ['続編', 'SEQUEL'],
  ['次作', 'SEQUEL'],
  ['スピンオフ', 'SPINOFF'],
  ['劇場版', 'MOVIE'],
  ['OVA', 'OVA'],
  ['ONA', 'ONA'],
  ['特別編', 'SPECIAL'],
  ['スペシャル', 'SPECIAL'],
  ['リメイク', 'REMAKE'],
  ['リブート', 'REBOOT'],
  ['総集編', 'COMPILATION'],
  ['別バージョン', 'ALTERNATIVE'],
  ['関連作品', 'OTHER']
];

function cleanTarget(value) {
  const target = String(value || '')
    .normalize('NFKC')
    .replace(/^[\s「『“"']+|[\s」』”"']+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 120);
  if (target.length < 2) return '';
  if (/^(?:https?:\/\/|www\.)/i.test(target)) return '';
  if (/^(?:19|20|21)\d{2}(?:年|[-/.])/.test(target)) return '';
  if (/^(?:放送|配信|公開|上映|発売|制作|製作)(?:開始|予定|決定)?$/i.test(target)) return '';
  return target;
}

function encodeHint(type, target) {
  return `${type}::${escapeVariable(target)}`;
}

function targetsFromRemainder(remainder) {
  const quoted = [...String(remainder || '').matchAll(/[「『“"]([^」』”"]{2,120})[」』”"]/g)]
    .map((match) => cleanTarget(match[1]))
    .filter(Boolean);
  if (quoted.length) return quoted;
  return String(remainder || '')
    .split(/\s*(?:、|,|，|;|；|\/|／)\s*/)
    .map(cleanTarget)
    .filter(Boolean)
    .slice(0, 8);
}

export function extractRelationHintClaims(context, candidate) {
  const claims = [];
  const currentKey = normalizeTitleKey(candidate?.title || candidate?.key || '');
  const seen = new Set();
  for (const rawLine of String(context || '').split(/\n+/).map((line) => line.trim()).filter(Boolean)) {
    for (const [label, type] of LABEL_TYPES) {
      const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = rawLine.match(new RegExp(`(?:^|\\s)${escapedLabel}\\s*[:：]\\s*(.{2,300})$`, 'i'));
      if (!match) continue;
      for (const target of targetsFromRemainder(match[1])) {
        const targetKey = normalizeTitleKey(target);
        if (!targetKey || targetKey === currentKey) continue;
        const value = encodeHint(type, target);
        if (seen.has(value)) continue;
        seen.add(value);
        claims.push({ field: RELATION_HINT_FIELD, value, rule: `relation-label-${type.toLowerCase()}` });
      }
    }
  }
  return claims.slice(0, 30);
}
