/**
 * 计划策略集合
 * 提供各种专门的计划生成策略
 */

import { 
  ActionType, 
  RiskLevel, 
  Step, 
  WaitType,
  SelectorType 
} from '../core/types';
import { ParsedIntent } from '../core/types';
import { PlanningStrategy, PlanningContext } from './planner';

/**
 * 电商网站策略
 * 专门处理电商网站的常见操作流程
 */
export const ECommerceStrategy: PlanningStrategy = {
  id: 'ecommerce-strategy',
  name: 'E-Commerce Strategy',
  description: 'Optimized for e-commerce website interactions',
  priority: 90,
  
  canHandle: (intent: ParsedIntent, context?: PlanningContext) => {
    const domain = context?.currentUrl ? new URL(context.currentUrl).hostname : '';
    const ecommerceDomains = ['taobao.com', 'tmall.com', 'jd.com', 'amazon.com', 'shopify.com'];
    return ecommerceDomains.some(d => domain.includes(d)) || 
           intent.context?.pageType === 'product' ||
           intent.context?.pageType === 'cart';
  },
  
  generateSteps: (intent: ParsedIntent) => {
    const steps: Step[] = [];
    
    switch (intent.action) {
      case ActionType.CLICK:
        // 电商网站点击通常需要等待加载
        steps.push({
          id: '',
          planId: '',
          order: 0,
          action: ActionType.CLICK,
          selectorCandidates: generateECommerceSelectors(intent),
          params: {},
          waitFor: { type: WaitType.ELEMENT, timeout: 8000 },
          retries: { maxAttempts: 3, delay: 1500, backoff: true },
          timeout: 8000,
          description: `Click ${intent.target?.description} (e-commerce optimized)`,
          isOptional: false
        });
        
        // 等待页面响应
        steps.push({
          id: '',
          planId: '',
          order: 1,
          action: ActionType.WAIT,
          selectorCandidates: [],
          params: {},
          waitFor: { type: WaitType.NETWORK_IDLE, timeout: 3000 },
          retries: { maxAttempts: 1, delay: 0, backoff: false },
          timeout: 3000,
          description: 'Wait for e-commerce page to load',
          isOptional: true
        });
        break;
        
      default:
        // 使用基础步骤生成
        steps.push(generateBasicStep(intent));
    }
    
    return steps;
  },
  
  estimateDuration: (steps: Step[]) => {
    // 电商网站通常较慢
    return steps.length * 3000;
  },
  
  assessRisk: () => RiskLevel.LOW
};

/**
 * 搜索引擎策略
 */
export const SearchEngineStrategy: PlanningStrategy = {
  id: 'search-engine-strategy',
  name: 'Search Engine Strategy',
  description: 'Optimized for search engine interactions',
  priority: 85,
  
  canHandle: (intent: ParsedIntent, context?: PlanningContext) => {
    const domain = context?.currentUrl ? new URL(context.currentUrl).hostname : '';
    const searchDomains = ['google.com', 'baidu.com', 'bing.com', 'yahoo.com'];
    return searchDomains.some(d => domain.includes(d)) ||
           intent.context?.pageType === 'search';
  },
  
  generateSteps: (intent: ParsedIntent) => {
    const steps: Step[] = [];
    
    if (intent.action === ActionType.TYPE && intent.parameters?.text) {
      // 搜索输入优化
      steps.push({
        id: '',
        planId: '',
        order: 0,
        action: ActionType.CLICK,
        selectorCandidates: [
          { type: SelectorType.CSS, value: 'input[type="search"]', score: 90, description: 'Search input', fallback: false },
          { type: SelectorType.CSS, value: 'input[name="q"]', score: 85, description: 'Query input', fallback: false },
          { type: SelectorType.CSS, value: '#search', score: 80, description: 'Search box', fallback: true }
        ],
        params: {},
        waitFor: { type: WaitType.ELEMENT, timeout: 5000 },
        retries: { maxAttempts: 2, delay: 500, backoff: false },
        timeout: 5000,
        description: 'Focus search input',
        isOptional: false
      });
      
      steps.push({
        id: '',
        planId: '',
        order: 1,
        action: ActionType.TYPE,
        selectorCandidates: [
          { type: SelectorType.CSS, value: 'input[type="search"]', score: 90, description: 'Search input', fallback: false },
          { type: SelectorType.CSS, value: 'input[name="q"]', score: 85, description: 'Query input', fallback: false }
        ],
        params: { text: intent.parameters.text },
        waitFor: { type: WaitType.ELEMENT, timeout: 3000 },
        retries: { maxAttempts: 3, delay: 500, backoff: true },
        timeout: 5000,
        description: `Type search query: ${intent.parameters.text}`,
        isOptional: false
      });
      
      // 提交搜索
      steps.push({
        id: '',
        planId: '',
        order: 2,
        action: ActionType.PRESS_KEY,
        selectorCandidates: [],
        params: { key: 'Enter' },
        waitFor: { type: WaitType.NAVIGATION, timeout: 10000 },
        retries: { maxAttempts: 2, delay: 1000, backoff: false },
        timeout: 10000,
        description: 'Submit search',
        isOptional: false
      });
    } else {
      steps.push(generateBasicStep(intent));
    }
    
    return steps;
  },
  
  estimateDuration: (steps: Step[]) => steps.length * 2500,
  assessRisk: () => RiskLevel.LOW
};

