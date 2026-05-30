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
}

export type ChatResult =
  | { type: 'text'; content: string }
  | { type: 'tool_calls'; calls: ToolCall[] };

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  confirm?: boolean; // true = requires user confirmation
}

export interface ChatProvider {
  complete(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<ChatResult>;

  completeStream?(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: { signal?: AbortSignal }
  ): Promise<string>;
}
