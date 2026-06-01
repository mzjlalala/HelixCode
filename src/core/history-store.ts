/**
 * 会话历史持久化
 * 将对话消息保存到 .helix/history.json，下次启动 REPL 时恢复
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { ChatMessage } from '../llm/types.js';
import { DEFAULT_MAX_HISTORY_MESSAGES } from './constants.js';

const HISTORY_FILE = '.helix/history.json';

export interface SavedSession {
  version: 1;
  savedAt: string;
  messages: ChatMessage[];
}

/** 从磁盘加载历史；文件不存在或格式错误时返回空数组 */
export async function loadHistory(cwd: string): Promise<ChatMessage[]> {
  try {
    const content = await readFile(resolve(cwd, HISTORY_FILE), 'utf8');
    const session = JSON.parse(content) as SavedSession;
    if (session.version === 1 && Array.isArray(session.messages)) {
      return session.messages;
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * 保存历史到磁盘
 * 裁剪时避免在 tool 消息中间截断（会破坏 tool_calls 与 tool 结果的配对）
 */
export async function saveHistory(
  cwd: string,
  messages: ChatMessage[],
  maxSaved = DEFAULT_MAX_HISTORY_MESSAGES
): Promise<void> {
  const target = resolve(cwd, HISTORY_FILE);
  await mkdir(dirname(target), { recursive: true });

  let trimmed = messages;
  if (trimmed.length > maxSaved) {
    const end = trimmed.length;
    let cutBefore = end - maxSaved;
    // 从截断点向前跳过孤立的 tool 消息（其对应的 assistant tool_calls 已被裁掉）
    for (let i = cutBefore; i < end; i += 1) {
      const m = trimmed[i];
      if (m?.role === 'tool') {
        cutBefore = i + 1;
      } else {
        break;
      }
    }
    trimmed = trimmed.slice(cutBefore);
  }

  const session: SavedSession = {
    version: 1,
    savedAt: new Date().toISOString(),
    messages: trimmed
  };
  await writeFile(target, JSON.stringify(session, null, 2) + '\n', 'utf8');
}
