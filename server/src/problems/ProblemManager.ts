import fs from 'node:fs';
import { PersistenceService, type ProblemRow } from '../db/PersistenceService.js';
import { ProjectManager } from '../projects/ProjectManager.js';
import { ORIGINAL_SAMPLE_SLUGS, SAMPLE_PROBLEMS, bullets, interviewerNotesFor } from './samples.js';

export function slugify(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'problem'
  );
}

export interface ProblemInput {
  title: string;
  description?: string;
  functional_reqs?: string;
  non_functional_reqs?: string;
  interviewer_notes?: string;
}

export class ProblemManager {
  constructor(
    private db: PersistenceService,
    private projects: ProjectManager,
  ) {}

  /**
   * Adds built-in samples that this install hasn't seen yet (so new samples appear after
   * an update) without re-creating samples the user deleted. Samples the user never edited
   * get the latest built-in requirements and interviewer notes.
   */
  seedSamples() {
    const legacy = this.db.getSetting('samplesSeeded', false) ? ORIGINAL_SAMPLE_SLUGS : [];
    const seeded = new Set(this.db.getSetting<string[]>('seededSampleSlugs', legacy));
    for (const s of SAMPLE_PROBLEMS) {
      const content = {
        title: s.title,
        description: s.description,
        functional_reqs: bullets(s.functional),
        non_functional_reqs: bullets(s.nonFunctional),
        interviewer_notes: interviewerNotesFor(s),
      };
      const existing = this.db.getProblemBySlug(s.slug);
      if (existing) {
        if (existing.sample) this.db.refreshSample(existing.id, content);
      } else if (!seeded.has(s.slug)) {
        const p = this.db.insertProblem({ slug: s.slug, ...content, sample: 1 });
        this.projects.scaffold(p.slug, p.title, p.description);
      }
      seeded.add(s.slug);
    }
    this.db.setSetting('seededSampleSlugs', [...seeded]);
    this.db.setSetting('samplesSeeded', true);
  }

  list() {
    return this.db.listProblems();
  }

  get(id: string): ProblemRow {
    const p = this.db.getProblem(id);
    if (!p) throw Object.assign(new Error('Problem not found'), { statusCode: 404 });
    // Project folder may have been deleted externally; recreate the skeleton.
    if (!fs.existsSync(this.projects.projectDir(p.slug))) this.projects.scaffold(p.slug, p.title, p.description);
    return p;
  }

  private uniqueSlug(title: string) {
    const base = slugify(title);
    let slug = base;
    for (let i = 2; this.db.getProblemBySlug(slug) || fs.existsSync(this.projects.projectDir(slug)); i++) slug = `${base}-${i}`;
    return slug;
  }

  create(input: ProblemInput, { scaffold = true } = {}) {
    if (!input.title?.trim()) throw Object.assign(new Error('Title is required'), { statusCode: 400 });
    const slug = this.uniqueSlug(input.title);
    const p = this.db.insertProblem({
      slug,
      title: input.title.trim(),
      description: input.description ?? '',
      functional_reqs: input.functional_reqs ?? '',
      non_functional_reqs: input.non_functional_reqs ?? '',
      interviewer_notes: input.interviewer_notes ?? '',
      sample: 0,
    });
    if (scaffold) this.projects.scaffold(p.slug, p.title, p.description);
    return p;
  }

  importFromDirectory(sourceDir: string, title: string) {
    const p = this.create({ title, description: `Imported from ${sourceDir}` }, { scaffold: false });
    try {
      this.projects.importDirectory(sourceDir, p.slug);
    } catch (e) {
      this.db.deleteProblem(p.id);
      throw Object.assign(e as Error, { statusCode: 400 });
    }
    return p;
  }

  update(id: string, patch: Partial<ProblemInput>) {
    this.get(id);
    return this.db.updateProblem(id, patch)!;
  }

  delete(id: string, deleteFiles: boolean) {
    const p = this.get(id);
    this.db.deleteProblem(id);
    if (deleteFiles) this.projects.remove(p.slug);
  }
}
