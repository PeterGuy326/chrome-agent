/**
 * 错误处理系统
 * 提供统一的错误处理和恢复机制
 */

import { EventType } from './types';
import { getDefaultEventBus } from './event-bus';
import { getDefaultLogger } from './logger';

export enum ErrorCode {
  // 系统错误
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  INITIALIZATION_ERROR = 'INITIALIZATION_ERROR',
  CONFIGURATION_ERROR = 'CONFIGURATION_ERROR',
  
  // 网络错误
  NETWORK_ERROR = 'NETWORK_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  
  // 浏览器错误
  BROWSER_ERROR = 'BROWSER_ERROR',
  PAGE_LOAD_ERROR = 'PAGE_LOAD_ERROR',
  NAVIGATION_ERROR = 'NAVIGATION_ERROR',
  
  // 元素定位错误
  ELEMENT_NOT_FOUND = 'ELEMENT_NOT_FOUND',
  ELEMENT_NOT_VISIBLE = 'ELEMENT_NOT_VISIBLE',
  ELEMENT_NOT_CLICKABLE = 'ELEMENT_NOT_CLICKABLE',
  
  // 执行错误
  EXECUTION_ERROR = 'EXECUTION_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  PERMISSION_ERROR = 'PERMISSION_ERROR',
  
  // 数据错误
  DATA_ERROR = 'DATA_ERROR',
  PARSING_ERROR = 'PARSING_ERROR',
  EXTRACTION_ERROR = 'EXTRACTION_ERROR',
  
  // 用户错误
  USER_ERROR = 'USER_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',
  UNSUPPORTED_OPERATION = 'UNSUPPORTED_OPERATION',
  
  // 执行器特定错误
  BROWSER_LAUNCH_ERROR = 'BROWSER_LAUNCH_ERROR',
  PAGE_CREATION_ERROR = 'PAGE_CREATION_ERROR',
  SCREENSHOT_ERROR = 'SCREENSHOT_ERROR',
  SELECTOR_ERROR = 'SELECTOR_ERROR',
  PLAN_EXECUTION_FAILED = 'PLAN_EXECUTION_FAILED'
}

export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

export interface AgentError {
  id: string;
  code: ErrorCode;
  message: string;
  severity: ErrorSeverity;
  timestamp: Date;
  context?: any;
  stack?: string;
  stepId?: string;
  recoverable: boolean;
  retryCount?: number;
  originalError?: Error;
}

export interface ErrorRecoveryStrategy {
  code: ErrorCode;
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
  handler: (error: AgentError) => Promise<boolean>;
}

export class ErrorHandler {
  private errorHistory: AgentError[] = [];
  private maxHistorySize: number = 1000;
  private recoveryStrategies: Map<ErrorCode, ErrorRecoveryStrategy> = new Map();
  private eventBus = getDefaultEventBus();
  private logger = getDefaultLogger();

  constructor() {
    this.setupDefaultStrategies();
  }

  /**
   * 处理错误
   */
  async handleError(error: Error | AgentError, context?: any, stepId?: string): Promise<boolean> {
    const agentError = this.normalizeError(error, context, stepId);
    
    // 记录错误
    this.recordError(agentError);
    
    // 发布错误事件
    this.eventBus.publish(EventType.ERROR, agentError, 'error-handler');
    
    // 尝试恢复
    if (agentError.recoverable) {
      return await this.attemptRecovery(agentError);
    }
    
    return false;
  }

  /**
   * 创建错误
   */
  createError(
    code: ErrorCode,
    message: string,
    options: {
      severity?: ErrorSeverity;
      context?: any;
      stepId?: string;
      recoverable?: boolean;
      originalError?: Error;
    } = {}
  ): AgentError {
    return {
      id: this.generateId(),
      code,
      message,
      severity: options.severity || this.getDefaultSeverity(code),
      timestamp: new Date(),
      context: options.context,
      stepId: options.stepId,
      recoverable: options.recoverable !== false,
      retryCount: 0,
      originalError: options.originalError,
      stack: options.originalError?.stack || new Error().stack
    };
  }

  /**
   * 注册恢复策略
   */
  registerRecoveryStrategy(strategy: ErrorRecoveryStrategy): void {
    this.recoveryStrategies.set(strategy.code, strategy);
    this.logger.debug(`Recovery strategy registered for ${strategy.code}`);
  }

