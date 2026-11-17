import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { X } from 'lucide-react';

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-[90vh] w-full flex-col rounded-md border border-line bg-elev shadow-2xl" style={{ maxWidth: width }}>
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="text-sm font-semibold">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>
  );
}

// --- imperative prompt/confirm dialogs ---------------------------------------

export function mountDialog<T>(render: (done: (v: T) => void) => ReactNode): Promise<T> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: T) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<>{render(done)}</>);
  });
}

function PromptDialog({ title, label, initial, placeholder, hint, done }: { title: string; label?: string; initial: string; placeholder?: string; hint?: string; done: (v: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.focus();
    const dot = initial.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 && !initial.endsWith('.') ? dot : initial.length);
  }, [initial]);
  return (
    <Modal
      title={title}
      onClose={() => done(null)}
      width={440}
      footer={
        <>
          <button className="btn-outline" onClick={() => done(null)}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => done(value.trim() || null)}>
            OK
          </button>
        </>
      }
    >
      {label && <label className="mb-1.5 block text-xs text-muted">{label}</label>}
      <input
        ref={ref}
        className="w-full px-2 py-1.5 font-mono text-[13px]"
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && done(value.trim() || null)}
      />
      {hint && <p className="mt-2 text-xs text-subtle">{hint}</p>}
    </Modal>
  );
}

export const promptDialog = (title: string, opts: { label?: string; initial?: string; placeholder?: string; hint?: string } = {}) =>
  mountDialog<string | null>((done) => <PromptDialog title={title} initial={opts.initial ?? ''} label={opts.label} placeholder={opts.placeholder} hint={opts.hint} done={done} />);

export const confirmDialog = (title: string, message: ReactNode, confirmLabel = 'Delete', danger = true) =>
  mountDialog<boolean>((done) => (
    <Modal
      title={title}
      onClose={() => done(false)}
      width={440}
      footer={
        <>
          <button className="btn-outline" onClick={() => done(false)}>
            Cancel
          </button>
          <button autoFocus className={danger ? 'btn-primary !bg-danger' : 'btn-primary'} onClick={() => done(true)}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-[13px]">{message}</div>
    </Modal>
  ));
