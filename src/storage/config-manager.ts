/**
 * 配置管理器
 * 负责应用配置的读取、写入和验证
 */

import { Storage, getDefaultStorage } from './storage';
import { getDefaultLogger } from '../core/logger';

export interface AppConfig {
  // 应用基础配置
  app: {
    name: string;
    version: string;
    environment: 'development' | 'production' | 'test';
    debug: boolean;
    logLevel: 'error' | 'warn' | 'info' | 'debug';
  };

  // 浏览器配置
  browser: {
    headless: boolean;
    devtools: boolean;
    slowMo: number;
    timeout: number;
    viewport: {
      width: number;
      height: number;
    };
    userAgent?: string;
    proxy?: {
      server: string;
      username?: string;
      password?: string;
    };
    args: string[];
    // 新增：反爬/环境伪装配置
    stealth?: boolean;
    userDataDir?: string;
    locale?: string;
    languages?: string[];
    timezone?: string;
    executablePath?: string;
    extraHeaders?: Record<string, string>;
  };

  // 选择器配置
  selector: {
    timeout: number;
    retries: number;
    strategies: string[];
    fallbackEnabled: boolean;
    scoreThreshold: number;
  };

  // 数据抽取配置
  extractor: {
    timeout: number;
    retries: number;
    batchSize: number;
    enableCache: boolean;
    cacheExpiry: number;
  };

  // 存储配置
  storage: {
    baseDir: string;
    enableCache: boolean;
    cacheSize: number;
    autoBackup: boolean;
    backupInterval: number;
    compression: boolean;
    encryption: boolean;
  };

  // API配置
  api: {
    port: number;
    host: string;
    cors: boolean;
    rateLimit: {
      windowMs: number;
      max: number;
    };
    auth: {
      enabled: boolean;
      secret?: string;
      expiresIn: string;
    };
  };

  // AI/LLM 配置
  ai: {
    enabled: boolean;
    provider: 'openai' | 'deepseek' | 'custom' | 'modelscope' | 'google' | 'bailian';
    model: string;
    baseUrl?: string;
    apiKey?: string;
    temperature: number;
    maxTokens: number;
    topP: number;
    systemPrompt?: string;
    timeout: number;
    intentModel?: string;
    plannerModel?: string;
    // 新增：Planner 参数化重试与严格提示
    planner: {
      retry: {
        maxAttempts: 2,
        temperatureStepDown: 0.2
      },
      strictPrompt: '严格只输出一个 JSON 对象（UTF-8），不要使用反引号、不要使用 Markdown 代码块、不要输出任何解释或额外文本；如果无法完全确定选择器，保持 selectorCandidates 为 [] 或给出低置信度候选；若 JSON 校验失败，请立即纠正并重新生成可被 JSON.parse 解析的结果。'
    }
  },
  plugins: {
    enabled: [],
    disabled: [],
    config: {}
  }
};

