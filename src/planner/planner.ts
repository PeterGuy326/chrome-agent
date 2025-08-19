/**
 * 计划生成器
 * 将解析后的意图转换为具体的执行步骤
 */

import { 
  Plan, 
  Step, 
  ActionType, 
  SelectorType, 
  RiskLevel, 
  WaitType,
  SelectorCandidate,
  StepParams,
  WaitCondition,
  RetryConfig,
  PlanMetadata
} from '../core/types';
import { ParsedIntent } from '../core/types';
import { getDefaultLogger } from '../core/logger';
import { getDefaultEventBus } from '../core/event-bus';

export interface PlanningContext {
  currentUrl?: string;
  pageTitle?: string;
  userAgent?: string;
  viewport?: { width: number; height: number };
  sessionHistory?: string[];
  userPreferences?: {
    timeout?: number;
    retries?: number;
    waitStrategy?: WaitType;
    riskTolerance?: RiskLevel;
  };
}

export interface PlanningStrategy {
  id: string;
  name: string;
  description: string;
  priority: number;
  canHandle: (intent: ParsedIntent, context?: PlanningContext) => boolean;
  generateSteps: (intent: ParsedIntent, context?: PlanningContext) => Step[];
  estimateDuration: (steps: Step[]) => number;
  assessRisk: (steps: Step[], context?: PlanningContext) => RiskLevel;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

export class Planner {
  private strategies: Map<string, PlanningStrategy> = new Map();
  private logger = getDefaultLogger();
  private eventBus = getDefaultEventBus();

  constructor() {
    this.initializeDefaultStrategies();
  }

  /**
   * 生成执行计划
   */
  async generatePlan(
    taskId: string,
    intents: ParsedIntent[],
    context?: PlanningContext
  ): Promise<Plan> {
    this.logger.info('Generating plan', { taskId, intentsCount: intents.length });

    if (intents.length === 0) {
      throw new Error('No intents provided for planning');
    }

    // 选择最佳策略
    const strategy = this.selectBestStrategy(intents[0], context);
    if (!strategy) {
      throw new Error('No suitable planning strategy found');
    }

    this.logger.debug(`Selected strategy: ${strategy.name}`, { strategyId: strategy.id });

    // 生成步骤
    const allSteps: Step[] = [];
    let stepOrder = 0;

    for (const intent of intents) {
      const steps = strategy.generateSteps(intent, context);
      
      // 更新步骤顺序和ID
      for (const step of steps) {
        step.order = stepOrder++;
        step.id = `${taskId}_step_${step.order}`;
        allSteps.push(step);
      }
    }

    // 优化步骤序列
    const optimizedSteps = this.optimizeSteps(allSteps, context);

    // 评估风险
    const riskLevel = strategy.assessRisk(optimizedSteps, context);

    // 估算执行时间
    const estimatedDuration = strategy.estimateDuration(optimizedSteps);

    // 生成元数据
    const metadata = this.generateMetadata(intents, optimizedSteps, context);

    const plan: Plan = {
      id: `plan_${taskId}_${Date.now()}`,
      taskId,
      steps: optimizedSteps,
      riskLevel,
      meta: metadata,
      createdAt: new Date(),
      estimatedDuration
    };

    // 验证计划
    const validation = this.validatePlan(plan);
    if (!validation.valid) {
      this.logger.error('Plan validation failed', { errors: validation.errors });
      throw new Error(`Plan validation failed: ${validation.errors.join(', ')}`);
    }

    if (validation.warnings.length > 0) {
      this.logger.warn('Plan validation warnings', { warnings: validation.warnings });
    }

    this.logger.info('Plan generated successfully', {
      planId: plan.id,
      stepsCount: plan.steps.length,
      riskLevel: plan.riskLevel,
      estimatedDuration: plan.estimatedDuration
    });

    return plan;
  }

  /**
   * 注册计划策略
   */
  registerStrategy(strategy: PlanningStrategy): void {
    this.strategies.set(strategy.id, strategy);
    this.logger.debug(`Registered planning strategy: ${strategy.name}`, { strategyId: strategy.id });
  }

