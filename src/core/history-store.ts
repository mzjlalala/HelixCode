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
