/**
 * 计划优化器
 * 对生成的执行计划进行优化，提高执行效率和成功率
 */

import { 
  Step, 
  ActionType, 
  WaitType, 
  RiskLevel,
  SelectorType 
} from '../core/types';
import { getDefaultLogger } from '../core/logger';

/**
 * 优化规则接口
 */
export interface OptimizationRule {
  id: string;
  name: string;
  description: string;
  priority: number;
  canApply: (steps: Step[]) => boolean;
  apply: (steps: Step[]) => Step[];
}

/**
 * 优化结果
 */
export interface OptimizationResult {
  originalSteps: Step[];
  optimizedSteps: Step[];
  appliedRules: string[];
  estimatedTimeSaved: number;
  riskAssessment: RiskLevel;
  optimizationScore: number;
}

/**
 * 计划优化器类
 */
export class PlanOptimizer {
  private rules: OptimizationRule[] = [];
  private logger = getDefaultLogger();

  constructor() {
    this.initializeBuiltinRules();
  }

  /**
   * 注册优化规则
   */
  registerRule(rule: OptimizationRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
    this.logger.info(`Registered optimization rule: ${rule.name}`);
  }

  /**
   * 优化执行计划
   */
  optimize(steps: Step[]): OptimizationResult {
    const startTime = Date.now();
    const originalSteps = [...steps];
    let currentSteps = [...steps];
    const appliedRules: string[] = [];

    this.logger.info(`Starting optimization for ${steps.length} steps`);

    // 应用优化规则
    for (const rule of this.rules) {
      if (rule.canApply(currentSteps)) {
        const beforeCount = currentSteps.length;
        currentSteps = rule.apply(currentSteps);
        const afterCount = currentSteps.length;
        
        appliedRules.push(rule.id);
        this.logger.debug(`Applied rule ${rule.name}: ${beforeCount} -> ${afterCount} steps`);
      }
    }

    // 重新分配步骤顺序
    currentSteps = this.reorderSteps(currentSteps);

    // 计算优化结果
    const result: OptimizationResult = {
      originalSteps,
      optimizedSteps: currentSteps,
      appliedRules,
      estimatedTimeSaved: this.calculateTimeSaved(originalSteps, currentSteps),
      riskAssessment: this.assessRisk(currentSteps),
      optimizationScore: this.calculateOptimizationScore(originalSteps, currentSteps)
    };

    const duration = Date.now() - startTime;
    this.logger.info(`Optimization completed in ${duration}ms, score: ${result.optimizationScore}`);

    return result;
  }

  /**
   * 初始化内置优化规则
   */
  private initializeBuiltinRules(): void {
    this.registerRule(RemoveRedundantWaitsRule);
    this.registerRule(MergeConsecutiveTypingRule);
    this.registerRule(OptimizeWaitTimesRule);
    this.registerRule(RemoveDuplicateSelectorsRule);
    this.registerRule(BatchSimilarActionsRule);
    this.registerRule(OptimizeScrollingRule);
    this.registerRule(ImproveRetryStrategiesRule);
    this.registerRule(AddMissingWaitsRule);
  }

  /**
   * 重新排序步骤
   */
  private reorderSteps(steps: Step[]): Step[] {
    return steps.map((step, index) => ({
      ...step,
      order: index
    }));
  }

  /**
   * 计算节省的时间
   */
  private calculateTimeSaved(original: Step[], optimized: Step[]): number {
    const originalTime = original.reduce((sum, step) => sum + (step.timeout || 0), 0);
    const optimizedTime = optimized.reduce((sum, step) => sum + (step.timeout || 0), 0);
    return Math.max(0, originalTime - optimizedTime);
  }

  /**
   * 评估风险等级
   */
  private assessRisk(steps: Step[]): RiskLevel {
    let riskScore = 0;
    
    for (const step of steps) {
      // 基于动作类型评估风险
      switch (step.action) {
        case ActionType.CLICK:
          riskScore += 1;
          break;
        case ActionType.TYPE:
          riskScore += 2;
          break;
        case ActionType.NAVIGATE:
          riskScore += 3;
          break;
        case ActionType.PRESS_KEY:
          riskScore += 1;
          break;
        default:
          riskScore += 1;
      }
      
      // 基于重试次数评估风险
      if (step.retries && step.retries.maxAttempts > 3) {
        riskScore += 2;
      }
      
      // 基于选择器质量评估风险
      const hasHighQualitySelector = step.selectorCandidates.some(s => s.score > 80);
      if (!hasHighQualitySelector) {
        riskScore += 3;
      }
    }
    
    const avgRisk = riskScore / steps.length;
    
    if (avgRisk < 2) return RiskLevel.LOW;
    if (avgRisk < 4) return RiskLevel.MEDIUM;
    return RiskLevel.HIGH;
  }

