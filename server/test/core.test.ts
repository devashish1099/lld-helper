import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeAll } from 'vitest';
import { FileSystemService, PathError, safeResolve } from '../src/fs/FileSystemService.js';
import { parseJavacOutput, stripJava, CompilationService } from '../src/java/CompilationService.js';
import { extractSymbols } from '../src/completion/ProjectSymbols.js';
import { ContextManager, FILE_BUDGET_CHARS } from '../src/ai/ContextManager.js';
import type { ProblemRow } from '../src/db/PersistenceService.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lld-test-'));

describe('safeResolve', () => {
  const root = path.join(tmp, 'proj');
  beforeAll(() => fs.mkdirSync(root, { recursive: true }));

  it('resolves normal relative paths', () => {
    expect(safeResolve(root, 'src/Main.java')).toBe(path.join(root, 'src/Main.java'));
  });
  it('rejects traversal', () => {
    expect(() => safeResolve(root, '../outside.txt')).toThrow(PathError);
    expect(() => safeResolve(root, 'src/../../x')).toThrow(PathError);
    expect(() => safeResolve(root, 'a\0b')).toThrow(PathError);
  });
  it('keeps leading-slash paths inside the root', () => {
    expect(safeResolve(root, '/etc/passwd')).toBe(path.join(root, 'etc/passwd'));
  });
  it('rejects the root unless allowed', () => {
    expect(() => safeResolve(root, '')).toThrow(PathError);
    expect(safeResolve(root, '', { allowRoot: true })).toBe(root);
  });
  it('rejects symlinks that escape the root', () => {
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside, { recursive: true });
    fs.symlinkSync(outside, path.join(root, 'link'));
    expect(() => safeResolve(root, 'link/secret.txt')).toThrow(PathError);
  });
});

describe('FileSystemService', () => {
  it('creates, moves and deletes', () => {
    const root = path.join(tmp, 'fsproj');
    fs.mkdirSync(root);
    const f = new FileSystemService(root);
    f.mkdir('src/models');
    f.createFile('src/models/A.java', 'class A {}');
    expect(() => f.createFile('src/models/A.java')).toThrow(/Already exists/);
    f.move('src/models/A.java', 'src/B.java');
    expect(f.read('src/B.java')).toBe('class A {}');
    expect(() => f.move('src', 'src/inner/src')).toThrow(/into itself/);
    f.delete('src/models');
    expect(f.tree().children!.map((c) => c.name)).toEqual(['src']);
  });
});

describe('javac output parsing', () => {
  it('extracts file, line, column and details', () => {
    const out = `src/main/java/models/Car.java:5: error: cannot find symbol
        Strin name;
        ^
  symbol:   class Strin
  location: class Car
src/main/java/Main.java:3: warning: [unchecked] unchecked call
    list.add(1);
            ^
1 error
1 warning
`;
    const d = parseJavacOutput(out, (p) => p);
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ file: 'src/main/java/models/Car.java', line: 5, column: 9, severity: 'error' });
    expect(d[0].message).toContain('symbol:   class Strin'.replace(/\s+/g, ' ').split(' ')[0]);
    expect(d[1]).toMatchObject({ line: 3, column: 13, severity: 'warning' });
  });

  it('strips comments and strings', () => {
    expect(stripJava('int a; // void main(String[] x)\n/* class X */ String s = "class Y";')).not.toMatch(/class [XY]|main/);
  });
});

describe('main class detection', () => {
  it('finds main classes with packages, preferring Main', () => {
    const root = path.join(tmp, 'mainproj');
    const f = new FileSystemService(root);
    fs.mkdirSync(root);
    f.write('src/main/java/app/Tool.java', 'package app;\npublic class Tool { public static void main(String... a) {} }');
    f.write('src/main/java/app/Main.java', 'package app;\npublic class Main { public static void main(String[] args) {} }');
    f.write('src/main/java/app/Other.java', 'package app;\n// public static void main(String[] args)\nclass Other {}');
    const mains = new CompilationService(tmp).findMainClasses(f);
    expect(mains.map((m) => m.className)).toEqual(['app.Main', 'app.Tool']);
  });
});

describe('symbol extraction', () => {
  const src = `package com.lot.models;
import java.util.*;
/** A spot */
public abstract class ParkingSpot implements Comparable<ParkingSpot> {
    private final String id;
    protected Map<String, List<Integer>> history = new HashMap<>();
    public static final int MAX = 10, MIN = 1;
    public ParkingSpot(String id) { this.id = id; if (id == null) { throw new IllegalArgumentException(); } }
    public String getId() { return id; }
    public abstract boolean canFit(Vehicle v);
    private <T extends Comparable<T>> T max(List<T> xs, int n) { for (T x : xs) { } return null; }
    public enum Size { SMALL, MEDIUM("m"), LARGE; Size() {} Size(String s) {} public boolean big() { return this == LARGE; } }
    interface Listener { void onFree(ParkingSpot s); }
}
record Ticket(String id, long issuedAt) {}
`;
  const types = extractSymbols(src, 'ParkingSpot.java');
  const spot = types.find((t) => t.name === 'ParkingSpot')!;

  it('finds types with packages and supertypes', () => {
    expect(types.map((t) => t.fqn)).toEqual(['com.lot.models.ParkingSpot', 'com.lot.models.ParkingSpot.Size', 'com.lot.models.ParkingSpot.Listener', 'com.lot.models.Ticket']);
    expect(spot.implements).toEqual(['Comparable<ParkingSpot>']);
  });
  it('finds fields, methods and constructors', () => {
    const names = spot.members.map((m) => `${m.kind}:${m.name}`);
    expect(names).toEqual(
      expect.arrayContaining(['field:id', 'field:history', 'field:MAX', 'field:MIN', 'constructor:ParkingSpot', 'method:getId', 'method:canFit', 'method:max']),
    );
    expect(spot.members.find((m) => m.name === 'history')!.type).toBe('Map<String, List<Integer>>');
    expect(spot.members.find((m) => m.name === 'max')!.params).toEqual(['List<T> xs', 'int n']);
    expect(names.filter((n) => n.startsWith('field:')).length).toBe(4);
  });
  it('handles enums, interfaces and records', () => {
    const size = types.find((t) => t.name === 'Size')!;
    expect(size.members.filter((m) => m.kind === 'enumConstant').map((m) => m.name)).toEqual(['SMALL', 'MEDIUM', 'LARGE']);
    expect(size.members.some((m) => m.name === 'big')).toBe(true);
    expect(types.find((t) => t.name === 'Listener')!.members.map((m) => m.name)).toEqual(['onFree']);
    const ticket = types.find((t) => t.name === 'Ticket')!;
    expect(ticket.members.filter((m) => m.kind === 'method').map((m) => m.name)).toEqual(['id', 'issuedAt']);
  });
});

