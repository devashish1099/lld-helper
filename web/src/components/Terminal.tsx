import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { CornerDownLeft, Trash2, ShieldAlert } from 'lucide-react';
import { useStore } from '../state/store';
import { clearTerminal, onTerminal, sendEof, sendStdin } from '../state/actions';

const COLORS = {
  stdout: '',
  stderr: '\x1b[31m',
  info: '\x1b[36m',
  success: '\x1b[32m',
  error: '\x1b[1;31m',
} as const;

const THEMES = {
  dark: { background: '#1e1e1e', foreground: '#cccccc', cursor: '#1e1e1e', selectionBackground: '#264f78' },
  light: { background: '#ffffff', foreground: '#1f1f1f', cursor: '#ffffff', selectionBackground: '#add6ff', red: '#c4314b', cyan: '#0e7490', green: '#2e7d32' },
};

export function Terminal({ visible }: { visible: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm>(undefined);
  const fitRef = useRef<FitAddon>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const runPhase = useStore((s) => s.runPhase);
  const theme = useStore((s) => s.settings?.theme ?? 'dark');
  const jdk = useStore((s) => s.system?.jdk);

  useEffect(() => {
    const term = new XTerm({
      convertEol: true,
      disableStdin: true,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      scrollback: 10000,
      cursorBlink: false,
      theme: THEMES[theme],
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    termRef.current = term;
    fitRef.current = fit;
    term.writeln('\x1b[2mOutput of compile and run appears here. Programs run on this machine with your local JDK.\x1b[0m');
    const off = onTerminal((text, stream) => {
      if (stream === 'clear') return term.clear();
      const c = COLORS[stream];
      term.write(c ? `${c}${text}\x1b[0m` : text);
    });
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        /* hidden */
      }
    });
    ro.observe(host.current!);
    return () => {
      off();
      ro.disconnect();
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = THEMES[theme];
  }, [theme]);

  useEffect(() => {
    if (visible) requestAnimationFrame(() => fitRef.current?.fit());
  }, [visible]);

  useEffect(() => {
    if (runPhase === 'running') inputRef.current?.focus();
  }, [runPhase]);

  const submit = () => {
    sendStdin(`${input}\n`);
    setInput('');
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 bg-editor py-1 pl-2">
        <div ref={host} className="h-full w-full" />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-panel px-2 py-1">
        <span className="font-mono text-xs text-muted">stdin&gt;</span>
        <input
          ref={inputRef}
          className="min-w-0 flex-1 border-transparent bg-transparent px-1 py-0.5 font-mono text-[12.5px]"
          placeholder={runPhase === 'running' ? 'Type input for the running program and press Enter' : 'Program input is enabled while a program runs'}
          disabled={runPhase !== 'running'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'd' && e.ctrlKey) {
              e.preventDefault();
              sendEof();
            }
          }}
        />
        <button className="icon-btn" title="Send line (Enter)" disabled={runPhase !== 'running'} onClick={submit}>
          <CornerDownLeft size={13} />
        </button>
        <button className="btn !py-0.5" title="Close stdin (Ctrl+D)" disabled={runPhase !== 'running'} onClick={sendEof}>
          EOF
        </button>
        <button className="icon-btn" title="Clear output" onClick={clearTerminal}>
          <Trash2 size={13} />
        </button>
        <span className="flex items-center gap-1 text-[11px] text-subtle" title="Java code is compiled and executed on this machine, inside the workspace directory.">
          <ShieldAlert size={12} /> local · {jdk?.found ? `JDK ${jdk.version}` : 'no JDK'}
        </span>
      </div>
    </div>
  );
}