  /**
   * 计算优化分数
   */
  private calculateOptimizationScore(original: Step[], optimized: Step[]): number {
    const stepReduction = Math.max(0, original.length - optimized.length);
    const timeReduction = this.calculateTimeSaved(original, optimized);
    
    // 基础分数：步骤减少 + 时间节省
    let score = (stepReduction * 10) + (timeReduction / 1000);
    
    // 质量加分：选择器质量提升
    const originalQuality = this.calculateSelectorQuality(original);
    const optimizedQuality = this.calculateSelectorQuality(optimized);
    score += (optimizedQuality - originalQuality) * 5;
    
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  /**
   * 计算选择器质量
   */
  private calculateSelectorQuality(steps: Step[]): number {
    if (steps.length === 0) return 0;
    
    const totalScore = steps.reduce((sum, step) => {
      const bestSelector = step.selectorCandidates.reduce((best, current) => 
        current.score > best.score ? current : best, { score: 0 });
      return sum + bestSelector.score;
    }, 0);
    
    return totalScore / steps.length;
  }
}

/**
 * 移除冗余等待规则
 */
const RemoveRedundantWaitsRule: OptimizationRule = {
  id: 'remove-redundant-waits',
  name: 'Remove Redundant Waits',
  description: 'Remove unnecessary wait steps that are too close together',
  priority: 90,
  
  canApply: (steps: Step[]) => {
    return steps.filter(s => s.action === ActionType.WAIT).length > 1;
  },
  
  apply: (steps: Step[]) => {
    const result: Step[] = [];
    let lastWaitIndex = -1;
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      if (step.action === ActionType.WAIT) {
        // 如果上一个等待步骤距离很近，跳过当前等待
        if (lastWaitIndex >= 0 && i - lastWaitIndex <= 2) {
          continue;
        }
        lastWaitIndex = i;
      }
      
      result.push(step);
    }
    
    return result;
  }
};

/**
 * 合并连续输入规则
 */
const MergeConsecutiveTypingRule: OptimizationRule = {
  id: 'merge-consecutive-typing',
  name: 'Merge Consecutive Typing',
  description: 'Merge consecutive typing actions on the same element',
  priority: 85,
  
  canApply: (steps: Step[]) => {
    const sameSelector = (step1: Step, step2: Step) => {
      const sel1 = step1.selectorCandidates[0];
      const sel2 = step2.selectorCandidates[0];
      return sel1 && sel2 && sel1.type === sel2.type && sel1.value === sel2.value;
    };
    
    for (let i = 0; i < steps.length - 1; i++) {
      if (steps[i].action === ActionType.TYPE && 
            steps[i + 1] && steps[i + 1].action === ActionType.TYPE &&
            sameSelector(steps[i], steps[i + 1])) {
        return true;
      }
    }
      return false;
    },
    
    apply: (steps: Step[]) => {
    const result: Step[] = [];
    let i = 0;
    
    // 辅助函数：检查两个步骤是否使用相同选择器
    const sameSelector = (step1: Step, step2: Step) => {
      const sel1 = step1.selectorCandidates[0];
      const sel2 = step2.selectorCandidates[0];
      return sel1 && sel2 && sel1.type === sel2.type && sel1.value === sel2.value;
    };
    
    while (i < steps.length) {
      const step = steps[i];
      
      if (step.action === ActionType.TYPE) {
        let mergedText = step.params?.text || '';
        let j = i + 1;
        
        // 查找连续的输入步骤
        while (j < steps.length && 
               steps[j].action === ActionType.TYPE &&
               sameSelector(step, steps[j])) {
          mergedText += steps[j].params?.text || '';
          j++;
        }
        
        // 创建合并后的步骤
        if (j > i + 1) {
          result.push({
            ...step,
            params: { ...step.params, text: mergedText },
            description: `Type merged text: ${mergedText.substring(0, 50)}${mergedText.length > 50 ? '...' : ''}`
          });
          i = j;
        } else {
          result.push(step);
          i++;
        }
      } else {
        result.push(step);
        i++;
      }
    }
    
    return result;
  }
};

/**
 * 优化等待时间规则
 */
