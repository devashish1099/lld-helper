import fs from 'node:fs';
import { spawn } from 'node:child_process';
import open from 'open';
import { DATA_DIR, HOST, PORT } from './config.js';
import { createServices } from './services.js';
import { buildApp } from './app.js';

// node:sqlite prints an ExperimentalWarning on some Node versions; keep startup output clean.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: any[]) => {
  if (String(typeof warning === 'string' ? warning : warning.message).includes('SQLite')) return;
  return (emitWarning as any)(warning, ...rest);
}) as typeof process.emitWarning;

const isWsl = () => {
  try {
    return /microsoft/i.test(fs.readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
};

async function openBrowser(url: string) {
  if (process.env.LLD_NO_OPEN) return;
  if (isWsl()) {
    // Open in the Windows default browser from WSL.
    const p = spawn('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true });
    p.on('error', () => void open(url).catch(() => {}));
    p.unref();
    return;
  }
  await open(url).catch(() => console.log(`Open ${url} in your browser.`));
}

async function main() {
  const services = createServices();
  const app = await buildApp(services);
  await app.listen({ port: PORT, host: HOST });
  const url = `http://localhost:${PORT}`;
  const jdk = services.jdk();
  console.log(`\n  LLD Studio running at ${url}`);
  console.log(`  Workspace: ${services.workspaceDir}`);
  console.log(`  Data:      ${DATA_DIR}`);
  console.log(jdk.found ? `  Java:      ${jdk.version} (${jdk.source})` : `  Java:      NOT FOUND - install a JDK (17+) or set its path in Settings`);
  console.log('  Note: Java programs you run execute on this machine.\n');
  if (jdk.found) services.apiIndex.ensure(jdk).catch((e) => console.warn('  Could not build Java API index:', e.message));
  await openBrowser(url);

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  if (e?.code === 'EADDRINUSE') console.error(`Port ${PORT} is in use. Is LLD Studio already running? Set LLD_PORT to use another port.`);
  else console.error(e);
  process.exit(1);
});
