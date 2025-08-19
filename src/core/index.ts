/**
 * Chrome Agent 核心框架模块入口
 * 导出所有核心组件和类型
 */

// 类型定义
export * from './types';

// 核心组件
export * from './logger';
export * from './event-bus';
export * from './error-handler';
export * from './task-manager';

// 便捷函数
export {
  getDefaultLogger,
  setDefaultLogger
} from './logger';

export {
  getDefaultEventBus,
  setDefaultEventBus
} from './event-bus';

export {
  getDefaultErrorHandler,
  setDefaultErrorHandler
} from './error-handler';

export {
  getDefaultTaskManager,
  setDefaultTaskManager
} from './task-manager';