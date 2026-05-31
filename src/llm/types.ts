export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string | null;
}

export type ChatResult =
  | { type: 'text'; content: string; reasoning_content?: string | null }
  | { type: 'tool_calls'; calls: ToolCall[]; content?: string | null; reasoning_content?: string | null };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  confirm?: boolean;
}

export interface ChatProvider {
  complete(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatResult>;

  completeStream?(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: { signal?: AbortSignal; tools?: ToolDefinition[]; onReasoning?: (token: string) => void }
  ): Promise<ChatResult>;
}
