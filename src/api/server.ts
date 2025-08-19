/**
 * API服务器
 * 提供兼容Open WebUI的HTTP接口
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { getDefaultLogger } from '../core/logger';
import { getDefaultEventBus } from '../core/event-bus';
import { getDefaultErrorHandler, ErrorCode } from '../core/error-handler';
import { EventType } from '../core/types';
import { chatRouter } from './routes/chat';
import { modelsRouter } from './routes/models';
import { healthRouter } from './routes/health';
import { metricsRouter } from './routes/metrics';

export interface ServerConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  rateLimit: {
    windowMs: number;
    max: number;
  };
  enableMetrics: boolean;
  enableLogging: boolean;
  apiPrefix: string;
}

export class ApiServer {
  private app: express.Application;
  private server: any;
  private config: ServerConfig;
  private logger = getDefaultLogger();
  private eventBus = getDefaultEventBus();
  private errorHandler = getDefaultErrorHandler();

  constructor(config: Partial<ServerConfig> = {}) {
    this.config = {
      port: 8080,
      host: '0.0.0.0',
      corsOrigins: ['*'],
      rateLimit: {
        windowMs: 15 * 60 * 1000, // 15分钟
        max: 100 // 限制每个IP 15分钟内最多100个请求
      },
      enableMetrics: true,
      enableLogging: true,
      apiPrefix: '/api/v1',
      ...config
    };

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    // 安全中间件
    this.app.use(helmet());

    // CORS配置
    this.app.use(cors({
      origin: this.config.corsOrigins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));

    // 请求解析
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // 速率限制
    const limiter = rateLimit({
      windowMs: this.config.rateLimit.windowMs,
      max: this.config.rateLimit.max,
      message: {
        error: 'Too many requests from this IP, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      },
      standardHeaders: true,
      legacyHeaders: false
    });
    this.app.use(limiter);

    // 请求日志
    if (this.config.enableLogging) {
      this.app.use((req, res, next) => {
        const start = Date.now();
        const originalSend = res.send;

        res.send = function(body) {
          const duration = Date.now() - start;
          const logger = getDefaultLogger();
          logger.info(`${req.method} ${req.path} - ${res.statusCode} - ${duration}ms`);
          return originalSend.call(this, body);
        };

        next();
      });
    }

    // 请求ID
    this.app.use((req, res, next) => {
      req.id = this.generateRequestId();
      res.setHeader('X-Request-ID', req.id);
      next();
    });
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    const prefix = this.config.apiPrefix;

    // 健康检查
    this.app.use(`${prefix}/health`, healthRouter);

    // 模型信息
    this.app.use(`${prefix}/models`, modelsRouter);

    // 聊天接口（兼容OpenAI格式）
    this.app.use(`${prefix}/chat`, chatRouter);

    // 指标接口
    if (this.config.enableMetrics) {
      this.app.use(`${prefix}/metrics`, metricsRouter);
    }

    // 根路径
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Chrome Agent API',
        version: '1.0.0',
        description: 'Browser automation agent compatible with Open WebUI',
        endpoints: {
          health: `${prefix}/health`,
          models: `${prefix}/models`,
          chat: `${prefix}/chat/completions`,
          metrics: this.config.enableMetrics ? `${prefix}/metrics` : null
        }
      });
    });

    // 404处理
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.originalUrl} not found`,
        code: 'ROUTE_NOT_FOUND'
      });
    });
  }

  /**
   * 设置错误处理
   */
  private setupErrorHandling(): void {
    this.app.use((error: any, req: any, res: any, next: any) => {
      const requestId = req.id || 'unknown';
      
      this.logger.error(`Request ${requestId} failed:`, error);
      
      // 记录错误到错误处理器
      this.errorHandler.handleError(error, {
        requestId,
        method: req.method,
        path: req.path,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });

      // 发送错误事件
      this.eventBus.emit(EventType.API_ERROR, {
        requestId,
        error: error.message,
        stack: error.stack,
        method: req.method,
        path: req.path
      });

      // 返回错误响应
      const statusCode = error.statusCode || error.status || 500;
      const errorResponse: any = {
        error: error.message || 'Internal Server Error',
        code: error.code || 'INTERNAL_ERROR',
        requestId,
        timestamp: new Date().toISOString()
      };

      // 在开发环境中包含堆栈跟踪
      if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = error.stack;
      }

      res.status(statusCode).json(errorResponse);
    });
  }

  /**
   * 启动服务器
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.server = this.app.listen(this.config.port, this.config.host, () => {
          this.logger.info(`API server started on ${this.config.host}:${this.config.port}`);
          
          this.eventBus.emit(EventType.API_SERVER_STARTED, {
            host: this.config.host,
            port: this.config.port,
            apiPrefix: this.config.apiPrefix
          });
          
          resolve();
        });

        this.server.on('error', (error: any) => {
          this.logger.error('Server error:', error);
          reject(error);
        });

      } catch (error) {
        this.logger.error('Failed to start server:', error);
        reject(error);
      }
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error: any) => {
        if (error) {
          this.logger.error('Error stopping server:', error);
          reject(error);
        } else {
          this.logger.info('API server stopped');
          this.eventBus.emit(EventType.API_SERVER_STOPPED);
          resolve();
        }
      });
    });
  }

  /**
   * 获取服务器信息
   */
  getServerInfo(): any {
    return {
      host: this.config.host,
      port: this.config.port,
      apiPrefix: this.config.apiPrefix,
      isRunning: !!this.server,
      uptime: this.server ? process.uptime() : 0
    };
  }

  /**
   * 生成请求ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * 获取Express应用实例
   */
  getApp(): express.Application {
    return this.app;
  }
}

// 默认服务器实例
let defaultServer: ApiServer | null = null;

export function getDefaultApiServer(): ApiServer {
  if (!defaultServer) {
    defaultServer = new ApiServer();
  }
  return defaultServer;
}

export function setDefaultApiServer(server: ApiServer): void {
  defaultServer = server;
}

export function createApiServer(config?: Partial<ServerConfig>): ApiServer {
  return new ApiServer(config);
}

// 扩展Express Request接口
declare global {
  namespace Express {
    interface Request {
      id?: string;
    }
  }
}