/**
 * 执行器模块
 * 负责执行具体的浏览器操作，基于Puppeteer实现
 */

const puppeteer = require('puppeteer');

import { Browser, Page, ElementHandle } from 'puppeteer';
import {
  Step,
  ActionType,
  Plan,
  WaitType,
  SelectorType,
  SelectorCandidate,
  ExecutionResult,
  StepResult
} from '../core/types';
import { getDefaultLogger } from '../core/logger';
import { getDefaultEventBus } from '../core/event-bus';
import { getDefaultErrorHandler, ErrorCode } from '../core/error-handler';
import { EventType } from '../core/types';

// 添加延迟函数
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 执行上下文
 */
export interface ExecutionContext {
  browser: Browser;
  page: Page;
  currentUrl: string;
  viewport: { width: number; height: number } | null;
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
  viewport: { width: number; height: number } | null;
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
  // 新增：元素选择器缓存，提高查找性能
  private selectorCache: Map<string, { element: ElementHandle | null; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 5000; // 缓存5秒

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = {
      headless: false, // 显示浏览器窗口
      viewport: null, // 使用默认视口大小
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      timeout: 30000,
      retryDelay: 500,
      screenshotOnError: true,
      screenshotOnSuccess: false,
      enableLogging: true,
      enableMetrics: true,
      maxConcurrentPages: 5,
      navigationTimeout: 30000,
      elementTimeout: 15000, // 增加元素等待时间
      // 反爬增强默认关闭，使用简单模式
      stealth: false,
      devtools: false,
      slowMo: 0,
      userDataDir: undefined,
      locale: 'zh-CN',
      languages: ['zh-CN', 'zh'],
      timezone: 'Asia/Shanghai',
      extraHeaders: undefined,
      executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // 直接指定 Chrome 路径
      ...config
    };
  }

