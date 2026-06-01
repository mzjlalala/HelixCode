/**
 * HelixCode 配置模块
 *
 * 负责从环境变量与 `.helix/config.json` 加载运行时配置，识别 LLM Provider（OpenAI / DeepSeek / 自定义），
 * 解析 API Key、模型与 Base URL，并加载项目级指令文件（AGENTS.md 等）供 Agent 系统提示使用。
 */
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

/** 将 `.helix/config.json` 中的会话限制字段解析为带默认值的 SessionSettings。 */
export function resolveSessionSettings(file: HelixFileConfig = {}): SessionSettings {
  return {
    maxToolRounds: positiveInt(file.maxToolRounds, DEFAULT_MAX_TOOL_ROUNDS),
    maxHistoryMessages: positiveInt(file.maxHistoryMessages, DEFAULT_MAX_HISTORY_MESSAGES),
    compactKeepMessages: positiveInt(file.compactKeepMessages, DEFAULT_COMPACT_KEEP_MESSAGES)
  };
}

/** 校验正整数，无效时回退到默认值。 */
function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

export interface ProjectInstruction {
  path: string;
  content: string;
}

const CONFIG_FILENAME = '.helix/config.json';

/**
 * 从环境变量加载 Helix 运行时配置（Provider、API Key、模型、Base URL）。
 * CLI `--model` 等标志在调用方覆盖，此处不读取文件配置。
 */
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

/** 从 `.helix/config.json` 读取项目文件配置；文件不存在时返回空对象。 */
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

/**
 * 将文件配置合并进环境变量配置。
 * 仅当未设置 HELIX_CHAT_MODEL / HELIX_MODEL 环境变量时，才用文件中的 model 覆盖。
 */
export function mergeFileConfig(base: HelixConfig, file: HelixFileConfig): HelixConfig {
  if (file.model && !process.env.HELIX_CHAT_MODEL && !process.env.HELIX_MODEL) {
    base.model = file.model;
  }
  return base;
}

/** 增量保存 `.helix/config.json`，保留已有字段并与 partial 浅合并。 */
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

/** 读取项目权限模式（default | acceptEdits | plan | auto）。 */
export async function loadPermissionMode(cwd: string): Promise<PermissionMode | undefined> {
  const config = await loadFileConfig(cwd);
  return config.permissionMode;
}

/** 持久化权限模式到 `.helix/config.json`。 */
export async function savePermissionMode(cwd: string, mode: PermissionMode): Promise<void> {
  await saveFileConfig(cwd, { permissionMode: mode });
}

/**
 * 识别 LLM Provider：优先读 HELIX_PROVIDER，其次根据 Base URL 推断 DeepSeek，默认 OpenAI。
 */
function normalizeProvider(value: string | undefined): LlmProvider {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'deepseek' || normalized === 'openai' || normalized === 'custom') return normalized;
  // Base URL 含 deepseek.com 时自动识别为 DeepSeek
  if (process.env.HELIX_BASE_URL?.toLowerCase().includes('deepseek.com')) return 'deepseek';
  return 'openai';
}

/** 按 Provider 优先级解析 API Key（各 Provider 环境变量顺序不同）。 */
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

/** 各 Provider 的默认模型与 API Base URL。 */
function providerDefaults(provider: LlmProvider): { model: string; baseURL: string } {
  if (provider === 'deepseek') {
    return { model: 'deepseek-chat', baseURL: 'https://api.deepseek.com' };
  }
  return { model: 'gpt-4o', baseURL: 'https://api.openai.com/v1' };
}

/**
 * 加载项目指令文件内容，注入 Agent 系统提示。
 * 合并 config.json 中声明的路径与默认路径（AGENTS.md、.helix/instructions.md），去重后依次读取。
 */
export async function loadProjectInstructions(cwd: string): Promise<ProjectInstruction[]> {
  const instructions: ProjectInstruction[] = [];

  // 优先使用 config.json 中配置的 instructions 路径
  const fileConfig = await loadFileConfig(cwd);
  const configPaths = fileConfig.instructions ?? [];

  // 默认路径始终尝试加载
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
