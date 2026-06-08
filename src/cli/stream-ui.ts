/**
 * Agent 流式输出 UI
 *
 * - 正文 token：识别 markdown 代码块并加轻量样式
 * - tool_calls 参数流：write_file / edit_file 等生成代码时增量展示
 * - 工具执行：read_file 等安全工具的开始/结束提示
 */

import { style, SYMBOL } from './style.js';
import { extractPartialJsonStringField, toolStreamContentField } from './json-stream.js';
import type { ToolActivityEvent, ToolCallStreamEvent } from '../agent/stream-events.js';

export type { ToolActivityEvent, ToolCallStreamEvent } from '../agent/stream-events.js';

export type WriteFn = (text: string) => void;

/** 终端 Agent 流式反馈渲染器 */
export class AgentStreamUI {
  private inCodeFence = false;
  private fenceLang = '';
  private toolHeaderShown = false;
  private toolStreamName = '';
  private toolStreamPath = '';
  private toolStreamDisplayedLen = 0;
  private lastOutput: 'reasoning' | 'content' | 'tool' | null = null;

  /** 本轮是否已通过 tool 流展示过代码（确认 UI 可跳过重复 diff） */
  toolPreviewStreamed = false;

  constructor(private readonly write: WriteFn) {}

  beginLlmRound(): void {
    this.toolHeaderShown = false;
    this.toolStreamName = '';
    this.toolStreamPath = '';
    this.toolStreamDisplayedLen = 0;
  }

  reset(): void {
    this.inCodeFence = false;
    this.fenceLang = '';
    this.toolHeaderShown = false;
    this.toolStreamName = '';
    this.toolStreamPath = '';
    this.toolStreamDisplayedLen = 0;
    this.lastOutput = null;
    this.toolPreviewStreamed = false;
  }

  /** 流式正文 token */
  handleContentToken(token: string): void {
    if (!token) return;

    let rest = token;
    while (rest.length > 0) {
      if (!this.inCodeFence) {
        const fenceIdx = rest.indexOf('```');
        if (fenceIdx === -1) {
          this.writeContent(rest);
          break;
        }
        if (fenceIdx > 0) this.writeContent(rest.slice(0, fenceIdx));
        const afterFence = rest.slice(fenceIdx + 3);
        const lineEnd = afterFence.indexOf('\n');
        this.fenceLang = lineEnd === -1 ? afterFence.trim() : afterFence.slice(0, lineEnd).trim();
        this.inCodeFence = true;
        this.write('\n');
        this.write(`${style.dim(`── ${this.fenceLang || 'code'} ──`)}\n`);
        rest = lineEnd === -1 ? '' : afterFence.slice(lineEnd + 1);
        continue;
      }

      const closeIdx = rest.indexOf('```');
      if (closeIdx === -1) {
        this.writeCode(rest);
        break;
      }
      if (closeIdx > 0) this.writeCode(rest.slice(0, closeIdx));
      this.inCodeFence = false;
      this.write(`\n${style.dim('────────')}\n`);
      rest = rest.slice(closeIdx + 3);
    }
  }

  /** 流式 reasoning */
  handleReasoning(text: string): void {
    if (!text) return;
    if (this.lastOutput === 'content' || this.lastOutput === 'tool') this.write('\n');
    this.lastOutput = 'reasoning';
    this.write(`\x1b[2m\x1b[3m${text}\x1b[0m`);
  }

  /** tool_calls JSON 参数增量（写文件时逐字显示代码） */
  handleToolCallDelta(event: ToolCallStreamEvent): void {
    const name = event.name || this.toolStreamName;
    if (event.name) this.toolStreamName = event.name;

    const contentField = toolStreamContentField(name);
    if (!contentField) return;

    const path = extractPartialJsonStringField(event.argumentsSoFar, 'path');
    if (path) this.toolStreamPath = path;

    if (!this.toolHeaderShown && name) {
      this.toolHeaderShown = true;
      if (this.lastOutput === 'reasoning') this.write('\n');
      this.lastOutput = 'tool';
      const label = this.toolStreamPath
        ? `${name.replace(/_/g, ' ')}  ${this.toolStreamPath}`
        : name.replace(/_/g, ' ');
      this.write(`${style.cyan(`${SYMBOL.arrow} ${label}`)}\n`);
    }

    const content = extractPartialJsonStringField(event.argumentsSoFar, contentField);
    if (content.length <= this.toolStreamDisplayedLen) return;

    const delta = content.slice(this.toolStreamDisplayedLen);
    this.toolStreamDisplayedLen = content.length;
    this.toolPreviewStreamed = true;
    this.writeCode(delta);
  }

  /** 安全工具执行开始/结束 */
  handleToolActivity(event: ToolActivityEvent): void {
    if (event.phase === 'start') {
      const label = event.summary ?? event.tool.replace(/_/g, ' ');
      this.write(`${style.dim(`${SYMBOL.bullet} ${label}…`)}\n`);
      return;
    }
    if (event.ms !== undefined && event.ms >= 400) {
      this.write(`${style.dim(`  ${event.tool} ${(event.ms / 1000).toFixed(1)}s`)}\n`);
    }
  }

  private writeContent(text: string): void {
    if (!text) return;
    this.lastOutput = 'content';
    this.write(text);
  }

  private writeCode(text: string): void {
    if (!text) return;
    this.lastOutput = 'tool';
    if (process.stdout.isTTY) {
      this.write(`\x1b[38;5;252m${text}\x1b[0m`);
    } else {
      this.write(text);
    }
  }
}
