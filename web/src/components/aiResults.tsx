import { useEffect, useState } from 'react';
import { FileWarning, FilePlus2 } from 'lucide-react';
import { api } from '../api/client';
import { useStore, allFiles, errorMessage } from '../state/store';
import { writeFileContent } from '../editor/models';
import { openFile, setActivePseudo } from '../state/actions';
import { Modal, mountDialog } from './Modal';

// --- parsers for structured AI output ------------------------------------------

export function parseGeneratedFiles(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = /===\s*FILE:\s*(.+?)\s*===\s*\n```[\w-]*\n([\s\S]*?)\n```/g;
  for (const m of text.matchAll(re)) {
    const path = m[1].trim().replace(/^\/+/, '').replace(/\\/g, '/');
    if (!path.includes('..')) out.push({ path, content: `${m[2].replace(/\s+$/, '')}\n` });
  }
  return out;
}

export function parsePseudo(text: string): string | null {
  const m = text.match(/```(?:pseudo|pseudocode|text)?\n([\s\S]*?)\n```/);
  return m ? `${m[1].trimEnd()}\n` : null;
}

export function parseSuggestedQuestions(text: string): { category: string; question: string }[] {
  const m = text.match(/```(?:json)?\n([\s\S]*?)\n```/) ?? [null, text];
  try {
    const arr = JSON.parse(m[1] ?? '');
    return Array.isArray(arr) ? arr.filter((x) => x && typeof x.question === 'string').map((x) => ({ category: String(x.category ?? 'Functional requirements'), question: x.question })) : [];
  } catch {
    return [];
  }
}

// --- dialogs ---------------------------------------------------------------------

