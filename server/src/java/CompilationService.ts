import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { FileSystemService } from '../fs/FileSystemService.js';
import type { JdkInfo } from '../config.js';

export interface Diagnostic {
  file: string; // project-relative POSIX path
  line: number;
  column: number;
  severity: 'error' | 'warning';
  message: string;
}

export interface CompileResult {
  success: boolean;
  diagnostics: Diagnostic[];
  output: string;
  durationMs: number;
  fileCount: number;
  classesDir: string;
}

export interface MainClass {
  className: string; // fully-qualified
  file: string;
}

const DIAG_RE = /^(.+?\.java):(\d+): (error|warning): (.*)$/;

/** Parse javac's default (non -XDrawDiagnostics) output into structured diagnostics. */
export function parseJavacOutput(output: string, toRelative: (absOrRel: string) => string): Diagnostic[] {
  const lines = output.split(/\r?\n/);
  const diags: Diagnostic[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(DIAG_RE);
    if (!m) continue;
    const d: Diagnostic = {
      file: toRelative(m[1]),
      line: Number(m[2]),
      column: 1,
      severity: m[3] as Diagnostic['severity'],
      message: m[4],
    };
    // Following lines: optional detail lines ("symbol: ..."), the source line, then a caret line.
    const extra: string[] = [];
    for (let j = i + 1; j < lines.length && j <= i + 8; j++) {
      if (DIAG_RE.test(lines[j]) || /^\d+ (errors?|warnings?)$/.test(lines[j])) break;
      const caret = lines[j].match(/^(\s*)\^\s*$/);
      if (caret) {
        d.column = caret[1].length + 1;
        continue;
      }
      if (/^\s+(symbol|location|required|found|reason):/.test(lines[j])) extra.push(lines[j].trim());
    }
    if (extra.length) d.message += `\n${extra.join('\n')}`;
    diags.push(d);
  }
  return diags;
}

/** Strip comments and string literals so regex scans don't match inside them. */
export function stripJava(src: string) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])+'/g, "' '");
}

/**
 * Environment for javac/java. JAVA_TOOL_OPTIONS and friends are removed, not blanked:
 * the JVM prints "Picked up JAVA_TOOL_OPTIONS" to stderr whenever the variable exists.
 */
export function javaEnv() {
  const env = { ...process.env };
  delete env.JAVA_TOOL_OPTIONS;
  delete env._JAVA_OPTIONS;
  delete env.JDK_JAVA_OPTIONS;
  return env;
}

export class CompilationService {
  constructor(private buildRoot: string) {}

  /** Directory holding Java sources: src/main/java, else src, else the project root. */
  sourceRoot(files: FileSystemService) {
    if (files.exists('src/main/java')) return 'src/main/java';
    if (files.exists('src')) return 'src';
    return '';
  }

  javaFiles(files: FileSystemService) {
    return files.listFiles((p) => p.endsWith('.java'));
  }

  findMainClasses(files: FileSystemService): MainClass[] {
    const out: MainClass[] = [];
    for (const rel of this.javaFiles(files)) {
      const src = stripJava(files.read(rel));
      if (!/\bstatic\s+(?:final\s+)?void\s+main\s*\(\s*(?:final\s+)?String\s*(?:\[\]\s*\w+|\.\.\.\s*\w+|\w+\s*\[\])\s*\)/.test(src)) continue;
      const pkg = src.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
      const name = path.posix.basename(rel, '.java');
      out.push({ className: pkg ? `${pkg}.${name}` : name, file: rel });
    }
    // Prefer Main / *.Main first.
    return out.sort((a, b) => Number(/(^|\.)Main$/.test(b.className)) - Number(/(^|\.)Main$/.test(a.className)) || a.className.localeCompare(b.className));
  }

  compile(
    jdk: JdkInfo,
    files: FileSystemService,
    buildKey: string,
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<CompileResult> {
    const started = Date.now();
    const classesDir = path.join(this.buildRoot, buildKey, 'classes');
    fs.rmSync(classesDir, { recursive: true, force: true });
    fs.mkdirSync(classesDir, { recursive: true });

    const sources = this.javaFiles(files);
    if (!sources.length) {
      return Promise.resolve({
        success: false,
        diagnostics: [],
        output: 'No .java files found in the project.',
        durationMs: 0,
        fileCount: 0,
        classesDir,
      });
    }
    const argFile = path.join(this.buildRoot, buildKey, 'sources.txt');
    // javac @argfile: quote each path so spaces are safe.
    fs.writeFileSync(argFile, sources.map((s) => `"${files.resolve(s).replace(/\\/g, '\\\\')}"`).join('\n'));

    const args = ['-d', classesDir, '-encoding', 'UTF-8', '-g', '-Xmaxerrs', '500', '-Xlint:unchecked', `@${argFile}`];
    return new Promise((resolve) => {
      const child = spawn(jdk.javacPath, args, { cwd: files.root, signal: opts.signal, env: javaEnv() });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs ?? 60_000);
      const finish = (code: number | null, err?: Error) => {
        clearTimeout(timer);
        output = output.replace(/^Picked up JAVA_TOOL_OPTIONS:.*\n/m, '');
        const toRel = (p: string) => {
          const abs = path.isAbsolute(p) ? p : path.resolve(files.root, p);
          return files.relative(abs);
        };
        resolve({
          success: code === 0 && !err,
          diagnostics: parseJavacOutput(output, toRel),
          output: err ? `${output}\n${err.message}` : output,
          durationMs: Date.now() - started,
          fileCount: sources.length,
          classesDir,
        });
      };
      child.on('error', (e) => finish(null, e));
      child.on('close', (code) => finish(code));
    });
  }
}
