import { spawn, type ChildProcess } from 'node:child_process';
import type { JdkInfo } from '../config.js';
import { javaEnv } from './CompilationService.js';

export interface RunOptions {
  jdk: JdkInfo;
  classesDir: string;
  cwd: string;
  mainClass: string;
  args: string[];
  timeoutMs: number;
  maxHeapMb: number;
}

export interface RunEvents {
  onStdout(data: string): void;
  onStderr(data: string): void;
  onExit(result: { code: number | null; signal: string | null; durationMs: number; timedOut: boolean; killed: boolean }): void;
}

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/**
 * Runs a compiled Java program as a child process (no shell). One instance per run.
 * stdout/stderr are delivered separately; stdin can be written while it runs.
 */
export class JavaRun {
  private child?: ChildProcess;
  private killed = false;
  private timedOut = false;
  private outputBytes = 0;

  constructor(
    private opts: RunOptions,
    private events: RunEvents,
  ) {}

  start() {
    if (!/^[\w$]+(\.[\w$]+)*$/.test(this.opts.mainClass)) throw new Error(`Invalid main class: ${this.opts.mainClass}`);
    const started = Date.now();
    const args = [
      `-Xmx${this.opts.maxHeapMb}m`,
      '-XX:+UseSerialGC',
      '-Dfile.encoding=UTF-8',
      '-Dstdout.encoding=UTF-8',
      '-cp',
      this.opts.classesDir,
      this.opts.mainClass,
      ...this.opts.args,
    ];
    const child = spawn(this.opts.jdk.javaPath, args, {
      cwd: this.opts.cwd,
      env: javaEnv(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const timer = setTimeout(() => {
      this.timedOut = true;
      child.kill('SIGKILL');
    }, this.opts.timeoutMs);

    const pipe = (fn: (s: string) => void) => (d: Buffer) => {
      this.outputBytes += d.length;
      if (this.outputBytes > MAX_OUTPUT_BYTES) {
        if (!this.killed) {
          this.events.onStderr('\n[LLD Studio] Output limit (2 MB) exceeded - process terminated.\n');
          this.kill();
        }
        return;
      }
      fn(d.toString('utf8'));
    };
    child.stdout!.on('data', pipe(this.events.onStdout));
    child.stderr!.on('data', pipe(this.events.onStderr));
    child.stdin!.on('error', () => {}); // EPIPE when the program exits before reading stdin
    child.on('error', (e) => this.events.onStderr(`[LLD Studio] Failed to start java: ${e.message}\n`));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      this.events.onExit({ code, signal, durationMs: Date.now() - started, timedOut: this.timedOut, killed: this.killed });
    });
  }

  write(data: string) {
    if (this.child?.stdin?.writable) this.child.stdin.write(data);
  }

  endInput() {
    this.child?.stdin?.end();
  }

  kill() {
    if (this.child && this.child.exitCode === null) {
      this.killed = true;
      this.child.kill('SIGKILL');
    }
  }

  get running() {
    return !!this.child && this.child.exitCode === null && this.child.signalCode === null;
  }
}