  /**
   * 初始化浏览器
   */
  async initialize(): Promise<void> {
    try {
      console.log('正在启动浏览器...');
      await delay(2000); // 等待2秒

      // 启动浏览器配置
      const launchOptions: any = {
        headless: this.config.headless, // 显示浏览器窗口
        defaultViewport: null, // 使用默认视口大小
        args: [
          '--start-maximized', // 最大化窗口
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-features=IsolateOrigins,site-per-process',
          '--allow-running-insecure-content',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-ipc-flooding-protection',
          '--disable-blink-features=AutomationControlled',
          this.config.locale ? `--lang=${this.config.locale}` : undefined
        ].filter(Boolean),
        devtools: this.config.devtools,
        slowMo: this.config.slowMo,
        // 修复：确保每次启动使用不同的用户数据目录，避免SingletonLock冲突
        userDataDir: this.config.userDataDir || `/tmp/chrome-agent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      };

      // 设置 Chrome 可执行文件路径
      const envExecutable = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH;
      const executablePath = this.config.executablePath || envExecutable || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

      launchOptions.executablePath = executablePath;
      console.log(`使用 Chrome 路径: ${executablePath}`);

      this.browser = await puppeteer.launch(launchOptions);
      console.log('浏览器已启动');
      await delay(2000); // 等待2秒

      this.logger.info('Browser initialized successfully');

      this.eventBus.emit(EventType.EXECUTOR_INITIALIZED, {
        browserId: this.browser?.process()?.pid,
        config: this.config
      });
    } catch (error) {
      // 更详细的错误日志，便于排查
      const err = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { raw: String(error) };
      this.logger.error('Failed to initialize browser:', err as any);
      console.log('浏览器启动失败:', err);
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

      // 定期清理过期缓存
      this.cleanupExpiredCache();

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

      return result;

    } catch (error) {
      this.logger.error('Plan execution failed:', error);

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

    console.log(`正在访问网页: ${url}...`);
    this.logger.debug(`Navigating to: ${url}`);

    let response: any = null;
    let lastError: Error | null = null;
    const maxRetries = 3;

    // 重试机制
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`导航尝试 ${attempt}/${maxRetries}`);
        this.logger.debug(`Navigation attempt ${attempt}/${maxRetries}`);

        // 尝试导航，使用更宽松的等待策略
        response = await context.page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.navigationTimeout
        });

        console.log('页面已加载');
        console.log(`响应状态: ${response?.status()}`);
        await delay(2000); // 等待2秒

        // 如果成功，跳出重试循环
        break;

      } catch (error: any) {
        lastError = error;
        console.log(`导航尝试 ${attempt} 失败: ${error.message}`);
        this.logger.warn(`Navigation attempt ${attempt} failed: ${error.message}`);

        if (attempt < maxRetries) {
          // 等待后重试
          console.log(`等待 ${2000 * attempt}ms 后重试...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));

          // 尝试刷新页面状态
          try {
            await context.page.evaluate(() => window.stop());
          } catch { }
        }
      }
    }

    // 如果所有重试都失败，抛出最后的错误
    if (!response && lastError) {
      throw lastError;
    }

    // 额外等待页面稳定
    console.log('等待页面稳定...');
    try {
      // 等待页面主要内容加载完成，使用更灵活的条件
      await Promise.race([
        context.page.waitForFunction(() => {
          // 检查页面是否准备好
          return document.readyState === 'complete' || 
                 (document.readyState === 'interactive' && document.body.children.length > 0);
        }, { timeout: 10000 }),
        // 最多等待10秒，即使页面未完全加载也继续执行
        new Promise(resolve => setTimeout(resolve, 10000))
      ]);
      console.log('页面已稳定');
    } catch (e) {
      console.log('页面稳定检查完成');
      this.logger.debug('Page stability check completed');
    }

    // 更新上下文URL
    context.currentUrl = context.page.url();
    console.log(`当前页面URL: ${context.currentUrl}`);

    return {
      url: context.currentUrl,
      status: response?.status(),
      headers: response?.headers()
    };
  }

  /**
   * 执行点击操作（优化版）
   */
  private async executeClick(step: Step, context: ExecutionContext): Promise<any> {
    console.log('正在查找要点击的元素...');
    const selectorResult = await this.findElement(step.selectorCandidates, context.page);

    if (!selectorResult.element) {
      console.log('未找到要点击的元素');
      throw new Error(`Element not found for click: ${selectorResult.error || 'Unknown error'}`);
    }

    console.log('元素已找到，正在滚动到可见位置...');
    // 滚动到元素可见
    await selectorResult.element.scrollIntoView();
    await delay(500); // 等待滚动完成

    // 模拟人类鼠标移动到元素
    const boundingBox = await selectorResult.element.boundingBox();
    if (boundingBox) {
      // 获取元素中心点
      const centerX = boundingBox.x + boundingBox.width / 2;
      const centerY = boundingBox.y + boundingBox.height / 2;

      console.log(`正在移动鼠标到元素位置 (${Math.round(centerX)}, ${Math.round(centerY)})...`);
      // 模拟鼠标从当前位置移动到元素中心
      await context.page.mouse.move(centerX, centerY, { steps: 10 });

      // 添加随机小延迟，模拟人类反应时间
      await delay(Math.random() * 200 + 50);
    }

    console.log('等待元素可点击...');
    // 等待元素可点击（增强版检查）
    try {
      await context.page.waitForFunction(
        (element) => {
          const el = element as Element;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.opacity !== '0' &&
            !el.hasAttribute('disabled');
        },
        { timeout: this.config.elementTimeout },
        selectorResult.element
      );
      console.log('元素已可点击');
    } catch (waitError) {
      console.log('等待元素可点击超时，但继续执行...', (waitError as Error).message);
      this.logger.warn('Element clickable wait timeout, continuing...', waitError);
    }

    // 重试机制的点击
    let clicked = false;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`正在执行点击操作 (尝试 ${attempt}/3)...`);
        // 短暂等待确保元素稳定
        await delay(100);

        // 执行点击
        await selectorResult.element.click();
        clicked = true;
        console.log('点击操作成功');
        await delay(1000); // 等待点击后的响应
        break;
      } catch (error) {
        lastError = error as Error;
        console.log(`点击尝试 ${attempt} 失败: ${lastError.message}`);
        this.logger.debug(`Click attempt ${attempt} failed:`, error);

        if (attempt < 3) {
          // 等待后重试
          console.log('等待500ms后重试...');
          await delay(500);
        }
      }
    }

    if (!clicked && lastError) {
      console.log('所有点击尝试都失败了');
      throw new Error(`Failed to click element after 3 attempts: ${lastError.message}`);
    }

    return {
      selector: selectorResult.selector,
      clicked: true,
      attempts: clicked ? 1 : 3
    };
  }

  /**
   * 执行输入操作（增强版，支持多种清空方式和输入验证）
   */
  private async executeType(step: Step, context: ExecutionContext): Promise<any> {
    const text = step.params?.text;
    if (!text) {
      throw new Error('Type action requires text parameter');
    }

    console.log(`正在查找输入框...`);
    const selectorResult = await this.findElement(step.selectorCandidates, context.page);

    if (!selectorResult.element) {
      console.log('未找到输入框');
      throw new Error(`Element not found for typing: ${selectorResult.error || 'Unknown error'}`);
    }

    console.log('输入框已找到');

    // 确保元素可见并可交互
    console.log('正在等待元素可见并可交互...');
    await selectorResult.element.scrollIntoView();
    
    // 使用更宽松的等待条件，并增加超时处理
    try {
      await context.page.waitForFunction(
        (element) => {
          const el = element as Element;
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 &&
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            style.opacity !== '0';
        },
        { timeout: this.config.elementTimeout },
        selectorResult.element
      );
      console.log('元素已可见并可交互');
    } catch (waitError) {
      console.log('等待元素可见超时，但继续执行...', (waitError as Error).message);
      this.logger.warn('Element visibility wait timeout, continuing...', waitError);
    }

    console.log('正在聚焦输入框...');
    // 多重方式聚焦元素
    try {
      await selectorResult.element.focus();
      // 额外点击确保焦点
      await selectorResult.element.click();
      console.log('输入框已聚焦');
    } catch (error) {
      console.log('聚焦失败，尝试其他方法');
      this.logger.warn('Element focus failed, trying alternative method', error);
      // 如果聚焦失败，尝试直接点击
      await selectorResult.element.click();
      console.log('通过点击方式聚焦输入框');
    }

    // 等待一小段时间确保焦点生效
    console.log('等待焦点生效...');
    await delay(100);
    console.log('焦点已生效');

    console.log('正在清空输入框内容...');
    // 多重清空策略
    try {
      // 方法1：使用键盘快捷键全选后删除
      const isMac = process.platform === 'darwin';
      if (isMac) {
        console.log('使用Mac快捷键全选...');
        await context.page.keyboard.down('Meta');
        await context.page.keyboard.press('KeyA');
        await context.page.keyboard.up('Meta');
      } else {
        console.log('使用Windows快捷键全选...');
        await context.page.keyboard.down('Control');
        await context.page.keyboard.press('KeyA');
        await context.page.keyboard.up('Control');
      }

      console.log('删除已选中内容...');
      // 删除已选中内容
      await context.page.keyboard.press('Backspace');
      console.log('输入框内容已清空');

    } catch (error) {
      console.log('键盘清空方法失败，尝试其他方法');
      this.logger.warn('Keyboard clear method failed, trying alternative', error);

      // 方法2：直接清空输入框值
      try {
        console.log('使用JavaScript清空输入框...');
        await selectorResult.element.evaluate((el: any) => {
          if (el.value !== undefined) {
            el.value = '';
          } else if (el.textContent !== undefined) {
            el.textContent = '';
          }
          // 触发输入事件
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        console.log('输入框内容已清空');
      } catch (evalError) {
        this.logger.warn('Element evaluation clear failed', evalError);
      }
    }

    // 等待清空完成
    console.log('等待清空完成...');
    await delay(50);
    console.log('清空已完成');

    console.log(`正在输入文本"${text}"...`);
    // 执行输入 - 使用更稳定的方式
    let inputSuccess = false;
    let finalValue = '';

    try {
      // 方法1：使用 type 方法，添加随机延迟模拟人类打字
      console.log('使用type方法输入文本...');
      const typingDelay = 200; // 每个字符间隔200ms
      await selectorResult.element.type(text, { delay: typingDelay });
      console.log('文本输入完成');

      // 验证输入结果
      console.log('验证输入结果...');
      finalValue = await selectorResult.element.evaluate((el: any) => el.value || el.textContent || '');
      inputSuccess = finalValue.includes(text) || finalValue === text;
      console.log(`输入验证结果: ${inputSuccess}, 实际值: "${finalValue}"`);

    } catch (error) {
      console.log('type方法失败，尝试键盘输入');
      this.logger.warn('Type method failed, trying keyboard input', error);

      // 方法2：使用键盘输入
      try {
        console.log('使用键盘逐字符输入...');
        for (const char of text) {
          await context.page.keyboard.type(char, { delay: 30 });
        }
        console.log('文本输入完成');

        // 再次验证
        console.log('验证输入结果...');
        finalValue = await selectorResult.element.evaluate((el: any) => el.value || el.textContent || '');
        inputSuccess = finalValue.includes(text) || finalValue === text;
        console.log(`输入验证结果: ${inputSuccess}, 实际值: "${finalValue}"`);

      } catch (keyboardError) {
        console.log('键盘输入方法也失败了');
        this.logger.warn('Keyboard input method also failed', keyboardError);

        // 方法3：直接设置值
        try {
          console.log('使用JavaScript直接设置值...');
          await selectorResult.element.evaluate((el: any, textValue: string) => {
            if (el.value !== undefined) {
              el.value = textValue;
            } else if (el.textContent !== undefined) {
              el.textContent = textValue;
            }
            // 触发相关事件
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('keyup', { bubbles: true }));
          }, text);
          console.log('文本已设置');

          finalValue = text;
          inputSuccess = true;
          console.log(`输入验证结果: ${inputSuccess}`);

        } catch (directError) {
          console.log('所有输入方法都失败了');
          this.logger.error('All input methods failed', directError);
        }
      }
    }

    console.log('输入完成');
    await delay(1000); // 等待1秒

    // 触发失焦事件以确保输入生效
    console.log('触发失焦事件...');
    try {
      await selectorResult.element.evaluate((el: any) => {
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });
      console.log('失焦事件已触发');
    } catch (blurError) {
      this.logger.debug('Blur event failed', blurError);
    }

    return {
      selector: selectorResult.selector,
      text,
      typed: true,
      verified: inputSuccess,
      actualValue: finalValue,
      success: inputSuccess
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

    console.log(`正在按下键盘按键: ${key}...`);
    await context.page.keyboard.press(key as any);
    console.log('按键操作完成');
    await delay(1000); // 等待1秒

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
   * 查找元素（增强版，支持智能回退和多重策略）
   */
  private async findElement(candidates: SelectorCandidate[], page: Page): Promise<SelectorResult> {
    // 按分数排序候选选择器
    const sortedCandidates = [...candidates].sort((a, b) => b.score - a.score);

    // 首先尝试提供的候选选择器
    for (const candidate of sortedCandidates) {
      try {
        // 检查缓存
        const cacheKey = `${candidate.type}:${candidate.value}`;
        const cached = this.selectorCache.get(cacheKey);
        const now = Date.now();

        if (cached && (now - cached.timestamp) < this.CACHE_TTL) {
          // 验证缓存的元素是否仍然有效
          try {
            if (cached.element) {
              await cached.element.boundingBox(); // 检查元素是否仍然存在
              return {
                element: cached.element,
                selector: candidate,
                found: true
              };
            }
          } catch {
            // 缓存的元素已失效，清除缓存
            this.selectorCache.delete(cacheKey);
          }
        }

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
          // 将找到的元素加入缓存
          const cacheKey = `${candidate.type}:${candidate.value}`;
          this.selectorCache.set(cacheKey, {
            element,
            timestamp: Date.now()
          });

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

    // 如果所有候选选择器都失败，尝试智能回退策略
    this.logger.warn('All provided selectors failed, trying fallback strategies');
    const fallbackElement = await this.findElementWithFallback(page);
    if (fallbackElement) {
      return {
        element: fallbackElement.element,
        selector: fallbackElement.selector,
        found: true
      };
    }

    return {
      element: null,
      selector: candidates[0] || { type: SelectorType.CSS, value: 'unknown', score: 0, description: 'Unknown selector' },
      found: false,
      error: 'No matching element found after trying all strategies'
    };
  }

  /**
   * 智能回退策略：当所有选择器都失败时，尝试常见的元素查找方法
   */
  private async findElementWithFallback(page: Page): Promise<{ element: ElementHandle; selector: SelectorCandidate } | null> {
    const fallbackStrategies = [
      // 查找所有输入框（用于输入操作）
      { selector: 'input:not([type="hidden"]):not([type="submit"]):not([type="button"])', type: SelectorType.CSS, description: '通用输入框' },
      { selector: 'textarea', type: SelectorType.CSS, description: '文本域' },
      { selector: 'input[type="text"]', type: SelectorType.CSS, description: '文本输入框' },
      { selector: 'input[type="search"]', type: SelectorType.CSS, description: '搜索框' },
      { selector: 'input[type="email"]', type: SelectorType.CSS, description: '邮箱输入框' },
      // 查找可点击元素
      { selector: 'button', type: SelectorType.CSS, description: '按钮' },
      { selector: 'a', type: SelectorType.CSS, description: '链接' },
      { selector: '[role="button"]', type: SelectorType.CSS, description: '按钮角色元素' },
      { selector: 'input[type="submit"]', type: SelectorType.CSS, description: '提交按钮' },
      // 查找表单元素
      { selector: 'select', type: SelectorType.CSS, description: '下拉框' },
      { selector: 'form input', type: SelectorType.CSS, description: '表单输入框' },
    ];

    for (const strategy of fallbackStrategies) {
      try {
        const elements = await page.$$(strategy.selector);
        if (elements && elements.length > 0) {
          // 如果有多个元素，选择第一个可见的
          for (const element of elements) {
            const isVisible = await element.evaluate((el: Element) => {
              const style = window.getComputedStyle(el);
              const rect = el.getBoundingClientRect();
              return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                style.opacity !== '0' &&
                rect.width > 0 &&
                rect.height > 0
              );
            });

            if (isVisible) {
              this.logger.info(`Found element using fallback strategy: ${strategy.description}`);
              return {
                element,
                selector: {
                  type: strategy.type,
                  value: strategy.selector,
                  score: 0.3, // 低分表示这是回退策略
                  description: strategy.description
                }
              };
            }
          }
        }
      } catch (error) {
        this.logger.debug(`Fallback strategy failed: ${strategy.description}`, error);
      }
    }

    return null;
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
          timeout: condition.timeout || this.config.elementTimeout
        });
        break;

      case WaitType.NAVIGATION:
        try {
          console.log(`开始等待导航完成，超时时间: ${condition.timeout || this.config.navigationTimeout}ms`);
          // 先检查当前页面状态
          const currentUrlBefore = context.currentUrl;
          const pageUrl = context.page.url();
          console.log(`等待前URL - 上下文: ${currentUrlBefore}, 页面: ${pageUrl}`);
          
          // 如果页面URL不是about:blank，说明导航已经完成
          if (pageUrl !== 'about:blank') {
            context.currentUrl = pageUrl;
            console.log('导航已完成（页面已加载），无需等待');
            break;
          }
          
          // 如果URL已经改变，说明导航已经完成
          if (pageUrl !== currentUrlBefore) {
            context.currentUrl = pageUrl;
            console.log('导航已完成（URL已改变），无需等待');
            break;
          }
          
          // 如果上下文URL是about:blank而页面URL也是about:blank，说明还没有开始导航
          // 在这种情况下，我们等待一段时间让导航开始
          if (currentUrlBefore === 'about:blank' && pageUrl === 'about:blank') {
            console.log('尚未开始导航，等待一段时间');
            await new Promise(resolve => setTimeout(resolve, 1000));
            context.currentUrl = context.page.url();
            console.log(`等待后URL: ${context.currentUrl}`);
            break;
          }
          
          // 使用更宽松的等待条件，并增加超时处理
          // 给waitForNavigation稍微多一点时间，确保它有机会完成
          const navigationTimeout = Math.min(condition.timeout || this.config.navigationTimeout, 5000); // 最多5秒
          const overallTimeout = condition.timeout || this.config.navigationTimeout;
          
          console.log(`waitForNavigation超时设置: ${navigationTimeout}ms`);
          
          const navigationPromise = context.page.waitForNavigation({
            waitUntil: 'load',  // 使用'load'而不是'networkidle2'，更宽松
            timeout: navigationTimeout
          }).then(() => {
            console.log('waitForNavigation完成');
            return true;
          }).catch((error: Error) => {
            console.log('waitForNavigation失败或超时:', error.message);
            return false;
          });
          
          const timeoutPromise = new Promise(resolve => 
            setTimeout(() => {
              console.log('导航等待超时');
              resolve(false);
            }, overallTimeout)
          );
          
          const result = await Promise.race([navigationPromise, timeoutPromise]);
          
          // 更新当前URL
          context.currentUrl = context.page.url();
          console.log(`导航等待结束，当前URL: ${context.currentUrl}, waitForNavigation是否成功: ${result}`);
        } catch (error) {
          console.log('导航等待出现异常，继续执行...', (error as Error).message);
          this.logger.warn('Navigation wait exception, continuing...', error);
          context.currentUrl = context.page.url();
        }
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

    console.log('正在打开新页面...');
    const page = await this.browser.newPage();
    console.log('新页面已打开');
    await delay(1000); // 等待1秒

    // Headers 优化：尽量模拟真实请求头
    if (this.config.extraHeaders) {
      await page.setExtraHTTPHeaders(this.config.extraHeaders);
    }
    const acceptLang = (this.config.languages && this.config.languages.length > 0)
      ? this.config.languages.join(',')
      : (this.config.locale || 'zh-CN');
    await page.setExtraHTTPHeaders({ 'Accept-Language': acceptLang, ...(this.config.extraHeaders || {}) });

    // 设置用户代理
    await page.setUserAgent(this.config.userAgent);

    // 设置视口
    if (this.config.viewport) {
      await page.setViewport(this.config.viewport);
    }

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
        Object.defineProperty(navigator, 'languages', { get: () => copy && copy.length ? copy : ['zh-CN', 'zh'] });
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
      this.selectorCache.clear();
      
      this.logger.info('Executor closed successfully');
      
      this.eventBus.emit(EventType.EXECUTOR_CLOSED, {});
    } catch (error) {
      this.logger.error('Failed to close executor:', error);
      throw error;
    }
  }

  /**
   * 清理过期的选择器缓存
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    const entries = Array.from(this.selectorCache.entries());
    for (const [key, cached] of entries) {
      if (now - cached.timestamp > this.CACHE_TTL) {
        this.selectorCache.delete(key);
      }
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
