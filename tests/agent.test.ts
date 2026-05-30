import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { TerminalAgent } from '../src/agent/terminal-agent.js';
import { executeConfirmedTool } from '../src/agent/confirmed-action.js';
import type { ChatMessage, ChatProvider } from '../src/llm/types.js';

class ScriptedProvider implements ChatProvider {
  private index = 0;
  readonly calls: ChatMessage[][] = [];

  constructor(private readonly responses: string[]) {}

  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
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

  it('includes project instructions in the system prompt', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider(['Done.']);
    const agent = new TerminalAgent({
      cwd,
      provider,
      projectInstructions: [{ path: 'AGENTS.md', content: 'Use JDK 17 from C:/DevelopTool/JDK17.' }]
    });

    await agent.run('hello');

    expect(provider.calls[0]?.[0]?.role).toBe('system');
    expect(provider.calls[0]?.[0]?.content).toContain('Project instructions from AGENTS.md');
    expect(provider.calls[0]?.[0]?.content).toContain('Use JDK 17 from C:/DevelopTool/JDK17.');
  });

  it('updates and exposes the current session plan', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({
        tool: 'update_plan',
        args: {
          items: [
            { step: 'Inspect files', status: 'completed' },
            { step: 'Implement change', status: 'in_progress' }
          ]
        }
      }),
      'Plan updated.'
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('make a plan');

    expect(result.type).toBe('final');
    expect(agent.currentPlan()).toEqual([
      { step: 'Inspect files', status: 'completed' },
      { step: 'Implement change', status: 'in_progress' }
    ]);
  });

  it('asks for confirmation before running shell commands', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({ tool: 'run_shell', args: { command: 'npm test' } })
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('run tests');

    expect(result.type).toBe('confirmation');
    if (result.type === 'confirmation') {
      expect(result.tool).toBe('run_shell');
      expect(result.args.command).toBe('npm test');
    }
  });

  it('rejects empty shell commands without confirmation', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({ tool: 'run_shell', args: { command: '   ' } })
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('run a command');

    expect(result.type).toBe('final');
    if (result.type === 'final') expect(result.message).toMatch(/non-empty command/i);
  });

  it('asks for confirmation before writing files and can execute the confirmed write', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({
        tool: 'write_file',
        args: { path: 'notes.txt', content: 'hello from HelixCode\n' }
      })
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('write a note');

    expect(result.type).toBe('confirmation');
    if (result.type === 'confirmation') {
      expect(result.tool).toBe('write_file');
      const confirmed = await executeConfirmedTool(cwd, result);
      expect(confirmed.ok).toBe(true);
    }
  });

  it('asks for confirmation before replacing text in files', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({
        tool: 'replace_in_file',
        args: { path: 'README.md', oldText: 'old', newText: 'new' }
      })
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('edit README');

    expect(result.type).toBe('confirmation');
    if (result.type === 'confirmation') {
      expect(result.tool).toBe('replace_in_file');
      expect(result.args.path).toBe('README.md');
    }
  });

  it('continues the conversation after confirmed actions', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({
        tool: 'write_file',
        args: { path: 'notes.txt', content: 'hello from HelixCode\n' }
      }),
      'Created notes.txt.'
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('write a note');

    expect(result.type).toBe('confirmation');
    if (result.type === 'confirmation') {
      const confirmed = await executeConfirmedTool(cwd, result);
      const followUp = await agent.continueAfterConfirmation(result, confirmed);

      expect(followUp.type).toBe('final');
      if (followUp.type === 'final') expect(followUp.message).toContain('notes.txt');
      expect(provider.calls.at(-1)?.some((message) => message.role === 'tool')).toBe(true);
    }
  });
});
