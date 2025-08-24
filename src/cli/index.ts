#!/usr/bin/env node

/**
 * Chrome Agent CLI 入口文件
 * 提供命令行接口来使用Chrome Agent的各种功能
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
import { getDefaultLogger } from '../core/logger';
import { Planner } from '../planner/planner';
import { Executor } from '../executor/executor';
import { DataExtractor } from '../extractor/extractor';
import { initializeStorage } from '../storage';
import * as readline from 'readline';
import { getDefaultEventBus } from '../core/event-bus';
import { EventType } from '../core/types';

const logger = getDefaultLogger();
const program = new Command();

// 版本信息
program
  .name('chrome-agent')
  .description('Chrome Agent - 智能浏览器自动化工具')
  .version('1.0.0');

/**
 * 执行任务命令
 */
program
  .command('run')
  .description('执行自动化任务')
  .argument('<task>', '任务描述（自然语言）')
  .option('-u, --url <url>', '目标网页URL')
  .option('-o, --output <file>', '输出文件路径')
  .option('-f, --format <format>', '输出格式 (json|csv|xml)', 'json')
  // .option('-h, --headless', '无头模式运行', false) // 已禁用：默认使用有头模式
  .option('-w, --wait <ms>', '等待时间（毫秒）', '3000')
  .option('-v, --verbose', '详细输出', false)
  .option('--ai', '启用基于AI的意图解析', false)
  .option('--provider <provider>', 'AI提供商 (openai|deepseek|custom|modelscope)')
  .option('--model <model>', 'AI 模型')
  .option('--baseUrl <url>', 'AI Base URL')
  .option('--apiKey <key>', 'AI API Key')
  .option('--intentModel <model>', 'AI 模型（用于意图解析）')
  .option('--plannerModel <model>', 'AI 模型（用于步骤规划）')
  .option('--executablePath <path>', 'Chrome/Chromium 可执行文件路径')
  .option('--stealth', '启用 stealth 反爬插件', false)
  .option('--devtools', '启动时打开 DevTools', false)
  .option('--slowMo <ms>', '放慢操作节奏（毫秒）', '0')
  .option('--lang <lang>', '浏览器语言/Accept-Language（如 zh-CN）')
  .option('--tz <timezone>', '浏览器时区（如 Asia/Shanghai）')
  .option('--userDataDir <dir>', '用户数据目录（持久化会话）')
  .option('--userAgent <ua>', '自定义 User-Agent')
  .option('--header <k:v...>', '额外请求头，支持重复传入多个', (val: string, memo: string[]) => { memo.push(val); return memo; }, [] as string[])
  .action(async (task: string, options: any) => {
    try {
      logger.info('开始执行任务', { task, options });
 
      // 初始化存储
      await initializeStorage();
 
      // 在初始化 AI 之前，根据 CLI 选项动态更新配置
      const { quickSetConfigValue } = await import('../storage');
      if (options.ai) {
        await quickSetConfigValue('ai.enabled', true);
      }
      if (options.provider) {
        await quickSetConfigValue('ai.provider', options.provider);
      }
      if (options.model) {
        await quickSetConfigValue('ai.model', options.model);
      }
      if (options.intentModel) {
        await quickSetConfigValue('ai.intentModel', options.intentModel);
      }
      if (options.plannerModel) {
        await quickSetConfigValue('ai.plannerModel', options.plannerModel);
      }
      if (options.baseUrl) {
        await quickSetConfigValue('ai.baseUrl', options.baseUrl);
      }
      if (options.apiKey) {
        await quickSetConfigValue('ai.apiKey', options.apiKey);
      } else if (options.ai) {
        // 环境变量兜底（按 provider 优先）
        const prov = options.provider || process.env.AI_PROVIDER;
        const envApiKey = prov === 'deepseek' ? process.env.DEEPSEEK_API_KEY
          : prov === 'modelscope' ? process.env.MODELSCOPE_API_KEY || process.env.AI_API_KEY
          : process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
        if (envApiKey) {
          await quickSetConfigValue('ai.apiKey', envApiKey);
        }
        const envBaseUrl = prov === 'deepseek' ? (process.env.DEEPSEEK_BASE_URL || process.env.AI_BASE_URL)
          : prov === 'modelscope' ? process.env.MODELSCOPE_BASE_URL
          : (process.env.OPENAI_BASE_URL || process.env.AI_BASE_URL);
        if (envBaseUrl) {
          await quickSetConfigValue('ai.baseUrl', envBaseUrl);
        }
        const envModel = prov === 'deepseek' ? (process.env.DEEPSEEK_MODEL || process.env.AI_MODEL)
          : prov === 'modelscope' ? (process.env.MODELSCOPE_MODEL || process.env.AI_MODEL)
          : (process.env.OPENAI_MODEL || process.env.AI_MODEL);
        if (envModel) {
          await quickSetConfigValue('ai.model', envModel);
        }
      }

      // 若选择了 modelscope，且未指定 intent/planner 模型，使用用户期望的默认
      if ((options.provider === 'modelscope' || process.env.AI_PROVIDER === 'modelscope')) {
      const { quickGetConfigValue } = await import('../storage');
      const intentModelCurrent = await quickGetConfigValue<string>('ai.intentModel');
      const plannerModelCurrent = await quickGetConfigValue<string>('ai.plannerModel');
      if (!intentModelCurrent) {
      await quickSetConfigValue('ai.intentModel', 'deepseek-ai/DeepSeek-V2-Lite-Chat');
      }
      if (!plannerModelCurrent) {
      await quickSetConfigValue('ai.plannerModel', 'deepseek-ai/DeepSeek-V3.1');
      }
      }
      // 对于 modelscope，不再自动设置默认模型，请通过 --baseUrl/--model/--intentModel/--plannerModel 明确指定
      
      // 初始化 AI（确保 AIClientManager 预先加载配置并建立连接）
      const { initializeAI } = await import('../ai/config');
      await initializeAI();
 
      // 解析意图（AI-only）
      const { AIIntentParser } = await import('../ai/intent-parser');
      const aiParser = new AIIntentParser();
      const intents = await aiParser.parseIntent(task, { currentUrl: options.url });
      logger.debug('意图解析结果', { intents });
 
      // 生成计划
      const planner = new Planner();
      const taskId = `task_${Date.now()}`;
      const plan = await planner.generatePlan(taskId, intents, { currentUrl: options.url });
      logger.debug('执行计划', { plan });
 
      // 执行任务
      const executablePath = options.executablePath || process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
      const executor = new Executor({
        // headless: options.headless, // 已禁用：默认有头模式
        timeout: parseInt(options.wait),
        executablePath,
        stealth: options.stealth ? true : undefined,
        devtools: options.devtools,
        slowMo: parseInt(options.slowMo || '0'),
        locale: options.lang,
        languages: options.lang ? [options.lang] : undefined,
        timezone: options.tz,
        userDataDir: options.userDataDir || path.resolve(process.cwd(), 'data/user-data'),
        userAgent: options.userAgent || undefined,
        extraHeaders: (options.header || []).reduce((acc: any, kv: string) => {
          const idx = kv.indexOf(':');
          if (idx > 0) {
            const k = kv.slice(0, idx).trim();
            const v = kv.slice(idx + 1).trim();
            acc[k] = v;
          }
          return acc;
        }, {} as Record<string, string>)
      });

      await executor.initialize();

      const result = await executor.executePlan(plan);
      logger.info('任务执行完成', { result });

      // 如果需要输出文件
      if (options.output) {
        await saveResult(result, options.output, options.format);
        logger.info('结果已保存', { file: options.output });
      } else {
        console.log(JSON.stringify(result, null, 2));
      }

      // 保持浏览器与页面开启，便于用户和AI共同操作
    } catch (error) {
      logger.error('任务执行失败', { error });
      
      // 使用AI分析错误并生成用户友好的解释
      try {
        const { getDefaultAIErrorAnalyzer } = await import('../ai/error-analyzer');
        const errorAnalyzer = getDefaultAIErrorAnalyzer();
        const analysis = await errorAnalyzer.analyzeError(error as Error, {
          task,
          url: options.url
        });
        
        console.log(`\n❌ ${analysis.summary}`);
        if (analysis.possibleCauses.length > 0) {
          console.log(`\n💡 ${analysis.possibleCauses[0]}`);
        }
        if (analysis.suggestions.length > 0) {
          console.log(`🔧 ${analysis.suggestions[0]}`);
        }
        console.log('');
      } catch (analysisError) {
        console.log('\n❌ 任务执行失败\n');
      }
      
      process.exit(1);
    }
  });

