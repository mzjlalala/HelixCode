import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type LlmProvider = 'openai' | 'deepseek' | 'custom';

export interface HelixConfig {
  name: 'HelixCode';
  cwd: string;
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseURL: string;
}

export interface ProjectInstruction {
  path: string;
  content: string;
}

export function loadConfig(options: { cwd?: string } = {}): HelixConfig {
  const provider = normalizeProvider(process.env.HELIX_PROVIDER);
  const defaults = providerDefaults(provider);

  return {
    name: 'HelixCode',
    cwd: options.cwd ?? resolve(process.cwd()),
    provider,
    apiKey: resolveApiKey(provider),
    model: process.env.HELIX_CHAT_MODEL ?? process.env.HELIX_MODEL ?? defaults.model,
    baseURL: process.env.HELIX_BASE_URL ?? defaults.baseURL
  };
}

function normalizeProvider(value: string | undefined): LlmProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'deepseek' || normalized === 'openai' || normalized === 'custom') return normalized;
  if (process.env.HELIX_BASE_URL?.toLowerCase().includes('deepseek.com')) return 'deepseek';
  return 'openai';
}

function resolveApiKey(provider: LlmProvider): string {
  if (provider === 'deepseek') {
    return process.env.DEEPSEEK_API_KEY
      ?? process.env.HELIX_API_KEY
      ?? process.env.OPENAI_API_KEY
      ?? '';
  }

  return process.env.HELIX_API_KEY
    ?? process.env.OPENAI_API_KEY
    ?? process.env.DEEPSEEK_API_KEY
    ?? '';
}

function providerDefaults(provider: LlmProvider): { model: string; baseURL: string } {
  if (provider === 'deepseek') {
    return { model: 'deepseek-chat', baseURL: 'https://api.deepseek.com' };
  }
  return { model: 'gpt-4o', baseURL: 'https://api.openai.com/v1' };
}

export async function loadProjectInstructions(cwd: string): Promise<ProjectInstruction[]> {
  const instructionPaths = ['AGENTS.md', '.helix/instructions.md'];
  const instructions: ProjectInstruction[] = [];

  for (const path of instructionPaths) {
    try {
      const content = await readFile(resolve(cwd, path), 'utf8');
      if (content.trim()) instructions.push({ path, content });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'ENOENT') throw error;
    }
  }

  return instructions;
}
