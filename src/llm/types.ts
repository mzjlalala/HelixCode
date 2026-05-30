export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatProvider {
  complete(messages: ChatMessage[]): Promise<string>;

  completeStream?(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: { signal?: AbortSignal }
  ): Promise<string>;
}