/**
 * 数据抽取命令
 */
program
  .command('extract')
  .description('从网页抽取数据')
  .argument('<url>', '目标网页URL')
  .option('-s, --selector <selector>', '数据选择器')
  .option('-r, --rule <file>', '抽取规则文件')
  .option('-o, --output <file>', '输出文件路径')
  .option('-f, --format <format>', '输出格式 (json|csv|xml)', 'json')
  // .option('-h, --headless', '无头模式运行', false) // 已禁用：默认使用有头模式
  .option('-v, --verbose', '详细输出', false)
  .action(async (url: string, options: any) => {
    try {
      logger.info('开始数据抽取', { url, options });

      // 初始化存储
      await initializeStorage();

      // 初始化执行器
      const executor = new Executor({});

      await executor.initialize();
      
      // 创建一个简单的计划来导航到URL
      const { ActionType, WaitType, RiskLevel } = await import('../core/types');
      const taskId = `extract_task_${Date.now()}`;
      const plan = {
        id: `plan_${taskId}`,
        taskId,
        steps: [{
          id: `${taskId}_step_0`,
          planId: `plan_${taskId}`,
          order: 0,
          action: ActionType.NAVIGATE,
          selectorCandidates: [],
          params: { url },
          waitFor: { type: WaitType.NAVIGATION, timeout: 30000 },
          retries: { maxAttempts: 3, delay: 1000, backoff: false },
          timeout: 30000,
          description: 'Navigate to target URL',
          isOptional: false
        }],
        riskLevel: RiskLevel.LOW,
        meta: {
          targetUrl: url,
          description: 'Navigate and extract data',
          tags: ['extraction'],
          warnings: [],
          requirements: []
        },
        createdAt: new Date(),
        estimatedDuration: 30000
      };

      const executionResult = await executor.executePlan(plan);
      const context = executor['contexts'].get(plan.id);
      
      if (!context) {
        throw new Error('Failed to create execution context');
      }

      // 初始化数据抽取器
      const extractor = new DataExtractor();

      let result;
      if (options.rule) {
        // 使用规则文件
        const ruleContent = await fs.readFile(options.rule, 'utf8');
        const rule = JSON.parse(ruleContent);
        result = await extractor.extract(context.page, rule);
      } else if (options.selector) {
        // 使用简单选择器
        const { ExtractionType, FieldType } = await import('../extractor/extractor');
        const rule = {
          id: 'simple-extract',
          name: 'simple-extract',
          description: 'Simple selector extraction',
          selector: options.selector,
          type: ExtractionType.SINGLE,
          fields: [{
            name: 'data',
            selector: options.selector,
            type: FieldType.TEXT,
            required: false
          }]
        };
        result = await extractor.extract(context.page, rule);
      } else {
        // 自动抽取
        const { ExtractionType } = await import('../extractor/extractor');
        result = await extractor.extract(context.page, {
          id: 'auto-extract',
          name: 'auto-extract',
          description: 'Auto extraction',
          selector: 'body',
          type: ExtractionType.LIST,
          fields: []
        });
      }

      logger.info('数据抽取完成', { result });

      // 保存结果
      if (options.output) {
        await saveResult(result, options.output, options.format);
        logger.info('结果已保存', { file: options.output });
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
      // 保持浏览器与页面开启，便于用户和AI共同操作
      } catch (error) {
        logger.error('数据抽取失败', { error });
        process.exit(1);
      }
    });

/**
 * 生成示例命令
 */
program
  .command('init')
  .description('初始化项目并生成示例文件')
  .option('-d, --dir <directory>', '目标目录', './chrome-agent-samples')
  .action(async (options: any) => {
    try {
      logger.info('初始化项目', { dir: options.dir });

      await createSampleProject(options.dir);
      
      logger.info('项目初始化完成', { dir: options.dir });
      console.log(`\n项目已创建在: ${options.dir}`);
      console.log('\n开始使用:');
      console.log(`  cd ${options.dir}`);
      console.log('  npm install');
      console.log('  npm run example');
    } catch (error) {
      logger.error('项目初始化失败', { error });
      process.exit(1);
    }
  });

/**
 * 配置命令
 */
program
  .command('config')
  .description('管理配置')
  .option('-s, --set <key=value>', '设置配置项')
  .option('-g, --get <key>', '获取配置项')
  .option('-l, --list', '列出所有配置')
  .action(async (options: any) => {
    try {
      // 初始化存储
      await initializeStorage();
      
      const { quickGetConfig, quickSetConfigValue, quickGetConfigValue } = await import('../storage');

      if (options.set) {
        const [key, value] = options.set.split('=');
        await quickSetConfigValue(key, value);
        console.log(`配置已设置: ${key} = ${value}`);
      } else if (options.get) {
        const value = await quickGetConfigValue(options.get);
        console.log(`${options.get} = ${value}`);
      } else if (options.list) {
        const config = await quickGetConfig();
        console.log(JSON.stringify(config, null, 2));
      } else {
        console.log('请指定操作: --set, --get, 或 --list');
      }
    } catch (error) {
      logger.error('配置操作失败', { error });
      process.exit(1);
    }
  });

/**
 * 服务器命令
 */
program
  .command('serve')
  .description('启动API服务器')
  .option('-p, --port <port>', '端口号', '3000')
  .option('-h, --host <host>', '主机地址', 'localhost')
  .action(async (options: any) => {
    try {
      logger.info('启动服务器', { port: options.port, host: options.host });

      // 初始化存储
      await initializeStorage();

      // 启动API服务器
      const { createApiServer } = await import('../api');
      const server = createApiServer({
        port: options.port,
        host: options.host
      });

      await server.start();
      logger.info(`服务器已启动: http://${options.host}:${options.port}`);
      logger.info(`API文档: http://${options.host}:${options.port}/docs`);

      // 优雅关闭
      process.on('SIGINT', async () => {
        logger.info('正在关闭服务器...');
        await server.stop();
        logger.info('服务器已关闭');
        process.exit(0);
      });
    } catch (error) {
      logger.error('服务器启动失败', { error });
      process.exit(1);
    }
  });

/**
 * 保存结果到文件
 */
async function saveResult(result: any, filePath: string, format: string): Promise<void> {
  const outputPath = path.resolve(filePath);
  const ext = path.extname(outputPath).toLowerCase();

  let content: string;
  if (format === 'json' || ext === '.json') {
    content = JSON.stringify(result, null, 2);
  } else if (format === 'csv' || ext === '.csv') {
    // 简单的CSV转换
    if (Array.isArray(result)) {
      const headers = Object.keys(result[0] || {});
      const rows = result.map(item => 
        headers.map(header => JSON.stringify(item[header] || '')).join(',')
      );
      content = [headers.join(','), ...rows].join('\n');
    } else {
      content = JSON.stringify(result, null, 2);
    }
  } else {
    content = JSON.stringify(result, null, 2);
  }

  await fs.writeFile(outputPath, content, 'utf8');
}

/**
 * 创建示例项目
 */
async function createSampleProject(projectPath: string, type: string = 'basic'): Promise<void> {
  // 确保目录存在
  await fs.mkdir(projectPath, { recursive: true });

  // 创建基础目录结构
  const dirs = ['rules', 'output', 'scripts'];
  for (const dir of dirs) {
    await fs.mkdir(path.join(projectPath, dir), { recursive: true });
  }

  // 创建 package.json
  const packageJson = {
    name: 'chrome-agent-samples',
    version: '1.0.0',
    description: 'Chrome Agent 示例项目',
    main: 'index.js',
    scripts: {
      example: 'node examples/basic.js',
      'example:extract': 'node examples/extract.js',
      'example:automation': 'node examples/automation.js'
    },
    dependencies: {
      'chrome-agent': '^1.0.0'
    }
  };

  await fs.writeFile(
    path.join(projectPath, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );

  // 创建示例目录
  await fs.mkdir(path.join(projectPath, 'examples'), { recursive: true });

  // 根据类型创建示例文件
  switch (type) {
    case 'basic':
      await createBasicExample(projectPath);
      break;
    case 'extraction':
      await createExtractionExample(projectPath);
      break;
    case 'automation':
      await createAutomationExample(projectPath);
      break;
    default:
      await createBasicExample(projectPath);
  }

  await createExtractionRules(projectPath);
  await createReadme(projectPath, type);

  console.log(`示例项目已创建: ${projectPath}`);
}

/**
 * 创建基础示例
 */
async function createBasicExample(dir: string): Promise<void> {
  const content = `const { ChromeAgent } = require('chrome-agent');

async function basicExample() {
  const agent = new ChromeAgent();
  
  try {
    // 初始化
    await agent.initialize();
    
    // 导航到网页
    await agent.navigate('https://example.com');
    
    // 执行简单任务
    const result = await agent.run('获取页面标题');
    
    console.log('结果:', result);
  } catch (error) {
    console.error('错误:', error);
  } finally {
    await agent.close();
  }
}

basicExample();
`;

  await fs.writeFile(path.join(dir, 'examples', 'basic.js'), content);
}

/**
 * 创建数据抽取示例
 */
async function createExtractionExample(dir: string): Promise<void> {
  const content = `const { DataExtractor, Executor } = require('chrome-agent');

async function extractionExample() {
  const executor = new Executor();
  const extractor = new DataExtractor();
  
  try {
    await executor.initialize();
    await executor.navigate('https://news.ycombinator.com');
    
    // 使用规则文件抽取数据
    const rule = require('../rules/hackernews.json');
    const result = await extractor.extract(executor.getPage(), rule);
    
    console.log('抽取结果:', result);
    
    // 导出为CSV
    await extractor.export(result, './output/hackernews.csv', 'csv');
    console.log('数据已导出到 output/hackernews.csv');
    
  } catch (error) {
    console.error('错误:', error);
  } finally {
    // 保持浏览器开启以便后续人工/AI交互
  }
}

extractionExample();
`;

  await fs.writeFile(path.join(dir, 'examples', 'extract.js'), content);
}

/**
 * 创建自动化示例
 */
async function createAutomationExample(dir: string): Promise<void> {
  const content = `const { AIIntentParser, Planner, Executor } = require('chrome-agent');

async function automationExample() {
  const parser = new AIIntentParser();
  const planner = new Planner();
  const executor = new Executor();
  
  try {
    await executor.initialize();
    
    // 解析自然语言任务（AI）
    const intents = await parser.parseIntent('在Google搜索Chrome Agent并点击第一个结果');
    console.log('解析的意图候选:', intents);
    
    // 生成执行计划
    const plan = await planner.generatePlan(intents);
    console.log('执行计划:', plan);
    
    // 执行计划
    await executor.navigate('https://google.com');
    const result = await executor.executePlan(plan);
    
    console.log('执行结果:', result);
    
  } catch (error) {
    console.error('错误:', error);
  } finally {
    // 保持浏览器开启以便后续人工/AI交互
  }
}

automationExample();
`;

  await fs.writeFile(path.join(dir, 'examples', 'automation.js'), content);
}

/**
 * 创建抽取规则示例
 */
async function createExtractionRules(dir: string): Promise<void> {
  const hackerNewsRule = {
    name: 'Hacker News 文章列表',
    description: '抽取Hacker News首页的文章信息',
    url: 'https://news.ycombinator.com',
    type: 'list',
    listSelector: '.athing',
    fields: {
      title: {
        selector: '.titleline > a',
        type: 'text'
      },
      url: {
        selector: '.titleline > a',
        type: 'attribute',
        attribute: 'href'
      },
      score: {
        selector: '.score',
        type: 'text',
        transform: 'number'
      },
      author: {
        selector: '.hnuser',
        type: 'text'
      },
      comments: {
        selector: 'a[href*="item?id="]',
        type: 'text',
        transform: 'number'
      }
    }
  };

  await fs.writeFile(
    path.join(dir, 'rules', 'hackernews.json'),
    JSON.stringify(hackerNewsRule, null, 2)
  );

  const ecommerceRule = {
    name: '电商产品信息',
    description: '抽取电商网站的产品信息',
    type: 'object',
    fields: {
      name: {
        selector: 'h1, .product-title, [data-testid="product-title"]',
        type: 'text'
      },
      price: {
        selector: '.price, .product-price, [data-testid="price"]',
        type: 'text',
        transform: 'price'
      },
      description: {
        selector: '.description, .product-description',
        type: 'text'
      },
      images: {
        selector: '.product-image img, .gallery img',
        type: 'attribute',
        attribute: 'src',
        multiple: true
      },
      rating: {
        selector: '.rating, .stars',
        type: 'text',
        transform: 'number'
      }
    }
  };

  await fs.writeFile(
    path.join(dir, 'rules', 'ecommerce.json'),
    JSON.stringify(ecommerceRule, null, 2)
  );
}

/**
 * 创建README文件
 */
async function createReadme(dir: string, type: string = 'basic'): Promise<void> {
  const content = `# Chrome Agent 示例项目

这个项目包含了Chrome Agent的使用示例。

## 安装

\`\`\`bash
npm install
\`\`\`

## 示例

### 基础示例
\`\`\`bash
npm run example
\`\`\`

### 数据抽取示例
\`\`\`bash
npm run example:extract
\`\`\`

### 自动化示例
\`\`\`bash
npm run example:automation
\`\`\`

## 命令行使用

### 执行任务
\`\`\`bash
chrome-agent run "在Google搜索Chrome Agent" --url https://google.com
\`\`\`

### 数据抽取
\`\`\`bash
chrome-agent extract https://news.ycombinator.com --rule rules/hackernews.json --output output/news.json
\`\`\`

### 启动API服务器
\`\`\`bash
chrome-agent serve --port 3000
\`\`\`

## 文件结构

- \`examples/\` - 示例代码
- \`rules/\` - 数据抽取规则
- \`output/\` - 输出文件
- \`package.json\` - 项目配置

## 更多信息

请参考Chrome Agent的官方文档了解更多功能和用法。
`;

  await fs.writeFile(path.join(dir, 'README.md'), content);
}

// 新增：会话模式实现
async function startSession(): Promise<void> {
  const eventBus = getDefaultEventBus();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('Chrome Agent 会话模式已启动');
  console.log('- 输入自然语言指令，我会规划并在 Chrome 中逐步执行');
  console.log('- 实时显示执行到第几步，以及步骤结果');
  console.log('- 输入 help 查看帮助，exit/quit 退出会话，close 关闭浏览器');

  // 初始化依赖
  await initializeStorage();
  const { initializeAI } = await import('../ai/config');
  await initializeAI();

  const executor = new Executor({
    // 默认以有头模式运行，便于观察
    devtools: false,
    slowMo: 0,
    stealth: false,
    userDataDir: path.resolve(process.cwd(), 'data/user-data'),
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH
  });
  await executor.initialize();

  rl.setPrompt('chrome-agent> ');
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    if (input === 'help') {
      console.log('可用命令:');
      console.log('- 直接输入自然语言指令，例如：打开淘宝搜索 iPhone');
      console.log('- exit/quit: 退出会话（浏览器保持开启）');
      console.log('- close: 关闭浏览器（不建议在协同操作时使用）');
      rl.prompt();
      return;
    }

    if (input === 'exit' || input === 'quit') {
      console.log('已退出会话。浏览器将保持开启以便后续人工/AI交互。');
      rl.close();
      return;
    }

    if (input === 'close') {
      try {
        await executor.close();
        console.log('浏览器已关闭。');
      } catch (e) {
        console.error('关闭浏览器失败：', e);
      }
      rl.prompt();
      return;
    }

    try {
      console.log('理解意图中...');
      const { AIIntentParser } = await import('../ai/intent-parser');
      const aiParser = new AIIntentParser();
      const intents = await aiParser.parseIntent(input, { currentUrl: undefined });

      console.log('正在规划步骤...');
      const planner = new Planner();
      const taskId = `task_${Date.now()}`;
      const plan = await planner.generatePlan(taskId, intents, {});

      // 展示计划
      const orderedSteps = [...plan.steps].sort((a, b) => a.order - b.order);
      console.log(`规划完成，共 ${orderedSteps.length} 步：`);
      orderedSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s.description}`));

      // 订阅执行进度事件
      const stepDescMap = new Map(plan.steps.map(s => [s.id, s.description]));
      const unsubscribeInit = eventBus.subscribe(EventType.EXECUTOR_INITIALIZED, (ev: any) => {
        const pid = ev?.data?.browserId ?? '-';
        console.log(`执行器已初始化，浏览器PID: ${pid}`);
      });
      const unsubscribeStep = eventBus.subscribe(EventType.EXECUTOR_STEP_COMPLETED, (ev: any) => {
        const { stepId, stepResult, progress } = ev.data || {};
        const desc = stepDescMap.get(stepId) || stepId;
        const pct = Math.round(((progress || 0) * 100));
        const status = stepResult?.success ? '成功' : '失败';
        console.log(`步骤完成: ${desc} -> ${status}（进度 ${pct}%）`);
      });

      console.log('开始执行...');
      const result = await executor.executePlan(plan);

      // 取消订阅
      unsubscribeInit();
      unsubscribeStep();

      // 会话内总结
      console.log('—— 执行总结 ——');
      if (result.success) {
        console.log(`成功完成 ${result.successfulSteps}/${result.totalSteps} 步，耗时 ${result.duration}ms`);
        if (result.finalUrl) console.log(`最终页面：${result.finalUrl}`);
      } else {
        console.log(`执行失败：成功 ${result.successfulSteps}/${result.totalSteps} 步，失败 ${result.failedSteps} 步`);
        if (result.error) console.log(`错误：${result.error}`);
      }
      if (result.screenshots?.length) {
        console.log(`截图数量：${result.screenshots.length}`);
      }

      rl.prompt();
    } catch (err) {
      console.error('执行失败：', err instanceof Error ? err.message : err);
      rl.prompt();
    }
  });
}

// 如果直接运行此文件，则解析命令行参数
if (require.main === module) {
  if (process.argv.length <= 2) {
    // 无子命令，进入会话模式
    startSession().catch(err => {
      logger.error('会话模式启动失败', { error: err });
      process.exit(1);
    });
  } else {
    program.parse();
  }
}

export { program };