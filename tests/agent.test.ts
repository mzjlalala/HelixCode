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

/** 模拟单次响应返回多个 tool_calls 的 Provider */
class BatchToolProvider implements ChatProvider {
  readonly calls: ChatMessage[][] = [];
  private round = 0;

  constructor(private readonly batchCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>) {}

  async complete(messages: ChatMessage[]): Promise<ChatResult> {
    this.calls.push(messages);
    this.round += 1;
    if (this.round === 1) {
      return { type: 'tool_calls', calls: this.batchCalls };
    }
    return { type: 'text', content: `done round ${this.round}` };
  }
}

/** 校验 history 中 assistant tool_calls 与 tool 消息成对 */
function assertToolCallHistoryValid(messages: ChatMessage[]): void {
  let pendingIds: string[] | null = null;
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      if (pendingIds?.length) {
        throw new Error('assistant tool_calls without matching tool responses');
      }
      pendingIds = msg.tool_calls.map((tc) => tc.id);
      continue;
    }
    if (msg.role === 'tool') {
      if (!pendingIds?.length) throw new Error('orphan tool message');
      const id = msg.tool_call_id ?? '';
      const idx = pendingIds.indexOf(id);
      expect(idx).toBeGreaterThanOrEqual(0);
      pendingIds.splice(idx, 1);
      if (pendingIds.length === 0) pendingIds = null;
    }
  }
  if (pendingIds?.length) {
    throw new Error(`unanswered tool_calls: ${pendingIds.join(', ')}`);
  }
}

describe('TerminalAgent', () => {  it('builds a versatile system prompt for general and coding tasks', () => {
    const prompt = buildSystemPrompt([]);

    expect(prompt).toContain('versatile AI assistant');
    expect(prompt).toContain('For GENERAL tasks');
    expect(prompt).toContain('For CODING tasks');
    expect(prompt).toContain('Available tools');
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
      const confirmed = await executeConfirmedTool(cwd, result, agent.getToolRegistry());
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
      const confirmed = await executeConfirmedTool(cwd, result, agent.getToolRegistry());
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

  it('loadHistory filters out system messages only', () => {
    const provider = new ScriptedProvider([]);
    const agent = new TerminalAgent({ cwd: '/test', provider });

    agent.loadHistory([
      { role: 'system', content: 'be helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi', tool_calls: [] },
      { role: 'tool', content: 'result', tool_call_id: '1' },
    ]);
    // system is filtered, but user/assistant/tool are kept (tool chain integrity)
    expect(agent.historySize()).toBe(3);
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

  it('keeps one assistant message for multiple parallel tool_calls', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'helix-agent-'));
    await writeFile(join(cwd, 'a.txt'), 'alpha\n', 'utf8');
    await writeFile(join(cwd, 'b.txt'), 'beta\n', 'utf8');
    await writeFile(join(cwd, 'c.txt'), 'gamma\n', 'utf8');

    const provider = new BatchToolProvider([
      { id: 'call_a', name: 'read_file', arguments: { path: 'a.txt' } },
      { id: 'call_b', name: 'read_file', arguments: { path: 'b.txt' } },
      { id: 'call_c', name: 'read_file', arguments: { path: 'c.txt' } }
    ]);
    const agent = new TerminalAgent({ cwd, provider });

    const first = await agent.run('read three files');
    expect(first.type).toBe('final');
    assertToolCallHistoryValid(agent.getHistory());

    const batchAssistant = agent.getHistory().find(
      (m) => m.role === 'assistant' && (m.tool_calls?.length ?? 0) === 3
    );
    expect(batchAssistant).toBeTruthy();

    const second = await agent.run('continue');
    expect(second.type).toBe('final');
    assertToolCallHistoryValid(agent.getHistory());
    expect(provider.calls.length).toBe(3);
  });
});
