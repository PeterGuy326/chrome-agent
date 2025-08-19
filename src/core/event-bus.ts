/**
 * 事件总线
 * 提供模块间解耦通信机制
 */

import { EventType } from './types';

interface AgentEvent {
  id: string;
  type: EventType;
  timestamp: Date;
  data?: any;
  source?: string;
}

interface EventStats {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySource: Record<string, number>;
  averageEventsPerMinute: number;
}

// 简单的事件发射器实现
class SimpleEventEmitter {
  private events: Map<string, Function[]> = new Map();

  on(event: string, listener: Function): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener);
  }

  once(event: string, listener: Function): void {
    const onceWrapper = (...args: any[]) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    this.on(event, onceWrapper);
  }

  emit(event: string, ...args: any[]): void {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(...args);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      });
    }
  }

  off(event: string, listener: Function): void {
    const listeners = this.events.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  listenerCount(event: string): number {
    const listeners = this.events.get(event);
    return listeners ? listeners.length : 0;
  }
}

export class EventBus {
  private emitter: SimpleEventEmitter;
  private eventHistory: AgentEvent[] = [];
  private maxHistorySize: number = 1000;
  private cleanupTimer: any;
  private cleanupInterval: number = 5 * 60 * 1000; // 5分钟

  constructor() {
    this.emitter = new SimpleEventEmitter();
    this.startCleanup();
  }

  /**
   * 发布事件
   */
  publish(type: EventType, data?: any, source?: string): string {
    const event: AgentEvent = {
      id: this.generateId(),
      type,
      timestamp: new Date(),
      data,
      source: source || 'unknown'
    };

    // 添加到历史记录
    this.addToHistory(event);

    // 发射事件
    this.emitter.emit(type, event);
    this.emitter.emit('*', event); // 通配符事件

    return event.id;
  }

  /**
   * 发布事件（publish的别名）
   */
  emit(type: EventType, data?: any, source?: string): string {
    return this.publish(type, data, source);
  }

  /**
   * 订阅事件
   */
  subscribe(type: EventType | '*', handler: (event: AgentEvent) => void): () => void {
    this.emitter.on(type, handler);
    
    // 返回取消订阅函数
    return () => {
      this.emitter.off(type, handler);
    };
  }

  /**
   * 一次性订阅事件
   */
  subscribeOnce(type: EventType | '*', handler: (event: AgentEvent) => void): void {
    this.emitter.once(type, handler);
  }

  /**
   * 取消订阅
   */
  unsubscribe(type: EventType | '*', handler: (event: AgentEvent) => void): void {
    this.emitter.off(type, handler);
  }

  /**
   * 获取事件历史
   */
  getHistory(filter?: {
    type?: EventType;
    source?: string;
    since?: Date;
    limit?: number;
  }): AgentEvent[] {
    let events = [...this.eventHistory];

    if (filter) {
      if (filter.type) {
        events = events.filter(e => e.type === filter.type);
      }
      if (filter.source) {
        events = events.filter(e => e.source === filter.source);
      }
      if (filter.since) {
        events = events.filter(e => e.timestamp >= filter.since!);
      }
      if (filter.limit) {
        events = events.slice(-filter.limit);
      }
    }

    return events;
  }

  /**
   * 清空事件历史
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * 获取事件统计
   */
  getStats(): EventStats {
    const eventsByType: Record<string, number> = {};
    const eventsBySource: Record<string, number> = {};
    
    this.eventHistory.forEach(event => {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
      if (event.source) {
        eventsBySource[event.source] = (eventsBySource[event.source] || 0) + 1;
      }
    });

    // 计算平均每分钟事件数
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const recentEvents = this.eventHistory.filter(e => e.timestamp >= oneHourAgo);
    const averageEventsPerMinute = recentEvents.length / 60;

    return {
      totalEvents: this.eventHistory.length,
      eventsByType,
      eventsBySource,
      averageEventsPerMinute
    };
  }

  /**
   * 获取监听器数量
   */
  getListenerCount(type: EventType | '*'): number {
    return this.emitter.listenerCount(type);
  }

  /**
   * 等待特定事件
   */
  waitForEvent(type: EventType, timeout?: number): Promise<AgentEvent> {
    return new Promise((resolve, reject) => {
      let timeoutId: any;
      
      const handler = (event: AgentEvent) => {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        resolve(event);
      };

      this.subscribeOnce(type, handler);

      if (timeout) {
        timeoutId = setTimeout(() => {
          this.unsubscribe(type, handler);
          reject(new Error(`Timeout waiting for event: ${type}`));
        }, timeout);
      }
    });
  }

  /**
   * 销毁事件总线
   */
  destroy(): void {
    // 清理定时器
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }

    // 移除所有监听器
    this.emitter.removeAllListeners();

    // 清空历史记录
    this.clearHistory();
  }

  /**
   * 添加到历史记录
   */
  private addToHistory(event: AgentEvent): void {
    this.eventHistory.push(event);
    
    // 限制历史记录大小
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory = this.eventHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 开始清理任务
   */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupOldEvents();
    }, this.cleanupInterval);
  }

  /**
   * 清理旧事件
   */
  private cleanupOldEvents(): void {
    const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24小时前
    this.eventHistory = this.eventHistory.filter(event => event.timestamp > cutoffTime);
  }
}

// 默认事件总线实例
let defaultEventBus: EventBus | null = null;

export function getDefaultEventBus(): EventBus {
  if (!defaultEventBus) {
    defaultEventBus = new EventBus();
  }
  return defaultEventBus;
}

export function setDefaultEventBus(eventBus: EventBus): void {
  defaultEventBus = eventBus;
}