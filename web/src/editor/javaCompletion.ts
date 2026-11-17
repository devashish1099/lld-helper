import { monaco } from './monacoSetup';
import { api } from '../api/client';
import { pathOfModel } from './models';

// ---------------------------------------------------------------------------
// Data model: JDK classes (from the server's reflection index) and project
// types (from the server's lightweight symbol extractor), unified.
// ---------------------------------------------------------------------------

interface ApiMethod { name: string; params: string[]; returns: string; typeParams: string; static: boolean; declaringClass: string }
interface ApiClass {
  name: string; fqn: string; pkg: string; kind: string; typeParams: string; superclass?: string;
  constructors: { params: string[] }[]; methods: ApiMethod[]; fields: { name: string; type: string; static: boolean }[];
}
interface ProjectMember { name: string; kind: 'method' | 'field' | 'constructor' | 'enumConstant'; type: string; params: string[]; static: boolean; visibility: string }
interface ProjectType { name: string; fqn: string; pkg: string; kind: string; typeParams: string; extends: string[]; implements: string[]; members: ProjectMember[]; file: string }

interface Member { name: string; kind: 'method' | 'field' | 'enumConstant'; type: string; params: string[]; static: boolean; owner: string; private?: boolean }
interface TypeInfo {
  name: string; fqn: string; pkg: string; kind: string; typeParams: string[]; supers: string[];
  members: Member[]; ctors: string[][]; project: boolean; file?: string;
}

const JAVA_KEYWORDS = (
  'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yield true false null'
).split(' ');

const SNIPPETS: [string, string, string][] = [
  ['sout', 'System.out.println($0);', 'System.out.println'],
  ['souf', 'System.out.printf("$1%n"$0);', 'System.out.printf'],
  ['serr', 'System.err.println($0);', 'System.err.println'],
  ['psvm', 'public static void main(String[] args) {\n\t$0\n}', 'main method'],
  ['fori', 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t$0\n}', 'indexed for loop'],
  ['foreach', 'for (${1:var} ${2:item} : ${3:items}) {\n\t$0\n}', 'enhanced for loop'],
  ['ifn', 'if (${1:obj} == null) {\n\t$0\n}', 'null check'],
  ['trycatch', 'try {\n\t$1\n} catch (${2:Exception} e) {\n\t$0\n}', 'try/catch'],
  ['singleton', 'private static volatile ${1:Name} instance;\n\nprivate ${1:Name}() {}\n\npublic static ${1:Name} getInstance() {\n\tif (instance == null) {\n\t\tsynchronized (${1:Name}.class) {\n\t\t\tif (instance == null) instance = new ${1:Name}();\n\t\t}\n\t}\n\treturn instance;\n}', 'thread-safe singleton'],
  ['thr', 'throw new ${1:IllegalArgumentException}("$0");', 'throw exception'],
];

const ANNOTATIONS = ['Override', 'FunctionalInterface', 'Deprecated', 'SuppressWarnings("unchecked")', 'SafeVarargs'];

let apiTypes = new Map<string, TypeInfo[]>(); // simple name → candidates
let projectTypes = new Map<string, TypeInfo[]>();
let apiLoaded: Promise<void> | undefined;

