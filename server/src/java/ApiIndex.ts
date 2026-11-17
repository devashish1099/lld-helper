import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CACHE_DIR, SERVER_ROOT, type JdkInfo } from '../config.js';

const run = promisify(execFile);

/**
 * Generates (once per JDK version) a JSON index of common JDK classes using
 * java-tools/ApiIndexer.java, then serves it from the cache directory.
 */
export class ApiIndex {
  private pending?: Promise<string>;

  private file(jdk: JdkInfo) {
    return path.join(CACHE_DIR, `api-index-${(jdk.version ?? 'unknown').replace(/[^\w.-]/g, '_')}.json`);
  }

  async ensure(jdk: JdkInfo): Promise<string> {
    if (!jdk.found) throw new Error('JDK not found; cannot build the Java API index');
    const file = this.file(jdk);
    if (fs.existsSync(file)) return file;
    this.pending ??= (async () => {
      const outDir = path.join(CACHE_DIR, 'api-indexer');
      fs.mkdirSync(outDir, { recursive: true });
      await run(jdk.javacPath, ['-d', outDir, path.join(SERVER_ROOT, 'java-tools', 'ApiIndexer.java')]);
      const { stdout } = await run(jdk.javaPath, ['-cp', outDir, 'ApiIndexer'], { maxBuffer: 64 * 1024 * 1024 });
      JSON.parse(stdout); // validate before caching
      fs.writeFileSync(file, stdout);
      return file;
    })().finally(() => (this.pending = undefined));
    return this.pending;
  }
}
