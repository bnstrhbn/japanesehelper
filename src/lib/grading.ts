import { toHiragana, toKatakana } from 'wanakana';

export const normalizeJapanese = (s: string): string => {
  const hira = toHiragana(s, { passRomaji: false });
  return hira
    .trim()
    .replace(/[\s　]+/g, '')
    .replace(/[。．\.、，,！!？?「」『』（）\(\)\[\]【】]/g, '');
};

export const normalizeKatakana = (s: string): string => {
  const kata = toKatakana(s, { passRomaji: false });
  return kata
    .trim()
    .replace(/[\s　]+/g, '')
    .replace(/[。．\.、，,！!？?「」『』（）\(\)\[\]【】]/g, '');
};

export const isCorrect = (user: string, expected: string): boolean => {
  const u = normalizeJapanese(user);
  const e = normalizeJapanese(expected);
  if (u === e) return true;
  if (e.includes('を') && u === e.replace(/を/g, 'お')) return true;
  return false;
};

export const normalizeEnglish = (s: string): string => {
  return s
    .trim()
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const englishAcceptableAnswers = (expected: string): string[] => {
  const raw = expected.trim();
  const pieces = raw
    .split(';')
    .flatMap((p) => p.split(','))
    .flatMap((p) => p.split('/'))
    .map((p) => p.trim())
    .filter(Boolean);

  const variants = new Set<string>();
  variants.add(normalizeEnglish(raw));
  for (const p of pieces) {
    const n = normalizeEnglish(p);
    if (!n) continue;
    variants.add(n);
    if (n.startsWith('to ')) variants.add(n.slice(3).trim());
  }

  return [...variants].filter(Boolean);
};

const containsWordPhrase = (haystack: string, needle: string): boolean => {
  if (!needle) return false;
  const h = normalizeEnglish(haystack);
  const n = normalizeEnglish(needle);
  if (!h || !n) return false;
  if (h === n) return true;

  const hWords = h.split(' ').filter(Boolean);
  const nWords = n.split(' ').filter(Boolean);
  if (nWords.length === 0) return false;

  for (let i = 0; i + nWords.length <= hWords.length; i += 1) {
    let ok = true;
    for (let j = 0; j < nWords.length; j += 1) {
      if (hWords[i + j] !== nWords[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return true;
  }

  return false;
};

export const isCorrectEnglish = (user: string, expected: string): boolean => {
  const u = normalizeEnglish(user);
  if (!u) return false;
  const ok = englishAcceptableAnswers(expected);
  if (ok.includes(u)) return true;

  if (u.split(' ').length < 2) return false;
  return ok.some((variant) => containsWordPhrase(variant, u));
};
