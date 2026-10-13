import type { ReactNode } from 'react';

const TAG = /<(\/?)(radical|kanji|vocabulary|meaning|reading|ja)>/g;

/** Renders WaniKani mnemonic markup (<radical>, <kanji>, <vocabulary>, <meaning>, <reading>, <ja>) as styled spans. */
export function WkMarkup({ text }: { text?: string | null }) {
  if (!text) return null;
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className="wkMnemonic">
          {render(p)}
        </p>
      ))}
    </>
  );
}

const render = (text: string): ReactNode[] => {
  const root: ReactNode[] = [];
  const stack: Array<{ tag: string; children: ReactNode[] }> = [];
  const push = (n: ReactNode) => (stack.length ? stack[stack.length - 1].children : root).push(n);
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(TAG)) {
    if (m.index! > last) push(text.slice(last, m.index));
    last = m.index! + m[0].length;
    if (!m[1]) stack.push({ tag: m[2], children: [] });
    else if (stack.length && stack[stack.length - 1].tag === m[2]) {
      const { tag, children } = stack.pop()!;
      push(
        <span key={key++} className={`wkHl wkHl-${tag}`}>
          {children}
        </span>,
      );
    }
  }
  if (last < text.length) push(text.slice(last));
  while (stack.length) root.push(...stack.shift()!.children);
  return root;
};