const splitTop = (s: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<' || ch === '(' || ch === '[') depth++;
    if (ch === '>' || ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const typeParamNames = (tp: string) => (tp ? splitTop(tp.replace(/^<|>$/g, '')).map((t) => t.split(/\s+/)[0]) : []);
/** "Map<String, List<X>>" → { base: "Map", args: ["String", "List<X>"] } */
function parseType(t: string): { base: string; args: string[] } {
  const clean = t.replace(/\bfinal\s+/, '').replace(/@\w+\s*/g, '').trim();
  const lt = clean.indexOf('<');
  if (lt < 0) return { base: clean.replace(/\[\]/g, '').replace(/\.\.\.$/, ''), args: [] };
  return { base: clean.slice(0, lt).trim(), args: splitTop(clean.slice(lt + 1, clean.lastIndexOf('>'))) };
}
const simpleBase = (t: string) => {
  const base = parseType(t).base;
  // Map.Entry stays qualified; com.x.Foo → Foo
  const parts = base.split('.');
  return parts.length > 1 && /^[a-z]/.test(parts[0]) ? parts[parts.length - 1] : base;
};

function fromApi(c: ApiClass): TypeInfo {
  return {
    name: c.name, fqn: c.fqn, pkg: c.pkg, kind: c.kind, typeParams: typeParamNames(c.typeParams),
    supers: c.superclass ? [c.superclass] : [],
    members: [
      ...c.fields.map((f): Member => ({ name: f.name, kind: 'field', type: f.type, params: [], static: f.static, owner: c.name })),
      ...c.methods.map((m): Member => ({ name: m.name, kind: 'method', type: m.returns, params: m.params, static: m.static, owner: m.declaringClass })),
    ],
    ctors: c.constructors.map((k) => k.params),
    project: false,
  };
}

function fromProject(t: ProjectType): TypeInfo {
  return {
    name: t.name, fqn: t.fqn, pkg: t.pkg, kind: t.kind, typeParams: typeParamNames(t.typeParams),
    supers: [...t.extends, ...t.implements],
    members: t.members
      .filter((m) => m.kind !== 'constructor')
      .map((m) => ({ name: m.name, kind: m.kind as Member['kind'], type: m.type, params: m.params, static: m.static, owner: t.name, private: m.visibility === 'private' })),
    ctors: t.members.filter((m) => m.kind === 'constructor').map((m) => m.params),
    project: true,
    file: t.file,
  };
}

const addTo = (map: Map<string, TypeInfo[]>, t: TypeInfo) => {
  for (const key of new Set([t.name, t.name.split('.').pop()!])) map.set(key, [...(map.get(key) ?? []), t]);
};

export function loadApiIndex() {
  apiLoaded ??= api
    .completionIndex()
    .then((list: ApiClass[]) => {
      const m = new Map<string, TypeInfo[]>();
      list.forEach((c) => addTo(m, fromApi(c)));
      apiTypes = m;
    })
    .catch((e) => {
      apiLoaded = undefined;
      console.warn('Java API index unavailable:', e.message);
    });
  return apiLoaded;
}

export async function refreshProjectSymbols(problemId: string) {
  try {
    const list: ProjectType[] = await api.symbols(problemId);
    const m = new Map<string, TypeInfo[]>();
    list.forEach((t) => addTo(m, fromProject(t)));
    projectTypes = m;
  } catch {
    /* keep previous symbols */
  }
}

function lookupType(name: string, imports: string[] = []): TypeInfo | undefined {
  const simple = simpleBase(name);
  const proj = projectTypes.get(simple);
  if (proj?.length) return proj[0];
  const cands = apiTypes.get(simple);
  if (!cands?.length) return undefined;
  if (cands.length === 1) return cands[0];
  return cands.find((c) => imports.some((i) => i === c.fqn || i === `${c.pkg}.*`)) ?? cands.find((c) => c.pkg === 'java.lang') ?? cands[0];
}

/** All members including inherited ones, with generic type arguments substituted. */
function membersOf(typeRef: string, imports: string[], depth = 0, seen = new Set<string>()): Member[] {
  const { args } = parseType(typeRef);
  const t = lookupType(typeRef, imports);
  if (!t || seen.has(t.fqn) || depth > 4) return [];
  seen.add(t.fqn);
  const subst = new Map(t.typeParams.map((p, i) => [p, args[i] ?? 'Object']));
  const sub = (s: string) => (subst.size ? s.replace(/\b[A-Z]\w*\b/g, (w) => subst.get(w) ?? w) : s);
  const own = t.members.map((m) => ({ ...m, type: sub(m.type), params: m.params.map(sub) }));
  // API classes already include inherited public methods (getMethods()); project types need their supertypes.
  const inherited = t.project ? t.supers.flatMap((s) => membersOf(sub(s), imports, depth + 1, seen)) : [];
  const names = new Set(own.map((m) => `${m.name}(${m.params.length})`));
  return [...own, ...inherited.filter((m) => !names.has(`${m.name}(${m.params.length})`))];
}

// ---------------------------------------------------------------------------
// Context analysis on the current document
// ---------------------------------------------------------------------------

function stripCode(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
    .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => `"${' '.repeat(Math.max(0, m.length - 2))}"`);
}

const importsOf = (src: string) => [...src.matchAll(/^\s*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm)].map((m) => m[1]);
const packageOf = (src: string) => src.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1] ?? '';

/** Find the declared type of a local variable, parameter or field visible from `offset`. */
function declaredType(code: string, name: string, offset: number): string | undefined {
  const before = code.slice(0, offset);
  const esc = name.replace(/\$/g, '\\$');
  // Type name [= ...] | Type name; | Type name) | Type name, | for (Type name :
  const re = new RegExp(`(?:^|[\\s(,;{<])((?:final\\s+)?[A-Za-z_$][\\w$.]*\\s*(?:<[^;=(){}]*>)?(?:\\s*\\[\\])*)\\s+${esc}\\s*(?=[=;,):]|$)`, 'gm');
  let found: string | undefined;
  for (const m of before.matchAll(re)) found = m[1];
  if (!found) for (const m of code.matchAll(re)) found ??= m[1]; // fields declared later in the class
  if (!found) return undefined;
  found = found.replace(/^final\s+/, '').trim();
  if (['return', 'new', 'throw', 'else', 'case', 'instanceof'].includes(found)) return undefined;
  if (found === 'var') {
    const init = before.match(new RegExp(`var\\s+${esc}\\s*=\\s*new\\s+([\\w$.]+(?:<[^;()]*>)?)`));
    if (init) return init[1].replace(/<>$/, '');
    return undefined;
  }
  return found;
}

function enclosingClass(code: string, offset: number): string | undefined {
  let found: string | undefined;
  for (const m of code.slice(0, offset).matchAll(/\b(?:class|interface|enum|record)\s+([A-Z_$][\w$]*)/g)) found = m[1];
  return found;
}

/** Split `a.b(x).c` (ending before the trailing dot) into segments, right to left aware of parens. */
function parseChain(text: string): { name: string; call: boolean }[] | undefined {
  const segs: { name: string; call: boolean }[] = [];
  let i = text.length - 1;
  while (i >= 0) {
    let call = false;
    if (text[i] === ')') {
      let depth = 0;
      for (; i >= 0; i--) {
        if (text[i] === ')') depth++;
        else if (text[i] === '(') {
          depth--;
          if (depth === 0) break;
        }
      }
      if (i < 0) return undefined;
      i--;
      call = true;
      // skip diamond / explicit type arguments: new ArrayList<>() / new HashMap<String, Integer>()
      if (text[i] === '>') {
        let g = 0;
        for (; i >= 0; i--) {
          if (text[i] === '>') g++;
          else if (text[i] === '<' && --g === 0) break;
        }
        i--;
      }
    }
    let j = i;
    while (j >= 0 && /[\w$]/.test(text[j])) j--;
    const name = text.slice(j + 1, i + 1);
    if (!name) return undefined;
    // generic method call like Collections.<T>emptyList() is rare; ignore
    segs.unshift({ name, call });
    i = j;
    while (i >= 0 && /\s/.test(text[i])) i--;
    if (i >= 0 && text[i] === '.') {
      i--;
      while (i >= 0 && /\s/.test(text[i])) i--;
      continue;
    }
    if (i >= 0 && /\bnew\s*$/.test(text.slice(0, j + 1))) segs[0] = { name: `new ${segs[0].name}`, call: true };
    break;
  }
  return segs;
}

interface Resolved { type: string; staticCtx: boolean }

function resolveChain(code: string, offset: number, chainText: string, imports: string[]): Resolved | undefined {
  const segs = parseChain(chainText);
  if (!segs?.length) return undefined;
  let cur: Resolved | undefined;
  const [first, ...rest] = segs;
  const cls = enclosingClass(code, offset);
  if (first.name.startsWith('new ')) cur = { type: first.name.slice(4), staticCtx: false };
  else if (first.name === 'this' && cls) cur = { type: cls, staticCtx: false };
  else if (first.name === 'super' && cls) cur = { type: lookupType(cls)?.supers[0] ?? 'Object', staticCtx: false };
  else if (first.call && cls) {
    const m = membersOf(cls, imports).find((x) => x.kind === 'method' && x.name === first.name);
    if (m) cur = { type: m.type, staticCtx: false };
  } else {
    const t = declaredType(code, first.name, offset);
    if (t) cur = { type: t, staticCtx: false };
    else if (cls && membersOf(cls, imports).some((x) => x.name === first.name && x.kind === 'field'))
      cur = { type: membersOf(cls, imports).find((x) => x.name === first.name)!.type, staticCtx: false };
    else if (lookupType(first.name, imports)) cur = { type: first.name, staticCtx: true };
  }
  for (const seg of rest) {
    if (!cur) return undefined;
    const members = membersOf(cur.type, imports);
    const m = members.find((x) => x.name === seg.name && (seg.call ? x.kind === 'method' : x.kind !== 'method'));
    if (!m) {
      // Nested type access, e.g. Map.Entry
      const nested = lookupType(`${simpleBase(cur.type)}.${seg.name}`, imports);
      if (!seg.call && nested) {
        cur = { type: nested.name, staticCtx: true };
        continue;
      }
      return undefined;
    }
    cur = { type: m.type, staticCtx: false };
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Completion items
// ---------------------------------------------------------------------------

const K = () => monaco.languages.CompletionItemKind;
const SNIPPET = () => monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
const PARAM_HINTS = { id: 'editor.action.triggerParameterHints', title: 'Parameter hints' };

function importEdit(model: monaco.editor.ITextModel, t: TypeInfo): monaco.languages.TextEdit[] | undefined {
  const src = model.getValue();
  const pkg = packageOf(src);
  if (!t.pkg || t.pkg === 'java.lang' || t.pkg === pkg) return undefined;
  const imports = importsOf(src);
  const importName = t.fqn;
  if (imports.includes(importName) || imports.includes(`${t.pkg}.*`)) return undefined;
  // nested types (Map.Entry) are importable by fqn too; skip if outer is imported and name is qualified
  if (t.name.includes('.') && imports.some((i) => importName.startsWith(`${i}.`))) return undefined;
  const lines = src.split('\n');
  let insertLine = 0;
  lines.forEach((l, i) => {
    if (/^\s*(package|import)\s/.test(l)) insertLine = i + 1;
  });
  const text = `${insertLine === 0 ? '' : ''}import ${importName};\n${insertLine === 0 ? '\n' : ''}`;
  return [{ range: new monaco.Range(insertLine + 1, 1, insertLine + 1, 1), text }];
}

const typeKind = (t: TypeInfo) =>
  t.kind === 'interface' ? K().Interface : t.kind === 'enum' ? K().Enum : t.kind === 'record' ? K().Struct : K().Class;

function memberItems(members: Member[], staticCtx: boolean, range: monaco.IRange, ownerSimple: string): monaco.languages.CompletionItem[] {
  const seen = new Set<string>();
  const items: monaco.languages.CompletionItem[] = [];
  for (const m of members) {
    if (m.private && m.owner !== ownerSimple) continue;
    const sig = m.kind === 'method' ? `(${m.params.join(', ')})` : '';
    const key = m.name + sig;
    if (seen.has(key)) continue;
    seen.add(key);
    const objectMember = m.owner === 'Object';
    // Static context: statics first; instance members still listed (e.g. "ArrayList." to explore the API).
    const rank = (staticCtx ? (m.static ? 0 : 2) : m.static ? 2 : 0) + (objectMember ? 3 : 0) + (m.kind === 'method' ? 1 : 0);
    items.push({
      label: { label: m.name, detail: sig, description: m.type },
      kind: m.kind === 'method' ? K().Method : m.kind === 'enumConstant' ? K().EnumMember : m.static ? K().Constant : K().Field,
      insertText: m.kind === 'method' ? (m.params.length ? `${m.name}($0)` : `${m.name}()`) : m.name,
      insertTextRules: SNIPPET(),
      filterText: m.name,
      sortText: `${rank}${m.name}`,
      detail: `${m.static ? 'static ' : ''}${m.type} ${m.name}${sig} — ${m.owner}`,
      command: m.kind === 'method' && m.params.length ? PARAM_HINTS : undefined,
      range,
    });
  }
  return items;
}

function allTypes(): TypeInfo[] {
  const out = new Map<string, TypeInfo>();
  for (const list of [...apiTypes.values(), ...projectTypes.values()]) for (const t of list) out.set(t.fqn, t);
  return [...out.values()];
}

function provideCompletion(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.CompletionList {
  const src = model.getValue();
  const offset = model.getOffsetAt(position);
  const code = stripCode(src);
  const lineBefore = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
  const imports = importsOf(src);
  const word = model.getWordUntilPosition(position);
  const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
  const cls = enclosingClass(code, offset);

  // Inside a string or comment (stripped to blanks in `code`): nothing.
  const codeLine = stripCode(lineBefore);
  if (offset > 0 && /\S/.test(src[offset - 1]) && code[offset - 1] === ' ') return { suggestions: [] };
  if (/"[^"]*$/.test(codeLine.replace(/"\s*"/g, ''))) return { suggestions: [] };

  // import statements
  const imp = lineBefore.match(/^\s*import\s+(?:static\s+)?([\w.]*)$/);
  if (imp) {
    const start = position.column - imp[1].length;
    const r = new monaco.Range(position.lineNumber, start, position.lineNumber, position.column);
    const pkgs = new Set(allTypes().map((t) => t.pkg).filter(Boolean));
    return {
      suggestions: [
        ...allTypes().map((t) => ({ label: t.fqn, kind: typeKind(t), insertText: `${t.fqn};`, range: r, sortText: t.project ? `0${t.fqn}` : `1${t.fqn}` })),
        ...[...pkgs].map((p) => ({ label: `${p}.*`, kind: K().Module, insertText: `${p}.*;`, range: r, sortText: `2${p}` })),
      ],
    };
  }

  // Annotations
  if (/@\w*$/.test(lineBefore)) return { suggestions: ANNOTATIONS.map((a) => ({ label: a, kind: K().Reference, insertText: a, range })) };

  // Member access: expr.<partial>
  const dot = codeLine.match(/([\w$\s.()<>,"]*?)\.\s*([\w$]*)$/);
  if (dot && !/^\s*(package|import)\b/.test(lineBefore) && !/\d\.$/.test(codeLine.slice(0, codeLine.length - dot[2].length))) {
    // take text before the dot from the whole document to allow multi-line chains
    const dotOffset = offset - dot[2].length - 1;
    const chainText = code.slice(Math.max(0, dotOffset - 400), dotOffset).replace(/^[\s\S]*?(?=[\w$]+[\w$\s.()<>,"]*$)/, '');
    const res = resolveChain(code, offset, chainText.trimEnd(), imports);
    if (!res) return { suggestions: [] };
    const members = membersOf(res.type, imports);
    const items = memberItems(members, res.staticCtx, range, cls ?? '');
    if (res.staticCtx) {
      items.push({ label: 'class', kind: K().Keyword, insertText: 'class', range, sortText: '9class' });
      const t = lookupType(res.type, imports);
      for (const nested of allTypes().filter((x) => t && x.name.startsWith(`${t.name}.`)))
        items.push({ label: nested.name.slice(t!.name.length + 1), kind: typeKind(nested), insertText: nested.name.slice(t!.name.length + 1), range });
    }
    return { suggestions: items };
  }

  // Constructors after "new"
  if (/\bnew\s+[\w$]*$/.test(codeLine)) {
    const items: monaco.languages.CompletionItem[] = [];
    for (const t of allTypes()) {
      if (t.kind === 'interface' || t.kind === 'enum' || !t.ctors.length) continue;
      const generic = t.typeParams.length ? '<>' : '';
      const seen = new Set<string>();
      for (const params of t.ctors) {
        const sig = `(${params.join(', ')})`;
        if (seen.has(sig)) continue;
        seen.add(sig);
        items.push({
          label: { label: t.name, detail: `${generic}${sig}`, description: t.pkg },
          kind: K().Constructor,
          insertText: params.length ? `${t.name}${generic}($0)` : `${t.name}${generic}()`,
          insertTextRules: SNIPPET(),
          filterText: t.name,
          sortText: `${t.project ? 0 : 1}${t.name}${params.length}`,
          additionalTextEdits: importEdit(model, t),
          command: params.length ? PARAM_HINTS : undefined,
          range,
        });
      }
    }
    return { suggestions: items };
  }

  // General: keywords, snippets, types, locals and members of the enclosing class.
  const items: monaco.languages.CompletionItem[] = [];
  for (const kw of JAVA_KEYWORDS) items.push({ label: kw, kind: K().Keyword, insertText: kw, range, sortText: `5${kw}` });
  for (const [label, body, detail] of SNIPPETS)
    items.push({ label, kind: K().Snippet, insertText: body, insertTextRules: SNIPPET(), detail, documentation: body.replace(/\$\{\d:([^}]*)\}|\$\d/g, '$1'), range, sortText: `6${label}` });
  for (const t of allTypes()) {
    if (t.name.includes('.')) continue;
    items.push({
      label: { label: t.name, description: t.fqn },
      kind: typeKind(t),
      insertText: t.name,
      sortText: `${t.project ? 2 : 4}${t.name}`,
      additionalTextEdits: importEdit(model, t),
      range,
    });
  }
  const locals = new Set<string>();
  const declRe = /(?:^|[\s(,;{])(?:final\s+)?[A-Za-z_$][\w$.]*\s*(?:<[^;=(){}]*>)?(?:\s*\[\])*\s+([a-z_$][\w$]*)\s*(?=[=;,):])/gm;
  for (const m of code.slice(0, offset).matchAll(declRe)) if (!JAVA_KEYWORDS.includes(m[1])) locals.add(m[1]);
  for (const name of locals) items.push({ label: name, kind: K().Variable, insertText: name, range, sortText: `0${name}` });
  if (cls) {
    for (const it of memberItems(membersOf(cls, imports), false, range, cls)) {
      if (!locals.has((it.label as monaco.languages.CompletionItemLabel).label)) items.push({ ...it, sortText: `1${it.sortText}` });
    }
  }
  return { suggestions: items };
}

// ---------------------------------------------------------------------------
// Signature help
// ---------------------------------------------------------------------------

function provideSignatureHelp(model: monaco.editor.ITextModel, position: monaco.Position): monaco.languages.SignatureHelpResult | null {
  const src = model.getValue();
  const offset = model.getOffsetAt(position);
  const code = stripCode(src);
  const imports = importsOf(src);
  // Find the innermost unclosed '(' before the cursor.
  let depth = 0;
  let commas = 0;
  let i = offset - 1;
  for (; i >= 0 && offset - i < 2000; i--) {
    const ch = code[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) break;
      depth--;
    } else if (ch === ',' && depth === 0) commas++;
    else if ((ch === ';' || ch === '{' || ch === '}') && depth === 0) return null;
  }
  if (i < 0 || code[i] !== '(') return null;
  const before = code.slice(Math.max(0, i - 400), i).trimEnd();
  let candidates: { label: string; params: string[]; ret?: string }[] = [];

  const ctor = before.match(/\bnew\s+([\w$.]+)\s*(?:<[^()]*>)?$/);
  if (ctor) {
    const t = lookupType(ctor[1], imports);
    candidates = (t?.ctors ?? []).map((p) => ({ label: t!.name, params: p }));
  } else {
    const m = before.match(/([\w$]+)$/);
    if (!m) return null;
    const name = m[1];
    const head = before.slice(0, before.length - name.length).trimEnd();
    let members: Member[] = [];
    if (head.endsWith('.')) {
      const chain = head.slice(0, -1).replace(/^[\s\S]*?(?=[\w$]+[\w$\s.()<>,]*$)/, '');
      const res = resolveChain(code, offset, chain.trimEnd(), imports);
      if (res) members = membersOf(res.type, imports);
    } else {
      const cls = enclosingClass(code, offset);
      if (cls) members = membersOf(cls, imports);
    }
    candidates = members.filter((x) => x.kind === 'method' && x.name === name).map((x) => ({ label: name, params: x.params, ret: x.type }));
  }
  if (!candidates.length) return null;
  const uniq = [...new Map(candidates.map((c) => [c.params.join(','), c])).values()].sort((a, b) => a.params.length - b.params.length);
  const active = Math.max(0, uniq.findIndex((c) => c.params.length > commas || (c.params.length && c.params[c.params.length - 1].endsWith('...'))));
  return {
    value: {
      signatures: uniq.map((c) => ({
        label: `${c.label}(${c.params.join(', ')})${c.ret ? `: ${c.ret}` : ''}`,
        parameters: c.params.map((p) => ({ label: p })),
      })),
      activeSignature: active,
      activeParameter: commas,
    },
    dispose() {},
  };
}

// ---------------------------------------------------------------------------
// Toggle
// ---------------------------------------------------------------------------

let registrations: monaco.IDisposable[] = [];

export function isAutocompleteEnabled() {
  return registrations.length > 0;
}

/**
 * Enable/disable Java IntelliSense. Only completion and signature-help providers
 * and suggestion triggers are affected; highlighting, formatting and diagnostics are untouched.
 */
export function setJavaAutocomplete(enabled: boolean) {
  if (enabled && !registrations.length) {
    void loadApiIndex();
    registrations = [
      monaco.languages.registerCompletionItemProvider('java', {
        triggerCharacters: ['.', '@', ' '],
        provideCompletionItems: (model, position, ctx) => {
          // A space only triggers after "new " / "import ".
          if (ctx.triggerCharacter === ' ') {
            const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
            if (!/\b(new|import)\s$/.test(before)) return { suggestions: [] };
          }
          return provideCompletion(model, position);
        },
      }),
      monaco.languages.registerSignatureHelpProvider('java', {
        signatureHelpTriggerCharacters: ['(', ','],
        signatureHelpRetriggerCharacters: [','],
        provideSignatureHelp: (model, position) => provideSignatureHelp(model, position),
      }),
    ];
  } else if (!enabled) {
    registrations.forEach((d) => d.dispose());
    registrations = [];
  }
}

/** Editor options that must follow the toggle (so Monaco's word-based fallback is off too). */
export const suggestOptions = (enabled: boolean): monaco.editor.IEditorOptions & monaco.editor.IGlobalEditorOptions => ({
  quickSuggestions: enabled ? { other: true, comments: false, strings: false } : false,
  suggestOnTriggerCharacters: enabled,
  wordBasedSuggestions: enabled ? 'currentDocument' : 'off',
  parameterHints: { enabled },
  snippetSuggestions: enabled ? 'inline' : 'none',
});

export const _test = { parseChain, declaredType, resolveChain, membersOf, pathOfModel };
