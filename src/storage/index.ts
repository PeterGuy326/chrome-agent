/**
 * 存储模块入口文件
 * 提供文件存储、配置管理和缓存功能
 */

// 核心存储类
export {
  Storage as FileStorage,
  getDefaultStorage,
  setDefaultStorage,
  createStorage,
  type StorageConfig,
  type StorageOptions,
  type StorageMetadata,
  type StorageEntry,
  type BackupInfo
} from './storage';

// 配置管理器
export {
  ConfigManager,
  getDefaultConfigManager,
  setDefaultConfigManager,
  createConfigManager,
  type AppConfig,
  type ConfigValidationRule,
  type ConfigValidationResult
} from './config-manager';

// 缓存管理器
export {
  CacheManager,
  getDefaultCacheManager,
  setDefaultCacheManager,
  createCacheManager,
  type CacheConfig,
  type CacheEntry,
  type CacheStats,
  type CacheOptions
} from './cache-manager';

// 导入类型
import type { 
  StorageConfig, 
  BackupInfo
} from './storage';
import type { Storage as FileStorage } from './storage';
import type { AppConfig } from './config-manager';
import type { CacheConfig, CacheStats, CacheManager } from './cache-manager';
import type { ConfigManager } from './config-manager';

/**
 * 快速存储数据
 */
export async function quickStore(key: string, data: any): Promise<void> {
  const { getDefaultStorage } = await import('./storage');
  const storage = getDefaultStorage();
  await storage.write(key, data);
}

/**
 * 快速加载数据
 */
export async function quickLoad<T = any>(key: string): Promise<T | null> {
  const { getDefaultStorage } = await import('./storage');
  const storage = getDefaultStorage();
  return await storage.read<T>(key);
}

/**
 * 快速删除数据
 */
export async function quickDelete(key: string): Promise<void> {
  const { getDefaultStorage } = await import('./storage');
  const storage = getDefaultStorage();
  await storage.delete(key);
}

/**
 * 快速缓存数据
 */
export async function quickCache(key: string, data: any, ttl?: number): Promise<void> {
  const { getDefaultCacheManager } = await import('./cache-manager');
  const cache = getDefaultCacheManager();
  await cache.set(key, data, { ttl });
}

/**
 * 快速获取缓存
 */
export async function quickGetCache<T = any>(key: string): Promise<T | null> {
  const { getDefaultCacheManager } = await import('./cache-manager');
  const cache = getDefaultCacheManager();
  return await cache.get(key) as T | null;
}

/**
 * 快速缓存或设置
 */
export async function quickCacheOrSet<T>(
  key: string, 
  factory: () => Promise<T>, 
  ttl?: number
): Promise<T> {
  const { getDefaultCacheManager } = await import('./cache-manager');
  const cache = getDefaultCacheManager();
  
  const cached = await cache.get(key) as T | null;
  if (cached !== null) {
    return cached;
  }
  
  const value = await factory();
  await cache.set(key, value, { ttl });
  return value;
}

/**
 * 快速获取配置
 */
export async function quickGetConfig(): Promise<AppConfig> {
  const { getDefaultConfigManager } = await import('./config-manager');
  const configManager = getDefaultConfigManager();
  return await configManager.load();
}

/**
 * 快速设置配置
 */
export async function quickSetConfig(config: AppConfig): Promise<void> {
  const { getDefaultConfigManager } = await import('./config-manager');
  const configManager = getDefaultConfigManager();
  await configManager.save(config);
}

/**
 * 快速获取配置值
 */
export async function quickGetConfigValue<T>(path: string): Promise<T | undefined> {
  const { getDefaultConfigManager } = await import('./config-manager');
  const configManager = getDefaultConfigManager();
  
  // 确保配置已加载
  try {
    return await configManager.get<T>(path);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Configuration not loaded')) {
      // 配置未加载，先加载配置
      await configManager.load();
      return await configManager.get<T>(path);
    }
    throw error;
  }
}

