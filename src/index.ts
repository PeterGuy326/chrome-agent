/**
 * Chrome Agent 主入口文件
 * 负责启动API服务器和初始化核心组件
 */

import 'dotenv/config';
import { getDefaultLogger } from './core/logger';
import { createApiServer, ServerConfig } from './api/server';
import { initializeAI } from './ai/config';

const logger = getDefaultLogger();

/**
 * 启动应用
 */
async function startApplication() {
  try {
    logger.info('启动服务器', {
      port: process.env.PORT || '3000',
      host: process.env.HOST || '0.0.0.0'
    });

    // 1. 初始化存储系统（确保配置正确加载）
    try {
      const { initializeStorage } = await import('./storage');
      const storageResult = await initializeStorage();
      logger.info('存储系统初始化完成', {
        configLoaded: !!storageResult.appConfig,
        storageReady: !!storageResult.storage
      });
    } catch (error) {
      logger.warn('存储系统初始化失败:', error);
    }

    // 2. 尝试初始化AI（可选，不阻止启动）
    try {
      await initializeAI();
      logger.info('AI系统初始化完成');
    } catch (error) {
      logger.warn('AI系统初始化失败，将使用规则模式:', error);
    }

    // 3. 启动API服务器
    const serverConfig: Partial<ServerConfig> = {
      port: parseInt(process.env.PORT || '3000'),
      host: process.env.HOST || '0.0.0.0',
      corsOrigins: ['*'],
      rateLimit: {
        windowMs: 15 * 60 * 1000,
        max: 1000
      },
      enableMetrics: true,
      enableLogging: true,
      apiPrefix: '/api/v1'
    };

    const server = createApiServer(serverConfig);
    await server.start();

    const info = server.getServerInfo();
    logger.info(`服务器已启动: http://${info.host}:${info.port}`);
    logger.info(`API文档: http://${info.host}:${info.port}/docs`);
    logger.info(`演示页面: http://${info.host}:${info.port}/demo.html`);

    // 4. 设置优雅关闭
    setupGracefulShutdown(server);

  } catch (error) {
    logger.error('应用启动失败:', error);
    process.exit(1);
  }
}

/**
 * 设置优雅关闭
 */
function setupGracefulShutdown(server: any) {
  const signals = ['SIGTERM', 'SIGINT', 'SIGQUIT', 'SIGHUP'];

  signals.forEach((signal) => {
    process.on(signal, async () => {
      logger.info(`收到 ${signal}，正在关闭服务器...`);
      
      try {
        await server.stop();
        logger.info('服务器已关闭');
        process.exit(0);
      } catch (error) {
        logger.error('关闭服务器时出错:', error);
        process.exit(1);
      }
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('未捕获的异常:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('未处理的Promise拒绝:', reason);
    process.exit(1);
  });
}

// 如果直接运行此文件，启动应用
if (require.main === module) {
  startApplication();
}

export { startApplication };