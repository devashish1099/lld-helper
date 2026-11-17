// End-to-end API workflow test against a running LLD Studio server.
// Usage: node scripts/e2e.mjs [baseUrl]   (default http://127.0.0.1:4173)
// Set E2E_PHASE=verify to only check data created by a previous run (after a restart).
import { createRequire } from 'node:module';
const require = createRequire(new URL('../server/package.json', import.meta.url));
const WebSocket = require('ws');

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const TITLE = 'E2E Vending Machine';
let failures = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!cond) failures++;
};

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

function run(problemId, extra = {}, interact) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws/run');
    const events = [];
    ws.on('open', () => ws.send(JSON.stringify({ type: 'run', problemId, ...extra })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      events.push(m);
      interact?.(m, ws);
      const compileFailed = m.type === 'compile' && !m.success;
      if (m.type === 'exit' || m.type === 'error' || compileFailed) {
        ws.close();
        const out = (t) => events.filter((e) => e.type === t).map((e) => e.data).join('');
        resolve({ events, stdout: out('stdout'), stderr: out('stderr'), compile: events.find((e) => e.type === 'compile'), exit: events.find((e) => e.type === 'exit'), error: events.find((e) => e.type === 'error') });
      }
    });
    ws.on('error', reject);
  });
}

async function readSse(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) return { status: res.status, error: (await res.json()).error };
  const text = await res.text();
  const events = text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
  return { status: res.status, events, text: events.filter((e) => e.type === 'delta').map((e) => e.text).join(''), error: events.find((e) => e.type === 'error')?.message };
}

async function create() {
  // 2. Create a new LLD problem (3. which scaffolds a Java project)
  const p = await api('POST', '/api/problems', { title: TITLE, description: 'Design a vending machine.', functional_reqs: '- Select product\n- Pay\n- Dispense' });
  ok(p.status === 200 && p.data.slug, 'create problem', p.data.slug);
  const id = p.data.id;
  const tree = await api('GET', `/api/problems/${id}/tree`);
  ok(JSON.stringify(tree.data).includes('src/main/java/Main.java'), 'project scaffolded with src/main/java/Main.java');

  // 4. Create packages and classes
  ok((await api('POST', `/api/problems/${id}/fs/package`, { name: 'vending.models' })).status === 200, 'create package vending.models');
  const c = await api('POST', `/api/problems/${id}/fs/create`, { path: 'src/main/java/vending/models/Product.java' });
  const tpl = await api('GET', `/api/problems/${id}/file?path=src/main/java/vending/models/Product.java`);
  ok(c.status === 200 && tpl.data.content.startsWith('package vending.models;'), 'new class gets package declaration');

  // 5. Write code
  await api('PUT', `/api/problems/${id}/file`, {
    path: 'src/main/java/vending/models/Product.java',
    content: 'package vending.models;\n\npublic record Product(String name, int priceCents) {}\n',
  });
  await api('POST', `/api/problems/${id}/fs/mkdir`, { path: 'src/main/java/vending/services' });
  await api('PUT', `/api/problems/${id}/file`, {
    path: 'src/main/java/vending/services/VendingMachine.java',
    content: `package vending.services;

import java.util.*;
import vending.models.Product;

public class VendingMachine {
    private final Map<String, Product> slots = new HashMap<>();
    public void load(String slot, Product p) { slots.put(slot, p); }
    public Product select(String slot) {
        Product p = slots.get(slot);
        if (p == null) throw new IllegalArgumentException("Empty slot: " + slot);
        return p;
    }
}
`,
  });
  await api('PUT', `/api/problems/${id}/file`, {
    path: 'src/main/java/Main.java',
    content: `import java.util.Scanner;
import vending.models.Product;
import vending.services.VendingMachine;

public class Main {
    public static void main(String[] args) {
        VendingMachine vm = new VendingMachine();
        vm.load("A1", new Product("Chips", 150));
        Scanner in = new Scanner(System.in);
        String slot = in.nextLine().trim();
        System.out.println("Dispensing " + vm.select(slot).name());
        System.err.println("audit: sold " + slot);
    }
}
`,
  });

  // 7. Compile + execute with stdin
  const r = await run(id, {}, (m, ws) => {
    if (m.type === 'status' && m.phase === 'running') ws.send(JSON.stringify({ type: 'stdin', data: 'A1\n' }));
  });
  ok(r.compile?.success && r.compile.fileCount === 3, 'multi-package project compiles', `${r.compile?.fileCount} files, ${r.compile?.durationMs}ms`);
  ok(r.stdout.includes('Dispensing Chips'), 'stdout captured with stdin input', JSON.stringify(r.stdout));
  ok(r.stderr.includes('audit: sold A1'), 'stderr captured separately');
  ok(!/Picked up/.test(r.stderr), 'no JVM option noise in program stderr', JSON.stringify(r.stderr));
  ok(r.exit?.code === 0 && typeof r.exit.durationMs === 'number', 'exit code + execution time', `${r.exit?.durationMs}ms`);

  // Runtime exception with stack trace
  const r2 = await run(id, { stdin: 'Z9\n' });
  ok(r2.exit?.code === 1 && r2.stderr.includes('IllegalArgumentException: Empty slot: Z9') && r2.stderr.includes('at vending.services.VendingMachine.select'), 'runtime exception + stack trace');

  // Kill a running program
  await api('PUT', `/api/problems/${id}/file`, { path: 'src/main/java/vending/Loop.java', content: 'package vending;\npublic class Loop { public static void main(String[] a) throws Exception { while (true) Thread.sleep(100); } }\n' });
  const r3 = await run(id, { mainClass: 'vending.Loop' }, (m, ws) => {
    if (m.type === 'status' && m.phase === 'running') setTimeout(() => ws.send(JSON.stringify({ type: 'kill' })), 500);
  });
  ok(r3.exit?.killed === true, 'running program can be terminated');
  await api('DELETE', `/api/problems/${id}/fs?path=src/main/java/vending/Loop.java`);

  // Compilation errors are reported with positions
  await api('PUT', `/api/problems/${id}/file`, { path: 'src/main/java/vending/Broken.java', content: 'package vending;\npublic class Broken {\n    Strin x;\n}\n' });
  const chk = await api('POST', `/api/problems/${id}/check`, {});
  const d = chk.data.diagnostics?.[0];
  ok(!chk.data.success && d?.file === 'src/main/java/vending/Broken.java' && d.line === 3 && d.column === 5, 'compile error diagnostics', d && `${d.file}:${d.line}:${d.column} ${d.message.split('\n')[0]}`);
  await api('DELETE', `/api/problems/${id}/fs?path=src/main/java/vending/Broken.java`);

  // 6. Autocomplete data sources (toggle itself is client-side)
  const syms = await api('GET', `/api/problems/${id}/symbols`);
  ok(syms.data.some((t) => t.fqn === 'vending.services.VendingMachine' && t.members.some((m) => m.name === 'select')), 'project symbols for autocomplete');
  const idx = await api('GET', '/api/completion/index');
  const al = idx.data.find?.((c) => c.name === 'ArrayList');
  ok(al && ['add', 'get', 'remove', 'size'].every((n) => al.methods.some((m) => m.name === n)), 'JDK API index has ArrayList add/get/remove/size');

  // 8/9. Clarification question → AI interviewer → record response
  const q = await api('POST', `/api/problems/${id}/clarifications`, { category: 'Business rules', question: 'Which payment methods are supported?' });
  ok(q.status === 200 && q.data.status === 'unanswered', 'record clarification question');
  const secrets = await api('GET', '/api/secrets/status');
  // E2E_PROVIDER=claude-code uses the local Claude Code sign-in instead of an API key.
  const configured = process.env.E2E_PROVIDER ?? Object.entries(secrets.data).find(([, v]) => v.configured)?.[0];
  const ai = await readSse('/api/ai/chat', { problemId: id, mode: 'interviewer_answer', message: q.data.question, provider: configured ?? 'anthropic' });
  let answer = '';
  if (configured) {
    ok(!ai.error && ai.text.length > 0, `AI interviewer answered (${configured})`, ai.error ?? ai.text.slice(0, 160));
    answer = ai.text;
  } else {
    ok(ai.status === 400 && /No API key configured/.test(ai.error), 'AI without key gives actionable error (no API key in this environment)', ai.error);
    answer = 'Cash and card.';
  }
  const upd = await api('PUT', `/api/clarifications/${q.data.id}`, { response: answer });
  ok(upd.data.status === 'answered', 'record interviewer response');

  // 10. Write pseudocode
  const pseudo = '# Vending\nCLASS VendingMachine\n    FUNCTION select(slot)\n        IF slot empty THEN THROW "empty" END IF\n    END FUNCTION\nEND CLASS\n';
  await api('PUT', `/api/problems/${id}/file`, { path: 'pseudocode/solution.pseudo', content: pseudo });
  ok((await api('GET', `/api/problems/${id}/file?path=pseudocode/solution.pseudo`)).data.content === pseudo, 'pseudocode saved');

  // 11. Generate Java from pseudocode
  if (configured) {
    const gen = await readSse('/api/ai/chat', { problemId: id, mode: 'pseudo_to_java', pseudoFile: 'pseudocode/solution.pseudo', provider: configured });
    const files = [...gen.text.matchAll(/=== FILE: (.+?) ===/g)].map((m) => m[1]);
    ok(!gen.error && files.length > 0, 'pseudocode → Java produced FILE blocks', gen.error ?? files.join(', '));
    ok((await api('GET', `/api/problems/${id}/file?path=pseudocode/solution.pseudo`)).data.content === pseudo, 'original pseudocode preserved');
  } else {
    console.log('SKIP  pseudocode → Java (needs an API key)');
  }
  await api('PUT', '/api/state/layout', { value: { leftWidth: 300, e2e: true } });
  return id;
}

