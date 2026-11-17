import { useEffect, useRef, useState } from 'react';
import {
  ChevronRight, ChevronDown, FilePlus, FolderPlus, Package, RefreshCw, ChevronsDownUp, Upload, Download,
  FileCode, FileText, File, Folder, FolderOpen, Coffee, Braces, Pencil, Trash2, Copy, Paperclip, ListTree,
} from 'lucide-react';
import { api, fileToBase64, type TreeNode } from '../api/client';
import { useStore, errorMessage } from '../state/store';
import { afterDelete, afterMove, openFile } from '../state/actions';
import { saveAll } from '../editor/models';
import { confirmDialog, promptDialog } from './Modal';

const JAVA_ROOT = 'src/main/java';

export function FileIcon({ name, open, dir }: { name: string; open?: boolean; dir?: boolean }) {
  if (dir) return open ? <FolderOpen size={14} className="shrink-0 text-[#dcb67a]" /> : <Folder size={14} className="shrink-0 text-[#dcb67a]" />;
  if (name.endsWith('.java')) return <Coffee size={14} className="shrink-0 text-[#e76f00]" />;
  if (name.endsWith('.md')) return <FileText size={14} className="shrink-0 text-[#519aba]" />;
  if (name.endsWith('.pseudo')) return <ListTree size={14} className="shrink-0 text-[#a074c4]" />;
  if (name.endsWith('.json')) return <Braces size={14} className="shrink-0 text-[#cbcb41]" />;
  if (/\.(xml|ya?ml|properties|gradle)$/.test(name)) return <FileCode size={14} className="shrink-0 text-muted" />;
  return <File size={14} className="shrink-0 text-muted" />;
}

interface MenuState {
  x: number;
  y: number;
  node: TreeNode;
}

const dirOf = (n: TreeNode | null) => (!n ? '' : n.type === 'dir' ? n.path : n.path.split('/').slice(0, -1).join('/'));
const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