  /**
   * 获取所有策略
   */
  getStrategies(): PlanningStrategy[] {
    return Array.from(this.strategies.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * 验证计划
   */
  validatePlan(plan: Plan): PlanValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // 基本验证
    if (!plan.id) errors.push('Plan ID is required');
    if (!plan.taskId) errors.push('Task ID is required');
    if (!plan.steps || plan.steps.length === 0) errors.push('Plan must have at least one step');

    // 步骤验证
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepErrors = this.validateStep(step, i);
      errors.push(...stepErrors);
    }

    // 步骤顺序验证
    const orderErrors = this.validateStepOrder(plan.steps);
    errors.push(...orderErrors);

    // 风险评估
    if (plan.riskLevel === RiskLevel.HIGH || plan.riskLevel === RiskLevel.CRITICAL) {
      warnings.push(`Plan has ${plan.riskLevel} risk level`);
    }

    // 性能建议
    if (plan.estimatedDuration && plan.estimatedDuration > 300000) { // 5分钟
      suggestions.push('Consider breaking down the plan into smaller tasks');
    }

    if (plan.steps.length > 20) {
      suggestions.push('Large number of steps may indicate complex task - consider simplification');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions
    };
  }

  /**
   * 优化计划
   */
  async optimizePlan(plan: Plan, context?: PlanningContext): Promise<Plan> {
    this.logger.debug('Optimizing plan', { planId: plan.id });

    const optimizedSteps = this.optimizeSteps(plan.steps, context);
    
    return {
      ...plan,
      steps: optimizedSteps,
      meta: {
        ...plan.meta,
        description: plan.meta.description + ' (optimized)'
      }
    };
  }

  /**
   * 选择最佳策略
   */
  private selectBestStrategy(
    intent: ParsedIntent,
    context?: PlanningContext
  ): PlanningStrategy | null {
    const candidates = Array.from(this.strategies.values())
      .filter(strategy => strategy.canHandle(intent, context))
      .sort((a, b) => b.priority - a.priority);

    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * 优化步骤序列
   */
  private optimizeSteps(steps: Step[], context?: PlanningContext): Step[] {
    let optimized = [...steps];

    // 合并连续的等待步骤
    optimized = this.mergeWaitSteps(optimized);

    // 移除冗余的导航步骤
    optimized = this.removeRedundantNavigation(optimized);

    // 优化选择器候选
    optimized = this.optimizeSelectors(optimized);

    // 调整超时和重试配置
    optimized = this.adjustTimeoutsAndRetries(optimized, context);

    return optimized;
  }

  /**
   * 合并连续的等待步骤
   */
  private mergeWaitSteps(steps: Step[]): Step[] {
    const merged: Step[] = [];
    let i = 0;

    while (i < steps.length) {
      const step = steps[i];
      
      if (step.action === ActionType.WAIT && i < steps.length - 1) {
        const nextStep = steps[i + 1];
        if (nextStep.action === ActionType.WAIT) {
          // 合并等待时间
          const totalTimeout = step.timeout + nextStep.timeout;
          merged.push({
            ...step,
            timeout: totalTimeout,
            description: `${step.description} + ${nextStep.description}`
          });
          i += 2; // 跳过下一个步骤
          continue;
        }
      }
      
      merged.push(step);
      i++;
    }

    return merged;
  }

  /**
   * 移除冗余的导航步骤
   */
  private removeRedundantNavigation(steps: Step[]): Step[] {
    const filtered: Step[] = [];
    let lastNavigateUrl: string | undefined;

    for (const step of steps) {
      if (step.action === ActionType.NAVIGATE) {
        const currentUrl = step.params.url;
        if (currentUrl !== lastNavigateUrl) {
          filtered.push(step);
          lastNavigateUrl = currentUrl;
        }
        // 跳过重复的导航
      } else {
        filtered.push(step);
      }
    }

    return filtered;
  }

  /**
   * 优化选择器候选
   */
  private optimizeSelectors(steps: Step[]): Step[] {
    return steps.map(step => {
      if (step.selectorCandidates.length > 5) {
        // 只保留前5个最高分的选择器
        const topSelectors = step.selectorCandidates
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);
        
        return {
          ...step,
          selectorCandidates: topSelectors
        };
      }
      return step;
    });
  }

