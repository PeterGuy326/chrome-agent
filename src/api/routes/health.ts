/**
 * 健康检查路由
 * 提供系统健康状态检查接口
 */

import { Router } from 'express';
import { getDefaultLogger } from '../../core/logger';
import { getDefaultEventBus } from '../../core/event-bus';
import { getDefaultErrorHandler } from '../../core/error-handler';
import { getDefaultExecutor } from '../../executor';

const router = Router();
const logger = getDefaultLogger();
const eventBus = getDefaultEventBus();
const errorHandler = getDefaultErrorHandler();

/**
 * 基础健康检查
 */
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // 检查各个组件状态
    const checks = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      version: process.version,
      status: 'healthy'
    };

    const responseTime = Date.now() - startTime;
    
    res.json({
      status: 'ok',
      checks,
      responseTime: `${responseTime}ms`
    });
    
  } catch (error) {
    logger.error('Health check failed:', error);
    res.status(503).json({
      status: 'error',
      error: 'Health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 详细健康检查
 */
router.get('/detailed', async (req, res) => {
  try {
    const startTime = Date.now();
    
    // 检查浏览器状态
    let browserStatus = 'unknown';
    try {
      const executor = getDefaultExecutor();
      const browserInfo = await executor.getBrowserInfo();
      browserStatus = browserInfo ? 'healthy' : 'not_initialized';
    } catch (error) {
      browserStatus = 'error';
    }
    
    // 检查事件总线状态
    const eventBusStats = eventBus.getStats();
    
    // 检查错误处理器状态
    const errorStats = errorHandler.getErrorStats();
    
    const checks = {
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
      },
      components: {
        browser: {
          status: browserStatus
        },
        eventBus: {
          status: 'healthy',
          stats: eventBusStats
        },
        errorHandler: {
          status: 'healthy',
          stats: errorStats
        }
      }
    };

    const responseTime = Date.now() - startTime;
    
    // 判断整体健康状态
    const overallStatus = browserStatus === 'error' ? 'degraded' : 'healthy';
    
    res.json({
      status: overallStatus,
      checks,
      responseTime: `${responseTime}ms`
    });
    
  } catch (error) {
    logger.error('Detailed health check failed:', error);
    res.status(503).json({
      status: 'error',
      error: 'Detailed health check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 就绪检查
 */
router.get('/ready', async (req, res) => {
  try {
    // 检查关键组件是否就绪
    const checks = [];
    
    // 检查浏览器是否可用
    try {
      const executor = getDefaultExecutor();
      await executor.getBrowserInfo();
      checks.push({ component: 'browser', status: 'ready' });
    } catch (error: any) {
      checks.push({ component: 'browser', status: 'not_ready', error: error.message });
    }
    
    // 检查事件总线
    try {
      eventBus.getStats();
      checks.push({ component: 'eventBus', status: 'ready' });
    } catch (error: any) {
      checks.push({ component: 'eventBus', status: 'not_ready', error: error.message });
    }
    
    const allReady = checks.every(check => check.status === 'ready');
    
    if (allReady) {
      res.json({
        status: 'ready',
        checks,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        checks,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    logger.error('Readiness check failed:', error);
    res.status(503).json({
      status: 'error',
      error: 'Readiness check failed',
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 存活检查
 */
router.get('/live', (req, res) => {
  // 简单的存活检查，只要进程在运行就返回成功
  res.json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export { router as healthRouter };
export default router;