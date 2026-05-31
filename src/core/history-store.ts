import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import type { ChatMessage } from '../llm/types.js';

const HISTORY_FILE = '.helix/history.json';
const MAX_SAVED = 40; // Keep up to 40 messages in the saved file

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

export async function saveHistory(cwd: string, messages: ChatMessage[]): Promise<void> {
  const target = resolve(cwd, HISTORY_FILE);
  await mkdir(dirname(target), { recursive: true });
  const session: SavedSession = {
    version: 1,
    savedAt: new Date().toISOString(),
    messages: messages.slice(-MAX_SAVED)
  };
  await writeFile(target, JSON.stringify(session, null, 2) + '\n', 'utf8');
}
