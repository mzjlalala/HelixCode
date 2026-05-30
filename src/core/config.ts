import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export interface HelixConfig {
  name: 'HelixCode';
  cwd: string;
  apiKey: string;
  model: string;
  baseURL: string;
}

export interface ProjectInstruction {
  path: string;
  content: string;
}

export function loadConfig(options: { cwd?: string } = {}): HelixConfig {
  return {
    name: 'HelixCode',
    cwd: options.cwd ?? resolve(process.cwd()),
    apiKey: process.env.HELIX_API_KEY ?? process.env.OPENAI_API_KEY ?? '',
    model: process.env.HELIX_CHAT_MODEL ?? process.env.HELIX_MODEL ?? 'gpt-4o',
    baseURL: process.env.HELIX_BASE_URL ?? 'https://api.openai.com/v1'
  };
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