/**
 * 快速设置配置值
 */
export async function quickSetConfigValue<T>(path: string, value: T): Promise<void> {
  const { getDefaultConfigManager } = await import('./config-manager');
  const configManager = getDefaultConfigManager();
  
  // 确保配置已加载
  try {
    await configManager.set(path, value);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Configuration not loaded')) {
      // 配置未加载，先加载配置
      await configManager.load();
      await configManager.set(path, value);
    } else {
      throw error;
    }
  }
}

/**
 * 创建备份
 */
export async function createBackup(files?: string[]): Promise<BackupInfo> {
  const { getDefaultStorage } = await import('./storage');
  const storage = getDefaultStorage();
  return await storage.createBackup(files);
}

/**
 * 恢复备份
 */
export async function restoreBackup(backupId: string): Promise<void> {
  const { getDefaultStorage } = await import('./storage');
  const storage = getDefaultStorage();
  await storage.restoreBackup(backupId);
}

/**
 * 列出备份
 */
export async function listBackups(): Promise<BackupInfo[]> {
  const { getDefaultStorage } = await import('./storage');
  const storage = getDefaultStorage();
  return await storage.listBackups();
}

/**
 * 存储统计信息
 */
export interface StorageStats {
  storage: {
    totalFiles: number;
    totalSize: number;
    cacheSize: number;
    backupCount: number;
  };
  cache: CacheStats;
}

/**
 * 获取存储统计信息
 */
export async function getStorageStats(): Promise<StorageStats> {
  const { getDefaultStorage } = await import('./storage');
  const { getDefaultCacheManager } = await import('./cache-manager');
  
  const storage = getDefaultStorage();
  const cache = getDefaultCacheManager();
  
  const storageStats = await storage.getStats();
  const cacheStats = await cache.getStats();
  
  return {
    storage: storageStats,
    cache: cacheStats
  };
}

/**
 * 清理存储
 */
export async function cleanupStorage(): Promise<void> {
  const { getDefaultStorage } = await import('./storage');
  const { getDefaultCacheManager } = await import('./cache-manager');
  
  const storage = getDefaultStorage();
  const cache = getDefaultCacheManager();
  
  await storage.cleanup();
  await cache.cleanup();
}

/**
 * 初始化选项
 */
export interface InitializeOptions {
  storageConfig?: Partial<StorageConfig>;
  cacheConfig?: Partial<CacheConfig>;
}

/**
 * 初始化结果
 */
export interface InitializeResult {
  storage: FileStorage;
  cache: CacheManager;
  configManager: ConfigManager;
  appConfig: AppConfig;
}

/**
 * 初始化存储系统
 */
export async function initializeStorage(options: InitializeOptions = {}): Promise<InitializeResult> {
  const [
    { createStorage, getDefaultStorage },
    { createCacheManager, getDefaultCacheManager },
    { createConfigManager, getDefaultConfigManager }
  ] = await Promise.all([
    import('./storage'),
    import('./cache-manager'),
    import('./config-manager')
  ]);
  
  // 创建存储实例
  const storage = options.storageConfig 
    ? createStorage(options.storageConfig)
    : getDefaultStorage();
  
  // 创建缓存实例
  const cache = options.cacheConfig
    ? createCacheManager(options.cacheConfig)
    : getDefaultCacheManager();
  
  // 创建配置管理器
  const configManager = getDefaultConfigManager();
  
  // 加载应用配置
  const appConfig = await configManager.load();
  
  return {
    storage,
    cache,
    configManager,
    appConfig
  };
}

/**
 * 关闭存储系统
 */
export async function closeStorage(): Promise<void> {
  const { getDefaultStorage } = await import('./storage');
  const { getDefaultCacheManager } = await import('./cache-manager');
  
  const storage = getDefaultStorage();
  const cache = getDefaultCacheManager();
  
  await storage.close();
  await cache.close();
}