/**
 * 社交媒体策略
 */
export const SocialMediaStrategy: PlanningStrategy = {
  id: 'social-media-strategy',
  name: 'Social Media Strategy',
  description: 'Optimized for social media platform interactions',
  priority: 80,
  
  canHandle: (intent: ParsedIntent, context?: PlanningContext) => {
    const domain = context?.currentUrl ? new URL(context.currentUrl).hostname : '';
    const socialDomains = ['twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'weibo.com'];
    return socialDomains.some(d => domain.includes(d));
  },
  
  generateSteps: (intent: ParsedIntent) => {
    const steps: Step[] = [];
    
    // 社交媒体通常需要处理动态加载内容
    if (intent.action === ActionType.SCROLL) {
      steps.push({
        id: '',
        planId: '',
        order: 0,
        action: ActionType.SCROLL,
        selectorCandidates: [],
        params: { coordinates: { x: 0, y: 500 } },
        waitFor: { type: WaitType.TIMEOUT, timeout: 2000 },
        retries: { maxAttempts: 1, delay: 0, backoff: false },
        timeout: 3000,
        description: 'Scroll to load more content',
        isOptional: false
      });
      
      // 等待内容加载
      steps.push({
        id: '',
        planId: '',
        order: 1,
        action: ActionType.WAIT,
        selectorCandidates: [],
        params: {},
        waitFor: { type: WaitType.NETWORK_IDLE, timeout: 3000 },
        retries: { maxAttempts: 1, delay: 0, backoff: false },
        timeout: 3000,
        description: 'Wait for dynamic content to load',
        isOptional: true
      });
    } else {
      steps.push(generateBasicStep(intent));
    }
    
    return steps;
  },
  
  estimateDuration: (steps: Step[]) => steps.length * 2000,
  assessRisk: () => RiskLevel.LOW
};

/**
 * 表单填写策略
 */
export const FormFillingStrategy: PlanningStrategy = {
  id: 'form-filling-strategy',
  name: 'Form Filling Strategy',
  description: 'Optimized for complex form interactions',
  priority: 75,
  
  canHandle: (intent: ParsedIntent, context?: PlanningContext) => {
    return intent.context?.pageType === 'login' ||
           intent.context?.pageType === 'register' ||
           intent.action === ActionType.TYPE ||
           intent.action === ActionType.SELECT;
  },
  
  generateSteps: (intent: ParsedIntent) => {
    const steps: Step[] = [];
    
    if (intent.action === ActionType.TYPE) {
      // 表单输入优化流程
      steps.push({
        id: '',
        planId: '',
        order: 0,
        action: ActionType.CLICK,
        selectorCandidates: generateFormSelectors(intent),
        params: {},
        waitFor: { type: WaitType.ELEMENT, timeout: 5000 },
        retries: { maxAttempts: 3, delay: 500, backoff: true },
        timeout: 5000,
        description: `Focus ${intent.target?.description}`,
        isOptional: false
      });
      
      // 清空现有内容
      steps.push({
        id: '',
        planId: '',
        order: 1,
        action: ActionType.PRESS_KEY,
        selectorCandidates: [],
        params: { key: 'Control+a' },
        waitFor: { type: WaitType.TIMEOUT, timeout: 200 },
        retries: { maxAttempts: 1, delay: 0, backoff: false },
        timeout: 1000,
        description: 'Select all existing text',
        isOptional: true
      });
      
      // 输入新内容
      steps.push({
        id: '',
        planId: '',
        order: 2,
        action: ActionType.TYPE,
        selectorCandidates: generateFormSelectors(intent),
        params: { text: intent.parameters?.text },
        waitFor: { type: WaitType.ELEMENT, timeout: 3000 },
        retries: { maxAttempts: 3, delay: 500, backoff: true },
        timeout: 5000,
        description: `Type: ${intent.parameters?.text}`,
        isOptional: false
      });
      
      // 验证输入
      steps.push({
        id: '',
        planId: '',
        order: 3,
        action: ActionType.WAIT,
        selectorCandidates: [],
        params: {},
        waitFor: { type: WaitType.TIMEOUT, timeout: 500 },
        retries: { maxAttempts: 1, delay: 0, backoff: false },
        timeout: 1000,
        description: 'Wait for input validation',
        isOptional: true
      });
    } else {
      steps.push(generateBasicStep(intent));
    }
    
    return steps;
  },
  
  estimateDuration: (steps: Step[]) => steps.length * 1500,
  assessRisk: () => RiskLevel.LOW
};

/**
 * 数据提取策略
 */
export const DataExtractionStrategy: PlanningStrategy = {
  id: 'data-extraction-strategy',
  name: 'Data Extraction Strategy',
  description: 'Optimized for data scraping and extraction',
  priority: 70,
  
  canHandle: (intent: ParsedIntent) => {
    return intent.action === ActionType.EXTRACT;
  },
  
  generateSteps: (intent: ParsedIntent) => {
    const steps: Step[] = [];
    
    // 等待页面完全加载
    steps.push({
      id: '',
      planId: '',
      order: 0,
      action: ActionType.WAIT,
      selectorCandidates: [],
      params: {},
      waitFor: { type: WaitType.NETWORK_IDLE, timeout: 5000 },
      retries: { maxAttempts: 2, delay: 1000, backoff: false },
      timeout: 8000,
      description: 'Wait for page to fully load before extraction',
      isOptional: false
    });
    
    // 截图用于调试
    steps.push({
      id: '',
      planId: '',
      order: 1,
      action: ActionType.SCREENSHOT,
      selectorCandidates: [],
      params: {},
      waitFor: { type: WaitType.TIMEOUT, timeout: 1000 },
      retries: { maxAttempts: 1, delay: 0, backoff: false },
      timeout: 3000,
      description: 'Take screenshot before extraction',
      isOptional: true
    });
    
    // 执行数据提取
    steps.push({
      id: '',
      planId: '',
      order: 2,
      action: ActionType.EXTRACT,
      selectorCandidates: generateExtractionSelectors(intent),
      params: {},
      waitFor: { type: WaitType.ELEMENT, timeout: 5000 },
      retries: { maxAttempts: 3, delay: 1000, backoff: true },
      timeout: 10000,
      description: `Extract ${intent.target?.description}`,
      isOptional: false
    });
    
    return steps;
  },
  
  estimateDuration: (steps: Step[]) => steps.length * 2000,
  assessRisk: () => RiskLevel.LOW
};

/**
 * 生成电商网站选择器
 */
function generateECommerceSelectors(intent: ParsedIntent) {
  const selectors = [];
  const description = intent.target?.description?.toLowerCase() || '';
  
  if (description.includes('购买') || description.includes('buy')) {
    selectors.push(
      { type: SelectorType.CSS, value: '.buy-btn', score: 90, description: 'Buy button', fallback: false },
      { type: SelectorType.CSS, value: '[data-testid="buy-button"]', score: 85, description: 'Buy button testid', fallback: false },
      { type: SelectorType.TEXT, value: '立即购买', score: 80, description: 'Buy now text', fallback: true }
    );
  }
  
  if (description.includes('加入购物车') || description.includes('add to cart')) {
    selectors.push(
      { type: SelectorType.CSS, value: '.add-to-cart', score: 90, description: 'Add to cart button', fallback: false },
      { type: SelectorType.CSS, value: '[data-testid="add-to-cart"]', score: 85, description: 'Add to cart testid', fallback: false },
      { type: SelectorType.TEXT, value: '加入购物车', score: 80, description: 'Add to cart text', fallback: true }
    );
  }
  
  // 通用选择器
  if (selectors.length === 0) {
    selectors.push(
      { type: SelectorType.TEXT, value: intent.target?.description || '', score: 70, description: 'Text match', fallback: true }
    );
  }
  
  return selectors;
}

/**
 * 生成表单选择器
 */
function generateFormSelectors(intent: ParsedIntent) {
  const selectors = [];
  const description = intent.target?.description?.toLowerCase() || '';
  
  if (description.includes('用户名') || description.includes('username')) {
    selectors.push(
      { type: SelectorType.CSS, value: 'input[name="username"]', score: 95, description: 'Username input', fallback: false },
      { type: SelectorType.CSS, value: 'input[type="text"]', score: 80, description: 'Text input', fallback: true },
      { type: SelectorType.ID, value: 'username', score: 90, description: 'Username ID', fallback: false }
    );
  }
  
  if (description.includes('密码') || description.includes('password')) {
    selectors.push(
      { type: SelectorType.CSS, value: 'input[name="password"]', score: 95, description: 'Password input', fallback: false },
      { type: SelectorType.CSS, value: 'input[type="password"]', score: 90, description: 'Password type', fallback: false },
      { type: SelectorType.ID, value: 'password', score: 85, description: 'Password ID', fallback: false }
    );
  }
  
  if (description.includes('邮箱') || description.includes('email')) {
    selectors.push(
      { type: SelectorType.CSS, value: 'input[name="email"]', score: 95, description: 'Email input', fallback: false },
      { type: SelectorType.CSS, value: 'input[type="email"]', score: 90, description: 'Email type', fallback: false },
      { type: SelectorType.ID, value: 'email', score: 85, description: 'Email ID', fallback: false }
    );
  }
  
  // 通用表单选择器
  if (selectors.length === 0) {
    selectors.push(
      { type: SelectorType.TEXT, value: intent.target?.description || '', score: 70, description: 'Label text match', fallback: true },
      { type: SelectorType.CSS, value: 'input', score: 60, description: 'Any input', fallback: true }
    );
  }
  
  return selectors;
}

/**
 * 生成数据提取选择器
 */
function generateExtractionSelectors(intent: ParsedIntent) {
  const selectors = [];
  const description = intent.target?.description?.toLowerCase() || '';
  
  if (description.includes('列表') || description.includes('list')) {
    selectors.push(
      { type: SelectorType.CSS, value: 'ul li', score: 85, description: 'List items', fallback: false },
      { type: SelectorType.CSS, value: '.list-item', score: 80, description: 'List item class', fallback: false },
      { type: SelectorType.CSS, value: '[data-testid*="item"]', score: 75, description: 'Item testid', fallback: true }
    );
  }
  
  if (description.includes('表格') || description.includes('table')) {
    selectors.push(
      { type: SelectorType.CSS, value: 'table tr', score: 90, description: 'Table rows', fallback: false },
      { type: SelectorType.CSS, value: 'tbody tr', score: 85, description: 'Table body rows', fallback: false },
      { type: SelectorType.CSS, value: '.table-row', score: 80, description: 'Table row class', fallback: true }
    );
  }
  
  if (description.includes('价格') || description.includes('price')) {
    selectors.push(
      { type: SelectorType.CSS, value: '.price', score: 90, description: 'Price class', fallback: false },
      { type: SelectorType.CSS, value: '[data-testid*="price"]', score: 85, description: 'Price testid', fallback: false },
      { type: SelectorType.CSS, value: '.amount', score: 80, description: 'Amount class', fallback: true }
    );
  }
  
  // 通用提取选择器
  if (selectors.length === 0) {
    selectors.push(
      { type: SelectorType.TEXT, value: intent.target?.description || '', score: 70, description: 'Text content match', fallback: true },
      { type: SelectorType.CSS, value: '*', score: 50, description: 'All elements', fallback: true }
    );
  }
  
  return selectors;
}

/**
 * 生成基础步骤
 */
function generateBasicStep(intent: ParsedIntent): Step {
  return {
    id: '',
    planId: '',
    order: 0,
    action: intent.action,
    selectorCandidates: intent.target?.selectors?.map(s => ({
      type: s.type,
      value: s.value,
      score: Math.round(s.confidence * 100),
      description: `${s.type}: ${s.value}`,
      fallback: s.confidence < 0.7
    })) || [],
    params: {
      text: intent.parameters?.text,
      url: intent.parameters?.url,
      value: intent.parameters?.value,
      coordinates: intent.parameters?.coordinates,
      options: intent.parameters?.options
    },
    waitFor: { type: WaitType.ELEMENT, timeout: 5000 },
    retries: { maxAttempts: 3, delay: 1000, backoff: true },
    timeout: 8000,
    description: intent.target?.description || `Execute ${intent.action}`,
    isOptional: false
  };
}

/**
 * 获取所有内置策略
 */
export function getAllStrategies(): PlanningStrategy[] {
  return [
    ECommerceStrategy,
    SearchEngineStrategy,
    SocialMediaStrategy,
    FormFillingStrategy,
    DataExtractionStrategy
  ];
}

/**
 * 根据上下文推荐策略
 */
export function recommendStrategy(
  intent: ParsedIntent,
  context?: PlanningContext
): PlanningStrategy | null {
  const strategies = getAllStrategies();
  
  for (const strategy of strategies) {
    if (strategy.canHandle(intent, context)) {
      return strategy;
    }
  }
  
  return null;
}