async function verify() {
  // 12. After restart: everything persisted
  const list = await api('GET', '/api/problems');
  const p = list.data.find((x) => x.title === TITLE);
  ok(!!p, 'problem persisted across restart');
  if (!p) return;
  const f = await api('GET', `/api/problems/${p.id}/file?path=src/main/java/vending/services/VendingMachine.java`);
  ok(f.status === 200 && f.data.content.includes('class VendingMachine'), 'source files persisted');
  const cl = await api('GET', `/api/problems/${p.id}/clarifications`);
  ok(cl.data.length === 1 && cl.data[0].status === 'answered', 'clarifications + responses persisted');
  const secrets = await api('GET', '/api/secrets/status');
  if (process.env.E2E_PROVIDER || Object.values(secrets.data).some((v) => v.configured)) {
    const th = await api('GET', `/api/problems/${p.id}/threads/interviewer`);
    ok(th.data.length >= 1, 'AI conversation history persisted', `${th.data.length} messages`);
  } else console.log('SKIP  AI conversation history (no API key, so no conversation was created)');
  ok((await api('GET', `/api/problems/${p.id}/file?path=pseudocode/solution.pseudo`)).data.content.includes('CLASS VendingMachine'), 'pseudocode persisted');
  ok((await api('GET', '/api/state/layout')).data.value?.e2e === true, 'layout preferences persisted');
  const r = await run(p.id, { stdin: 'A1\n' });
  ok(r.stdout.includes('Dispensing Chips'), 'project still runs after restart');
}

if (process.env.E2E_PHASE === 'verify') await verify();
else await create();
console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
