import fs from 'node:fs';
import path from 'node:path';
import { FileSystemService, isWithin } from '../fs/FileSystemService.js';

export const JAVA_SRC = 'src/main/java';
export const PSEUDO_DIR = 'pseudocode';
export const DESIGN_FILE = 'design.md';
export const NOTES_FILE = 'notes.md';

const mainTemplate = (title: string) => `public class Main {
    public static void main(String[] args) {
        System.out.println("${title.replace(/"/g, '\\"')} - LLD Studio");
    }
}
`;

const pseudoTemplate = (title: string) => `# ${title} - Pseudocode
// Work out entities, responsibilities and core flows before writing Java.

CLASS Example
    FIELD items : List<Item>

    FUNCTION add(item)
        IF item IS NULL THEN
            THROW "item required"
        END IF
        items.append(item)
    END FUNCTION
END CLASS
`;

const designTemplate = (title: string) => `# ${title} - Design Notes

## Entities

## Relationships

\`\`\`mermaid
classDiagram
    class Main
\`\`\`

## Design patterns & trade-offs
`;

export class ProjectManager {
  constructor(private workspaceDir: string) {}

  get workspace() {
    return this.workspaceDir;
  }

  projectDir(slug: string) {
    const dir = path.resolve(this.workspaceDir, slug);
    if (!isWithin(this.workspaceDir, dir) || dir === this.workspaceDir) throw new Error('Invalid project slug');
    return dir;
  }

  fs(slug: string) {
    const dir = this.projectDir(slug);
    fs.mkdirSync(dir, { recursive: true });
    return new FileSystemService(dir);
  }

  /** Create the standard layout for a new problem. Never overwrites existing files. */
  scaffold(slug: string, title: string, description: string) {
    const files = this.fs(slug);
    for (const d of [`${JAVA_SRC}/models`, `${JAVA_SRC}/services`, `${JAVA_SRC}/strategies`, PSEUDO_DIR]) files.mkdir(d);
    const put = (rel: string, content: string) => {
      if (!files.exists(rel)) files.write(rel, content);
    };
    put(`${JAVA_SRC}/Main.java`, mainTemplate(title));
    put('README.md', `# ${title}\n\n${description}\n`);
    put(NOTES_FILE, `# Notes - ${title}\n\n`);
    put(DESIGN_FILE, designTemplate(title));
    put(`${PSEUDO_DIR}/solution.pseudo`, pseudoTemplate(title));
  }

  /** Copy an existing directory from the local machine into a new project folder. */
  importDirectory(sourceDir: string, slug: string) {
    const src = path.resolve(sourceDir);
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error(`Not a directory: ${sourceDir}`);
    const dst = this.projectDir(slug);
    if (isWithin(dst, src) || isWithin(src, dst)) throw new Error('Source and destination overlap');
    fs.cpSync(src, dst, {
      recursive: true,
      filter: (p) => !/[\\/](node_modules|\.git|target|build|out)([\\/]|$)/.test(path.relative(src, p) ? `/${path.relative(src, p)}` : ''),
    });
  }

  remove(slug: string) {
    fs.rmSync(this.projectDir(slug), { recursive: true, force: true });
  }
}