const OptimizeWaitTimesRule: OptimizationRule = {
  id: 'optimize-wait-times',
  name: 'Optimize Wait Times',
  description: 'Adjust wait times based on action types and context',
  priority: 80,
  
  canApply: (steps: Step[]) => {
    return steps.some(s => s.waitFor && s.waitFor.timeout > 1000);
  },
  
  apply: (steps: Step[]) => {
    return steps.map(step => {
      if (!step.waitFor) return step;
      
      let optimizedTimeout = step.waitFor.timeout;
      
      // 根据动作类型优化等待时间
      switch (step.action) {
        case ActionType.CLICK:
          optimizedTimeout = Math.min(optimizedTimeout, 5000);
          break;
        case ActionType.TYPE:
          optimizedTimeout = Math.min(optimizedTimeout, 3000);
          break;
        case ActionType.NAVIGATE:
          optimizedTimeout = Math.min(optimizedTimeout, 10000);
          break;
        case ActionType.WAIT:
          // 等待步骤可以更激进地优化
          optimizedTimeout = Math.min(optimizedTimeout, 3000);
          break;
      }
      
      // 根据等待类型优化
      if (step.waitFor.type === WaitType.TIMEOUT) {
        optimizedTimeout = Math.min(optimizedTimeout, 2000);
      }
      
      return {
        ...step,
        waitFor: {
          ...step.waitFor,
          timeout: optimizedTimeout
        },
        timeout: Math.min(step.timeout, optimizedTimeout + 2000)
      };
    });
  }
};

/**
 * 移除重复选择器规则
 */
