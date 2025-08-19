/**
 * 模型信息路由
 * 兼容 Open WebUI 的模型接口规范
 */

import { Router } from 'express';
import { getDefaultLogger } from '../../core/logger';

const router = Router();
const logger = getDefaultLogger();

/**
 * 获取可用模型列表
 * GET /api/v1/models
 */
router.get('/', (req, res) => {
  try {
    const models = {
      object: 'list',
      data: [
        {
          id: 'chrome-agent-v1',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'chrome-agent',
          permission: [],
          root: 'chrome-agent-v1',
          parent: null,
          capabilities: {
            web_automation: true,
            data_extraction: true,
            screenshot: true,
            navigation: true,
            form_filling: true,
            element_interaction: true
          },
          description: 'Chrome Agent - Web Automation and Data Extraction Model',
          version: '1.0.0',
          max_tokens: 4096,
          context_window: 8192
        }
      ]
    };

    res.json(models);
    
  } catch (error: any) {
    logger.error('Failed to get models:', error);
    res.status(500).json({
      error: 'Failed to get models',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 获取特定模型信息
 * GET /api/v1/models/:modelId
 */
router.get('/:modelId', (req, res) => {
  try {
    const { modelId } = req.params;
    
    if (modelId !== 'chrome-agent-v1') {
      res.status(404).json({
        error: 'Model not found',
        message: `Model '${modelId}' not found`,
        timestamp: new Date().toISOString()
      });
      return;
    }

    const model = {
      id: 'chrome-agent-v1',
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'chrome-agent',
      permission: [],
      root: 'chrome-agent-v1',
      parent: null,
      capabilities: {
        web_automation: true,
        data_extraction: true,
        screenshot: true,
        navigation: true,
        form_filling: true,
        element_interaction: true,
        supported_actions: [
          'navigate',
          'click',
          'type',
          'scroll',
          'wait',
          'extract',
          'screenshot',
          'select',
          'hover',
          'drag_and_drop'
        ],
        supported_selectors: [
          'css',
          'xpath',
          'text',
          'id',
          'class',
          'name',
          'data-testid',
          'aria-label'
        ]
      },
      description: 'Chrome Agent - Web Automation and Data Extraction Model',
      version: '1.0.0',
      max_tokens: 4096,
      context_window: 8192,
      pricing: {
        input: 0,
        output: 0,
        currency: 'USD'
      },
      limits: {
        requests_per_minute: 60,
        requests_per_hour: 1000,
        concurrent_requests: 5
      },
      status: 'active',
      last_updated: new Date().toISOString()
    };

    res.json(model);
    
  } catch (error: any) {
    logger.error('Failed to get model info:', error);
    res.status(500).json({
      error: 'Failed to get model info',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 检查模型可用性
 * POST /api/v1/models/:modelId/check
 */
router.post('/:modelId/check', async (req, res) => {
  const startTime = Date.now();
  try {
    const { modelId } = req.params;
    
    if (modelId !== 'chrome-agent-v1') {
      res.status(404).json({
        error: 'Model not found',
        message: `Model '${modelId}' not found`,
        timestamp: new Date().toISOString()
      });
      return;
    }

    // 检查模型依赖和状态
    const checks = {
      model_loaded: true,
      dependencies_available: true,
      browser_available: false,
      memory_sufficient: true
    };

    // 检查浏览器可用性
    try {
      const { getDefaultExecutor } = await import('../../executor');
      const executor = getDefaultExecutor();
      const browserInfo = await executor.getBrowserInfo();
      checks.browser_available = !!browserInfo;
    } catch (error) {
      checks.browser_available = false;
    }

    // 检查内存使用情况
    const memoryUsage = process.memoryUsage();
    const memoryPercentage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    checks.memory_sufficient = memoryPercentage < 90;

    const allChecksPass = Object.values(checks).every(check => check === true);

    res.json({
      model_id: modelId,
      status: allChecksPass ? 'available' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
      response_time: Date.now() - startTime
    });
    
  } catch (error: any) {
    logger.error('Failed to check model availability:', error);
    res.status(500).json({
      error: 'Failed to check model availability',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export { router as modelsRouter };
export default router;