export interface ConfigValidationRule {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  enum?: any[];
  validator?: (value: any) => boolean | string;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class ConfigManager {
  private storage: Storage;
  private logger = getDefaultLogger();
  private config: AppConfig | null = null;
  private watchers: Map<string, ((config: AppConfig) => void)[]> = new Map();

  constructor(storage?: Storage) {
    this.storage = storage || getDefaultStorage();
  }

  /**
   * 获取默认配置
   */
  getDefaultConfig(): AppConfig {
    return {
      app: {
        name: 'Chrome Agent',
        version: '1.0.0',
        environment: 'development',
        debug: true,
        logLevel: 'info'
      },
      browser: {
        headless: false,
        devtools: false,
        slowMo: 0,
        timeout: 30000,
        viewport: {
          width: 1920,
          height: 1080
        },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        stealth: true,
        locale: 'zh-CN',
        languages: ['zh-CN','zh'],
        timezone: 'Asia/Shanghai',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu'
        ]
      },
      selector: {
        timeout: 5000,
        retries: 3,
        strategies: ['text', 'id', 'class', 'aria', 'role', 'testid', 'tag'],
        fallbackEnabled: true,
        scoreThreshold: 0.5
      },
      extractor: {
        timeout: 10000,
        retries: 3,
        batchSize: 100,
        enableCache: true,
        cacheExpiry: 3600000 // 1小时
      },
      storage: {
        baseDir: './data',
        enableCache: true,
        cacheSize: 1000,
        autoBackup: false,
        backupInterval: 60,
        compression: false,
        encryption: false
      },
      api: {
        port: 3000,
        host: '0.0.0.0',
        cors: true,
        rateLimit: {
          windowMs: 15 * 60 * 1000, // 15分钟
          max: 100
        },
        auth: {
          enabled: false,
          expiresIn: '24h'
        }
      },
      ai: {
        enabled: true,
        provider: (process.env.AI_PROVIDER as any) || 'openai',
        model: (() => {
          const p = process.env.AI_PROVIDER || 'openai';
          if (p === 'deepseek') return process.env.DEEPSEEK_MODEL || 'deepseek-chat';
          if (p === 'modelscope') return process.env.MODELSCOPE_MODEL || process.env.AI_MODEL || 'gpt-3.5-turbo';
          if (p === 'google') return process.env.GOOGLE_MODEL || process.env.GEMINI_MODEL || process.env.AI_MODEL || 'gemini-1.5-flash';
          if (p === 'bailian') return process.env.BAILIAN_MODEL || process.env.AI_MODEL || 'qwen-plus';
          return process.env.OPENAI_MODEL || process.env.AI_MODEL || 'gpt-3.5-turbo';
        })(),
        baseUrl: (() => {
          const p = process.env.AI_PROVIDER || 'openai';
          if (p === 'deepseek') return process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
          if (p === 'modelscope') return process.env.MODELSCOPE_BASE_URL;
          if (p === 'google') return process.env.GOOGLE_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
          if (p === 'bailian') return process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
          return process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
        })(),
        apiKey: (() => {
          const p = process.env.AI_PROVIDER || 'openai';
          if (p === 'deepseek') return process.env.DEEPSEEK_API_KEY;
          if (p === 'modelscope') return process.env.MODELSCOPE_API_KEY || process.env.AI_API_KEY;
          if (p === 'google') return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || process.env.AI_API_KEY;
          if (p === 'bailian') return process.env.BAILIAN_API_KEY || process.env.AI_API_KEY;
          return process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
        })(),
        temperature: parseFloat(process.env.AI_TEMPERATURE || '0.2'),
        maxTokens: parseInt(process.env.AI_MAX_TOKENS || '2048', 10),
        topP: parseFloat(process.env.AI_TOP_P || '1'),
        systemPrompt: process.env.AI_SYSTEM_PROMPT,
        timeout: parseInt(process.env.AI_TIMEOUT || '60000', 10),
        intentModel: (() => {
          const p = process.env.AI_PROVIDER || 'openai';
          if (process.env.AI_INTENT_MODEL) return process.env.AI_INTENT_MODEL;
          if (p === 'modelscope') return 'deepseek-ai/DeepSeek-V2-Lite-Chat';
          if (p === 'google') return process.env.GOOGLE_INTENT_MODEL || process.env.GEMINI_INTENT_MODEL || 'gemini-1.5-flash';
          if (p === 'bailian') return process.env.BAILIAN_INTENT_MODEL || 'qwen-turbo';
          return undefined;
        })(),
        plannerModel: (() => {
          const p = process.env.AI_PROVIDER || 'openai';
          if (process.env.AI_PLANNER_MODEL) return process.env.AI_PLANNER_MODEL;
          if (p === 'modelscope') return 'deepseek-ai/DeepSeek-V3.1';
          if (p === 'google') return process.env.GOOGLE_PLANNER_MODEL || process.env.GEMINI_PLANNER_MODEL || 'gemini-1.5-pro';
          if (p === 'bailian') return process.env.BAILIAN_PLANNER_MODEL || 'qwen-plus';
          return undefined;
        })(),
        // 新增默认 Planner 配置
        planner: {
          retry: {
            maxAttempts: 2,
            temperatureStepDown: 0.2
          },
          strictPrompt: '严格只输出一个 JSON 对象（UTF-8），不要使用反引号、不要使用 Markdown 代码块、不要输出任何解释或额外文本；如果无法完全确定选择器，保持 selectorCandidates 为 [] 或给出低置信度候选；若 JSON 校验失败，请立即纠正并重新生成可被 JSON.parse 解析的结果。'
        }
      },
      plugins: {
        enabled: [],
        disabled: [],
        config: {}
      }
    };
  }

  /**
   * 加载配置
   */
  async load(configPath = 'configs/app'): Promise<AppConfig> {
    try {
      // 尝试从存储中读取配置
      let config = await this.storage.read<AppConfig>(configPath);
      
      if (!config) {
        // 如果配置不存在，使用默认配置
        config = this.getDefaultConfig();
        await this.save(config, configPath);
        this.logger.info('Created default configuration', { configPath });
      } else {
        // 合并默认配置以确保所有字段都存在
        config = this.mergeConfig(this.getDefaultConfig(), config);
        this.logger.info('Configuration loaded', { configPath });
      }

      // 验证配置
      const validation = this.validate(config);
      if (!validation.valid) {
        this.logger.warn('Configuration validation failed', {
          errors: validation.errors,
          warnings: validation.warnings
        });
      }

      this.config = config;
      this.notifyWatchers(config);
      
      return config;
    } catch (error) {
      this.logger.error('Failed to load configuration', { configPath, error });
      
      // 返回默认配置作为后备
      const defaultConfig = this.getDefaultConfig();
      this.config = defaultConfig;
      return defaultConfig;
    }
  }

