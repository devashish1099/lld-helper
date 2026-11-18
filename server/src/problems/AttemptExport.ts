import type { ChatMessageRow, ClarificationRow, ProblemRow } from '../db/PersistenceService.js';
import type { FileSystemService } from '../fs/FileSystemService.js';
import { DESIGN_FILE, NOTES_FILE, PSEUDO_DIR, designTemplate, mainTemplate, pseudoTemplate } from '../projects/ProjectManager.js';

const TEXT_FILE = /\.(java|md|pseudo|txt)$/i;
const MAX_FILE_CHARS = 60_000;

export const RATING_PROMPT = `You are a senior engineer conducting a Low-Level Design (LLD) interview in Java. Below is a candidate's complete attempt: the problem, the clarification questions they asked, their design notes, pseudocode, Java code and their conversation with the interviewer.

Rate the attempt as a real interviewer would. For each dimension give a score out of 10 and 1-3 concrete reasons that cite classes, files or messages:
1. Requirement gathering (clarification questions, assumptions stated)
2. Object-oriented design (entities, responsibilities, relationships)
3. SOLID principles and clean abstractions
4. Design patterns (used where they fit, not forced)
5. Extensibility (how easily new requirements fit in)
6. Correctness and edge cases (validation, rounding, invalid input, concurrency where relevant)
7. Code quality and readability
8. Communication (how clearly they explained and justified decisions)

Then give: an overall score out of 10, a hiring signal (Strong Hire / Hire / Lean Hire / Lean No Hire / No Hire), the 3 most important improvements, and anything required by the problem that is missing.`;

const fence = (path: string) => (path.endsWith('.java') ? 'java' : path.endsWith('.md') ? 'markdown' : '');

/**
 * Builds a single Markdown document of the candidate's attempt that can be pasted into
 * any external chatbot for rating. Never includes the hidden interviewer notes.
 */
export function buildAttemptMarkdown(
  problem: ProblemRow,
  clarifications: ClarificationRow[],
  interviewerMessages: ChatMessageRow[],
  files: FileSystemService,
  { includePrompt = true } = {},
) {
  const out: string[] = [];
  if (includePrompt) out.push(RATING_PROMPT, '---');
  out.push(`# LLD Interview Attempt: ${problem.title}`);
  out.push(`## Problem\n${problem.description || '(no description)'}`);
  if (problem.functional_reqs.trim()) out.push(`### Functional requirements\n${problem.functional_reqs}`);
  if (problem.non_functional_reqs.trim()) out.push(`### Non-functional requirements\n${problem.non_functional_reqs}`);

  out.push(
    `## Clarification questions asked by the candidate\n${
      clarifications.length
        ? clarifications.map((c, i) => `${i + 1}. **[${c.category}]** ${c.question}\n   - Answer: ${c.response.trim() || '_(unanswered)_'}`).join('\n')
        : '_(none)_'
    }`,
  );

  // Skip scaffold files the candidate never touched, so the rater isn't misled by templates.
  const untouched: Record<string, string> = {
    'README.md': `# ${problem.title}\n\n${problem.description}\n`,
    [NOTES_FILE]: `# Notes - ${problem.title}\n\n`,
    [DESIGN_FILE]: designTemplate(problem.title),
    [`${PSEUDO_DIR}/solution.pseudo`]: pseudoTemplate(problem.title),
    'src/main/java/Main.java': mainTemplate(problem.title),
  };
  const all = files.listFiles((p) => TEXT_FILE.test(p) && p !== 'README.md');
  const order = (p: string) => (p === DESIGN_FILE ? 0 : p === NOTES_FILE ? 1 : p.endsWith('.pseudo') ? 2 : 3);
  const sections: string[] = [];
  for (const path of all.sort((a, b) => order(a) - order(b) || a.localeCompare(b))) {
    let content: string;
    try {
      content = files.read(path);
    } catch {
      continue;
    }
    if (!content.trim() || untouched[path] === content) continue;
    const body = content.length > MAX_FILE_CHARS ? `${content.slice(0, MAX_FILE_CHARS)}\n... [truncated]` : content;
    sections.push(`### ${path}\n\`\`\`${fence(path)}\n${body.replace(/\n$/, '')}\n\`\`\``);
  }
  out.push(`## Candidate's files\n${sections.length ? sections.join('\n\n') : '_(no files written yet)_'}`);

  if (interviewerMessages.length) {
    const lines = interviewerMessages.map((m) => `**${m.role === 'user' ? 'Candidate' : 'Interviewer'}:** ${m.content.trim()}`);
    out.push(`## Conversation with the interviewer\n${lines.join('\n\n')}`);
  }
  return out.join('\n\n') + '\n';
}