  /**
   * 调整超时和重试配置
   */
  private adjustTimeoutsAndRetries(steps: Step[], context?: PlanningContext): Step[] {
    const userPrefs = context?.userPreferences;
    
    return steps.map(step => {
      const adjustedStep = { ...step };
      
      // 应用用户偏好的超时设置
      if (userPrefs?.timeout && step.timeout < userPrefs.timeout) {
        adjustedStep.timeout = userPrefs.timeout;
      }
      
      // 应用用户偏好的重试设置
      if (userPrefs?.retries) {
        adjustedStep.retries = {
          ...step.retries,
          maxAttempts: Math.max(step.retries.maxAttempts, userPrefs.retries)
        };
      }
      
      return adjustedStep;
    });
  }

  /**
   * 生成计划元数据
   */
  private generateMetadata(
    intents: ParsedIntent[],
    steps: Step[],
    context?: PlanningContext
  ): PlanMetadata {
    const warnings: string[] = [];
    const requirements: string[] = [];
    const tags: string[] = [];

    // 分析意图生成标签
    const actions = new Set(intents.map(intent => intent.action));
    tags.push(...Array.from(actions));

    // 检查是否需要特殊权限
    if (actions.has(ActionType.NAVIGATE)) {
      requirements.push('Network access required');
    }
    
    if (actions.has(ActionType.SCREENSHOT)) {
      requirements.push('Screenshot permission required');
    }

    // 生成警告
    const highRiskActions = [ActionType.EVALUATE, ActionType.PRESS_KEY];
    if (highRiskActions.some(action => actions.has(action))) {
      warnings.push('Plan contains potentially risky actions');
    }

    if (steps.length > 15) {
      warnings.push('Plan has many steps - execution may take significant time');
    }

    // 提取目标URL
    const navigateSteps = steps.filter(step => step.action === ActionType.NAVIGATE);
    const targetUrl = navigateSteps.length > 0 ? navigateSteps[0].params.url : context?.currentUrl;

    return {
      targetUrl,
      description: this.generateDescription(intents, steps),
      tags,
      warnings,
      requirements
    };
  }