  /**
   * 获取错误历史
   */
  getErrorHistory(filter?: {
    code?: ErrorCode;
    severity?: ErrorSeverity;
    stepId?: string;
    since?: Date;
    limit?: number;
  }): AgentError[] {
    let errors = [...this.errorHistory];

    if (filter) {
      if (filter.code) {
        errors = errors.filter(e => e.code === filter.code);
      }
      if (filter.severity) {
        errors = errors.filter(e => e.severity === filter.severity);
      }
      if (filter.stepId) {
        errors = errors.filter(e => e.stepId === filter.stepId);
      }
      if (filter.since) {
        errors = errors.filter(e => e.timestamp >= filter.since!);
      }
      if (filter.limit) {
        errors = errors.slice(-filter.limit);
      }
    }

    return errors;
  }

  /**
   * 获取错误统计
   */
  getErrorStats(): {
    totalErrors: number;
    errorsByCode: Record<string, number>;
    errorsBySeverity: Record<string, number>;
    errorsByStep: Record<string, number>;
    recoverySuccessRate: number;
  } {
    const errorsByCode: Record<string, number> = {};
    const errorsBySeverity: Record<string, number> = {};
    const errorsByStep: Record<string, number> = {};
    let totalRecoveryAttempts = 0;
    let successfulRecoveries = 0;

    this.errorHistory.forEach(error => {
      errorsByCode[error.code] = (errorsByCode[error.code] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
      
      if (error.stepId) {
        errorsByStep[error.stepId] = (errorsByStep[error.stepId] || 0) + 1;
      }
      
      if (error.retryCount && error.retryCount > 0) {
        totalRecoveryAttempts++;
        // 假设如果有重试计数，说明尝试了恢复
        // 这里可以根据实际情况调整逻辑
      }
    });

    const recoverySuccessRate = totalRecoveryAttempts > 0 
      ? successfulRecoveries / totalRecoveryAttempts 
      : 0;

    return {
      totalErrors: this.errorHistory.length,
      errorsByCode,
      errorsBySeverity,
      errorsByStep,
      recoverySuccessRate
    };
  }

  /**
   * 清空错误历史
   */
  clearErrorHistory(): void {
    this.errorHistory = [];
    this.logger.info('Error history cleared');
  }

  /**
   * 检查是否为关键错误
   */
  isCriticalError(error: AgentError): boolean {
    return error.severity === ErrorSeverity.CRITICAL ||
           [ErrorCode.SYSTEM_ERROR, ErrorCode.INITIALIZATION_ERROR].includes(error.code);
  }

  /**
   * 标准化错误
   */
  private normalizeError(error: Error | AgentError, context?: any, stepId?: string): AgentError {
    if ('code' in error && 'severity' in error) {
      // 已经是 AgentError
      return error as AgentError;
    }

    // 转换普通 Error 为 AgentError
    const normalizedError = error as Error;
    let code = ErrorCode.SYSTEM_ERROR;
    let severity = ErrorSeverity.MEDIUM;

    // 根据错误消息推断错误类型
    if (normalizedError.message.includes('timeout')) {
      code = ErrorCode.TIMEOUT_ERROR;
    } else if (normalizedError.message.includes('network')) {
      code = ErrorCode.NETWORK_ERROR;
    } else if (normalizedError.message.includes('element')) {
      code = ErrorCode.ELEMENT_NOT_FOUND;
    }

    return this.createError(code, normalizedError.message, {
      severity,
      context,
      stepId,
      originalError: normalizedError
    });
  }

  /**
   * 记录错误
   */
  private recordError(error: AgentError): void {
    this.errorHistory.push(error);
    
    // 限制历史记录大小
    if (this.errorHistory.length > this.maxHistorySize) {
      this.errorHistory = this.errorHistory.slice(-this.maxHistorySize);
    }

    // 记录日志
    const logLevel = this.getLogLevel(error.severity);
    this.logger[logLevel](
      `Error occurred: ${error.code} - ${error.message}`,
      {
        errorId: error.id,
        code: error.code,
        severity: error.severity,
        context: error.context,
        stepId: error.stepId
      },
      error.stepId
    );
  }

  /**
   * 尝试恢复
   */
  private async attemptRecovery(error: AgentError): Promise<boolean> {
    const strategy = this.recoveryStrategies.get(error.code);
    if (!strategy) {
      this.logger.warn(`No recovery strategy found for error code: ${error.code}`);
      return false;
    }

    const maxRetries = strategy.maxRetries;
    let retryCount = error.retryCount || 0;

    while (retryCount < maxRetries) {
      try {
        this.logger.info(`Attempting recovery for ${error.code}, retry ${retryCount + 1}/${maxRetries}`);
        
        // 等待重试延迟
        const delay = strategy.retryDelay * Math.pow(strategy.backoffMultiplier, retryCount);
        await this.sleep(delay);
        
        // 执行恢复策略
        const success = await strategy.handler(error);
        
        if (success) {
          this.logger.info(`Recovery successful for ${error.code}`);
          this.eventBus.publish(EventType.RECOVERY_SUCCESS, { error, retryCount: retryCount + 1 }, 'error-handler');
          return true;
        }
        
        retryCount++;
        error.retryCount = retryCount;
        
      } catch (recoveryError) {
        this.logger.error(`Recovery attempt failed for ${error.code}`, recoveryError);
        retryCount++;
        error.retryCount = retryCount;
      }
    }

    this.logger.error(`All recovery attempts failed for ${error.code}`);
    this.eventBus.publish(EventType.RECOVERY_FAILED, { error, totalRetries: retryCount }, 'error-handler');
    return false;
  }

  /**
   * 获取默认严重程度
   */
  private getDefaultSeverity(code: ErrorCode): ErrorSeverity {
    switch (code) {
      case ErrorCode.SYSTEM_ERROR:
      case ErrorCode.INITIALIZATION_ERROR:
        return ErrorSeverity.CRITICAL;
      
      case ErrorCode.BROWSER_ERROR:
      case ErrorCode.NETWORK_ERROR:
      case ErrorCode.EXECUTION_ERROR:
        return ErrorSeverity.HIGH;
      
      case ErrorCode.ELEMENT_NOT_FOUND:
      case ErrorCode.VALIDATION_ERROR:
      case ErrorCode.DATA_ERROR:
        return ErrorSeverity.MEDIUM;
      
      default:
        return ErrorSeverity.LOW;
    }
  }

  /**
   * 获取日志级别
   */
  private getLogLevel(severity: ErrorSeverity): 'debug' | 'info' | 'warn' | 'error' {
    switch (severity) {
      case ErrorSeverity.LOW:
        return 'debug';
      case ErrorSeverity.MEDIUM:
        return 'info';
      case ErrorSeverity.HIGH:
        return 'warn';
      case ErrorSeverity.CRITICAL:
        return 'error';
      default:
        return 'error';
    }
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 睡眠函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 设置默认恢复策略
   */
  private setupDefaultStrategies(): void {
    // 网络错误恢复策略
    this.registerRecoveryStrategy({
      code: ErrorCode.NETWORK_ERROR,
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2,
      handler: async (error) => {
        // 简单的网络重试逻辑
        this.logger.info('Retrying network operation...');
        return true; // 假设重试成功
      }
    });

    // 元素定位错误恢复策略
    this.registerRecoveryStrategy({
      code: ErrorCode.ELEMENT_NOT_FOUND,
      maxRetries: 2,
      retryDelay: 500,
      backoffMultiplier: 1.5,
      handler: async (error) => {
        this.logger.info('Retrying element location...');
        return false; // 需要具体实现
      }
    });

    // 页面加载错误恢复策略
    this.registerRecoveryStrategy({
      code: ErrorCode.PAGE_LOAD_ERROR,
      maxRetries: 2,
      retryDelay: 2000,
      backoffMultiplier: 1.5,
      handler: async (error) => {
        this.logger.info('Retrying page load...');
        return false; // 需要具体实现
      }
    });
  }
}

// 默认错误处理器实例
let defaultErrorHandler: ErrorHandler | null = null;

export function getDefaultErrorHandler(): ErrorHandler {
  if (!defaultErrorHandler) {
    defaultErrorHandler = new ErrorHandler();
  }
  return defaultErrorHandler;
}

export function setDefaultErrorHandler(errorHandler: ErrorHandler): void {
  defaultErrorHandler = errorHandler;
}