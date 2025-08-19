/**
 * 定位引擎
 * 负责多策略元素定位和候选打分
 */

import { Page, ElementHandle } from 'puppeteer';
import { 
  SelectorCandidate, 
  SelectorType, 
  ActionType 
} from '../core/types';
import { getDefaultLogger } from '../core/logger';

export interface SelectorStrategy {
  id: string;
  name: string;
  type: SelectorType;
  priority: number;
  canHandle: (description: string, actionType: ActionType) => boolean;
  generateCandidates: (description: string, actionType: ActionType, context?: SelectorContext) => SelectorCandidate[];
  score: (candidate: SelectorCandidate, context: SelectorContext) => number;
}

export interface SelectorContext {
  page: Page;
  currentUrl: string;
  pageTitle: string;
  actionType: ActionType;
  previousSelectors?: SelectorCandidate[];
  userPreferences?: {
    preferredTypes: SelectorType[];
    avoidTypes: SelectorType[];
    strictMode: boolean;
  };
}

export interface SelectorResult {
  candidate: SelectorCandidate;
  element: ElementHandle | null;
  found: boolean;
  score: number;
  executionTime: number;
  error?: string;
}

export interface SelectorEngineConfig {
  maxCandidates: number;
  timeoutMs: number;
  enableFallback: boolean;
  enableCaching: boolean;
  scoreThreshold: number;
  retryAttempts: number;
}

export class SelectorEngine {
  private strategies: Map<string, SelectorStrategy> = new Map();
  private cache: Map<string, SelectorResult[]> = new Map();
  private config: SelectorEngineConfig;
  private logger = getDefaultLogger();

  constructor(config: Partial<SelectorEngineConfig> = {}) {
    this.config = {
      maxCandidates: 10,
      timeoutMs: 5000,
      enableFallback: true,
      enableCaching: true,
      scoreThreshold: 0.3,
      retryAttempts: 3,
      ...config
    };

    this.initializeDefaultStrategies();
  }

  /**
   * 查找元素
   */
  async findElement(
    description: string,
    actionType: ActionType,
    context: SelectorContext
  ): Promise<SelectorResult | null> {
    const startTime = Date.now();
    
    try {
      // 1. 生成候选选择器
      const candidates = this.generateCandidates(description, actionType, context);
      
      if (candidates.length === 0) {
        this.logger.warn('No selector candidates generated', { description, actionType });
        return null;
      }

      // 2. 按分数排序
      const scoredCandidates = this.scoreCandidates(candidates, context);
      
      // 3. 尝试查找元素
      for (const candidate of scoredCandidates) {
        if (candidate.score < this.config.scoreThreshold) {
          continue;
        }

        const result = await this.tryFindElement(candidate, context);
        if (result.found) {
          this.logger.info('Element found', {
            selector: candidate.value,
            type: candidate.type,
            score: candidate.score,
            executionTime: Date.now() - startTime
          });
          return result;
        }
      }

      // 4. 如果启用了回退策略，尝试更宽松的匹配
      if (this.config.enableFallback) {
        return await this.fallbackSearch(description, actionType, context);
      }

      return null;
    } catch (error) {
      this.logger.error('Selector engine error', { error, description, actionType });
      return null;
    }
  }

  /**
   * 查找多个元素
   */
  async findElements(
    description: string,
    actionType: ActionType,
    context: SelectorContext,
    maxResults: number = 10
  ): Promise<SelectorResult[]> {
    const candidates = this.generateCandidates(description, actionType, context);
    const scoredCandidates = this.scoreCandidates(candidates, context);
    const results: SelectorResult[] = [];

    for (const candidate of scoredCandidates.slice(0, maxResults)) {
      const result = await this.tryFindElement(candidate, context);
      results.push(result);
    }

    return results.filter(r => r.found);
  }

  /**
   * 注册选择器策略
   */
  registerStrategy(strategy: SelectorStrategy): void {
    this.strategies.set(strategy.id, strategy);
    this.logger.info(`Registered selector strategy: ${strategy.name}`);
  }

