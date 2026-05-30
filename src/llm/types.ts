export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface ChatProvider {
  complete(messages: ChatMessage[]): Promise<string>;
}