describe('ContextManager', () => {
  const problem: ProblemRow = {
    id: 'p', slug: 'p', title: 'Parking Lot', description: 'desc', functional_reqs: '- park', non_functional_reqs: '',
    interviewer_notes: '- secret: 3 floors', sample: 0, created_at: '', updated_at: '',
  };
  const root = path.join(tmp, 'ctxproj');
  fs.mkdirSync(root);
  const f = new FileSystemService(root);
  f.write('src/main/java/Main.java', 'class Main {}');
  f.write('src/main/java/Big.java', 'x'.repeat(FILE_BUDGET_CHARS + 50));
  f.write('pseudocode/solution.pseudo', 'CLASS Lot END CLASS');
  const cm = new ContextManager();

  it('hides interviewer notes from the coach and shows them to the interviewer', () => {
    expect(cm.build('chat', problem, [], f, {}).text).not.toContain('secret');
    expect(cm.build('interviewer', problem, [], f, {}).text).toContain('secret');
  });
  it('only sends files that were asked for in chat mode', () => {
    const r = cm.build('chat', problem, [], f, { activeFile: 'src/main/java/Main.java', includeActiveFile: false });
    expect(r.includedFiles).toEqual([]);
    const r2 = cm.build('chat', problem, [], f, { activeFile: 'src/main/java/Main.java', includeActiveFile: true });
    expect(r2.includedFiles).toEqual(['src/main/java/Main.java']);
  });
  it('shows the interviewer only shared files, and never files for clarification answers', () => {
    expect(cm.build('interviewer', problem, [], f, {}).includedFiles).toEqual([]);
    const shared = cm.build('interviewer', problem, [], f, { activeFile: 'src/main/java/Main.java', includeActiveFile: true });
    expect(shared.includedFiles).toEqual(['src/main/java/Main.java']);
    expect(shared.text).toContain('class Main {}');
    const answer = cm.build('interviewer_answer', problem, [], f, { activeFile: 'src/main/java/Main.java', includeActiveFile: true, attachedFiles: ['src/main/java/Big.java'] });
    expect(answer.includedFiles).toEqual([]);
  });
  it('sends the whole project only when asked', () => {
    expect(cm.build('interviewer', problem, [], f, {}).includedFiles).toEqual([]);
    const r = cm.build('interviewer', problem, [], f, { includeProject: true });
    expect(r.includedFiles).toContain('pseudocode/solution.pseudo');
    // Every Java file is sent or reported as truncated (the fixture's Big.java exceeds the budget).
    expect([...r.includedFiles, ...r.truncated]).toEqual(expect.arrayContaining(['src/main/java/Main.java', 'src/main/java/Big.java']));
  });
  it('includes pseudocode for pseudo modes and truncates over budget', () => {
    const r = cm.build('compare_impl', problem, [], f, {});
    expect(r.includedFiles[0]).toBe('pseudocode/solution.pseudo');
    expect(r.truncated).toContain('src/main/java/Big.java');
    expect(r.text).toContain('[truncated');
  });
});

describe('attempt export', () => {
  it('bundles problem, clarifications, edited files and interviewer chat without hidden notes or untouched templates', async () => {
    const { buildAttemptMarkdown } = await import('../src/problems/AttemptExport.js');
    const { ProjectManager } = await import('../src/projects/ProjectManager.js');
    const pmgr = new ProjectManager(path.join(tmp, 'export-ws'));
    pmgr.scaffold('sw', 'Splitwise', 'Split bills');
    const files = pmgr.fs('sw');
    files.write('src/main/java/models/User.java', 'record User(String id, String name) {}');
    const problem: ProblemRow = {
      id: 'x', slug: 'sw', title: 'Splitwise', description: 'Split bills', functional_reqs: '- add expense', non_functional_reqs: '',
      interviewer_notes: '- SECRET part 2', sample: 1, created_at: '', updated_at: '',
    };
    const md = buildAttemptMarkdown(
      problem,
      [{ id: 'c', problem_id: 'x', category: 'Scope', question: 'Groups?', response: 'Later', status: 'answered', source: 'user', sort: 1, created_at: '', updated_at: '' } as any],
      [{ id: 'm', problem_id: 'x', thread: 'interviewer', role: 'user', content: 'Here is my design', mode: 'interviewer', created_at: '' } as any],
      files,
    );
    expect(md).toMatch(/^You are a senior engineer/);
    expect(md).toContain('record User(String id, String name)');
    expect(md).toContain('Groups?');
    expect(md).toContain('**Candidate:** Here is my design');
    expect(md).not.toContain('SECRET');
    expect(md).not.toContain('### design.md'); // untouched template
    expect(md).not.toContain('### src/main/java/Main.java');
  });
});
