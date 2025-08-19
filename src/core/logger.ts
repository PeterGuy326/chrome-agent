/**
 * 日志系统
 * 提供结构化日志记录功能
 */

import { LogLevel, LogEntry } from './types';

export class Logger {
  private logEntries: LogEntry[] = [];
  private maxEntries: number = 10000;
  private logLevel: LogLevel;
  private enableConsole: boolean;
  private enableFile: boolean;
  private logDir: string;

  constructor(options: {
    level?: LogLevel;
    logDir?: string;
    enableConsole?: boolean;
    enableFile?: boolean;
  } = {}) {
    this.logLevel = options.level || LogLevel.INFO;
    this.logDir = options.logDir || './logs';
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;

    // 确保日志目录存在
    if (this.enableFile) {
      this.ensureLogDir();
    }
  }

  /**
   * 记录调试信息
   */
  debug(message: string, data?: any, stepId?: string): void {
    this.log(LogLevel.DEBUG, message, data, stepId);
  }

  /**
   * 记录一般信息
   */
  info(message: string, data?: any, stepId?: string): void {
    this.log(LogLevel.INFO, message, data, stepId);
  }

  /**
   * 记录警告信息
   */
  warn(message: string, data?: any, stepId?: string): void {
    this.log(LogLevel.WARN, message, data, stepId);
  }

  /**
   * 记录错误信息
   */
  error(message: string, error?: Error | any, stepId?: string): void {
    const data = error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack
    } : error;
    
    this.log(LogLevel.ERROR, message, data, stepId);
  }

  /**
   * 通用日志记录方法
   */
  private log(level: LogLevel, message: string, data?: any, stepId?: string): void {
    // 检查日志级别
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      message,
      stepId,
      data
    };

    // 添加到内存日志
    this.addToMemory(entry);

    // 控制台输出
    if (this.enableConsole) {
      this.logToConsole(entry);
    }

    // 文件输出
    if (this.enableFile) {
      this.logToFile(entry);
    }
  }

  /**
   * 记录步骤开始
   */
  stepStart(stepId: string, description: string, data?: any): void {
    this.info(`Step started: ${description}`, data, stepId);
  }

  /**
   * 记录步骤完成
   */
  stepComplete(stepId: string, description: string, duration: number, data?: any): void {
    this.info(`Step completed: ${description} (${duration}ms)`, data, stepId);
  }

  /**
   * 记录步骤失败
   */
  stepFailed(stepId: string, description: string, error: Error, data?: any): void {
    this.error(`Step failed: ${description}`, error, stepId);
  }

  /**
   * 获取日志条目
   */
  getEntries(filter?: {
    level?: LogLevel;
    stepId?: string;
    since?: Date;
    limit?: number;
  }): LogEntry[] {
    let entries = [...this.logEntries];

    if (filter) {
      if (filter.level) {
        entries = entries.filter(e => e.level === filter.level);
      }
      if (filter.stepId) {
        entries = entries.filter(e => e.stepId === filter.stepId);
      }
      if (filter.since) {
        entries = entries.filter(e => e.timestamp >= filter.since!);
      }
      if (filter.limit) {
        entries = entries.slice(-filter.limit);
      }
    }

    return entries;
  }

  /**
   * 清空内存日志
   */
  clearMemory(): void {
    this.logEntries = [];
  }

  /**
   * 获取日志统计
   */
  getStats(): {
    totalEntries: number;
    entriesByLevel: Record<string, number>;
    entriesByStep: Record<string, number>;
  } {
    const entriesByLevel: Record<string, number> = {};
    const entriesByStep: Record<string, number> = {};

    this.logEntries.forEach(entry => {
      entriesByLevel[entry.level] = (entriesByLevel[entry.level] || 0) + 1;
      if (entry.stepId) {
        entriesByStep[entry.stepId] = (entriesByStep[entry.stepId] || 0) + 1;
      }
    });

    return {
      totalEntries: this.logEntries.length,
      entriesByLevel,
      entriesByStep
    };
  }

  /**
   * 检查是否应该记录该级别的日志
   */
  private shouldLog(level: LogLevel): boolean {
    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR];
    const currentIndex = levels.indexOf(this.logLevel);
    const messageIndex = levels.indexOf(level);
    return messageIndex >= currentIndex;
  }

  /**
   * 添加到内存日志
   */
  private addToMemory(entry: LogEntry): void {
    this.logEntries.push(entry);
    
    // 限制内存日志大小
    if (this.logEntries.length > this.maxEntries) {
      this.logEntries = this.logEntries.slice(-this.maxEntries);
    }
  }

  /**
   * 控制台输出
   */
  private logToConsole(entry: LogEntry): void {
    const timestamp = entry.timestamp.toISOString();
    const stepInfo = entry.stepId ? `[${entry.stepId}]` : '';
    const dataStr = entry.data ? ` ${JSON.stringify(this.sanitizeData(entry.data))}` : '';
    const message = `${timestamp} [${entry.level.toUpperCase()}]${stepInfo}: ${entry.message}${dataStr}`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(message);
        break;
      case LogLevel.INFO:
        console.info(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
        console.error(message);
        break;
    }
  }

  /**
   * 文件输出
   */
  private logToFile(entry: LogEntry): void {
    try {
      const fs = require('fs');
      const path = require('path');
      
      const logData = {
        timestamp: entry.timestamp.toISOString(),
        level: entry.level,
        message: entry.message,
        stepId: entry.stepId,
        data: this.sanitizeData(entry.data)
      };

      const logLine = JSON.stringify(logData) + '\n';
      const logFile = path.join(this.logDir, 'combined.log');
      
      fs.appendFileSync(logFile, logLine, 'utf8');

      // 错误日志单独记录
      if (entry.level === LogLevel.ERROR) {
        const errorFile = path.join(this.logDir, 'error.log');
        fs.appendFileSync(errorFile, logLine, 'utf8');
      }
    } catch (error) {
      console.error('Failed to write log to file:', error);
    }
  }

  /**
   * 确保日志目录存在
   */
  private ensureLogDir(): void {
    try {
      const fs = require('fs');
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error);
    }
  }

  /**
   * 清理敏感数据
   */
  private sanitizeData(data: any): any {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = { ...data };
    const sensitiveKeys = ['password', 'token', 'key', 'secret', 'auth', 'apiKey'];
    
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some(sensitive => key.toLowerCase().includes(sensitive))) {
        sanitized[key] = '[REDACTED]';
      }
    }

    return sanitized;
  }

  /**
   * 销毁日志器
   */
  destroy(): void {
    this.clearMemory();
  }
}

// 默认日志器实例
let defaultLogger: Logger | null = null;

export function getDefaultLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger();
  }
  return defaultLogger;
}

export function setDefaultLogger(logger: Logger): void {
  defaultLogger = logger;
}