import 'dotenv/config';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { PermissionMode } from '../cli/permission-mode.js';
import {
  DEFAULT_COMPACT_KEEP_MESSAGES,
  DEFAULT_MAX_HISTORY_MESSAGES,
  DEFAULT_MAX_TOOL_ROUNDS
} from './constants.js';

export type LlmProvider = 'openai' | 'deepseek' | 'custom';

export interface HelixConfig {
  name: 'HelixCode';
  cwd: string;
  provider: LlmProvider;
  apiKey: string;
  model: string;
  baseURL: string;
}

export interface HelixFileConfig {
  /** Default chat model. CLI `--model` flag overrides this. */
  model?: string;
  /** Permission mode: default | acceptEdits | plan | auto */
  permissionMode?: PermissionMode;
  /** Paths to project instruction files, relative to project root */
  instructions?: string[];
  /** Max tool rounds per agent run (default 6). */
  maxToolRounds?: number;
  /** In-memory and persisted history cap (default 80). */
  maxHistoryMessages?: number;
  /** Default /compact keep count (default 20). */
  compactKeepMessages?: number;
}

export interface SessionSettings {
  maxToolRounds: number;
  maxHistoryMessages: number;
  compactKeepMessages: number;
}

export function resolveSessionSettings(file: HelixFileConfig = {}): SessionSettings {
  return {
    maxToolRounds: positiveInt(file.maxToolRounds, DEFAULT_MAX_TOOL_ROUNDS),
    maxHistoryMessages: positiveInt(file.maxHistoryMessages, DEFAULT_MAX_HISTORY_MESSAGES),
    compactKeepMessages: positiveInt(file.compactKeepMessages, DEFAULT_COMPACT_KEEP_MESSAGES)
  };
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface ProjectInstruction {
  path: string;
  content: string;
}

const CONFIG_FILENAME = '.helix/config.json';

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

/** Load the file-based config from .helix/config.json */
export async function loadFileConfig(cwd: string): Promise<HelixFileConfig> {
  try {
    const content = await readFile(resolve(cwd, CONFIG_FILENAME), 'utf8');
    const parsed = JSON.parse(content) as HelixFileConfig;
    return parsed;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT') return {};
    throw error;
  }
}

/** Merge file config into env-based config (file config takes precedence) */
export function mergeFileConfig(base: HelixConfig, file: HelixFileConfig): HelixConfig {
  if (file.model && !process.env.HELIX_CHAT_MODEL && !process.env.HELIX_MODEL) {
    base.model = file.model;
  }
  return base;
}

/** Save/update .helix/config.json, preserving existing fields */
export async function saveFileConfig(
  cwd: string,
  partial: Partial<HelixFileConfig>
): Promise<HelixFileConfig> {
  const current = await loadFileConfig(cwd);
  const merged: HelixFileConfig = { ...current, ...partial };
  const target = resolve(cwd, CONFIG_FILENAME);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  return merged;
}

export async function loadPermissionMode(cwd: string): Promise<PermissionMode | undefined> {
  const config = await loadFileConfig(cwd);
  return config.permissionMode;
}

export async function savePermissionMode(cwd: string, mode: PermissionMode): Promise<void> {
  await saveFileConfig(cwd, { permissionMode: mode });
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
  const instructions: ProjectInstruction[] = [];

  // Load from .helix/config.json first if specified
  const fileConfig = await loadFileConfig(cwd);
  const configPaths = fileConfig.instructions ?? [];

  // Default paths always checked
  const allPaths = [...new Set([...configPaths, 'AGENTS.md', '.helix/instructions.md'])];

  for (const path of allPaths) {
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
