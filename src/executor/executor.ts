/**
 * 执行器模块
 * 负责执行具体的浏览器操作，基于Puppeteer实现
 */

import { Browser, Page, ElementHandle, JSHandle } from 'puppeteer';
import { 
  Step, 
  ActionType, 
  Plan, 
  TaskStatus, 
  WaitType,
  SelectorType,
  SelectorCandidate,
  ExecutionResult,
  StepResult,
  RiskLevel
} from '../core/types';
import { getDefaultLogger } from '../core/logger';
import { getDefaultEventBus } from '../core/event-bus';
import { getDefaultErrorHandler, ErrorCode } from '../core/error-handler';
import { EventType } from '../core/types';

/**
 * 执行上下文
 */
export interface ExecutionContext {
  browser: Browser;
  page: Page;
  currentUrl: string;
  viewport: { width: number; height: number };
  userAgent: string;
  cookies: any[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  screenshots: string[];
  executionStartTime: number;
  stepResults: StepResult[];
}

/**
 * 执行配置
 */
export interface ExecutorConfig {
  headless: boolean;
  viewport: { width: number; height: number };
  userAgent: string;
  timeout: number;
  retryDelay: number;
  screenshotOnError: boolean;
  screenshotOnSuccess: boolean;
  enableLogging: boolean;
  enableMetrics: boolean;
  maxConcurrentPages: number;
  navigationTimeout: number;
  elementTimeout: number;
  // 新增：可选的浏览器可执行文件路径（用于使用系统已安装的 Chrome/Chromium）
  executablePath?: string;
  // 新增：反爬增强与环境伪装配置
  stealth?: boolean;
  devtools?: boolean;
  slowMo?: number;
  userDataDir?: string;
  locale?: string; // 如 zh-CN
  languages?: string[]; // 如 ['zh-CN','zh']
  timezone?: string; // 如 Asia/Shanghai
  extraHeaders?: Record<string, string>;
}

/**
 * 选择器解析结果
 */
interface SelectorResult {
  element: ElementHandle | null;
  selector: SelectorCandidate;
  found: boolean;
  error?: string;
}

/**
 * 执行器类
 */
export class Executor {
  private browser: Browser | null = null;
  private pages: Map<string, Page> = new Map();
  private contexts: Map<string, ExecutionContext> = new Map();
  private config: ExecutorConfig;
  private logger = getDefaultLogger();
  private eventBus = getDefaultEventBus();
  private errorHandler = getDefaultErrorHandler();

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = {
      headless: false,
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      timeout: 30000,
      retryDelay: 1000,
      screenshotOnError: true,
      screenshotOnSuccess: false,
      enableLogging: true,
      enableMetrics: true,
      maxConcurrentPages: 5,
      navigationTimeout: 30000,
      elementTimeout: 10000,
      // 反爬增强默认开启
      stealth: true,
      devtools: false,
      slowMo: 0,
      userDataDir: undefined,
      locale: 'zh-CN',
      languages: ['zh-CN', 'zh'],
      timezone: 'Asia/Shanghai',
      extraHeaders: undefined,
      ...config
    };
  }

