/**
 * 存储模块
 * 负责本地文件读写和数据持久化
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { getDefaultLogger } from '../core/logger';

export interface StorageConfig {
  baseDir: string;
  enableCache: boolean;
  cacheSize: number;
  autoBackup: boolean;
  backupInterval: number; // 分钟
  compression: boolean;
  encryption: boolean;
  encryptionKey?: string;
}

export interface StorageOptions {
  encoding?: BufferEncoding;
  createDirs?: boolean;
  backup?: boolean;
  compress?: boolean;
  encrypt?: boolean;
}

export interface StorageMetadata {
  size: number;
  created: Date;
  modified: Date;
  checksum: string;
  version: number;
  compressed: boolean;
  encrypted: boolean;
}

export interface StorageEntry<T = any> {
  key: string;
  data: T;
  metadata: StorageMetadata;
  expiry?: Date;
}

export interface BackupInfo {
  id: string;
  timestamp: Date;
  files: string[];
  size: number;
  compressed: boolean;
}

export class Storage {
  private config: StorageConfig;
  private cache: Map<string, StorageEntry> = new Map();
  private logger = getDefaultLogger();
  private backupTimer?: NodeJS.Timeout;

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = {
      baseDir: path.join(process.cwd(), 'data'),
      enableCache: true,
      cacheSize: 1000,
      autoBackup: false,
      backupInterval: 60,
      compression: false,
      encryption: false,
      ...config
    };

    this.initialize();
  }

  /**
   * 初始化存储
   */
  private async initialize(): Promise<void> {
    try {
      // 确保基础目录存在
      await this.ensureDirectory(this.config.baseDir);
      
      // 创建子目录
      await this.ensureDirectory(path.join(this.config.baseDir, 'configs'));
      await this.ensureDirectory(path.join(this.config.baseDir, 'cache'));
      await this.ensureDirectory(path.join(this.config.baseDir, 'backups'));
      await this.ensureDirectory(path.join(this.config.baseDir, 'logs'));
      await this.ensureDirectory(path.join(this.config.baseDir, 'temp'));

      // 启动自动备份
      if (this.config.autoBackup) {
        this.startAutoBackup();
      }

      this.logger.info('Storage initialized', {
        baseDir: this.config.baseDir,
        enableCache: this.config.enableCache,
        autoBackup: this.config.autoBackup
      });
    } catch (error) {
      this.logger.error('Failed to initialize storage', { error });
      throw error;
    }
  }

  /**
   * 写入数据
   */
  async write<T>(
    key: string,
    data: T,
    options: StorageOptions = {}
  ): Promise<void> {
    try {
      const filePath = this.getFilePath(key);
      const opts = { ...options, createDirs: true };

      // 确保目录存在
      if (opts.createDirs) {
        await this.ensureDirectory(path.dirname(filePath));
      }

      // 序列化数据
      let content = this.serialize(data);

      // 压缩
      if (opts.compress || this.config.compression) {
        content = await this.compress(content);
      }

      // 加密
      if (opts.encrypt || this.config.encryption) {
        content = await this.encrypt(content);
      }

      // 写入文件
      await fs.writeFile(filePath, content, {
        encoding: opts.encoding || 'utf8'
      });

      // 生成元数据
      const stats = await fs.stat(filePath);
      const metadata: StorageMetadata = {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        checksum: await this.calculateChecksum(content),
        version: 1,
        compressed: opts.compress || this.config.compression,
        encrypted: opts.encrypt || this.config.encryption
      };

      // 更新缓存
      if (this.config.enableCache) {
        this.updateCache(key, data, metadata);
      }

      // 创建备份
      if (opts.backup) {
        await this.createBackup([filePath]);
      }

      this.logger.debug('Data written successfully', {
        key,
        size: metadata.size,
        compressed: metadata.compressed,
        encrypted: metadata.encrypted
      });
    } catch (error) {
      this.logger.error('Failed to write data', { key, error });
      throw error;
    }
  }

  /**
   * 读取数据
   */
  async read<T>(
    key: string,
    options: StorageOptions = {}
  ): Promise<T | null> {
    try {
      // 检查缓存
      if (this.config.enableCache) {
        const cached = this.getFromCache<T>(key);
        if (cached) {
          this.logger.debug('Data retrieved from cache', { key });
          return cached;
        }
      }

      const filePath = this.getFilePath(key);

      // 检查文件是否存在
      try {
        await fs.access(filePath);
      } catch {
        return null;
      }

      // 读取文件
      let content = await fs.readFile(filePath, {
        encoding: options.encoding || 'utf8'
      }) as string;

      // 解密
      if (this.config.encryption) {
        content = await this.decrypt(content);
      }

      // 解压缩
      if (this.config.compression) {
        content = await this.decompress(content);
      }

      // 反序列化
      const data = this.deserialize<T>(content);

      // 更新缓存
      if (this.config.enableCache) {
        const stats = await fs.stat(filePath);
        const metadata: StorageMetadata = {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          checksum: await this.calculateChecksum(content),
          version: 1,
          compressed: this.config.compression,
          encrypted: this.config.encryption
        };
        this.updateCache(key, data, metadata);
      }

      this.logger.debug('Data read successfully', { key });
      return data;
    } catch (error) {
      this.logger.error('Failed to read data', { key, error });
      throw error;
    }
  }

  /**
   * 删除数据
   */
  async delete(key: string): Promise<boolean> {
    try {
      const filePath = this.getFilePath(key);

      // 检查文件是否存在
      try {
        await fs.access(filePath);
      } catch {
        return false;
      }

      // 删除文件
      await fs.unlink(filePath);

      // 从缓存中移除
      if (this.config.enableCache) {
        this.cache.delete(key);
      }

      this.logger.debug('Data deleted successfully', { key });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete data', { key, error });
      return false;
    }
  }

  /**
   * 检查数据是否存在
   */
  async exists(key: string): Promise<boolean> {
    try {
      // 检查缓存
      if (this.config.enableCache && this.cache.has(key)) {
        return true;
      }

      const filePath = this.getFilePath(key);
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取数据元数据
   */
  async getMetadata(key: string): Promise<StorageMetadata | null> {
    try {
      // 检查缓存
      if (this.config.enableCache) {
        const cached = this.cache.get(key);
        if (cached) {
          return cached.metadata;
        }
      }

      const filePath = this.getFilePath(key);

      // 检查文件是否存在
      try {
        await fs.access(filePath);
      } catch {
        return null;
      }

      const stats = await fs.stat(filePath);
      const content = await fs.readFile(filePath, 'utf8');

      return {
        size: stats.size,
        created: stats.birthtime,
        modified: stats.mtime,
        checksum: await this.calculateChecksum(content),
        version: 1,
        compressed: this.config.compression,
        encrypted: this.config.encryption
      };
    } catch (error) {
      this.logger.error('Failed to get metadata', { key, error });
      return null;
    }
  }

  /**
   * 列出所有键
   */
  async list(pattern?: string): Promise<string[]> {
    try {
      const keys: string[] = [];
      
      // 递归遍历目录
      const traverse = async (dir: string, prefix = ''): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
          
          if (entry.isDirectory()) {
            await traverse(fullPath, relativePath);
          } else if (entry.isFile() && entry.name.endsWith('.json')) {
            const key = relativePath.replace(/\.json$/, '');
            if (!pattern || this.matchPattern(key, pattern)) {
              keys.push(key);
            }
          }
        }
      };

      await traverse(this.config.baseDir);
      return keys.sort();
    } catch (error) {
      this.logger.error('Failed to list keys', { error });
      return [];
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.debug('Cache cleared');
  }

  /**
   * 获取缓存统计
   */
  getCacheStats(): { size: number; maxSize: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxSize: this.config.cacheSize,
      hitRate: 0 // TODO: 实现命中率统计
    };
  }

  /**
   * 创建备份
   */
  async createBackup(files?: string[]): Promise<BackupInfo> {
    try {
      const backupId = `backup_${Date.now()}`;
      const backupDir = path.join(this.config.baseDir, 'backups', backupId);
      
      await this.ensureDirectory(backupDir);

      const filesToBackup = files || await this.getAllFiles();
      let totalSize = 0;

      for (const file of filesToBackup) {
        const relativePath = path.relative(this.config.baseDir, file);
        const backupPath = path.join(backupDir, relativePath);
        
        await this.ensureDirectory(path.dirname(backupPath));
        await fs.copyFile(file, backupPath);
        
        const stats = await fs.stat(backupPath);
        totalSize += stats.size;
      }

      const backupInfo: BackupInfo = {
        id: backupId,
        timestamp: new Date(),
        files: filesToBackup,
        size: totalSize,
        compressed: false
      };

      // 保存备份信息
      await this.write(`backups/${backupId}/info`, backupInfo);

      this.logger.info('Backup created successfully', {
        backupId,
        fileCount: filesToBackup.length,
        size: totalSize
      });

      return backupInfo;
    } catch (error) {
      this.logger.error('Failed to create backup', { error });
      throw error;
    }
  }

  /**
   * 恢复备份
   */
  async restoreBackup(backupId: string): Promise<void> {
    try {
      const backupDir = path.join(this.config.baseDir, 'backups', backupId);
      const backupInfo = await this.read<BackupInfo>(`backups/${backupId}/info`);
      
      if (!backupInfo) {
        throw new Error(`Backup not found: ${backupId}`);
      }

      // 清空当前数据
      await this.clearData();

      // 恢复文件
      for (const file of backupInfo.files) {
        const relativePath = path.relative(this.config.baseDir, file);
        const backupPath = path.join(backupDir, relativePath);
        const targetPath = path.join(this.config.baseDir, relativePath);
        
        await this.ensureDirectory(path.dirname(targetPath));
        await fs.copyFile(backupPath, targetPath);
      }

      // 清空缓存
      this.clearCache();

      this.logger.info('Backup restored successfully', { backupId });
    } catch (error) {
      this.logger.error('Failed to restore backup', { backupId, error });
      throw error;
    }
  }

  /**
   * 列出所有备份
   */
  async listBackups(): Promise<BackupInfo[]> {
    try {
      const backupsDir = path.join(this.config.baseDir, 'backups');
      const entries = await fs.readdir(backupsDir, { withFileTypes: true });
      const backups: BackupInfo[] = [];

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const backupInfo = await this.read<BackupInfo>(`backups/${entry.name}/info`);
          if (backupInfo) {
            backups.push(backupInfo);
          }
        }
      }

      return backups.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    } catch (error) {
      this.logger.error('Failed to list backups', { error });
      return [];
    }
  }

  /**
   * 删除备份
   */
  async deleteBackup(backupId: string): Promise<boolean> {
    try {
      const backupDir = path.join(this.config.baseDir, 'backups', backupId);
      await fs.rm(backupDir, { recursive: true, force: true });
      
      this.logger.info('Backup deleted successfully', { backupId });
      return true;
    } catch (error) {
      this.logger.error('Failed to delete backup', { backupId, error });
      return false;
    }
  }

  /**
   * 获取存储统计信息
   */
  async getStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    cacheSize: number;
    backupCount: number;
  }> {
    try {
      const files = await this.getAllFiles();
      let totalSize = 0;

      for (const file of files) {
        const stats = await fs.stat(file);
        totalSize += stats.size;
      }

      const backups = await this.listBackups();

      return {
        totalFiles: files.length,
        totalSize,
        cacheSize: this.cache.size,
        backupCount: backups.length
      };
    } catch (error) {
      this.logger.error('Failed to get storage stats', { error });
      return {
        totalFiles: 0,
        totalSize: 0,
        cacheSize: this.cache.size,
        backupCount: 0
      };
    }
  }

  /**
   * 清理过期数据
   */
  async cleanup(): Promise<void> {
    try {
      const now = new Date();
      const expiredKeys: string[] = [];

      // 检查缓存中的过期项
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiry && entry.expiry < now) {
          expiredKeys.push(key);
        }
      }

      // 删除过期项
      for (const key of expiredKeys) {
        await this.delete(key);
      }

      this.logger.info('Cleanup completed', { expiredCount: expiredKeys.length });
    } catch (error) {
      this.logger.error('Failed to cleanup storage', { error });
    }
  }

  /**
   * 关闭存储
   */
  async close(): Promise<void> {
    try {
      // 停止自动备份
      if (this.backupTimer) {
        clearInterval(this.backupTimer);
        this.backupTimer = undefined;
      }

      // 清空缓存
      this.clearCache();

      this.logger.info('Storage closed');
    } catch (error) {
      this.logger.error('Failed to close storage', { error });
    }
  }

  // 私有方法

  private getFilePath(key: string): string {
    return path.join(this.config.baseDir, `${key}.json`);
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  private serialize<T>(data: T): string {
    return JSON.stringify(data, null, 2);
  }

  private deserialize<T>(content: string): T {
    return JSON.parse(content);
  }

  private async compress(content: string): Promise<string> {
    // TODO: 实现压缩功能（可以使用 zlib）
    return content;
  }

  private async decompress(content: string): Promise<string> {
    // TODO: 实现解压缩功能
    return content;
  }

  private async encrypt(content: string): Promise<string> {
    // TODO: 实现加密功能（可以使用 crypto）
    return content;
  }

  private async decrypt(content: string): Promise<string> {
    // TODO: 实现解密功能
    return content;
  }

  private async calculateChecksum(content: string): Promise<string> {
    // 简单的校验和实现
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 转换为32位整数
    }
    return Math.abs(hash).toString(16);
  }

  private updateCache<T>(key: string, data: T, metadata: StorageMetadata): void {
    if (this.cache.size >= this.config.cacheSize) {
      // 删除最旧的条目
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      key,
      data,
      metadata
    });
  }

  private getFromCache<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (entry) {
      // 检查是否过期
      if (entry.expiry && entry.expiry < new Date()) {
        this.cache.delete(key);
        return null;
      }
      return entry.data as T;
    }
    return null;
  }

  private matchPattern(text: string, pattern: string): boolean {
    // 简单的通配符匹配
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
    return regex.test(text);
  }

  private async getAllFiles(): Promise<string[]> {
    const files: string[] = [];
    
    const traverse = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          await traverse(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    };

    await traverse(this.config.baseDir);
    return files;
  }

  private async clearData(): Promise<void> {
    const files = await this.getAllFiles();
    for (const file of files) {
      // 跳过备份目录
      if (!file.includes('/backups/')) {
        await fs.unlink(file);
      }
    }
  }

  private startAutoBackup(): void {
    this.backupTimer = setInterval(async () => {
      try {
        await this.createBackup();
        this.logger.info('Auto backup completed');
      } catch (error) {
        this.logger.error('Auto backup failed', { error });
      }
    }, this.config.backupInterval * 60 * 1000);
  }
}

// 默认实例管理
let defaultStorage: Storage | null = null;

export function getDefaultStorage(): Storage {
  if (!defaultStorage) {
    defaultStorage = new Storage();
  }
  return defaultStorage;
}

export function setDefaultStorage(storage: Storage): void {
  defaultStorage = storage;
}

export function createStorage(config?: Partial<StorageConfig>): Storage {
  return new Storage(config);
}