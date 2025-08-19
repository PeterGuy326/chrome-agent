/**
 * 缓存管理器
 * 提供内存缓存和持久化缓存功能
 */

import { Storage, getDefaultStorage } from './storage';
import { getDefaultLogger } from '../core/logger';

export interface CacheConfig {
  maxSize: number;
  ttl: number; // 生存时间（毫秒）
  checkInterval: number; // 清理检查间隔（毫秒）
  enablePersistence: boolean;
  persistenceKey: string;
  enableStats: boolean;
}

export interface CacheEntry<T = any> {
  key: string;
  value: T;
  createdAt: number;
  accessedAt: number;
  expiresAt: number;
  accessCount: number;
  size: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  totalSize: number;
  oldestEntry?: number;
  newestEntry?: number;
}

export interface CacheOptions {
  ttl?: number;
  persist?: boolean;
  priority?: 'low' | 'normal' | 'high';
}

export class CacheManager<T = any> {
  private config: CacheConfig;
  private cache: Map<string, CacheEntry<T>> = new Map();
  private storage: Storage;
  private logger = getDefaultLogger();
  private cleanupTimer?: NodeJS.Timeout;
  private stats: CacheStats;

  constructor(config: Partial<CacheConfig> = {}, storage?: Storage) {
    this.config = {
      maxSize: 1000,
      ttl: 3600000, // 1小时
      checkInterval: 300000, // 5分钟
      enablePersistence: true,
      persistenceKey: 'cache/default',
      enableStats: true,
      ...config
    };

    this.storage = storage || getDefaultStorage();
    this.stats = this.initStats();
    
    this.initialize();
  }

  /**
   * 初始化缓存
   */
  private async initialize(): Promise<void> {
    try {
      // 从持久化存储中恢复缓存
      if (this.config.enablePersistence) {
        await this.loadFromStorage();
      }

      // 启动清理定时器
      this.startCleanupTimer();

      this.logger.info('Cache manager initialized', {
        maxSize: this.config.maxSize,
        ttl: this.config.ttl,
        enablePersistence: this.config.enablePersistence
      });
    } catch (error) {
      this.logger.error('Failed to initialize cache manager', { error });
    }
  }

  /**
   * 设置缓存项
   */
  async set(
    key: string,
    value: T,
    options: CacheOptions = {}
  ): Promise<void> {
    try {
      const now = Date.now();
      const ttl = options.ttl || this.config.ttl;
      const size = this.calculateSize(value);

      // 检查是否需要清理空间
      if (this.cache.size >= this.config.maxSize) {
        await this.evict(options.priority || 'normal');
      }

      const entry: CacheEntry<T> = {
        key,
        value,
        createdAt: now,
        accessedAt: now,
        expiresAt: now + ttl,
        accessCount: 0,
        size
      };

      this.cache.set(key, entry);
      this.updateStats('set', size);

      // 持久化
      if (options.persist !== false && this.config.enablePersistence) {
        await this.persistToStorage();
      }

      this.logger.debug('Cache entry set', {
        key,
        size,
        ttl,
        expiresAt: new Date(entry.expiresAt)
      });
    } catch (error) {
      this.logger.error('Failed to set cache entry', { key, error });
      throw error;
    }
  }

