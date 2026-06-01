import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { loadPlan, savePlan } from '../src/core/plan-store.js';

describe('plan-store', () => {
  it('round-trips plan items', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-plan-'));
    const items = [
      { step: 'Read README', status: 'completed' as const },
      { step: 'Fix tests', status: 'in_progress' as const }
    ];

    await savePlan(cwd, items);
    const loaded = await loadPlan(cwd);

    expect(loaded).toEqual(items);
    const raw = await readFile(join(cwd, '.helix', 'plan.json'), 'utf8');
    expect(raw).toContain('Read README');
  });
});
