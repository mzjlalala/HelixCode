import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt, TerminalAgent } from '../src/agent/terminal-agent.js';
import { executeConfirmedTool } from '../src/agent/confirmed-action.js';
import type { ChatMessage, ChatProvider, ChatResult } from '../src/llm/types.js';

class ScriptedProvider implements ChatProvider {
  private index = 0;
  readonly calls: ChatMessage[][] = [];

  constructor(private readonly responses: string[]) {}

  async complete(_messages: ChatMessage[], _tools?: unknown[]): Promise<ChatResult> {
    this.calls.push(_messages);
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) throw new Error('No scripted response left');

    // If response looks like a JSON tool call, return as native tool_calls
    try {
      const parsed = JSON.parse(response) as { tool?: unknown; args?: unknown };
      if (typeof parsed.tool === 'string') {
        return {
          type: 'tool_calls',
          calls: [{
            id: `call_${this.index}`,
            name: parsed.tool,
            arguments: isPlainObject(parsed.args) ? parsed.args as Record<string, unknown> : {}
          }]
        };
      }
    } catch { /* not JSON — treat as text */ }

    return { type: 'text', content: response };
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

describe('TerminalAgent', () => {  it('guides the model through a coding-agent tool workflow', () => {
    const prompt = buildSystemPrompt([]);

    expect(prompt).toContain('Before editing, inspect the relevant files');
    expect(prompt).toContain('Prefer search_files');
    expect(prompt).toContain('After changing code, run the smallest relevant verification command');
    expect(prompt).toContain('Use the provided tools');
  });

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

  it('compacts history without clearing the current plan', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({
        tool: 'update_plan',
        args: { items: [{ step: 'Keep this plan', status: 'in_progress' }] }
      }),
      'Plan updated.',
      ...Array.from({ length: 12 }, (_, index) => `Reply ${index}`)
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    await agent.run('plan');
    for (let index = 0; index < 12; index += 1) {
      await agent.run(`message ${index}`);
    }

    const before = agent.historySize();
    const after = agent.compactHistory(5);

    expect(before).toBeGreaterThan(5);
    expect(after).toBe(5);
    expect(agent.historySize()).toBe(5);
    expect(agent.currentPlan()).toEqual([{ step: 'Keep this plan', status: 'in_progress' }]);
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

  it('asks for confirmation before editing line ranges', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    const provider = new ScriptedProvider([
      JSON.stringify({
        tool: 'edit_file',
        args: { path: 'README.md', startLine: 1, endLine: 1, content: '# New title' }
      })
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const result = await agent.run('edit README');

    expect(result.type).toBe('confirmation');
    if (result.type === 'confirmation') {
      expect(result.tool).toBe('edit_file');
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

  it('loadHistory adds messages to agent state', () => {
    const provider = new ScriptedProvider([]);
    const agent = new TerminalAgent({ cwd: '/test', provider });
    expect(agent.historySize()).toBe(0);

    agent.loadHistory([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ]);
    expect(agent.historySize()).toBe(2);
  });

  it('loadHistory filters out system and tool messages', () => {
    const provider = new ScriptedProvider([]);
    const agent = new TerminalAgent({ cwd: '/test', provider });

    agent.loadHistory([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi', tool_calls: [] },
      { role: 'tool', content: 'result', tool_call_id: '1' },
    ]);
    expect(agent.historySize()).toBe(2); // only user + assistant
  });

  it('getHistory returns a copy of history', () => {
    const provider = new ScriptedProvider([]);
    const agent = new TerminalAgent({ cwd: '/test', provider });
    agent.loadHistory([{ role: 'user', content: 'Hello' }]);

    const copy = agent.getHistory();
    expect(copy).toHaveLength(1);
    // Mutating the copy should not affect internal state
    copy.push({ role: 'assistant', content: 'added' });
    expect(agent.getHistory()).toHaveLength(1);
  });
});
