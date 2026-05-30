import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { TerminalAgent } from '../src/agent/terminal-agent.js';
import type { ChatProvider } from '../src/llm/types.js';

class ScriptedProvider implements ChatProvider {
  private index = 0;

  constructor(private readonly responses: string[]) {}

  async complete(): Promise<string> {
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) throw new Error('No scripted response left');
    return response;
  }
}

describe('TerminalAgent', () => {
  it('executes a safe read_file tool call and returns a final response', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    await writeFile(join(cwd, 'README.md'), '# HelixCode\n', 'utf8');
    const provider = new ScriptedProvider([
      JSON.stringify({ tool: 'read_file', args: { path: 'README.md' } }),
      'README says HelixCode'
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('read README');

    expect(result.type).toBe('final');
    if (result.type === 'final') expect(result.message).toContain('HelixCode');
  });

  it('asks for confirmation before running shell commands', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({ tool: 'run_shell', args: { command: 'npm test' } })
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('run tests');

    expect(result.type).toBe('confirmation');
    if (result.type === 'confirmation') expect(result.command).toBe('npm test');
  });
});