export function FileExplorer() {
  const { tree, problem, activeTab, dirty, diagnostics, toast, refreshTree } = useStore();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const storageKey = problem ? `lld:expanded:${problem.id}` : '';

  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      setExpanded(new Set(saved ? JSON.parse(saved) : ['src', 'src/main', JAVA_ROOT, 'pseudocode']));
    } catch {
      setExpanded(new Set(['src', 'src/main', JAVA_ROOT]));
    }
  }, [storageKey]);

  const persist = (s: Set<string>) => {
    setExpanded(s);
    try {
      localStorage.setItem(storageKey, JSON.stringify([...s]));
    } catch {
      /* ignore */
    }
  };
  const expand = (...paths: string[]) => {
    const s = new Set(expanded);
    for (const p of paths) {
      const parts = p.split('/');
      for (let i = 1; i <= parts.length; i++) s.add(parts.slice(0, i).join('/'));
    }
    persist(s);
  };
  const toggle = (p: string) => {
    const s = new Set(expanded);
    if (s.has(p)) s.delete(p);
    else s.add(p);
    persist(s);
  };

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  if (!problem || !tree) return <div className="p-3 text-xs text-muted">No problem open.</div>;
  const pid = problem.id;

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  const newFile = (dir: string) =>
    run(async () => {
      const name = await promptDialog('New file', { label: `In /${dir}`, placeholder: 'notes.md or path/to/File.java' });
      if (!name) return;
      const path = join(dir, name);
      await api.createFile(pid, path);
      await refreshTree();
      expand(dirOf({ path, name, type: 'file' }));
      openFile(path);
    });

  const newJavaClass = (dir: string) =>
    run(async () => {
      const base = dir.startsWith(JAVA_ROOT) ? dir : JAVA_ROOT;
      const input = await promptDialog('New Java type', {
        label: `Package directory: /${base}`,
        placeholder: 'ParkingSpot  ·  interface PricingStrategy  ·  enum VehicleType  ·  models.Ticket',
        hint: 'Prefix with interface / enum / record / abstract to choose the kind. Use dots for sub-packages.',
      });
      if (!input) return;
      const m = input.match(/^(interface|enum|record|abstract(?:\s+class)?|class)?\s*([\w.$]+?)(?:\.java)?$/);
      if (!m) throw new Error(`Invalid type name: ${input}`);
      const kind = m[1]?.startsWith('abstract') ? 'abstract class' : (m[1] ?? 'class');
      const parts = m[2].split('.');
      const name = parts.pop()!;
      if (!/^[A-Za-z_$][\w$]*$/.test(name)) throw new Error(`Invalid class name: ${name}`);
      const path = join(join(base, parts.join('/')).replace(/\/$/, ''), `${name}.java`);
      await api.createFile(pid, path, undefined, kind);
      await refreshTree();
      expand(dirOf({ path, name, type: 'file' }));
      openFile(path);
    });

  const newFolder = (dir: string) =>
    run(async () => {
      const name = await promptDialog('New folder', { label: `In /${dir}`, placeholder: 'folder or nested/folder' });
      if (!name) return;
      await api.mkdir(pid, join(dir, name));
      await refreshTree();
      expand(join(dir, name));
    });

  const newPackage = (dir: string) =>
    run(async () => {
      const prefix = dir.startsWith(`${JAVA_ROOT}/`) ? dir.slice(JAVA_ROOT.length + 1).replace(/\//g, '.') + '.' : '';
      const name = await promptDialog('New Java package', { label: `Under /${JAVA_ROOT}`, initial: prefix, placeholder: 'com.parking.models' });
      if (!name) return;
      const r = await api.createPackage(pid, name.replace(/\.$/, ''));
      await refreshTree();
      expand(r.path);
    });

  const rename = (node: TreeNode) =>
    run(async () => {
      const name = await promptDialog(`Rename ${node.type === 'dir' ? 'folder' : 'file'}`, { initial: node.name });
      if (!name || name === node.name) return;
      const to = join(node.path.split('/').slice(0, -1).join('/'), name);
      await saveAll();
      await api.move(pid, node.path, to);
      await afterMove(node.path, to);
    });

  const remove = (node: TreeNode) =>
    run(async () => {
      const ok = await confirmDialog(`Delete ${node.type === 'dir' ? 'folder' : 'file'}`, (
        <>
          Permanently delete <code className="font-mono">{node.path}</code>
          {node.type === 'dir' ? ' and everything inside it' : ''}? This deletes it from disk.
        </>
      ));
      if (!ok) return;
      await api.remove(pid, node.path);
      await afterDelete(node.path);
    });

  const moveTo = (from: string, toDir: string) =>
    run(async () => {
      const name = from.split('/').pop()!;
      const to = join(toDir, name);
      if (to === from || toDir === from || toDir.startsWith(`${from}/`)) return;
      await saveAll();
      await api.move(pid, from, to);
      await afterMove(from, to);
      expand(toDir);
    });

  const upload = (files: FileList) =>
    run(async () => {
      const dir = dirOf(selected);
      const list = await Promise.all(
        [...files].map(async (f) => ({ path: join(dir, (f as File & { webkitRelativePath: string }).webkitRelativePath || f.name), contentBase64: await fileToBase64(f) })),
      );
      const r = await api.upload(pid, list);
      await refreshTree();
      toast(`Imported ${r.written} file(s)${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}`, 'success');
    });

  const errorFiles = new Set(diagnostics.filter((d) => d.severity === 'error').map((d) => d.file));

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isDir = node.type === 'dir';
    const open = expanded.has(node.path);
    const hasErr = isDir ? [...errorFiles].some((f) => f.startsWith(`${node.path}/`)) : errorFiles.has(node.path);
    // Compact Java package display: collapse single-child directory chains under src/main/java.
    let display = node;
    let label = node.name;
    if (isDir && node.path.startsWith(`${JAVA_ROOT}/`)) {
      while (display.children?.length === 1 && display.children[0].type === 'dir' && !expanded.has(`${display.path}!`)) {
        display = display.children[0];
        label += `.${display.name}`;
      }
    }
    const dOpen = expanded.has(display.path);
    return (
      <div key={node.path}>
        <div
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/x-lld-path', node.path);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (!isDir) return;
            e.preventDefault();
            setDragOver(display.path);
          }}
          onDragLeave={() => setDragOver((d) => (d === display.path ? null : d))}
          onDrop={(e) => {
            if (!isDir) return;
            e.preventDefault();
            e.stopPropagation();
            setDragOver(null);
            const from = e.dataTransfer.getData('text/x-lld-path');
            if (from) void moveTo(from, display.path);
          }}
          onClick={() => {
            setSelected(display);
            if (isDir) toggle(display.path);
            else openFile(node.path);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setSelected(display);
            setMenu({ x: e.clientX, y: e.clientY, node: display });
          }}
          className={`flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-[13px] select-none ${
            activeTab === node.path ? 'bg-active' : selected?.path === display.path ? 'bg-hover' : 'hover:bg-hover'
          } ${dragOver === display.path ? 'outline outline-1 outline-accent' : ''}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          title={node.path}
        >
          {isDir ? (dOpen ? <ChevronDown size={14} className="shrink-0 text-muted" /> : <ChevronRight size={14} className="shrink-0 text-muted" />) : <span className="w-3.5 shrink-0" />}
          {isDir && display.path.startsWith(`${JAVA_ROOT}/`) ? <Package size={14} className="shrink-0 text-[#c09553]" /> : <FileIcon name={node.name} dir={isDir} open={dOpen} />}
          <span className={`truncate ${hasErr ? 'text-danger' : ''}`}>{label}</span>
          {!isDir && dirty[node.path] && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-fg/60" />}
        </div>
        {isDir && (display === node ? open : dOpen) && display.children?.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  const menuDir = menu ? dirOf(menu.node) : '';
  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-9 shrink-0 items-center justify-between px-3">
        <span className="panel-title shrink-0" title={problem.projectDir}>
          Files
        </span>
        <div className="flex items-center">
          <button className="icon-btn" title="New Java class" onClick={() => newJavaClass(dirOf(selected))}>
            <Coffee size={14} />
          </button>
          <button className="icon-btn" title="New file" onClick={() => newFile(dirOf(selected))}>
            <FilePlus size={14} />
          </button>
          <button className="icon-btn" title="New folder" onClick={() => newFolder(dirOf(selected))}>
            <FolderPlus size={14} />
          </button>
          <button className="icon-btn" title="New Java package" onClick={() => newPackage(dirOf(selected))}>
            <Package size={14} />
          </button>
          <button className="icon-btn" title="Upload folder into project" onClick={() => uploadRef.current?.click()}>
            <Upload size={14} />
          </button>
          <a className="icon-btn" title="Export project as .zip" href={api.exportUrl(pid)} download>
            <Download size={14} />
          </a>
          <button className="icon-btn" title="Refresh" onClick={() => run(refreshTree)}>
            <RefreshCw size={13} />
          </button>
          <button className="icon-btn" title="Collapse all" onClick={() => persist(new Set())}>
            <ChevronsDownUp size={14} />
          </button>
        </div>
      </div>
      <div
        className={`min-h-0 flex-1 overflow-auto pb-6 ${dragOver === '' ? 'outline outline-1 -outline-offset-1 outline-accent' : ''}`}
        onClick={(e) => e.target === e.currentTarget && setSelected(null)}
        onContextMenu={(e) => {
          e.preventDefault();
          setSelected(null);
          setMenu({ x: e.clientX, y: e.clientY, node: tree });
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver('');
        }}
        onDragLeave={() => setDragOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(null);
          const from = e.dataTransfer.getData('text/x-lld-path');
          if (from) void moveTo(from, '');
        }}
      >
        <div className="px-3 pb-1 text-[11px] font-semibold text-muted uppercase">{tree.name}</div>
        {tree.children?.map((c) => renderNode(c, 0))}
      </div>
      <input
        ref={uploadRef}
        type="file"
        multiple
        className="hidden"
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        onChange={(e) => {
          if (e.target.files?.length) void upload(e.target.files);
          e.target.value = '';
        }}
      />
      {menu && (
        <div
          className="fixed z-50 min-w-[190px] rounded border border-line bg-elev py-1 text-[13px] shadow-xl"
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 300) }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { icon: Coffee, label: 'New Java Class…', fn: () => newJavaClass(menuDir) },
            { icon: FilePlus, label: 'New File…', fn: () => newFile(menuDir) },
            { icon: FolderPlus, label: 'New Folder…', fn: () => newFolder(menuDir) },
            { icon: Package, label: 'New Package…', fn: () => newPackage(menuDir) },
            ...(menu.node.path
              ? [
                  { sep: true },
                  ...(menu.node.type === 'file'
                    ? [{ icon: Paperclip, label: 'Attach to AI chat', fn: () => useStore.setState((s) => ({ aiAttachments: [...new Set([...s.aiAttachments, menu.node.path])] })) }]
                    : []),
                  { icon: Pencil, label: 'Rename…', fn: () => rename(menu.node) },
                  { icon: Copy, label: 'Copy relative path', fn: () => navigator.clipboard.writeText(menu.node.path) },
                  { icon: Trash2, label: 'Delete', fn: () => remove(menu.node), danger: true },
                ]
              : []),
          ].map((item, i) =>
            'sep' in item ? (
              <div key={i} className="my-1 border-t border-line" />
            ) : (
              <button
                key={i}
                className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent hover:text-accent-fg ${item.danger ? 'text-danger' : ''}`}
                onClick={() => {
                  setMenu(null);
                  void item.fn!();
                }}
              >
                {item.icon && <item.icon size={14} />}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
