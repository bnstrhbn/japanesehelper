import { wkGet, wkGetAll } from './api';
import { loadWkContent, loadWkProgress } from './db';
import type { WkContent, WkProgress, WkSubject } from './types';

export const isVerb = (s: WkSubject) =>
  (s.object === 'vocabulary' || s.object === 'kana_vocabulary') && (s.data.parts_of_speech ?? []).some((p) => /\bverb\b/i.test(p));

type WkUser = { data: { level: number; subscription?: { max_level_granted?: number } } };

/** Highest level the user has reached: WaniKani account level or local WK Path level, whichever is higher, within the subscription cap. */
export const reachedLevel = (apiLevel: number, progress: WkProgress | undefined, maxGranted: number): number =>
  Math.min(maxGranted || 60, Math.max(apiLevel, progress?.level ?? 0));

/**
 * Verb subjects for every level the user has reached. Prefers the locally downloaded WK Path content
 * (works offline / if WaniKani is gone); falls back to the API.
 */
export const loadReachedVerbs = async (
  token: string | undefined,
  f: typeof fetch = fetch,
  local?: { content?: WkContent; progress?: WkProgress },
): Promise<{ verbs: WkSubject[]; level: number; source: 'local' | 'api' }> => {
  const [content, progress] = local
    ? [local.content, local.progress]
    : await Promise.all([loadWkContent().catch(() => undefined), loadWkProgress().catch(() => undefined)]);
  const hasContent = !!content && Object.keys(content.subjects).length > 0;
  let apiLevel = 0;
  let maxGranted = content?.maxLevelGranted ?? 60;
  if (token) {
    try {
      const u = await wkGet<WkUser>(token, 'user', f);
      apiLevel = u.data.level;
      maxGranted = u.data.subscription?.max_level_granted ?? maxGranted;
    } catch (err) {
      if (!hasContent) throw err;
    }
  }
  const level = reachedLevel(apiLevel, progress, maxGranted);
  if (!level) throw new Error('Could not determine your WaniKani level. Save a token or download WK Path content first.');
  if (hasContent) return { verbs: Object.values(content!.subjects).filter((s) => s.data.level <= level && !s.data.hidden_at && isVerb(s)), level, source: 'local' };
  if (!token) throw new Error('No WaniKani token saved.');
  const levels = Array.from({ length: level }, (_, i) => i + 1).join(',');
  const raw = await wkGetAll<WkSubject['data']>(token, `subjects?types=vocabulary,kana_vocabulary&levels=${levels}`, f);
  const verbs = raw.map((r) => ({ id: r.id, object: r.object as WkSubject['object'], data: r.data })).filter((s) => !s.data.hidden_at && isVerb(s));
  return { verbs, level, source: 'api' };
};
