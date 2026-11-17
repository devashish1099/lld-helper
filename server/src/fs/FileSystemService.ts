import fs from 'node:fs';
import path from 'node:path';

export class PathError extends Error {
  statusCode = 400;
}

export interface TreeNode {
  name: string;
  path: string; // POSIX-style, relative to the project root
  type: 'file' | 'dir';
  children?: TreeNode[];
}

const IGNORED = new Set(['.git', 'node_modules', '.idea', '.vscode', 'target', 'build', 'out', '.DS_Store']);
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** True if `child` is `root` or lies inside it. Both must be absolute, normalized paths. */
export function isWithin(root: string, child: string) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a client-supplied relative path against a root, rejecting traversal,
 * absolute paths, NUL bytes and symlinks that escape the root.
 */
export function safeResolve(root: string, relPath: string, { allowRoot = false } = {}): string {
  if (typeof relPath !== 'string') throw new PathError('Path must be a string');
  if (relPath.includes('\0')) throw new PathError('Invalid path');
  const cleaned = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.isAbsolute(relPath) && !relPath.startsWith('/')) throw new PathError('Absolute paths are not allowed');
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, cleaned);
  if (!isWithin(rootAbs, abs)) throw new PathError(`Path escapes the project directory: ${relPath}`);
  if (!allowRoot && abs === rootAbs) throw new PathError('Operation not allowed on the project root');

  // Symlink check: resolve the deepest existing ancestor and make sure it is still inside root.
  let probe = abs;
  while (!fs.existsSync(probe) && probe !== rootAbs) probe = path.dirname(probe);
  if (fs.existsSync(probe)) {
    const realRoot = fs.realpathSync(rootAbs);
    const real = fs.realpathSync(probe);
    if (!isWithin(realRoot, real)) throw new PathError('Path resolves outside the project directory');
  }
  return abs;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

export function validateName(name: string) {
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\0]/.test(name)) throw new PathError(`Invalid name: ${name}`);
}

export class FileSystemService {
  constructor(readonly root: string) {}

  resolve(rel: string, opts?: { allowRoot?: boolean }) {
    return safeResolve(this.root, rel, opts);
  }

  relative(abs: string) {
    return toPosix(path.relative(this.root, abs));
  }

  tree(): TreeNode {
    const walk = (abs: string, rel: string): TreeNode[] => {
      const entries = fs.readdirSync(abs, { withFileTypes: true }).filter((e) => !IGNORED.has(e.name));
      entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
      return entries
        .filter((e) => e.isDirectory() || e.isFile())
        .map((e) => {
          const childRel = rel ? `${rel}/${e.name}` : e.name;
          return e.isDirectory()
            ? { name: e.name, path: childRel, type: 'dir' as const, children: walk(path.join(abs, e.name), childRel) }
            : { name: e.name, path: childRel, type: 'file' as const };
        });
    };
    return { name: path.basename(this.root), path: '', type: 'dir', children: walk(this.root, '') };
  }

  listFiles(predicate: (rel: string) => boolean = () => true): string[] {
    const out: string[] = [];
    const walk = (n: TreeNode) => {
      if (n.type === 'file' && predicate(n.path)) out.push(n.path);
      n.children?.forEach(walk);
    };
    walk(this.tree());
    return out;
  }

  read(rel: string): string {
    const abs = this.resolve(rel);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new PathError('Not a file');
    if (st.size > MAX_FILE_BYTES) throw new PathError('File too large to open in the editor (> 5 MB)');
    return fs.readFileSync(abs, 'utf8');
  }

  write(rel: string, content: string) {
    const abs = this.resolve(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }

  writeBuffer(rel: string, data: Buffer) {
    const abs = this.resolve(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }

  createFile(rel: string, content = '') {
    const abs = this.resolve(rel);
    validateName(path.basename(abs));
    if (fs.existsSync(abs)) throw new PathError(`Already exists: ${rel}`);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }

  mkdir(rel: string) {
    const abs = this.resolve(rel);
    for (const seg of rel.split('/').filter(Boolean)) validateName(seg);
    fs.mkdirSync(abs, { recursive: true });
  }

  move(from: string, to: string) {
    const src = this.resolve(from);
    const dst = this.resolve(to);
    validateName(path.basename(dst));
    if (!fs.existsSync(src)) throw new PathError(`Not found: ${from}`);
    if (fs.existsSync(dst)) throw new PathError(`Destination already exists: ${to}`);
    if (isWithin(src, dst)) throw new PathError('Cannot move a folder into itself');
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  }

  delete(rel: string) {
    const abs = this.resolve(rel);
    if (!fs.existsSync(abs)) throw new PathError(`Not found: ${rel}`);
    fs.rmSync(abs, { recursive: true, force: true });
  }

  exists(rel: string) {
    return fs.existsSync(this.resolve(rel, { allowRoot: true }));
  }
}
