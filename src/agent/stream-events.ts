/** Agent 流式 UI 事件类型（CLI 与 Agent 共用） */

export interface ToolCallStreamEvent {
  index: number;
  name?: string;
  argumentsDelta: string;
  argumentsSoFar: string;
}

export interface ToolActivityEvent {
  phase: 'start' | 'end';
  tool: string;
  summary?: string;
  ms?: number;
}
