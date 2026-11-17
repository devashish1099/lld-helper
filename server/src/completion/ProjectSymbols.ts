import path from 'node:path';
import { stripJava } from '../java/CompilationService.js';

export interface MemberSymbol {
  name: string;
  kind: 'method' | 'field' | 'constructor' | 'enumConstant';
  type: string; // return type / field type
  params: string[]; // "Type name"
  static: boolean;
  visibility: 'public' | 'protected' | 'private' | 'package';
  line: number;
}

export interface TypeSymbol {
  name: string;
  fqn: string;
  pkg: string;
  kind: 'class' | 'interface' | 'enum' | 'record';
  typeParams: string;
  extends: string[];
  implements: string[];
  members: MemberSymbol[];
  file: string;
  line: number;
}

const MODIFIERS = /\b(public|protected|private|static|final|abstract|synchronized|volatile|transient|native|default|sealed|non-sealed|strictfp)\b/g;
const TYPE_DECL = /\b(class|interface|enum|record)\s+([A-Z_$][\w$]*)\s*(<[^{]*?>)?\s*(\([^)]*\))?\s*(?:extends\s+([\w$.<>,\s?]+?))?\s*(?:implements\s+([\w$.<>,\s?]+?))?\s*(?:permits\s+[\w$.,\s]+)?\{/;

/** Split on commas that are not nested in <> or (). */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(') depth++;
    if (ch === '>' || ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const visibilityOf = (mods: string): MemberSymbol['visibility'] =>
  /\bpublic\b/.test(mods) ? 'public' : /\bprotected\b/.test(mods) ? 'protected' : /\bprivate\b/.test(mods) ? 'private' : 'package';

const stripAnnotations = (s: string) => s.replace(/@[\w.]+(\([^)]*\))?\s*/g, '');

/**
 * Lightweight Java symbol extractor. Not a full parser: it walks braces to find
 * type bodies and uses regexes on member-level statements. Good enough for completion.
 */
export function extractSymbols(source: string, file: string): TypeSymbol[] {
  const src = stripJava(source);
  const pkg = src.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? '';
  const types: TypeSymbol[] = [];
  const lineAt = (idx: number) => src.slice(0, idx).split('\n').length;

  // Stack of open braces: either a type body (with its symbol) or a plain block.
  const stack: { type?: TypeSymbol; isEnumBody?: boolean; enumConstantsDone?: boolean }[] = [];
  let stmtStart = 0;
  let parenDepth = 0;

  const currentType = () => {
    const top = stack[stack.length - 1];
    return top?.type;
  };

  const handleMember = (text: string, startIdx: number, endsWithBrace: boolean) => {
    const owner = currentType();
    if (!owner) return;
    let t = stripAnnotations(text).trim();
    if (!t) return;

    const top = stack[stack.length - 1];
    if (owner.kind === 'enum' && top.isEnumBody && !top.enumConstantsDone) {
      // Enum constants come first, terminated by ';' (or the body end).
      const constPart = t.split(';')[0];
      for (const c of splitTopLevel(constPart)) {
        const m = c.match(/^([A-Z_$][\w$]*)\s*(\(.*\))?$/s);
        if (m) owner.members.push({ name: m[1], kind: 'enumConstant', type: owner.name, params: [], static: true, visibility: 'public', line: lineAt(startIdx) });
      }
      if (t.includes(';') || endsWithBrace) top.enumConstantsDone = true;
      if (!t.includes(';')) return;
      t = t.slice(t.indexOf(';') + 1).trim();
      if (!t) return;
    }

    const mods = (t.match(MODIFIERS) ?? []).join(' ');
    const rest = t.replace(MODIFIERS, '').replace(/\s+/g, ' ').trim();
    if (/^(class|interface|enum|record)\b/.test(rest)) return;

    // Method or constructor: [<T>] Type name(params) [throws X]
    const mm = rest.match(/^(<[^>]+>\s*)?(?:([\w$.<>,?\[\] ]+?)\s+)?([\w$]+)\s*\(([^)]*)\)\s*(?:throws\s+[\w$.,\s]+)?$/s);
    if (mm && endsWithBrace !== undefined) {
      const [, , ret, name, params] = mm;
      const isCtor = !ret && name === owner.name;
      if (!ret && !isCtor) return;
      if (['if', 'for', 'while', 'switch', 'catch', 'return', 'new', 'else'].includes(ret?.trim() ?? '')) return;
      owner.members.push({
        name,
        kind: isCtor ? 'constructor' : 'method',
        type: isCtor ? owner.name : ret!.trim(),
        params: splitTopLevel(params).map((p) => stripAnnotations(p).replace(/\bfinal\s+/, '').trim()),
        static: /\bstatic\b/.test(mods),
        visibility: owner.kind === 'interface' && !/private/.test(mods) ? 'public' : visibilityOf(mods),
        line: lineAt(startIdx),
      });
      return;
    }
    if (endsWithBrace) return;
    // Field(s): Type a [= x], b [= y];
    const fm = rest.match(/^([\w$.<>,?\[\] ]+?)\s+([\w$]+\s*(?:\[\])*\s*(?:=.*)?(?:,\s*[\w$]+\s*(?:=.*)?)*)$/s);
    if (fm) {
      const type = fm[1].trim();
      if (/^(return|throw|new|package|import)$/.test(type)) return;
      for (const decl of splitTopLevel(fm[2])) {
        const name = decl.split('=')[0].replace(/\[\]/g, '').trim();
        if (/^[\w$]+$/.test(name))
          owner.members.push({
            name,
            kind: 'field',
            type,
            params: [],
            static: /\bstatic\b/.test(mods) || owner.kind === 'interface',
            visibility: owner.kind === 'interface' ? 'public' : visibilityOf(mods),
            line: lineAt(startIdx),
          });
      }
    }
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(') parenDepth++;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (parenDepth > 0) continue;
    else if (ch === '{') {
      const header = src.slice(stmtStart, i);
      const decl = (header + '{').match(TYPE_DECL);
      const inTypeBody = !!currentType() || stack.length === 0;
      if (decl && inTypeBody && !/\bnew\s+[\w$.<>]+\s*\(/.test(header)) {
        const [, kind, name, tps, recordParams, ext, impl] = decl;
        const outer = currentType();
        const t: TypeSymbol = {
          name,
          fqn: [pkg, ...(outer ? [outer.fqn.replace(pkg ? `${pkg}.` : '', '')] : []), name].filter(Boolean).join('.'),
          pkg,
          kind: kind as TypeSymbol['kind'],
          typeParams: tps?.trim() ?? '',
          extends: ext ? splitTopLevel(ext).map((s) => s.trim()) : [],
          implements: impl ? splitTopLevel(impl).map((s) => s.trim()) : [],
          members: [],
          file,
          line: lineAt(stmtStart + header.search(/\S|$/)),
        };
        if (kind === 'interface') {
          t.implements = t.extends;
          t.extends = [];
        }
        if (recordParams) {
          for (const p of splitTopLevel(recordParams.slice(1, -1))) {
            const parts = stripAnnotations(p).trim().split(/\s+/);
            const pname = parts.pop()!;
            const ptype = parts.join(' ');
            t.members.push({ name: pname, kind: 'method', type: ptype, params: [], static: false, visibility: 'public', line: t.line });
            t.members.push({ name: pname, kind: 'field', type: ptype, params: [], static: false, visibility: 'private', line: t.line });
          }
          t.members.push({ name, kind: 'constructor', type: name, params: splitTopLevel(recordParams.slice(1, -1)), static: false, visibility: 'public', line: t.line });
        }
        types.push(t);
        stack.push({ type: t, isEnumBody: kind === 'enum' });
      } else {
        // Method body, initializer, lambda, anonymous class, array initializer...
        if (currentType() && stack[stack.length - 1].type) handleMember(header, stmtStart, true);
        stack.push({});
      }
      stmtStart = i + 1;
    } else if (ch === '}') {
      const top = stack[stack.length - 1];
      if (top?.type) {
        const pending = src.slice(stmtStart, i);
        if (pending.trim()) handleMember(pending, stmtStart, false);
      }
      stack.pop();
      stmtStart = i + 1;
    } else if (ch === ';') {
      const top = stack[stack.length - 1];
      if (top?.type) handleMember(src.slice(stmtStart, i + 1).replace(/;$/, top.isEnumBody && !top.enumConstantsDone ? ';' : ''), stmtStart, false);
      stmtStart = i + 1;
    }
  }
  for (const t of types) {
    if ((t.kind === 'class' || t.kind === 'enum') && !t.members.some((m) => m.kind === 'constructor'))
      t.members.push({ name: t.name, kind: 'constructor', type: t.name, params: [], static: false, visibility: 'public', line: t.line });
  }
  return types;
}

export function extractProjectSymbols(files: { path: string; content: string }[]) {
  return files.flatMap((f) => {
    try {
      return extractSymbols(f.content, f.path);
    } catch {
      return [];
    }
  });
}

export const javaFileClassName = (rel: string) => path.posix.basename(rel, '.java');
