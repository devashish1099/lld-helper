import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PersistenceService } from '../src/db/PersistenceService.js';
import { ProjectManager } from '../src/projects/ProjectManager.js';
import { ProblemManager } from '../src/problems/ProblemManager.js';
import { SAMPLE_PROBLEMS, ORIGINAL_SAMPLE_SLUGS } from '../src/problems/samples.js';

const setup = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lld-seed-'));
  const db = new PersistenceService(path.join(dir, 'db.sqlite'));
  const projects = new ProjectManager(path.join(dir, 'ws'));
  return { db, projects, pm: new ProblemManager(db, projects) };
};

describe('sample seeding', () => {
  it('seeds every sample on a fresh install, with unique slugs', () => {
    const { pm } = setup();
    pm.seedSamples();
    const slugs = pm.list().map((p) => p.slug);
    expect(new Set(SAMPLE_PROBLEMS.map((s) => s.slug)).size).toBe(SAMPLE_PROBLEMS.length);
    expect(slugs).toEqual(expect.arrayContaining(['amazon-locker', 'linux-find', 'notification-system', 'agentic-chatbot', 'parking-lot']));
    expect(slugs).toHaveLength(SAMPLE_PROBLEMS.length);
  });

  it('upgrades a legacy install: adds new samples, keeps deletions and user edits', () => {
    const { db, projects, pm } = setup();
    // Simulate an install made by the previous version (12 samples, old seeding flag only).
    for (const slug of ORIGINAL_SAMPLE_SLUGS) {
      const s = SAMPLE_PROBLEMS.find((x) => x.slug === slug)!;
      db.insertProblem({ slug, title: s.title, description: 'old', functional_reqs: '- old', non_functional_reqs: '', interviewer_notes: '- old', sample: 1 });
      projects.scaffold(slug, s.title, 'old');
    }
    db.setSetting('samplesSeeded', true);
    db.deleteProblem(db.getProblemBySlug('chess')!.id);
    const parking = db.getProblemBySlug('parking-lot')!;
    db.updateProblem(parking.id, { description: 'my own notes' }); // user edit

    pm.seedSamples();

    expect(db.getProblemBySlug('chess')).toBeUndefined();
    expect(db.getProblemBySlug('amazon-locker')).toBeDefined();
    expect(db.getProblemBySlug('agentic-chatbot')!.interviewer_notes).toMatch(/Chain of Responsibility/);
    expect(db.getProblemBySlug('parking-lot')!.description).toBe('my own notes');
    const elevator = db.getProblemBySlug('elevator-system')!;
    expect(elevator.functional_reqs).toMatch(/LOOK \/ SCAN/);
    expect(elevator.updated_at).toBe(elevator.created_at); // still counts as unedited

    // Idempotent: a second run changes nothing and doesn't resurrect deletions.
    const before = pm.list().length;
    pm.seedSamples();
    expect(pm.list().length).toBe(before);
    db.deleteProblem(db.getProblemBySlug('amazon-locker')!.id);
    pm.seedSamples();
    expect(db.getProblemBySlug('amazon-locker')).toBeUndefined();
  });
});