const RemoveDuplicateSelectorsRule: OptimizationRule = {
  id: 'remove-duplicate-selectors',
  name: 'Remove Duplicate Selectors',
  description: 'Remove duplicate selectors from candidate lists',
  priority: 75,
  
  canApply: (steps: Step[]) => {
    return steps.some(step => {
      const selectors = step.selectorCandidates;
      const unique = new Set(selectors.map(s => `${s.type}:${s.value}`));
      return unique.size < selectors.length;
    });
  },
  
  apply: (steps: Step[]) => {
    return steps.map(step => {
      const seen = new Set<string>();
      const uniqueSelectors = step.selectorCandidates.filter(selector => {
        const key = `${selector.type}:${selector.value}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      
      return {
        ...step,
        selectorCandidates: uniqueSelectors
      };
    });
  }
};

/**
 * 批量处理相似动作规则
 */
const BatchSimilarActionsRule: OptimizationRule = {
  id: 'batch-similar-actions',
  name: 'Batch Similar Actions',
  description: 'Group similar actions together for better performance',
  priority: 70,
  
  canApply: (steps: Step[]) => {
    // 检查是否有多个截图或提取动作
    const screenshots = steps.filter(s => s.action === ActionType.SCREENSHOT);
    const extractions = steps.filter(s => s.action === ActionType.EXTRACT);
    return screenshots.length > 1 || extractions.length > 1;
  },
  
  apply: (steps: Step[]) => {
    const result: Step[] = [];
    const batched = new Set<number>();
    
    for (let i = 0; i < steps.length; i++) {
      if (batched.has(i)) continue;
      
      const step = steps[i];
      
      if (step.action === ActionType.SCREENSHOT) {
        // 批量处理截图：只保留最后一个
        let lastScreenshot = i;
        for (let j = i + 1; j < steps.length; j++) {
          if (steps[j].action === ActionType.SCREENSHOT) {
            batched.add(j);
            lastScreenshot = j;
          }
        }
        result.push(steps[lastScreenshot]);
      } else {
        result.push(step);
      }
    }
    
    return result;
  }
};

/**
 * 优化滚动规则
 */
const OptimizeScrollingRule: OptimizationRule = {
  id: 'optimize-scrolling',
  name: 'Optimize Scrolling',
  description: 'Combine multiple small scrolls into larger ones',
  priority: 65,
  
  canApply: (steps: Step[]) => {
    const scrollSteps = steps.filter(s => s.action === ActionType.SCROLL);
    return scrollSteps.length > 1;
  },
  
  apply: (steps: Step[]) => {
    const result: Step[] = [];
    let i = 0;
    
    while (i < steps.length) {
      const step = steps[i];
      
      if (step.action === ActionType.SCROLL) {
        const initialCoords = step.params?.coordinates;
        let totalY = initialCoords?.y || 0;
        let j = i + 1;
        
        // 查找连续的滚动步骤
        while (j < steps.length && steps[j].action === ActionType.SCROLL) {
          const coords = steps[j].params?.coordinates;
          totalY += coords?.y || 0;
          j++;
        }
        
        if (j > i + 1) {
          // 合并滚动
          result.push({
            ...step,
            params: {
              ...step.params,
              coordinates: { x: 0, y: totalY }
            },
            description: `Scroll ${totalY}px (optimized)`
          });
          i = j;
        } else {
          result.push(step);
          i++;
        }
      } else {
        result.push(step);
        i++;
      }
    }
    
    return result;
  }
};

/**
 * 改进重试策略规则
 */
const ImproveRetryStrategiesRule: OptimizationRule = {
  id: 'improve-retry-strategies',
  name: 'Improve Retry Strategies',
  description: 'Optimize retry configurations based on action types',
  priority: 60,
  
  canApply: (steps: Step[]) => {
    return steps.some(s => s.retries && (s.retries.maxAttempts > 5 || s.retries.delay > 3000));
  },
  
  apply: (steps: Step[]) => {
    return steps.map(step => {
      if (!step.retries) return step;
      
      let optimizedRetries = { ...step.retries };
      
      // 根据动作类型优化重试策略
      switch (step.action) {
        case ActionType.CLICK:
          optimizedRetries.maxAttempts = Math.min(3, optimizedRetries.maxAttempts);
          optimizedRetries.delay = Math.min(1000, optimizedRetries.delay);
          break;
        case ActionType.TYPE:
          optimizedRetries.maxAttempts = Math.min(3, optimizedRetries.maxAttempts);
          optimizedRetries.delay = Math.min(500, optimizedRetries.delay);
          break;
        case ActionType.NAVIGATE:
          optimizedRetries.maxAttempts = Math.min(2, optimizedRetries.maxAttempts);
          optimizedRetries.delay = Math.min(2000, optimizedRetries.delay);
          break;
        case ActionType.EXTRACT:
          optimizedRetries.maxAttempts = Math.min(3, optimizedRetries.maxAttempts);
          optimizedRetries.delay = Math.min(1000, optimizedRetries.delay);
          break;
      }
      
      return {
        ...step,
        retries: optimizedRetries
      };
    });
  }
};

/**
 * 添加缺失等待规则
 */
const AddMissingWaitsRule: OptimizationRule = {
  id: 'add-missing-waits',
  name: 'Add Missing Waits',
  description: 'Add necessary wait steps after navigation or dynamic actions',
  priority: 55,
  
  canApply: (steps: Step[]) => {
    for (let i = 0; i < steps.length - 1; i++) {
      const current = steps[i];
      const next = steps[i + 1];
      
      // 导航后没有等待
      if (current.action === ActionType.NAVIGATE && 
          next.action !== ActionType.WAIT) {
        return true;
      }
      
      // 点击后立即进行其他操作，可能需要等待
      if (current.action === ActionType.CLICK && 
          next.action === ActionType.EXTRACT &&
          !current.waitFor) {
        return true;
      }
    }
    return false;
  },
  
  apply: (steps: Step[]) => {
    const result: Step[] = [];
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      result.push(step);
      
      // 在导航后添加等待
      if (step.action === ActionType.NAVIGATE && 
          i < steps.length - 1 && 
          steps[i + 1].action !== ActionType.WAIT) {
        result.push({
          id: '',
          planId: '',
          order: 0,
          action: ActionType.WAIT,
          selectorCandidates: [],
          params: {},
          waitFor: { type: WaitType.NETWORK_IDLE, timeout: 3000 },
          retries: { maxAttempts: 1, delay: 0, backoff: false },
          timeout: 5000,
          description: 'Wait for page to load after navigation',
          isOptional: true
        });
      }
      
      // 在点击后添加等待（如果下一步是提取）
      if (step.action === ActionType.CLICK && 
          i < steps.length - 1 && 
          steps[i + 1].action === ActionType.EXTRACT &&
          !step.waitFor) {
        result.push({
          id: '',
          planId: '',
          order: 0,
          action: ActionType.WAIT,
          selectorCandidates: [],
          params: {},
          waitFor: { type: WaitType.ELEMENT, timeout: 2000 },
          retries: { maxAttempts: 1, delay: 0, backoff: false },
          timeout: 3000,
          description: 'Wait for content to load after click',
          isOptional: true
        });
      }
    }
    
    return result;
  }
};

/**
 * 创建默认优化器实例
 */
export function createDefaultOptimizer(): PlanOptimizer {
  return new PlanOptimizer();
}