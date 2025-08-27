/**
 * AI 配置和连接管理模块
 * 处理 OpenAI 兼容的 API 客户端连接
 */

import { getDefaultLogger } from '../core/logger';
import { quickGetConfigValue } from '../storage';
import { createOpenAICompatibleClient } from './client-factory';

const logger = getDefaultLogger();

/**
 * AI 提供商类型
 */
export enum AIProvider {
  OPENAI = 'openai',
  DEEPSEEK = 'deepseek',
  CUSTOM = 'custom',
  MODELSCOPE = 'modelscope',
  GOOGLE = 'google',
  BAILIAN = 'bailian'
}

/**
 * AI 配置接口
 */
export interface AIConfig {
  enabled: boolean;
  provider: AIProvider;
  model: string;
  baseUrl?: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  systemPrompt?: string;
  timeout?: number;
  intentModel?: string;
  plannerModel?: string;
}

/**
 * AI 客户端管理器
 */
export class AIClientManager {
  private static instance: AIClientManager | null = null;
  private client: any | null = null; // loosen type to support custom providers
  private config: AIConfig | null = null;

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): AIClientManager {
    if (!AIClientManager.instance) {
      AIClientManager.instance = new AIClientManager();
    }
    return AIClientManager.instance;
  }

  /**
   * 初始化 AI 客户端
   */
  async initialize(): Promise<void> {
    try {
      // 从配置中获取 AI 设置
      const enabled = await quickGetConfigValue<boolean>('ai.enabled') ?? false;
      
      if (!enabled) {
        logger.info('AI features disabled in configuration');
        return;
      }

      const provider = await quickGetConfigValue<string>('ai.provider') ?? AIProvider.OPENAI;
      const model = await quickGetConfigValue<string>('ai.model') ?? '';
      const baseUrl = await quickGetConfigValue<string>('ai.baseUrl');
      const apiKey = await quickGetConfigValue<string>('ai.apiKey');
      
      if (!apiKey) {
        throw new Error('AI API key not configured');
      }
      if (!model) {
        throw new Error('AI model not configured. Please set ai.model or use --model.');
      }

      this.config = {
        enabled,
        provider: provider as AIProvider,
        model,
        baseUrl,
        apiKey,
        temperature: await quickGetConfigValue<number>('ai.temperature') ?? 0.2,
        maxTokens: await quickGetConfigValue<number>('ai.maxTokens') ?? 2048,
        topP: await quickGetConfigValue<number>('ai.topP') ?? 1,
        systemPrompt: await quickGetConfigValue<string>('ai.systemPrompt') ?? '',
        timeout: await quickGetConfigValue<number>('ai.timeout') ?? 60000,
        intentModel: await quickGetConfigValue<string>('ai.intentModel') ?? undefined,
        plannerModel: await quickGetConfigValue<string>('ai.plannerModel') ?? undefined
      };

      if (this.config.provider === AIProvider.MODELSCOPE && !this.config.baseUrl) {
        throw new Error('AI provider "modelscope" requires baseUrl. Please set --baseUrl or MODELSCOPE_BASE_URL.');
      }

      // 根据提供商创建客户端（统一工厂）
      this.client = createOpenAICompatibleClient(String(this.config.provider), {
        apiKey: this.config.apiKey,
        baseUrl: this.config.baseUrl,
        timeout: this.config.timeout
      });
      
      logger.info('AI client initialized', {
        provider: this.config.provider,
        model: this.config.model,
        baseUrl: this.config.baseUrl || 'default'
      });

      // 测试连接
      await this.testConnection();
    } catch (error) {
      logger.error('Failed to initialize AI client', error);
      throw error;
    }
  }

  /**
   * 测试 AI 连接
   */
  private async testConnection(): Promise<void> {
    if (!this.client || !this.config) {
      throw new Error('AI client not initialized');
    }

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.intentModel || this.config.plannerModel || this.config.model,
        messages: [
          { role: 'user', content: 'Test connection' }
        ],
        max_tokens: 10,
        temperature: 0
      });

      if (!response.choices || response.choices.length === 0) {
        throw new Error('Invalid response from AI provider');
      }

      logger.debug('AI connection test successful');
    } catch (error) {
      logger.error('AI connection test failed', error);
      throw new Error(`AI connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * 获取 AI 客户端
   */
  getClient(): any {
    if (!this.client) {
      throw new Error('AI client not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /**
   * 获取 AI 配置
   */
  getConfig(): AIConfig {
    if (!this.config) {
      throw new Error('AI config not loaded. Call initialize() first.');
    }
    return this.config;
  }

  /**
   * 检查 AI 是否已启用
   */
  isEnabled(): boolean {
    return this.config?.enabled ?? false;
  }

  /**
   * 重新加载配置
   */
  async reload(): Promise<void> {
    this.client = null;
    this.config = null;
    await this.initialize();
  }

  /**
   * 关闭客户端
   */
  close(): void {
    this.client = null;
    this.config = null;
    logger.info('AI client closed');
  }
}

/**
 * 获取默认的 AI 客户端管理器
 */
export function getAIClientManager(): AIClientManager {
  return AIClientManager.getInstance();
}

/**
 * 初始化 AI 系统
 */
export async function initializeAI(): Promise<void> {
  const manager = getAIClientManager();
  await manager.initialize();
}

/**
 * 检查 AI 是否可用
 */
export function isAIEnabled(): boolean {
  const manager = getAIClientManager();
  return manager.isEnabled();
}

/**
 * 获取 AI 客户端
 */
export function getAIClient(): any {
  const manager = getAIClientManager();
  return manager.getClient();
}