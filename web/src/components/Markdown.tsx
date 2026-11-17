import { memo, useEffect, useRef } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useStore } from '../state/store';

let mermaidPromise: Promise<typeof import('mermaid').default> | undefined;
let mermaidTheme: string | undefined;
let diagramId = 0;

async function getMermaid(theme: 'dark' | 'light') {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  const t = theme === 'dark' ? 'dark' : 'default';
  if (mermaidTheme !== t) {
    mermaid.initialize({ startOnLoad: false, theme: t, securityLevel: 'strict' });
    mermaidTheme = t;
  }
  return mermaid;
}

/**
 * Renders (untrusted) markdown safely: HTML is sanitized, ```mermaid blocks become diagrams,
 * and every code block gets a copy button.
 */
export const Markdown = memo(function Markdown({ text, mermaid = false, className = '' }: { text: string; mermaid?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const theme = useStore((s) => s.settings?.theme ?? 'dark');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: false }) as string);
    el.querySelectorAll('pre').forEach((pre) => {
      const code = pre.querySelector('code');
      if (mermaid && code?.classList.contains('language-mermaid')) return;
      const btn = document.createElement('button');
      btn.textContent = 'Copy';
      btn.className = 'absolute right-1.5 top-1.5 rounded border border-line bg-elev px-1.5 py-0.5 text-[10px] text-muted hover:text-fg';
      btn.onclick = () => {
        void navigator.clipboard.writeText(code?.textContent ?? pre.textContent ?? '');
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = 'Copy'), 1200);
      };
      pre.appendChild(btn);
    });
    if (!mermaid) return;
    const blocks = [...el.querySelectorAll('code.language-mermaid')];
    if (!blocks.length) return;
    let cancelled = false;
    void getMermaid(theme).then(async (m) => {
      for (const code of blocks) {
        if (cancelled) return;
        const pre = code.parentElement!;
        try {
          const { svg } = await m.render(`mmd-${++diagramId}`, code.textContent ?? '');
          const div = document.createElement('div');
          div.className = 'mermaid-diagram';
          div.innerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['foreignObject'] });
          pre.replaceWith(div);
        } catch (e) {
          const err = document.createElement('div');
          err.className = 'text-xs text-danger';
          err.textContent = `Mermaid error: ${(e as Error).message}`;
          pre.after(err);
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [text, mermaid, theme]);

  return <div ref={ref} className={`md ${className}`} />;
});
