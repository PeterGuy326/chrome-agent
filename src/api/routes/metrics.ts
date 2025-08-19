/**
 * 指标监控路由
 * 提供系统性能和使用情况指标
 */

import { Router } from 'express';
import { getDefaultLogger } from '../../core/logger';
import { getDefaultEventBus } from '../../core/event-bus';
import { getDefaultTaskManager } from '../../core/task-manager';
import { getDefaultErrorHandler } from '../../core/error-handler';

const router = Router();
const logger = getDefaultLogger();

/**
 * 获取系统指标
 * GET /api/v1/metrics
 */
router.get('/', async (req, res) => {
  try {
    const taskManager = getDefaultTaskManager();
    const eventBus = getDefaultEventBus();
    const errorHandler = getDefaultErrorHandler();
    
    // 获取系统基础指标
    const systemMetrics = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: {
        ...process.memoryUsage(),
        percentage: (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100
      },
      cpu: {
        usage: process.cpuUsage()
      },
      version: {
        node: process.version,
        platform: process.platform,
        arch: process.arch
      }
    };
    
    // 获取任务统计
    const taskStats = await taskManager.getStats();
    
    // 获取事件总线统计
    const eventStats = eventBus.getStats();
    
    // 获取错误统计
    const errorStats = errorHandler.getErrorStats();
    
    const metrics = {
      system: systemMetrics,
      tasks: taskStats,
      events: eventStats,
      errors: errorStats
    };
    
    res.json(metrics);
    
  } catch (error: any) {
    logger.error('Failed to get metrics:', error);
    res.status(500).json({
      error: 'Failed to get metrics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 获取性能指标
 * GET /api/v1/metrics/performance
 */
router.get('/performance', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // 内存使用情况
    const memoryUsage = process.memoryUsage();
    const memoryMetrics = {
      heapUsed: memoryUsage.heapUsed,
      heapTotal: memoryUsage.heapTotal,
      heapPercentage: (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100,
      rss: memoryUsage.rss,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers
    };
    
    // CPU使用情况
    const cpuUsage = process.cpuUsage();
    const cpuMetrics = {
      user: cpuUsage.user,
      system: cpuUsage.system,
      total: cpuUsage.user + cpuUsage.system
    };
    
    // 事件循环延迟（简单估算）
    const eventLoopStart = Date.now();
    await new Promise(resolve => setImmediate(resolve));
    const eventLoopDelay = Date.now() - eventLoopStart;
    
    // GC统计（如果可用）
    let gcStats = null;
    try {
      if (global.gc) {
        const beforeGC = process.memoryUsage();
        global.gc();
        const afterGC = process.memoryUsage();
        gcStats = {
          beforeHeapUsed: beforeGC.heapUsed,
          afterHeapUsed: afterGC.heapUsed,
          freed: beforeGC.heapUsed - afterGC.heapUsed
        };
      }
    } catch (error) {
      // GC不可用
    }
    
    const responseTime = Date.now() - startTime;
    
    const performanceMetrics = {
      timestamp: new Date().toISOString(),
      memory: memoryMetrics,
      cpu: cpuMetrics,
      eventLoopDelay,
      gc: gcStats,
      responseTime,
      uptime: process.uptime()
    };
    
    res.json(performanceMetrics);
    
  } catch (error: any) {
    logger.error('Failed to get performance metrics:', error);
    res.status(500).json({
      error: 'Failed to get performance metrics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 获取任务指标
 * GET /api/v1/metrics/tasks
 */
router.get('/tasks', async (req, res) => {
  try {
    const taskManager = getDefaultTaskManager();
    const taskStats = await taskManager.getStats();
    
    // 添加更详细的任务指标
    const detailedStats = {
      ...taskStats,
      timestamp: new Date().toISOString(),
      averageExecutionTime: (taskStats as any).totalTasks > 0 
        ? ((taskStats as any).totalExecutionTime || 0) / (taskStats as any).totalTasks 
        : 0,
      successRate: (taskStats as any).totalTasks > 0 
        ? ((taskStats as any).completedTasks || 0) / (taskStats as any).totalTasks * 100 
        : 0,
      errorRate: (taskStats as any).totalTasks > 0 
        ? ((taskStats as any).failedTasks || 0) / (taskStats as any).totalTasks * 100 
        : 0
    };
    
    res.json(detailedStats);
    
  } catch (error: any) {
    logger.error('Failed to get task metrics:', error);
    res.status(500).json({
      error: 'Failed to get task metrics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 获取错误指标
 * GET /api/v1/metrics/errors
 */
router.get('/errors', async (req, res) => {
  try {
    const errorHandler = getDefaultErrorHandler();
    const errorStats = errorHandler.getErrorStats();
    
    // 添加错误趋势分析
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    
    const detailedErrorStats = {
      ...errorStats,
      timestamp: new Date().toISOString(),
      trends: {
        lastHour: {
          // 这里应该从实际的错误日志中统计
          count: 0,
          types: {}
        },
        lastDay: {
          count: 0,
          types: {}
        }
      }
    };
    
    res.json(detailedErrorStats);
    
  } catch (error: any) {
    logger.error('Failed to get error metrics:', error);
    res.status(500).json({
      error: 'Failed to get error metrics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 获取事件指标
 * GET /api/v1/metrics/events
 */
router.get('/events', async (req, res) => {
  try {
    const eventBus = getDefaultEventBus();
    const eventStats = eventBus.getStats();
    
    const detailedEventStats = {
      ...eventStats,
      timestamp: new Date().toISOString(),
      eventsPerSecond: eventStats.totalEvents > 0 && process.uptime() > 0
        ? eventStats.totalEvents / process.uptime()
        : 0
    };
    
    res.json(detailedEventStats);
    
  } catch (error: any) {
    logger.error('Failed to get event metrics:', error);
    res.status(500).json({
      error: 'Failed to get event metrics',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Prometheus格式的指标
 * GET /api/v1/metrics/prometheus
 */
router.get('/prometheus', async (req, res) => {
  try {
    const taskManager = getDefaultTaskManager();
    const eventBus = getDefaultEventBus();
    const errorHandler = getDefaultErrorHandler();
    
    const taskStats = await taskManager.getStats();
    const eventStats = eventBus.getStats();
    const errorStats = errorHandler.getErrorStats();
    const memoryUsage = process.memoryUsage();
    
    // 生成Prometheus格式的指标
    const prometheusMetrics = [
      '# HELP chrome_agent_uptime_seconds Process uptime in seconds',
      '# TYPE chrome_agent_uptime_seconds counter',
      `chrome_agent_uptime_seconds ${process.uptime()}`,
      '',
      '# HELP chrome_agent_memory_heap_used_bytes Memory heap used in bytes',
      '# TYPE chrome_agent_memory_heap_used_bytes gauge',
      `chrome_agent_memory_heap_used_bytes ${memoryUsage.heapUsed}`,
      '',
      '# HELP chrome_agent_memory_heap_total_bytes Memory heap total in bytes',
      '# TYPE chrome_agent_memory_heap_total_bytes gauge',
      `chrome_agent_memory_heap_total_bytes ${memoryUsage.heapTotal}`,
      '',
      '# HELP chrome_agent_tasks_total Total number of tasks',
      '# TYPE chrome_agent_tasks_total counter',
      `chrome_agent_tasks_total ${(taskStats as any).totalTasks || 0}`,
      '',
      '# HELP chrome_agent_tasks_completed_total Total number of completed tasks',
      '# TYPE chrome_agent_tasks_completed_total counter',
      `chrome_agent_tasks_completed_total ${(taskStats as any).completedTasks || 0}`,
      '',
      '# HELP chrome_agent_tasks_failed_total Total number of failed tasks',
      '# TYPE chrome_agent_tasks_failed_total counter',
      `chrome_agent_tasks_failed_total ${(taskStats as any).failedTasks || 0}`,
      '',
      '# HELP chrome_agent_events_total Total number of events',
      '# TYPE chrome_agent_events_total counter',
      `chrome_agent_events_total ${(eventStats as any).totalEvents || 0}`,
      '',
      '# HELP chrome_agent_errors_total Total number of errors',
      '# TYPE chrome_agent_errors_total counter',
      `chrome_agent_errors_total ${(errorStats as any).totalErrors || 0}`,
      ''
    ].join('\n');
    
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(prometheusMetrics);
    
  } catch (error: any) {
    logger.error('Failed to get Prometheus metrics:', error);
    res.status(500).send('# Error generating metrics\n');
  }
});

export { router as metricsRouter };
export default router;