  /**
   * 初始化浏览器
   */
  async initialize(): Promise<void> {
    try {
      let puppeteerLib: any;
      let useStealth = !!this.config.stealth;

      try {
        const puppeteerExtra = (await import('puppeteer-extra')).default as any;
        if (useStealth) {
          const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default as any;
          puppeteerExtra.use(StealthPlugin());
        }
        puppeteerLib = puppeteerExtra;
        this.logger.info(`Using puppeteer-extra${useStealth ? ' with stealth' : ''}`);
      } catch (e) {
        // 回退到原生 puppeteer
        const puppeteer = await import('puppeteer');
        puppeteerLib = puppeteer;
        useStealth = false;
        this.logger.warn('puppeteer-extra not available, falling back to puppeteer');
      }

      // 允许通过配置或环境变量指定可执行文件路径
      const envExecutable = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
      const executablePath = this.config.executablePath || envExecutable;

      // Prefer system Chrome channel when no explicit executablePath provided
      const channel = process.env.PUPPETEER_CHANNEL || (process.platform === 'darwin' ? 'chrome' : (process.platform === 'win32' ? 'chrome' : 'chromium'));

      const launchOptions: any = {
        headless: this.config.headless,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          this.config.locale ? `--lang=${this.config.locale}` : undefined
        ].filter(Boolean),
        defaultViewport: this.config.viewport,
        devtools: this.config.devtools,
        slowMo: this.config.slowMo,
        userDataDir: this.config.userDataDir
      };

      if (executablePath) {
        launchOptions.executablePath = executablePath;
        this.logger.info('Using custom Chrome executable', { executablePath });
      } else if (channel) {
        launchOptions.channel = channel;
        this.logger.info('Using browser channel', { channel });
      }
      
      this.browser = (await puppeteerLib.launch(launchOptions)) as unknown as Browser;

      this.logger.info('Browser initialized successfully');
      
      this.eventBus.emit(EventType.EXECUTOR_INITIALIZED, {
        browserId: this.browser.process()?.pid,
        config: this.config
      });
    } catch (error) {
      // 更详细的错误日志，便于排查
      const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { raw: String(error) };
      this.logger.error('Failed to initialize browser:', err as any);
      throw this.errorHandler.createError(
        ErrorCode.BROWSER_LAUNCH_ERROR,
        'Failed to initialize browser',
        { originalError: error instanceof Error ? error : new Error(String(error)) }
      );
    }
  }

  /**
   * 执行计划
   */
  async executePlan(plan: Plan): Promise<ExecutionResult> {
    if (!this.browser) {
      throw this.errorHandler.createError(ErrorCode.BROWSER_ERROR, 'Browser not initialized');
    }

    const startTime = Date.now();
    const planId = plan.id;
    
    this.logger.info(`Starting execution of plan: ${planId}`);
    
    try {
      // 创建新页面
      const page = await this.createPage(planId);
      
      // 创建执行上下文
      const context = await this.createExecutionContext(page, planId);
      
      // 执行步骤
      const stepResults: StepResult[] = [];
      let currentStep = 0;
      
      for (const step of plan.steps) {
        currentStep++;
        this.logger.info(`Executing step ${currentStep}/${plan.steps.length}: ${step.description}`);
        
        try {
          const stepResult = await this.executeStep(step, context);
          stepResults.push(stepResult);
          
          // 更新上下文
          context.stepResults.push(stepResult);
          
          // 如果步骤失败且不是可选的，停止执行
          if (!stepResult.success && !step.isOptional) {
            this.logger.error(`Critical step failed: ${step.description}`);
            break;
          }
          
          // 发送进度事件
          this.eventBus.emit(EventType.EXECUTOR_STEP_COMPLETED, {
            planId,
            stepId: step.id,
            stepResult,
            progress: currentStep / plan.steps.length
          });
          
        } catch (error) {
          const stepResult: StepResult = {
            stepId: step.id,
            success: false,
            error: error instanceof Error ? error.message : String(error),
            duration: 0,
            timestamp: Date.now(),
            screenshots: [],
            data: null
          };
          
          stepResults.push(stepResult);
          
          if (!step.isOptional) {
            this.logger.error(`Critical step failed with exception: ${step.description}`, error);
            break;
          }
        }
      }
      
      // 计算执行结果
      const duration = Date.now() - startTime;
      const successfulSteps = stepResults.filter(r => r.success).length;
      const success = successfulSteps === plan.steps.length || 
                     stepResults.every(r => r.success || plan.steps.find(s => s.id === r.stepId)?.isOptional);
      
      const result: ExecutionResult = {
        planId,
        success,
        duration,
        stepResults,
        totalSteps: plan.steps.length,
        successfulSteps,
        failedSteps: stepResults.length - successfulSteps,
        screenshots: context.screenshots,
        finalUrl: context.currentUrl,
        error: success ? undefined : 'Some critical steps failed',
        metadata: {
          browserInfo: await this.getBrowserInfo(),
          executionContext: {
            viewport: context.viewport,
            userAgent: context.userAgent,
            startTime: context.executionStartTime,
            endTime: Date.now()
          }
        }
      };
      
      this.logger.info(`Plan execution completed: ${success ? 'SUCCESS' : 'FAILED'} (${duration}ms)`);
      
      // 清理资源（已禁用，保留页面与浏览器以便交互）
      // await this.cleanupContext(planId);
      
      return result;
      
    } catch (error) {
      this.logger.error('Plan execution failed:', error);
      
      // 清理资源（已禁用，保留页面与浏览器以便交互）
      // await this.cleanupContext(planId);
      
      throw this.errorHandler.createError(
        ErrorCode.PLAN_EXECUTION_FAILED,
        'Plan execution failed',
        { context: { planId }, originalError: error instanceof Error ? error : new Error(String(error)) }
      );
    }
  }

  /**
   * 执行单个步骤
   */
  async executeStep(step: Step, context: ExecutionContext): Promise<StepResult> {
    const startTime = Date.now();
    const stepId = step.id;
    
    this.logger.debug(`Executing step: ${step.action} - ${step.description}`);
    
    try {
      let result: any = null;
      let screenshots: string[] = [];
      
      // 执行前截图（如果配置启用）
      if (this.config.screenshotOnSuccess) {
        const screenshot = await this.takeScreenshot(context.page, `before_${stepId}`);
        screenshots.push(screenshot);
      }
      
      // 根据动作类型执行相应操作
      switch (step.action) {
        case ActionType.NAVIGATE:
          result = await this.executeNavigate(step, context);
          break;
        case ActionType.CLICK:
          result = await this.executeClick(step, context);
          break;
        case ActionType.TYPE:
          result = await this.executeType(step, context);
          break;
        case ActionType.SELECT:
          result = await this.executeSelect(step, context);
          break;
        case ActionType.SCROLL:
          result = await this.executeScroll(step, context);
          break;
        case ActionType.WAIT:
          result = await this.executeWait(step, context);
          break;
        case ActionType.PRESS_KEY:
          result = await this.executePressKey(step, context);
          break;
        case ActionType.EXTRACT:
          result = await this.executeExtract(step, context);
          break;
        case ActionType.SCREENSHOT:
          result = await this.executeScreenshot(step, context);
          screenshots.push(result);
          break;
        default:
          throw new Error(`Unsupported action type: ${step.action}`);
      }
      
      // 执行后等待（如果配置了等待条件）
      if (step.waitFor) {
        await this.waitForCondition(step.waitFor, context);
      }
      
      // 执行后截图
      if (this.config.screenshotOnSuccess) {
        const screenshot = await this.takeScreenshot(context.page, `after_${stepId}`);
        screenshots.push(screenshot);
      }
      
      const duration = Date.now() - startTime;
      
      return {
        stepId,
        success: true,
        duration,
        timestamp: startTime,
        screenshots,
        data: result
      };
      
    } catch (error) {
      const duration = Date.now() - startTime;
      let screenshots: string[] = [];
      
      // 错误时截图
      if (this.config.screenshotOnError) {
        try {
          const screenshot = await this.takeScreenshot(context.page, `error_${stepId}`);
          screenshots.push(screenshot);
        } catch (screenshotError) {
          this.logger.warn('Failed to take error screenshot:', screenshotError);
        }
      }
      
      this.logger.error(`Step execution failed: ${step.description}`, error);
      
      return {
        stepId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
        timestamp: startTime,
        screenshots,
        data: null
      };
    }
  }

  /**
   * 执行导航操作
   */
  private async executeNavigate(step: Step, context: ExecutionContext): Promise<any> {
    const url = step.params?.url;
    if (!url) {
      throw new Error('Navigate action requires URL parameter');
    }
    
    this.logger.debug(`Navigating to: ${url}`);
    
    const response = await context.page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: this.config.navigationTimeout
    });

    // 额外等待稳定：网络空闲或首屏稳定
    try {
      await context.page.waitForNetworkIdle({ idleTime: 800, timeout: Math.min(10000, this.config.navigationTimeout) });
    } catch {}
    try {
      await context.page.waitForFunction(() => document.readyState === 'complete', { timeout: Math.min(10000, this.config.navigationTimeout) });
    } catch {}
    
    // 更新上下文URL
    context.currentUrl = context.page.url();
    
    return {
      url: context.currentUrl,
      status: response?.status(),
      headers: response?.headers()
    };
  }

  /**
   * 执行点击操作
   */
  private async executeClick(step: Step, context: ExecutionContext): Promise<any> {
    const selectorResult = await this.findElement(step.selectorCandidates, context.page);
    
    if (!selectorResult.element) {
      throw new Error(`Element not found for click: ${selectorResult.error || 'Unknown error'}`);
    }
    
    // 滚动到元素可见
    await selectorResult.element.scrollIntoView();
    
    // 等待元素可点击
    await context.page.waitForFunction(
      (element) => {
        const el = element as Element;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && 
               window.getComputedStyle(el).visibility !== 'hidden';
      },
      { timeout: this.config.elementTimeout },
      selectorResult.element
    );
    
    // 执行点击
    await selectorResult.element.click();
    
    return {
      selector: selectorResult.selector,
      clicked: true
    };
  }

  /**
   * 执行输入操作
   */
  private async executeType(step: Step, context: ExecutionContext): Promise<any> {
    const text = step.params?.text;
    if (!text) {
      throw new Error('Type action requires text parameter');
    }
    
    const selectorResult = await this.findElement(step.selectorCandidates, context.page);
    
    if (!selectorResult.element) {
      throw new Error(`Element not found for typing: ${selectorResult.error || 'Unknown error'}`);
    }
    
    // 清空现有内容
    await selectorResult.element.click({ clickCount: 3 });
    
    // 输入文本
    await selectorResult.element.type(text, { delay: 50 });
    
    return {
      selector: selectorResult.selector,
      text,
      typed: true
    };
  }

  /**
   * 执行选择操作
   */
  private async executeSelect(step: Step, context: ExecutionContext): Promise<any> {
    const value = step.params?.value;
    if (!value) {
      throw new Error('Select action requires value parameter');
    }
    
    const selectorResult = await this.findElement(step.selectorCandidates, context.page);
    
    if (!selectorResult.element) {
      throw new Error(`Element not found for selection: ${selectorResult.error || 'Unknown error'}`);
    }
    
    // 执行选择
    await context.page.select(selectorResult.selector.value, value);
    
    return {
      selector: selectorResult.selector,
      value,
      selected: true
    };
  }

  /**
   * 执行滚动操作
   */
  private async executeScroll(step: Step, context: ExecutionContext): Promise<any> {
    const coordinates = step.params?.coordinates;
    
    if (coordinates) {
      // 滚动到指定坐标
      await context.page.evaluate((x, y) => {
        window.scrollBy(x, y);
      }, coordinates.x || 0, coordinates.y || 0);
      
      return {
        scrolled: true,
        coordinates
      };
    } else {
      // 滚动到页面底部
      await context.page.evaluate(() => {
        window.scrollTo(0, document.body.scrollHeight);
      });
      
      return {
        scrolled: true,
        toBottom: true
      };
    }
  }

  /**
   * 执行等待操作
   */
  private async executeWait(step: Step, context: ExecutionContext): Promise<any> {
    const waitCondition = step.waitFor;
    if (!waitCondition) {
      // 默认等待1秒
      await new Promise(resolve => global.setTimeout(resolve, 1000));
      return { waited: true, duration: 1000 };
    }
    
    return await this.waitForCondition(waitCondition, context);
  }

  /**
   * 执行按键操作
   */
  private async executePressKey(step: Step, context: ExecutionContext): Promise<any> {
    const key = step.params?.key;
    if (!key) {
      throw new Error('Press key action requires key parameter');
    }
    
    await context.page.keyboard.press(key as any);
    
    return {
      key,
      pressed: true
    };
  }

  /**
   * 执行数据提取操作
   */
  private async executeExtract(step: Step, context: ExecutionContext): Promise<any> {
    const selectorResult = await this.findElement(step.selectorCandidates, context.page);
    
    if (!selectorResult.element) {
      throw new Error(`Element not found for extraction: ${selectorResult.error || 'Unknown error'}`);
    }
    
    // 提取元素数据
    const data = await context.page.evaluate((element) => {
      const el = element as Element;
      return {
        text: el.textContent?.trim(),
        html: el.innerHTML,
        attributes: Array.from(el.attributes).reduce((acc, attr) => {
          acc[attr.name] = attr.value;
          return acc;
        }, {} as Record<string, string>),
        tagName: el.tagName.toLowerCase(),
        className: el.className,
        id: el.id
      };
    }, selectorResult.element);
    
    return {
      selector: selectorResult.selector,
      data,
      extracted: true
    };
  }

  /**
   * 执行截图操作
   */
  private async executeScreenshot(step: Step, context: ExecutionContext): Promise<string> {
    return await this.takeScreenshot(context.page, `step_${step.id}`);
  }

  /**
   * 查找元素
   */
  private async findElement(candidates: SelectorCandidate[], page: Page): Promise<SelectorResult> {
    // 按分数排序候选选择器
    const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score);
    
    for (const candidate of sortedCandidates) {
      try {
        let element: ElementHandle | null = null;
        
        switch (candidate.type) {
          case SelectorType.CSS:
            element = await page.$(candidate.value);
            break;
          case SelectorType.XPATH:
            const elements = await page.$x(candidate.value);
            element = elements[0] as any || null;
            break;
          case SelectorType.TEXT:
            element = await page.evaluateHandle((text) => {
              const walker = document.createTreeWalker(
                document.body,
                NodeFilter.SHOW_TEXT,
                null
              );
              
              let node;
              while (node = walker.nextNode()) {
                if (node.textContent?.includes(text)) {
                  return node.parentElement;
                }
              }
              return null;
            }, candidate.value) as ElementHandle;
            break;
          case SelectorType.ID:
            element = await page.$(`#${candidate.value}`);
            break;
          case SelectorType.CLASS:
            element = await page.$(`.${candidate.value}`);
            break;
          case SelectorType.NAME:
            element = await page.$(`[name="${candidate.value}"]`);
            break;
          case SelectorType.DATA_TESTID:
            element = await page.$(`[data-testid="${candidate.value}"]`);
            break;
          case SelectorType.ARIA_LABEL:
            element = await page.$(`[aria-label="${candidate.value}"]`);
            break;
        }
        
        if (element) {
          return {
            element,
            selector: candidate,
            found: true
          };
        }
        
      } catch (error) {
        this.logger.debug(`Selector failed: ${candidate.type}:${candidate.value}`, error);
      }
    }
    
    return {
      element: null,
      selector: candidates[0],
      found: false,
      error: 'No matching element found'
    };
  }

  /**
   * 等待条件满足
   */
  private async waitForCondition(condition: any, context: ExecutionContext): Promise<any> {
    const startTime = Date.now();
    
    switch (condition.type) {
      case WaitType.TIMEOUT:
        await new Promise(resolve => global.setTimeout(resolve, condition.timeout));
        break;
        
      case WaitType.ELEMENT:
        await context.page.waitForSelector(condition.selector || 'body', {
          timeout: condition.timeout
        });
        break;
        
      case WaitType.NAVIGATION:
        await context.page.waitForNavigation({
          waitUntil: 'networkidle2',
          timeout: condition.timeout
        });
        context.currentUrl = context.page.url();
        break;
        
      case WaitType.NETWORK_IDLE:
        // Puppeteer doesn't have waitForLoadState, use waitForTimeout instead
        await new Promise(resolve => global.setTimeout(resolve, condition.timeout || 2000));
        break;
        
      default:
        await new Promise(resolve => global.setTimeout(resolve, condition.timeout || 1000));
    }
    
    const duration = Date.now() - startTime;
    
    return {
      waited: true,
      condition: condition.type,
      duration
    };
  }

  /**
   * 创建页面
   */
  private async createPage(planId: string): Promise<Page> {
    if (!this.browser) {
      throw new Error('Browser not initialized');
    }
    
    const page = await this.browser.newPage();

    // Headers 优化：尽量模拟真实请求头
    if (this.config.extraHeaders) {
      await page.setExtraHTTPHeaders(this.config.extraHeaders);
    }
    const acceptLang = (this.config.languages && this.config.languages.length > 0)
      ? this.config.languages.join(',')
      : (this.config.locale || 'en-US');
    await page.setExtraHTTPHeaders({ 'Accept-Language': acceptLang, ...(this.config.extraHeaders || {}) });
    
    // 设置用户代理
    await page.setUserAgent(this.config.userAgent);
    
    // 设置视口
    await page.setViewport(this.config.viewport);
    
    // 设置超时
    page.setDefaultTimeout(this.config.timeout);
    page.setDefaultNavigationTimeout(this.config.navigationTimeout);

    // 设置时区与语言
    try {
      if (this.config.timezone) {
        await page.emulateTimezone(this.config.timezone);
      }
    } catch (e) {
      this.logger.warn('Failed to emulate timezone', { error: e });
    }

    // 进一步去除自动化痕迹（在未启用 stealth 时的兜底）
    if (this.config.stealth === false) {
      await page.evaluateOnNewDocument(() => {
        // @ts-ignore
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        // @ts-ignore
        const copy = navigator.languages;
        // @ts-ignore
        Object.defineProperty(navigator, 'languages', { get: () => copy && copy.length ? copy : ['zh-CN','zh'] });
      });
    }
    
    this.pages.set(planId, page);
    
    return page;
  }

  /**
   * 创建执行上下文
   */
  private async createExecutionContext(page: Page, planId: string): Promise<ExecutionContext> {
    const context: ExecutionContext = {
      browser: this.browser!,
      page,
      currentUrl: 'about:blank',
      viewport: this.config.viewport,
      userAgent: this.config.userAgent,
      cookies: [],
      localStorage: {},
      sessionStorage: {},
      screenshots: [],
      executionStartTime: Date.now(),
      stepResults: []
    };
    
    this.contexts.set(planId, context);
    
    return context;
  }

  /**
   * 截图
   */
  private async takeScreenshot(page: Page, name: string): Promise<string> {
    try {
      const screenshot = await page.screenshot({
        type: 'png',
        fullPage: true
      });
      
      // 这里应该保存到文件系统或返回base64
      const base64 = screenshot.toString('base64');
      const filename = `screenshot_${name}_${Date.now()}.png`;
      
      this.logger.debug(`Screenshot taken: ${filename}`);
      
      return `data:image/png;base64,${base64}`;
    } catch (error) {
      this.logger.error('Failed to take screenshot:', error);
      throw error;
    }
  }

  /**
   * 获取浏览器信息
   */
  async getBrowserInfo(): Promise<any> {
    if (!this.browser) return null;
    
    try {
      const version = await this.browser.version();
      const userAgent = await this.browser.userAgent();
      
      return {
        version,
        userAgent,
        pid: this.browser.process()?.pid
      };
    } catch (error) {
      this.logger.warn('Failed to get browser info:', error);
      return null;
    }
  }

  /**
   * 清理执行上下文
   */
  private async cleanupContext(planId: string): Promise<void> {
    try {
      const page = this.pages.get(planId);
      if (page && !page.isClosed()) {
        await page.close();
      }
      
      this.pages.delete(planId);
      this.contexts.delete(planId);
      
      this.logger.debug(`Cleaned up context for plan: ${planId}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup context for plan ${planId}:`, error);
    }
  }

  /**
   * 关闭浏览器
   */
  async close(): Promise<void> {
    try {
      // 关闭所有页面
      for (const [planId, page] of this.pages) {
        if (!page.isClosed()) {
          await page.close();
        }
      }
      
      // 关闭浏览器
      if (this.browser) {
        await this.browser.close();
        this.browser = null;
      }
      
      // 清理缓存
      this.pages.clear();
      this.contexts.clear();
      
      this.logger.info('Executor closed successfully');
      
      this.eventBus.emit(EventType.EXECUTOR_CLOSED, {});
      
    } catch (error) {
      this.logger.error('Failed to close executor:', error);
      throw error;
    }
  }
}

// 默认执行器实例
let defaultExecutor: Executor | null = null;

/**
 * 获取默认执行器实例
 */
export function getDefaultExecutor(): Executor {
  if (!defaultExecutor) {
    defaultExecutor = new Executor();
  }
  return defaultExecutor;
}

/**
 * 设置默认执行器实例
 */
export function setDefaultExecutor(executor: Executor): void {
  defaultExecutor = executor;
}

/**
 * 创建执行器实例
 */
export function createExecutor(config?: Partial<ExecutorConfig>): Executor {
  return new Executor(config);
}