/** Untouched starter files created by LLD Studio (scaffolded Main, empty new class) are safe to replace. */
export function isPristineTemplate(content: string) {
  const c = content.trim();
  return (
    /^public class Main \{\s*public static void main\(String\[\] args\) \{\s*System\.out\.println\("[^"\n]* - LLD Studio"\);\s*\}\s*\}$/.test(c) ||
    /^(package [\w.]+;\s*)?public (abstract class|class|interface|enum) \w+ \{\s*\}$/.test(c) ||
    /^(package [\w.]+;\s*)?public record \w+\(\) \{\s*\}$/.test(c)
  );
}

function GeneratedFilesDialog({ files, done }: { files: { path: string; content: string }[]; done: () => void }) {
  const tree = useStore((s) => s.tree);
  const existing = new Set(allFiles(tree));
  const [selected, setSelected] = useState(() => new Set(files.filter((f) => !existing.has(f.path)).map((f) => f.path)));
  const [templates, setTemplates] = useState<Set<string>>(new Set());
  // Pre-select existing files that are still untouched starter templates.
  useEffect(() => {
    const problemId = useStore.getState().problem?.id;
    if (!problemId) return;
    void Promise.all(
      files
        .filter((f) => existing.has(f.path))
        .map(async (f) => (isPristineTemplate(await api.readFile(problemId, f.path).catch(() => '')) ? f.path : null)),
    ).then((paths) => {
      const t = new Set(paths.filter((p): p is string => !!p));
      setTemplates(t);
      setSelected((s) => new Set([...s, ...t]));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [preview, setPreview] = useState(files[0]?.path);
  const [busy, setBusy] = useState(false);
  const apply = async () => {
    setBusy(true);
    try {
      for (const f of files) if (selected.has(f.path)) await writeFileContent(f.path, f.content);
      await useStore.getState().refreshTree();
      useStore.getState().toast(`Wrote ${selected.size} Java file(s). Your pseudocode was not modified.`, 'success');
      const first = files.find((f) => selected.has(f.path));
      if (first) openFile(first.path);
      done();
    } catch (e) {
      useStore.getState().toast(errorMessage(e), 'error');
      setBusy(false);
    }
  };
  const cur = files.find((f) => f.path === preview);
  return (
    <Modal
      title="Generated Java files"
      onClose={done}
      width={980}
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">Files you've edited are unchecked by default; untouched templates are replaced. Pseudocode is never modified.</span>
          <button className="btn-outline" onClick={done}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!selected.size || busy} onClick={apply}>
            Write {selected.size} file(s)
          </button>
        </>
      }
    >
      <div className="flex h-[60vh] gap-3">
        <div className="w-80 shrink-0 overflow-auto rounded border border-line">
          {files.map((f) => (
            <label key={f.path} className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs ${preview === f.path ? 'bg-active' : 'hover:bg-hover'}`} onClick={() => setPreview(f.path)}>
              <input
                type="checkbox"
                checked={selected.has(f.path)}
                onChange={(e) => {
                  const s = new Set(selected);
                  if (e.target.checked) s.add(f.path);
                  else s.delete(f.path);
                  setSelected(s);
                }}
              />
              {existing.has(f.path) ? <FileWarning size={13} className="shrink-0 text-warning" /> : <FilePlus2 size={13} className="shrink-0 text-success" />}
              <span className="truncate font-mono" title={f.path}>
                {f.path.replace(/^src\/main\/java\//, '')}
              </span>
              {existing.has(f.path) && (
                <span className={`ml-auto shrink-0 text-[10px] ${templates.has(f.path) ? 'text-muted' : 'text-warning'}`}>{templates.has(f.path) ? 'replaces template' : 'overwrite'}</span>
              )}
            </label>
          ))}
        </div>
        <pre className="min-w-0 flex-1 overflow-auto rounded border border-line bg-editor p-3 font-mono text-xs">{cur?.content}</pre>
      </div>
    </Modal>
  );
}

export function showGeneratedFiles(text: string) {
  const files = parseGeneratedFiles(text);
  if (!files.length) {
    useStore.getState().toast('No "=== FILE: ... ===" blocks found in the response.', 'error');
    return;
  }
  void mountDialog<void>((done) => <GeneratedFilesDialog files={files} done={() => done()} />);
}

export async function savePseudoFromText(text: string) {
  const pseudo = parsePseudo(text);
  const { problem, tree, toast, refreshTree, setLayout } = useStore.getState();
  if (!pseudo || !problem) return toast('No pseudocode block found in the response.', 'error');
  const existing = new Set(allFiles(tree));
  let name = 'pseudocode/from-java.pseudo';
  for (let i = 2; existing.has(name); i++) name = `pseudocode/from-java-${i}.pseudo`;
  try {
    await api.writeFile(problem.id, name, pseudo);
    await refreshTree();
    setLayout({ centerMode: 'pseudo' });
    setActivePseudo(name);
    toast(`Saved as ${name}`, 'success');
  } catch (e) {
    toast(errorMessage(e), 'error');
  }
}

function SuggestionsDialog({ items, done }: { items: { category: string; question: string }[]; done: () => void }) {
  const [selected, setSelected] = useState(() => new Set(items.map((_, i) => i)));
  const add = async () => {
    const { problem, toast } = useStore.getState();
    if (!problem) return;
    try {
      for (const [i, it] of items.entries()) if (selected.has(i)) await api.addClarification(problem.id, { category: it.category, question: it.question, source: 'ai' });
      window.dispatchEvent(new Event('lld:clarifications-changed'));
      toast(`Added ${selected.size} question(s)`, 'success');
      done();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Modal
      title="Suggested clarification questions"
      onClose={done}
      width={640}
      footer={
        <>
          <button className="btn-outline" onClick={done}>
            Cancel
          </button>
          <button className="btn-primary" disabled={!selected.size} onClick={add}>
            Add {selected.size} question(s)
          </button>
        </>
      }
    >
      <div className="space-y-1">
        {items.map((it, i) => (
          <label key={i} className="flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-hover">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selected.has(i)}
              onChange={(e) => {
                const s = new Set(selected);
                if (e.target.checked) s.add(i);
                else s.delete(i);
                setSelected(s);
              }}
            />
            <div>
              <div className="text-[13px]">{it.question}</div>
              <div className="text-[11px] text-muted">{it.category}</div>
            </div>
          </label>
        ))}
      </div>
    </Modal>
  );
}

export function showSuggestions(text: string) {
  const items = parseSuggestedQuestions(text);
  if (!items.length) {
    useStore.getState().toast('Could not parse suggested questions from the response.', 'error');
    return;
  }
  void mountDialog<void>((done) => <SuggestionsDialog items={items} done={() => done()} />);
}