  /**
   * 保存配置
   */
  async save(config: AppConfig, configPath = 'configs/app'): Promise<void> {
    try {
      // 验证配置
      const validation = this.validate(config);
      if (!validation.valid) {
        throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
      }

      await this.storage.write(configPath, config, { backup: true });
      this.config = config;
      this.notifyWatchers(config);
      
      this.logger.info('Configuration saved', { configPath });
    } catch (error) {
      this.logger.error('Failed to save configuration', { configPath, error });
      throw error;
    }
  }

  /**
   * 获取当前配置
   */
  getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }
    return this.config;
  }

  /**
   * 获取配置值
   */
  get<T = any>(path: string, defaultValue?: T): T {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }

    const keys = path.split('.');
    let value: any = this.config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue as T;
      }
    }

    return value as T;
  }

  /**
   * 设置配置值
   */
  async set(path: string, value: any, save = true): Promise<void> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }

    const keys = path.split('.');
    const lastKey = keys.pop()!;
    let target: any = this.config;

    // 导航到目标对象
    for (const key of keys) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }

    // 设置值
    target[lastKey] = value;

    if (save) {
      await this.save(this.config);
    }

    this.logger.debug('Configuration value updated', { path, value });
  }

  /**
   * 重置配置为默认值
   */
  async reset(configPath = 'configs/app'): Promise<AppConfig> {
    try {
      const defaultConfig = this.getDefaultConfig();
      await this.save(defaultConfig, configPath);
      
      this.logger.info('Configuration reset to defaults', { configPath });
      return defaultConfig;
    } catch (error) {
      this.logger.error('Failed to reset configuration', { configPath, error });
      throw error;
    }
  }

  /**
   * 验证配置
   */
  validate(config: AppConfig): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const rules: ConfigValidationRule[] = [
      // 应用配置验证
      { path: 'app.name', type: 'string', required: true },
      { path: 'app.version', type: 'string', required: true, pattern: /^\d+\.\d+\.\d+/ },
      { path: 'app.environment', type: 'string', required: true, enum: ['development', 'production', 'test'] },
      { path: 'app.logLevel', type: 'string', required: true, enum: ['error', 'warn', 'info', 'debug'] },

      // 浏览器配置验证
      { path: 'browser.timeout', type: 'number', required: true, min: 1000, max: 300000 },
      { path: 'browser.viewport.width', type: 'number', required: true, min: 320, max: 4096 },
      { path: 'browser.viewport.height', type: 'number', required: true, min: 240, max: 4096 },

      // 选择器配置验证
      { path: 'selector.timeout', type: 'number', required: true, min: 1000, max: 60000 },
      { path: 'selector.retries', type: 'number', required: true, min: 0, max: 10 },
      { path: 'selector.scoreThreshold', type: 'number', required: true, min: 0, max: 1 },

      // API配置验证
      { path: 'api.port', type: 'number', required: true, min: 1, max: 65535 },
      { path: 'api.host', type: 'string', required: true },

      // 存储配置验证
      { path: 'storage.cacheSize', type: 'number', required: true, min: 10, max: 10000 },
      { path: 'storage.backupInterval', type: 'number', required: true, min: 1, max: 1440 },

      // AI/LLM 配置验证
      { path: 'ai.enabled', type: 'boolean', required: true },
      { path: 'ai.provider', type: 'string', required: true, enum: ['openai', 'deepseek', 'custom', 'modelscope', 'google', 'bailian'] },
      { path: 'ai.model', type: 'string', required: true },
      { path: 'ai.temperature', type: 'number', required: true, min: 0, max: 2 },
      { path: 'ai.maxTokens', type: 'number', required: true, min: 1, max: 200000 },
      { path: 'ai.topP', type: 'number', required: true, min: 0, max: 1 },
      { path: 'ai.timeout', type: 'number', required: true, min: 1000, max: 600000 },
      // 新增：Planner 配置验证
      { path: 'ai.planner.retry.maxAttempts', type: 'number', required: false, min: 1, max: 10 },
      { path: 'ai.planner.retry.temperatureStepDown', type: 'number', required: false, min: 0, max: 1 },
      { path: 'ai.planner.strictPrompt', type: 'string', required: false }
    ];

    for (const rule of rules) {
      const value = this.getValueByPath(config, rule.path);
      const result = this.validateValue(value, rule);
      
      if (result !== true) {
        if (rule.required) {
          errors.push(`${rule.path}: ${result}`);
        } else {
          warnings.push(`${rule.path}: ${result}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * 监听配置变化
   */
  watch(callback: (config: AppConfig) => void): () => void {
    const id = Math.random().toString(36);
    
    if (!this.watchers.has(id)) {
      this.watchers.set(id, []);
    }
    
    this.watchers.get(id)!.push(callback);

    // 返回取消监听的函数
    return () => {
      this.watchers.delete(id);
    };
  }

  /**
   * 导出配置
   */
  async export(format: 'json' | 'yaml' = 'json'): Promise<string> {
    if (!this.config) {
      throw new Error('Configuration not loaded. Call load() first.');
    }

    switch (format) {
      case 'json':
        return JSON.stringify(this.config, null, 2);
      case 'yaml':
        // TODO: 实现YAML导出
        return JSON.stringify(this.config, null, 2);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * 导入配置
   */
  async import(content: string, format: 'json' | 'yaml' = 'json'): Promise<AppConfig> {
    try {
      let config: AppConfig;

      switch (format) {
        case 'json':
          config = JSON.parse(content);
          break;
        case 'yaml':
          // TODO: 实现YAML导入
          config = JSON.parse(content);
          break;
        default:
          throw new Error(`Unsupported import format: ${format}`);
      }

      // 合并默认配置
      config = this.mergeConfig(this.getDefaultConfig(), config);

      // 验证配置
      const validation = this.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      await this.save(config);
      
      this.logger.info('Configuration imported successfully', { format });
      return config;
    } catch (error) {
      this.logger.error('Failed to import configuration', { format, error });
      throw error;
    }
  }

  // 私有方法

  private mergeConfig(defaultConfig: AppConfig, userConfig: Partial<AppConfig>): AppConfig {
    const merged = { ...defaultConfig };

    for (const [key, value] of Object.entries(userConfig)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        merged[key as keyof AppConfig] = {
          ...merged[key as keyof AppConfig],
          ...value
        } as any;
      } else {
        merged[key as keyof AppConfig] = value as any;
      }
    }

    return merged;
  }

  private getValueByPath(obj: any, path: string): any {
    const keys = path.split('.');
    let value = obj;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value;
  }

  private validateValue(value: any, rule: ConfigValidationRule): true | string {
    // 检查必需字段
    if (rule.required && (value === undefined || value === null)) {
      return 'is required';
    }

    if (value === undefined || value === null) {
      return true;
    }

    // 检查类型
    const actualType = Array.isArray(value) ? 'array' : typeof value;
    if (actualType !== rule.type) {
      return `expected ${rule.type}, got ${actualType}`;
    }

    // 检查数值范围
    if (rule.type === 'number') {
      if (rule.min !== undefined && value < rule.min) {
        return `must be >= ${rule.min}`;
      }
      if (rule.max !== undefined && value > rule.max) {
        return `must be <= ${rule.max}`;
      }
    }

    // 检查字符串长度
    if (rule.type === 'string') {
      if (rule.min !== undefined && value.length < rule.min) {
        return `length must be >= ${rule.min}`;
      }
      if (rule.max !== undefined && value.length > rule.max) {
        return `length must be <= ${rule.max}`;
      }
    }

    // 检查正则表达式
    if (rule.pattern && rule.type === 'string') {
      if (!rule.pattern.test(value)) {
        return `does not match pattern ${rule.pattern}`;
      }
    }

    // 检查枚举值
    if (rule.enum && !rule.enum.includes(value)) {
      return `must be one of: ${rule.enum.join(', ')}`;
    }

    // 自定义验证器
    if (rule.validator) {
      const result = rule.validator(value);
      if (result !== true) {
        return typeof result === 'string' ? result : 'validation failed';
      }
    }

    return true;
  }

  private notifyWatchers(config: AppConfig): void {
    for (const callbacks of this.watchers.values()) {
      for (const callback of callbacks) {
        try {
          callback(config);
        } catch (error) {
          this.logger.error('Error in config watcher callback', { error });
        }
      }
    }
  }
}

// 默认实例管理
let defaultConfigManager: ConfigManager | null = null;

export function getDefaultConfigManager(): ConfigManager {
  if (!defaultConfigManager) {
    defaultConfigManager = new ConfigManager();
  }
  return defaultConfigManager;
}

export function setDefaultConfigManager(configManager: ConfigManager): void {
  defaultConfigManager = configManager;
}

export function createConfigManager(storage?: Storage): ConfigManager {
  return new ConfigManager(storage);
}