  /**
   * 获取所有策略
   */
  getStrategies(): SelectorStrategy[] {
    return Array.from(this.strategies.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * 验证选择器
   */
  async validateSelector(
    candidate: SelectorCandidate,
    context: SelectorContext
  ): Promise<{ valid: boolean; element?: ElementHandle; error?: string }> {
    try {
      const element = await this.executeSelector(candidate, context.page);
      return {
        valid: element !== null,
        element: element || undefined
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 生成候选选择器
   */
  private generateCandidates(
    description: string,
    actionType: ActionType,
    context: SelectorContext
  ): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    
    for (const strategy of this.getStrategies()) {
      if (strategy.canHandle(description, actionType)) {
        try {
          const strategyCandidates = strategy.generateCandidates(description, actionType, context);
          candidates.push(...strategyCandidates);
        } catch (error) {
          this.logger.warn(`Strategy ${strategy.name} failed to generate candidates`, { error });
        }
      }
    }

    // 去重和限制数量
    const uniqueCandidates = this.deduplicateCandidates(candidates);
    return uniqueCandidates.slice(0, this.config.maxCandidates);
  }

  /**
   * 为候选选择器打分
   */
  private scoreCandidates(
    candidates: SelectorCandidate[],
    context: SelectorContext
  ): SelectorCandidate[] {
    const scoredCandidates = candidates.map(candidate => {
      const strategy = this.getStrategyByType(candidate.type);
      const score = strategy ? strategy.score(candidate, context) : candidate.score / 100;
      
      return {
        ...candidate,
        score: Math.max(0, Math.min(1, score))
      };
    });

    return scoredCandidates.sort((a, b) => b.score - a.score);
  }

  /**
   * 尝试查找元素
   */
  private async tryFindElement(
    candidate: SelectorCandidate,
    context: SelectorContext
  ): Promise<SelectorResult> {
    const startTime = Date.now();
    
    try {
      const element = await this.executeSelector(candidate, context.page);
      
      return {
        candidate,
        element,
        found: element !== null,
        score: candidate.score,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        candidate,
        element: null,
        found: false,
        score: candidate.score,
        executionTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * 执行选择器
   */
  private async executeSelector(
    candidate: SelectorCandidate,
    page: Page
  ): Promise<ElementHandle | null> {
    const timeout = this.config.timeoutMs;
    
    try {
      switch (candidate.type) {
        case SelectorType.CSS:
          return await page.$(candidate.value);
          
        case SelectorType.XPATH:
          const elements = await page.$x(candidate.value);
          return elements.length > 0 ? elements[0] as ElementHandle : null;
          
        case SelectorType.TEXT:
          const textElements = await page.$$eval('*', (elements, text) => {
            return elements
              .filter(el => el.textContent?.includes(text))
              .map(el => {
                const rect = el.getBoundingClientRect();
                return {
                  tagName: el.tagName,
                  id: el.id,
                  className: el.className,
                  textContent: el.textContent,
                  x: rect.x,
                  y: rect.y
                };
              });
          }, candidate.value);
          
          if (textElements.length > 0) {
            // 返回第一个匹配的元素
            const selector = textElements[0].id 
              ? `#${textElements[0].id}`
              : textElements[0].className
              ? `.${textElements[0].className.split(' ')[0]}`
              : textElements[0].tagName.toLowerCase();
            return await page.$(selector);
          }
          return null;
          
        case SelectorType.ARIA_LABEL:
          return await page.$(`[aria-label*="${candidate.value}"]`);
          
        case SelectorType.ROLE:
          return await page.$(`[role="${candidate.value}"]`);
          
        case SelectorType.DATA_TESTID:
          return await page.$(`[data-testid="${candidate.value}"]`);
          
        case SelectorType.ID:
          return await page.$(`#${candidate.value}`);
          
        case SelectorType.CLASS:
          return await page.$(`.${candidate.value}`);
          
        case SelectorType.TAG:
          return await page.$(candidate.value);
          
        case SelectorType.NAME:
          return await page.$(`[name="${candidate.value}"]`);
          
        default:
          throw new Error(`Unsupported selector type: ${candidate.type}`);
      }
    } catch (error) {
      this.logger.debug('Selector execution failed', {
        type: candidate.type,
        value: candidate.value,
        error
      });
      return null;
    }
  }

  /**
   * 回退搜索
   */
  private async fallbackSearch(
    description: string,
    actionType: ActionType,
    context: SelectorContext
  ): Promise<SelectorResult | null> {
    this.logger.info('Attempting fallback search', { description, actionType });
    
    // 尝试更宽松的文本匹配
    const fallbackCandidates: SelectorCandidate[] = [
      {
        type: SelectorType.TEXT,
        value: description,
        score: 0.2,
        description: `Fallback text search for: ${description}`,
        fallback: true
      },
      {
        type: SelectorType.CSS,
        value: '*',
        score: 0.1,
        description: 'Universal fallback selector',
        fallback: true
      }
    ];

    for (const candidate of fallbackCandidates) {
      const result = await this.tryFindElement(candidate, context);
      if (result.found) {
        return result;
      }
    }

    return null;
  }

  /**
   * 去重候选选择器
   */
  private deduplicateCandidates(candidates: SelectorCandidate[]): SelectorCandidate[] {
    const seen = new Set<string>();
    return candidates.filter(candidate => {
      const key = `${candidate.type}:${candidate.value}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * 根据类型获取策略
   */
  private getStrategyByType(type: SelectorType): SelectorStrategy | undefined {
    return Array.from(this.strategies.values()).find(s => s.type === type);
  }

  /**
   * 初始化默认策略
   */
  private initializeDefaultStrategies(): void {
    // 导入并注册默认策略
    import('./strategies').then(({ createDefaultStrategies }) => {
      const strategies = createDefaultStrategies();
      strategies.forEach(strategy => {
        this.registerStrategy(strategy);
      });
    }).catch(error => {
      this.logger.error('Failed to load default strategies', { error });
    });
  }
}

// 默认实例管理
let defaultSelectorEngine: SelectorEngine | null = null;

export function getDefaultSelectorEngine(): SelectorEngine {
  if (!defaultSelectorEngine) {
    defaultSelectorEngine = new SelectorEngine();
  }
  return defaultSelectorEngine;
}

export function setDefaultSelectorEngine(engine: SelectorEngine): void {
  defaultSelectorEngine = engine;
}

export function createSelectorEngine(config?: Partial<SelectorEngineConfig>): SelectorEngine {
  return new SelectorEngine(config);
}