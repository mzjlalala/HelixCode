import 'dotenv/config';
import { resolve } from 'node:path';

export interface HelixConfig {
  name: 'HelixCode';
  cwd: string;
  apiKey: string;
  model: string;
  baseURL: string;
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
