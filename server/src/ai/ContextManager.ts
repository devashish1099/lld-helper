import type { ClarificationRow, ProblemRow } from '../db/PersistenceService.js';
import type { FileSystemService } from '../fs/FileSystemService.js';
import type { AIMode } from './prompts.js';

export interface ContextRequest {
  activeFile?: string;
  includeActiveFile?: boolean;
  /** Send every Java file (and the pseudocode), not just the open/attached ones. */
  includeProject?: boolean;
  attachedFiles?: string[];
  pseudoFile?: string;
  runOutput?: string;
}

export interface ContextResult {
  text: string;
  includedFiles: string[];
  truncated: string[];
}

/** Total character budget for file contents in one request (~30k tokens). */
export const FILE_BUDGET_CHARS = 120_000;
const RUN_OUTPUT_CHARS = 12_000;

const JAVA_PROJECT_MODES = new Set<AIMode>(['java_to_pseudo', 'compare_impl', 'design_review', 'solid_review', 'edge_cases']);
const PSEUDO_MODES = new Set<AIMode>(['pseudo_to_java', 'review_pseudo', 'pseudo_missing_cases', 'compare_impl']);
const INTERVIEWER_NOTES_MODES = new Set<AIMode>(['interviewer', 'interviewer_answer', 'evaluate_questions', 'requirements_clarity', 'suggest_questions']);

const fence = (path: string) => (path.endsWith('.java') ? 'java' : path.endsWith('.md') ? 'markdown' : path.endsWith('.pseudo') ? 'pseudo' : '');

/**
 * Builds the context block for an AI request. Sends only what the mode needs:
 * the problem + clarifications always, the active file and explicitly attached
 * files when requested, and the whole Java project only for review/convert actions.
 */
export class ContextManager {
  build(mode: AIMode, problem: ProblemRow, clarifications: ClarificationRow[], files: FileSystemService, req: ContextRequest): ContextResult {
    const parts: string[] = [];
    const included: string[] = [];
    const truncated: string[] = [];
    let budget = FILE_BUDGET_CHARS;

    parts.push(`# Context\n## Problem: ${problem.title}\n${problem.description || '(no description)'}`);
    if (problem.functional_reqs.trim()) parts.push(`### Functional requirements\n${problem.functional_reqs}`);
    if (problem.non_functional_reqs.trim()) parts.push(`### Non-functional requirements\n${problem.non_functional_reqs}`);
    if (INTERVIEWER_NOTES_MODES.has(mode) && problem.interviewer_notes.trim())
      parts.push(`### Interviewer's private notes (hidden from the candidate)\n${problem.interviewer_notes}`);

    if (clarifications.length) {
      const lines = clarifications.map(
        (c, i) => `${i + 1}. [${c.category}] Q: ${c.question}\n   A: ${c.response.trim() || '(unanswered)'}`,
      );
      parts.push(`### Clarification questions asked so far\n${lines.join('\n')}`);
    } else if (mode !== 'chat') {
      parts.push('### Clarification questions asked so far\n(none yet)');
    }

    // Clarification answers never need code. The interviewer chat only sees files the candidate chose to share.
    if (mode === 'interviewer_answer') return { text: parts.join('\n\n'), includedFiles: [], truncated: [] };

    const addFile = (path: string, label: string) => {
      if (included.includes(path)) return;
      let content: string;
      try {
        content = files.read(path);
      } catch {
        return;
      }
      if (budget <= 0) {
        truncated.push(path);
        return;
      }
      let body = content;
      if (body.length > budget) {
        body = `${body.slice(0, budget)}\n... [truncated: ${content.length - budget} more characters not sent]`;
        truncated.push(path);
      }
      budget -= body.length;
      included.push(path);
      parts.push(`### ${label}: ${path}\n\`\`\`${fence(path)}\n${body}\n\`\`\``);
    };

    if (PSEUDO_MODES.has(mode)) {
      const pseudo = req.pseudoFile ?? files.listFiles((p) => p.endsWith('.pseudo'))[0];
      if (pseudo) addFile(pseudo, 'Pseudocode');
    }
    if (req.includeActiveFile && req.activeFile) addFile(req.activeFile, 'Currently open file');
    for (const f of req.attachedFiles ?? []) addFile(f, 'Attached file');

    const javaFiles = files.listFiles((p) => p.endsWith('.java'));
    if (req.includeProject) for (const f of files.listFiles((p) => p.endsWith('.pseudo'))) addFile(f, 'Pseudocode');
    if (JAVA_PROJECT_MODES.has(mode) || req.includeProject) for (const f of javaFiles) addFile(f, 'Java source');
    if (javaFiles.length) parts.push(`### Java files in the project\n${javaFiles.map((f) => `- ${f}`).join('\n')}`);

    if (req.runOutput?.trim()) {
      const out = req.runOutput.length > RUN_OUTPUT_CHARS ? `...${req.runOutput.slice(-RUN_OUTPUT_CHARS)}` : req.runOutput;
      parts.push(`### Last run output (compiler/program)\n\`\`\`\n${out}\n\`\`\``);
    }
    if (truncated.length)
      parts.push(`_Note: the context budget was exceeded; these files were truncated or omitted: ${truncated.join(', ')}. Say so if it matters for your answer._`);

    return { text: parts.join('\n\n'), includedFiles: included, truncated };
  }
}
