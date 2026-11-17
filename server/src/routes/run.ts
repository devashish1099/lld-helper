import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Services } from '../services.js';
import { JavaRun } from '../java/JavaExecutionService.js';

type ClientMsg =
  | { type: 'run'; problemId: string; mainClass?: string; args?: string[]; stdin?: string; closeStdin?: boolean }
  | { type: 'compile'; problemId: string }
  | { type: 'stdin'; data: string }
  | { type: 'eof' }
  | { type: 'kill' };

/**
 * WebSocket protocol for compile + run. Server → client messages:
 *   status {phase, ...} | compile {success, diagnostics, output, durationMs, fileCount}
 *   stdout {data} | stderr {data} | exit {code, signal, durationMs, timedOut, killed} | error {message}
 */
export function registerRunRoutes(app: FastifyInstance, s: Services) {
  app.get('/ws/run', { websocket: true }, (socket: WebSocket, req) => {
    // Only accept connections from our own origin (blocks cross-site WebSocket hijacking).
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      socket.close(1008, 'Origin not allowed');
      return;
    }
    let run: JavaRun | undefined;
    let busy = false;
    const send = (m: object) => socket.readyState === socket.OPEN && socket.send(JSON.stringify(m));

    const compileAndMaybeRun = async (msg: Extract<ClientMsg, { type: 'run' | 'compile' }>) => {
      if (busy) return send({ type: 'error', message: 'A program is already running. Stop it first.' });
      busy = true;
      try {
        const jdk = s.jdk();
        if (!jdk.found) return send({ type: 'error', message: `JDK not found (${jdk.error ?? 'javac missing'}). Open Settings → Java to configure it.` });
        const problem = s.problems.get(msg.problemId);
        const files = s.projects.fs(problem.slug);
        send({ type: 'status', phase: 'compiling', jdk: jdk.version });
        const result = await s.compiler.compile(jdk, files, problem.slug);
        send({ type: 'compile', ...result, classesDir: undefined });
        if (!result.success || msg.type === 'compile') return;

        const mains = s.compiler.findMainClasses(files);
        const mainClass = msg.mainClass && mains.some((m) => m.className === msg.mainClass) ? msg.mainClass : mains[0]?.className;
        if (!mainClass) return send({ type: 'error', message: 'No class with "public static void main(String[] args)" found.' });

        const settings = s.getSettings();
        send({ type: 'status', phase: 'running', mainClass, timeoutSec: settings.runTimeoutSec });
        await new Promise<void>((resolve) => {
          run = new JavaRun(
            {
              jdk,
              classesDir: result.classesDir,
              cwd: files.root,
              mainClass,
              args: Array.isArray(msg.args) ? msg.args.map(String) : [],
              timeoutMs: settings.runTimeoutSec * 1000,
              maxHeapMb: settings.maxHeapMb,
            },
            {
              onStdout: (data) => send({ type: 'stdout', data }),
              onStderr: (data) => send({ type: 'stderr', data }),
              onExit: (r) => {
                send({ type: 'exit', ...r });
                resolve();
              },
            },
          );
          run.start();
          if (msg.stdin) run.write(msg.stdin);
          if (msg.closeStdin) run.endInput();
        });
      } catch (e) {
        send({ type: 'error', message: (e as Error).message });
      } finally {
        busy = false;
        run = undefined;
      }
    };

    socket.on('message', (raw) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send({ type: 'error', message: 'Invalid message' });
      }
      switch (msg.type) {
        case 'run':
        case 'compile':
          void compileAndMaybeRun(msg);
          break;
        case 'stdin':
          run?.write(String(msg.data));
          break;
        case 'eof':
          run?.endInput();
          break;
        case 'kill':
          run?.kill();
          break;
      }
    });
    socket.on('close', () => run?.kill());
  });
}
