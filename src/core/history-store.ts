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

  // Trim to max, but never break a tool call chain.
  // Walk backward from the slice point to find a safe cut.
  let trimmed = messages;
  if (trimmed.length > MAX_SAVED) {
    const end = trimmed.length;
    // Find the first safe position (not in the middle of tool messages following a tool_calls)
    // Start from end - MAX_SAVED and walk forward past any trailing tool messages
    let cutBefore = end - MAX_SAVED;
    for (let i = cutBefore; i < end; i++) {
      const m = trimmed[i];
      // Skip past tool messages — they belong to a preceding assistant
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