  /**
   * 获取缓存项
   */
  async get(key: string): Promise<T | null> {
    try {
      const entry = this.cache.get(key);
      
      if (!entry) {
        this.updateStats('miss');
        return null;
      }

      const now = Date.now();

      // 检查是否过期
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        this.updateStats('miss');
        this.logger.debug('Cache entry expired', { key });
        return null;
      }

      // 更新访问信息
      entry.accessedAt = now;
      entry.accessCount++;

      this.updateStats('hit');
      
      this.logger.debug('Cache entry retrieved', {
        key,
        accessCount: entry.accessCount,
        age: now - entry.createdAt
      });

      return entry.value;
    } catch (error) {
      this.logger.error('Failed to get cache entry', { key, error });
      this.updateStats('miss');
      return null;
    }
  }

  /**
   * 删除缓存项
   */
  async delete(key: string): Promise<boolean> {
    try {
      const entry = this.cache.get(key);
      
      if (!entry) {
        return false;
      }

      this.cache.delete(key);
      this.updateStats('delete', -entry.size);

      // 更新持久化存储
      if (this.config.enablePersistence) {
        await this.persistToStorage();
      }

      this.logger.debug('Cache entry deleted', { key });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete cache entry', { key, error });
      return false;
    }
  }

  /**
   * 检查缓存项是否存在
   */
  has(key: string): boolean {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return false;
    }

    // 检查是否过期
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * 获取或设置缓存项
   */
  async getOrSet(
    key: string,
    factory: () => Promise<T> | T,
    options: CacheOptions = {}
  ): Promise<T> {
    try {
      // 尝试从缓存获取
      const cached = await this.get(key);
      if (cached !== null) {
        return cached;
      }

      // 生成新值
      const value = await factory();
      
      // 设置到缓存
      await this.set(key, value, options);
      
      return value;
    } catch (error) {
      this.logger.error('Failed to get or set cache entry', { key, error });
      throw error;
    }
  }

  /**
   * 批量设置
   */
  async setMany(
    entries: Array<{ key: string; value: T; options?: CacheOptions }>,
    globalOptions: CacheOptions = {}
  ): Promise<void> {
    try {
      for (const entry of entries) {
        const options = { ...globalOptions, ...entry.options };
        await this.set(entry.key, entry.value, { ...options, persist: false });
      }

      // 批量持久化
      if (this.config.enablePersistence) {
        await this.persistToStorage();
      }

      this.logger.debug('Batch cache entries set', { count: entries.length });
    } catch (error) {
      this.logger.error('Failed to set batch cache entries', { error });
      throw error;
    }
  }

  /**
   * 批量获取
   */
  async getMany(keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();

    for (const key of keys) {
      const value = await this.get(key);
      results.set(key, value);
    }

    return results;
  }

  /**
   * 批量删除
   */
  async deleteMany(keys: string[]): Promise<number> {
    let deletedCount = 0;

    for (const key of keys) {
      const deleted = await this.delete(key);
      if (deleted) {
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * 清空缓存
   */
  async clear(): Promise<void> {
    try {
      const size = this.cache.size;
      this.cache.clear();
      this.stats = this.initStats();

      // 清空持久化存储
      if (this.config.enablePersistence) {
        await this.storage.delete(this.config.persistenceKey);
      }

      this.logger.info('Cache cleared', { previousSize: size });
    } catch (error) {
      this.logger.error('Failed to clear cache', { error });
      throw error;
    }
  }

  /**
   * 获取所有键
   */
  keys(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * 获取所有值
   */
  values(): T[] {
    return Array.from(this.cache.values()).map(entry => entry.value);
  }

  /**
   * 获取所有条目
   */
  entries(): Array<[string, T]> {
    return Array.from(this.cache.entries()).map(([key, entry]) => [key, entry.value]);
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    if (!this.config.enableStats) {
      return this.initStats();
    }

    const entries = Array.from(this.cache.values());
    const totalSize = entries.reduce((sum, entry) => sum + entry.size, 0);
    const timestamps = entries.map(entry => entry.createdAt);

    return {
      ...this.stats,
      size: this.cache.size,
      totalSize,
      oldestEntry: timestamps.length > 0 ? Math.min(...timestamps) : undefined,
      newestEntry: timestamps.length > 0 ? Math.max(...timestamps) : undefined
    };
  }

  /**
   * 重置统计信息
   */
  resetStats(): void {
    this.stats = this.initStats();
    this.logger.debug('Cache stats reset');
  }

  /**
   * 清理过期条目
   */
  async cleanup(): Promise<number> {
    try {
      const now = Date.now();
      const expiredKeys: string[] = [];

      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiresAt <= now) {
          expiredKeys.push(key);
        }
      }

      for (const key of expiredKeys) {
        this.cache.delete(key);
      }

      if (expiredKeys.length > 0) {
        this.updateStats('cleanup', -expiredKeys.length);
        
        // 更新持久化存储
        if (this.config.enablePersistence) {
          await this.persistToStorage();
        }

        this.logger.debug('Cache cleanup completed', {
          expiredCount: expiredKeys.length
        });
      }

      return expiredKeys.length;
    } catch (error) {
      this.logger.error('Failed to cleanup cache', { error });
      return 0;
    }
  }

  /**
   * 设置TTL
   */
  async setTTL(key: string, ttl: number): Promise<boolean> {
    try {
      const entry = this.cache.get(key);
      
      if (!entry) {
        return false;
      }

      entry.expiresAt = Date.now() + ttl;

      // 更新持久化存储
      if (this.config.enablePersistence) {
        await this.persistToStorage();
      }

      this.logger.debug('Cache entry TTL updated', {
        key,
        ttl,
        expiresAt: new Date(entry.expiresAt)
      });

      return true;
    } catch (error) {
      this.logger.error('Failed to set cache entry TTL', { key, error });
      return false;
    }
  }

  /**
   * 获取TTL
   */
  getTTL(key: string): number | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    const remaining = entry.expiresAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /**
   * 关闭缓存管理器
   */
  async close(): Promise<void> {
    try {
      // 停止清理定时器
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = undefined;
      }

      // 最后一次持久化
      if (this.config.enablePersistence) {
        await this.persistToStorage();
      }

      this.logger.info('Cache manager closed');
    } catch (error) {
      this.logger.error('Failed to close cache manager', { error });
    }
  }

  // 私有方法

  private initStats(): CacheStats {
    return {
      size: 0,
      maxSize: this.config.maxSize,
      hitCount: 0,
      missCount: 0,
      hitRate: 0,
      totalSize: 0
    };
  }

  private updateStats(
    operation: 'hit' | 'miss' | 'set' | 'delete' | 'cleanup',
    sizeChange = 0
  ): void {
    if (!this.config.enableStats) {
      return;
    }

    switch (operation) {
      case 'hit':
        this.stats.hitCount++;
        break;
      case 'miss':
        this.stats.missCount++;
        break;
      case 'set':
        this.stats.totalSize += sizeChange;
        break;
      case 'delete':
      case 'cleanup':
        this.stats.totalSize += sizeChange;
        break;
    }

    // 计算命中率
    const total = this.stats.hitCount + this.stats.missCount;
    this.stats.hitRate = total > 0 ? this.stats.hitCount / total : 0;
  }

  private calculateSize(value: T): number {
    try {
      return JSON.stringify(value).length;
    } catch {
      return 1; // 默认大小
    }
  }

  private async evict(priority: 'low' | 'normal' | 'high'): Promise<void> {
    const entries = Array.from(this.cache.entries());
    
    if (entries.length === 0) {
      return;
    }

    // 根据优先级选择淘汰策略
    let sortFn: (a: [string, CacheEntry<T>], b: [string, CacheEntry<T>]) => number;

    switch (priority) {
      case 'high':
        // 高优先级：淘汰最少使用的
        sortFn = (a, b) => a[1].accessCount - b[1].accessCount;
        break;
      case 'low':
        // 低优先级：淘汰最近使用的
        sortFn = (a, b) => b[1].accessedAt - a[1].accessedAt;
        break;
      default:
        // 普通优先级：淘汰最旧的
        sortFn = (a, b) => a[1].createdAt - b[1].createdAt;
    }

    entries.sort(sortFn);

    // 淘汰10%的条目
    const evictCount = Math.max(1, Math.floor(entries.length * 0.1));
    
    for (let i = 0; i < evictCount; i++) {
      const [key] = entries[i];
      this.cache.delete(key);
    }

    this.logger.debug('Cache eviction completed', {
      evictCount,
      priority,
      remainingSize: this.cache.size
    });
  }

  private async loadFromStorage(): Promise<void> {
    try {
      const data = await this.storage.read<Array<[string, CacheEntry<T>]>>(
        this.config.persistenceKey
      );

      if (data) {
        const now = Date.now();
        let loadedCount = 0;

        for (const [key, entry] of data) {
          // 跳过过期条目
          if (entry.expiresAt > now) {
            this.cache.set(key, entry);
            loadedCount++;
          }
        }

        this.logger.info('Cache loaded from storage', {
          totalEntries: data.length,
          loadedEntries: loadedCount,
          expiredEntries: data.length - loadedCount
        });
      }
    } catch (error) {
      this.logger.warn('Failed to load cache from storage', { error });
    }
  }

  private async persistToStorage(): Promise<void> {
    try {
      const data = Array.from(this.cache.entries());
      await this.storage.write(this.config.persistenceKey, data);
      
      this.logger.debug('Cache persisted to storage', {
        entryCount: data.length
      });
    } catch (error) {
      this.logger.warn('Failed to persist cache to storage', { error });
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanup();
    }, this.config.checkInterval);
  }
}

// 默认实例管理
let defaultCacheManager: CacheManager | null = null;

export function getDefaultCacheManager<T = any>(): CacheManager<T> {
  if (!defaultCacheManager) {
    defaultCacheManager = new CacheManager();
  }
  return defaultCacheManager as CacheManager<T>;
}

export function setDefaultCacheManager<T = any>(cacheManager: CacheManager<T>): void {
  defaultCacheManager = cacheManager as CacheManager<any>;
}

export function createCacheManager<T = any>(
  config?: Partial<CacheConfig>,
  storage?: Storage
): CacheManager<T> {
  return new CacheManager<T>(config, storage);
}