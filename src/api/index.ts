/**
 * API层入口文件
 * 导出API服务器和相关组件
 */

import { ApiServer } from './server';
export { ApiServer };
export { healthRouter } from './routes/health';
export { modelsRouter } from './routes/models';
export { chatRouter } from './routes/chat';
export { metricsRouter } from './routes/metrics';

// 默认API服务器实例
let defaultApiServer: ApiServer | null = null;

/**
 * 获取默认API服务器实例
 */
export function getDefaultApiServer(): ApiServer {
  if (!defaultApiServer) {
    defaultApiServer = new ApiServer();
  }
  return defaultApiServer;
}

/**
 * 设置默认API服务器实例
 */
export function setDefaultApiServer(server: ApiServer): void {
  defaultApiServer = server;
}

/**
 * 创建新的API服务器实例
 */
export function createApiServer(config?: any): ApiServer {
  return new ApiServer(config);
}

/**
 * 启动默认API服务器
 */
export async function startDefaultApiServer(config?: any): Promise<void> {
  const server = getDefaultApiServer();
  // 配置将在创建时传入或使用默认配置
  await server.start();
}

/**
 * 停止默认API服务器
 */
export async function stopDefaultApiServer(): Promise<void> {
  if (defaultApiServer) {
    await defaultApiServer.stop();
  }
}

export default {
  ApiServer,
  getDefaultApiServer,
  setDefaultApiServer,
  createApiServer,
  startDefaultApiServer,
  stopDefaultApiServer
};