  /**
   * 生成计划描述
   */
  private generateDescription(intents: ParsedIntent[], steps: Step[]): string {
    if (intents.length === 1) {
      return `Execute ${intents[0].action} action with ${steps.length} steps`;
    }
    
    const actionCounts = intents.reduce((acc, intent) => {
      acc[intent.action] = (acc[intent.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    const actionSummary = Object.entries(actionCounts)
      .map(([action, count]) => `${count} ${action}`)
      .join(', ');
    
    return `Multi-action plan: ${actionSummary} (${steps.length} total steps)`;
  }

  /**
   * 验证单个步骤
   */
  private validateStep(step: Step, index: number): string[] {
    const errors: string[] = [];
    
    if (!step.id) errors.push(`Step ${index}: ID is required`);
    if (!step.action) errors.push(`Step ${index}: Action is required`);
    if (step.order < 0) errors.push(`Step ${index}: Order must be non-negative`);
    if (step.timeout <= 0) errors.push(`Step ${index}: Timeout must be positive`);
    
    // 验证选择器候选
    if (step.selectorCandidates.length === 0 && this.requiresSelector(step.action)) {
      errors.push(`Step ${index}: Action ${step.action} requires selector candidates`);
    }
    
    // 验证参数
    const paramErrors = this.validateStepParams(step.action, step.params, index);
    errors.push(...paramErrors);
    
    return errors;
  }

  /**
   * 验证步骤顺序
   */
  private validateStepOrder(steps: Step[]): string[] {
    const errors: string[] = [];
    
    for (let i = 0; i < steps.length; i++) {
      if (steps[i].order !== i) {
        errors.push(`Step order mismatch: expected ${i}, got ${steps[i].order}`);
      }
    }
    
    return errors;
  }

  /**
   * 检查动作是否需要选择器
   */
  private requiresSelector(action: ActionType): boolean {
    return [
      ActionType.CLICK,
      ActionType.TYPE,
      ActionType.SELECT,
      ActionType.HOVER,
      ActionType.EXTRACT
    ].includes(action);
  }

  /**
   * 验证步骤参数
   */
  private validateStepParams(action: ActionType, params: StepParams, stepIndex: number): string[] {
    const errors: string[] = [];
    
    switch (action) {
      case ActionType.NAVIGATE:
        if (!params.url) {
          errors.push(`Step ${stepIndex}: Navigate action requires URL parameter`);
        }
        break;
        
      case ActionType.TYPE:
        if (!params.text) {
          errors.push(`Step ${stepIndex}: Type action requires text parameter`);
        }
        break;
        
      case ActionType.SELECT:
        if (!params.value) {
          errors.push(`Step ${stepIndex}: Select action requires value parameter`);
        }
        break;
        
      case ActionType.PRESS_KEY:
        if (!params.key) {
          errors.push(`Step ${stepIndex}: Press key action requires key parameter`);
        }
        break;
    }
    
    return errors;
  }

  /**
   * 初始化默认策略
   */
  private initializeDefaultStrategies(): void {
    // 基础策略 - 处理单一动作
    this.registerStrategy({
      id: 'basic-single-action',
      name: 'Basic Single Action',
      description: 'Handles simple single-action intents',
      priority: 50,
      canHandle: (intent) => true, // 可以处理任何意图
      generateSteps: (intent) => this.generateBasicSteps(intent),
      estimateDuration: (steps) => steps.length * 2000, // 每步2秒
      assessRisk: (steps) => this.assessBasicRisk(steps)
    });

    // 导航策略 - 专门处理页面导航
    this.registerStrategy({
      id: 'navigation-strategy',
      name: 'Navigation Strategy',
      description: 'Optimized for navigation actions',
      priority: 80,
      canHandle: (intent) => intent.action === ActionType.NAVIGATE,
      generateSteps: (intent) => this.generateNavigationSteps(intent),
      estimateDuration: (steps) => steps.length * 3000, // 导航较慢
      assessRisk: () => RiskLevel.LOW // 导航风险较低
    });

    // 表单填写策略
    this.registerStrategy({
      id: 'form-filling-strategy',
      name: 'Form Filling Strategy',
      description: 'Optimized for form interactions',
      priority: 70,
      canHandle: (intent) => [ActionType.TYPE, ActionType.SELECT, ActionType.CLICK].includes(intent.action),
      generateSteps: (intent) => this.generateFormSteps(intent),
      estimateDuration: (steps) => steps.length * 1500,
      assessRisk: (steps) => this.assessFormRisk(steps)
    });

    this.logger.info(`Initialized ${this.strategies.size} planning strategies`);
  }

  /**
   * 生成基础步骤
   */
  private generateBasicSteps(intent: ParsedIntent): Step[] {
    const step: Step = {
      id: '', // 将在generatePlan中设置
      planId: '', // 将在generatePlan中设置
      order: 0, // 将在generatePlan中设置
      action: intent.action,
      selectorCandidates: this.generateSelectorCandidates(intent),
      params: this.convertIntentParams(intent),
      waitFor: this.generateWaitCondition(intent),
      retries: { maxAttempts: 3, delay: 1000, backoff: true },
      timeout: 10000,
      description: intent.target?.description || `Execute ${intent.action}`,
      isOptional: false
    };

    return [step];
  }

  /**
   * 生成导航步骤
   */
  private generateNavigationSteps(intent: ParsedIntent): Step[] {
    const steps: Step[] = [];

    // 主导航步骤
    steps.push({
      id: '',
      planId: '',
      order: 0,
      action: ActionType.NAVIGATE,
      selectorCandidates: [],
      params: { url: intent.parameters?.url || '' },
      waitFor: { type: WaitType.NAVIGATION, timeout: 15000 },
      retries: { maxAttempts: 2, delay: 2000, backoff: false },
      timeout: 15000,
      description: `Navigate to ${intent.parameters?.url}`,
      isOptional: false
    });

    // 等待页面加载完成
    steps.push({
      id: '',
      planId: '',
      order: 1,
      action: ActionType.WAIT,
      selectorCandidates: [],
      params: {},
      waitFor: { type: WaitType.NETWORK_IDLE, timeout: 5000 },
      retries: { maxAttempts: 1, delay: 0, backoff: false },
      timeout: 5000,
      description: 'Wait for page to load completely',
      isOptional: true
    });

    return steps;
  }

  /**
   * 生成表单步骤
   */
  private generateFormSteps(intent: ParsedIntent): Step[] {
    const steps: Step[] = [];

    // 如果是输入操作，先点击元素获得焦点
    if (intent.action === ActionType.TYPE) {
      steps.push({
        id: '',
        planId: '',
        order: 0,
        action: ActionType.CLICK,
        selectorCandidates: this.generateSelectorCandidates(intent),
        params: {},
        waitFor: { type: WaitType.ELEMENT, timeout: 5000 },
        retries: { maxAttempts: 3, delay: 500, backoff: true },
        timeout: 5000,
        description: `Click ${intent.target?.description} to focus`,
        isOptional: false
      });
    }

    // 主要操作步骤
    steps.push({
      id: '',
      planId: '',
      order: steps.length,
      action: intent.action,
      selectorCandidates: this.generateSelectorCandidates(intent),
      params: this.convertIntentParams(intent),
      waitFor: this.generateWaitCondition(intent),
      retries: { maxAttempts: 3, delay: 1000, backoff: true },
      timeout: 8000,
      description: intent.target?.description || `Execute ${intent.action}`,
      isOptional: false
    });

    return steps;
  }

  /**
   * 生成选择器候选
   */
  private generateSelectorCandidates(intent: ParsedIntent): SelectorCandidate[] {
    if (!intent.target?.selectors) {
      return [];
    }

    return intent.target.selectors.map(selector => ({
      type: selector.type,
      value: selector.value,
      score: Math.round(selector.confidence * 100),
      description: `${selector.type}: ${selector.value}`,
      fallback: selector.confidence < 0.7
    }));
  }

  /**
   * 转换意图参数
   */
  private convertIntentParams(intent: ParsedIntent): StepParams {
    const params = intent.parameters || {};
    return {
      text: params.text,
      url: params.url,
      value: params.value,
      key: (params as any).key, // 类型断言处理可能的key属性
      coordinates: params.coordinates,
      options: params.options
    };
  }

  /**
   * 生成等待条件
   */
  private generateWaitCondition(intent: ParsedIntent): WaitCondition {
    const timeout = intent.conditions?.timeout || 5000;
    
    switch (intent.action) {
      case ActionType.NAVIGATE:
        return { type: WaitType.NAVIGATION, timeout };
      case ActionType.CLICK:
      case ActionType.TYPE:
      case ActionType.SELECT:
        return { type: WaitType.ELEMENT, timeout };
      default:
        return { type: WaitType.TIMEOUT, timeout };
    }
  }

  /**
   * 评估基础风险
   */
  private assessBasicRisk(steps: Step[]): RiskLevel {
    const riskActions = [ActionType.EVALUATE, ActionType.PRESS_KEY];
    const hasRiskActions = steps.some(step => riskActions.includes(step.action));
    
    if (hasRiskActions) return RiskLevel.HIGH;
    if (steps.length > 10) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }

  /**
   * 评估表单风险
   */
  private assessFormRisk(steps: Step[]): RiskLevel {
    // 表单操作通常风险较低
    if (steps.length > 8) return RiskLevel.MEDIUM;
    return RiskLevel.LOW;
  }
}

// 默认计划器实例
let defaultPlanner: Planner | null = null;

export function getDefaultPlanner(): Planner {
  if (!defaultPlanner) {
    defaultPlanner = new Planner();
  }
  return defaultPlanner;
}

export function setDefaultPlanner(planner: Planner): void {
  defaultPlanner = planner;
}