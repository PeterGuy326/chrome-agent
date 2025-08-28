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
import { getAIClient, getAIClientManager } from '../ai/config'
import { quickGetConfigValue } from '../storage';

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
  private navigationTimeout: number = 30000;
  private elementTimeout: number = 5000;

  constructor() {
    this.initializeDefaultStrategies();
    this.loadTimeoutConfig();
  }

  /**
   * 加载超时配置
   */
  private async loadTimeoutConfig(): Promise<void> {
    try {
      this.navigationTimeout = await quickGetConfigValue<number>('executor.navigationTimeout') ?? 60000;
      this.elementTimeout = await quickGetConfigValue<number>('executor.elementTimeout') ?? 15000;
    } catch (error) {
      this.logger.warn('Failed to load timeout config, using defaults', { error });
    }
  }

  /**
   * 生成执行计划（纯 AI 版本）
   */
  async generatePlan(
    taskId: string,
    intents: ParsedIntent[],
    context?: PlanningContext
  ): Promise<Plan> {
    this.logger.info('Generating plan (AI-only)', { taskId, intentsCount: intents.length });

    if (intents.length === 0) {
      throw new Error('No intents provided for planning');
    }

    // 内联工具函数：提取 JSON、归一化动作/等待
    const extractJsonBlock = (s: string) => {
      const start = s.indexOf('{');
      const end = s.lastIndexOf('}');
      if (start >= 0 && end > start) return s.slice(start, end + 1);
      return s;
    };

    const normalizeAction = (a?: string): ActionType => {
      if (!a) return ActionType.WAIT;
      const key = a.toUpperCase();
      if ((ActionType as any)[key]) return (ActionType as any)[key] as ActionType;
      if (key === 'PRESS' || key === 'PRESSKEY') return ActionType.PRESS_KEY;
      return ActionType.WAIT;
    };

    const normalizeWait = (wait: any, action: ActionType) => {
      const rawType = (wait?.type || (action === ActionType.NAVIGATE ? 'NAVIGATION' : 'ELEMENT')).toString().toUpperCase();
      const type = (WaitType as any)[rawType] ?? (action === ActionType.NAVIGATE ? WaitType.NAVIGATION : WaitType.ELEMENT);
      const timeout = typeof wait?.timeout === 'number' ? wait.timeout : (action === ActionType.NAVIGATE ? this.navigationTimeout : this.elementTimeout);
      const value = wait?.value;
      return { type, timeout, value } as WaitCondition;
    };

    // 调用 LLM 生成步骤
    const client = getAIClient();
    const cfg = getAIClientManager().getConfig();

    // 参数化重试配置（来自全局配置）
    const maxAttempts = Math.max(1, (await quickGetConfigValue<number>('ai.planner.retry.maxAttempts')) ?? 2);
    const temperatureStepDown = Math.max(0, (await quickGetConfigValue<number>('ai.planner.retry.temperatureStepDown')) ?? 0.2);
    const strictPrompt = (await quickGetConfigValue<string>('ai.planner.strictPrompt')) ?? '严格只输出一个 JSON 对象（UTF-8），不要使用反引号/Markdown 代码块/任何解释文字；若 JSON 校验失败请立即纠正；必要时将 selectorCandidates 设为空数组。';

    const systemPrompt = [
      '你是一名浏览器自动化智能体的资深规划专家。',
      '请根据用户意图和可选上下文，产出最小化、逻辑有序、可执行的计划，格式为 JSON。',
      '最终输出必须严格为 JSON 且仅包含一个对象：{"steps": Step[] }，不要任何解释或多余文本。',
      '输出要求：',
      '- 只能输出有效 JSON（UTF-8，无 BOM），不要使用反引号，不要使用 Markdown 代码块，不要输出额外文字或注释。',
      '- JSON 必须可被 JSON.parse 直接解析。',
      '- 如果不确定选择器，允许 selectorCandidates 为空数组，或给出低置信度的 text/css 候选。',
      '- 若必须参数缺失（如 NAVIGATE 的 url），请合理从 intents 或 context 推断；实在无法推断时保持结构有效并尽量提供 WAIT 以保证可执行性。',
      '规则：',
      '- 不要包含 id、order、planId（由系统稍后分配）。',
      '- 允许的动作: NAVIGATE, CLICK, TYPE, SELECT, SCROLL, WAIT, EXTRACT, SCREENSHOT, EVALUATE, HOVER, PRESS_KEY。',
      '- NAVIGATE 必须提供 params.url。若缺失，请依据 intents.parameters.url 或 context.currentUrl 推断。',
      '- 步骤需最小且相关。常见流程：NAVIGATE -> WAIT(NAVIGATION) -> TYPE -> CLICK/PRESS_KEY -> WAIT(ELEMENT) -> EXTRACT。',
      '- 若 intents.target.selectors 已提供选择器，请优先使用。',
      '领域偏好（用于更合理的步骤规划）：',
      '- 电商：优先定位站内搜索框（input[type="search"], [placeholder*="搜"], [aria-label*="搜索"]），输入关键词后按 Enter 或点击"搜索/放大镜"按钮；如有"官方/自营/价格"筛选，先点击筛选再抽取商品列表（如 .product-item）。',
      '- 搜索引擎：在当前/目标搜索页输入查询并提交；等待结果后，如用户要求打开首条结果则 CLICK 第一条标题链接；避免登录弹窗和不相关按钮。',
      '- 表单填写：通过 label/placeholder/name 优先定位输入框；TYPE 输入值；SELECT 下拉选项；点击 type=submit 或文本为"提交/保存"的按钮提交；提交后等待 NAVIGATION 或 ELEMENT。',
      '- 新闻：在新闻站点优先抽取列表中的标题、时间、来源与链接；若用户要求"打开第一条/最新"，CLICK 第一条新闻标题；需要摘要或正文时在详情页 EXTRACT 段落文本。',
      '- 社交媒体：在站内搜索页输入关键词并提交；必要时 SCROLL 加载更多；CLICK "更多/展开"按钮再 EXTRACT 帖子卡片（作者、时间、内容、链接）；尽量避开登录弹窗。',
      '- 视频网站：优先使用站内搜索（如 input[placeholder*="搜索"], .search-input）；必要时 SCROLL 加载视频列表；点击视频标题或封面进入播放页；EXTRACT 视频信息（标题、作者、播放量、时长、描述）；播放控制用 .play-btn, .pause-btn 等选择器。',
      '- 地图导航：输入起点终点到搜索框（如 #origin, #destination, .route-input）；点击"搜索路线/导航"按钮；等待路线规划完成；EXTRACT 路线信息（距离、时长、路径）；必要时点击不同路线选项（如 .route-option）。',
      '- 文档/学术：在搜索框输入关键词或论文标题；使用高级搜索过滤器（如年份、作者、期刊）；EXTRACT 搜索结果（标题、作者、摘要、DOI、下载链接）；点击标题进入详情页获取全文信息。',
      '- 在线工具：定位主要功能输入区域（如 .input-area, #file-upload, .text-input）；输入内容或上传文件；点击"转换/处理/生成"按钮；等待处理完成；EXTRACT 或下载结果文件。',
      '- 金融/股票：输入股票代码或公司名称到搜索框；EXTRACT 实时价格、涨跌幅、成交量等关键指标；必要时切换时间周期（日线、周线）或查看详细财务数据。',
      '- 一般：NAVIGATE 之后务必 WAIT(NAVIGATION)；对需要渲染的页面在交互前 WAIT(ELEMENT)；避免冗余的连续 NAVIGATE；必要时使用 PRESS_KEY=Enter 提交搜索或表单。',
      'Step 项（StepLike）结构：',
      '{ "action":"NAVIGATE|CLICK|TYPE|SELECT|SCROLL|WAIT|EXTRACT|SCREENSHOT|EVALUATE|HOVER|PRESS_KEY",',
      '  "selectorCandidates":[{"type":"css|xpath|text|aria-label|role|data-testid|id|class|tag|name","value":"...","score":80,"description":"...","fallback":false}],',
      '  "params":{"url":"...","text":"...","value":"...","key":"...","options":{}},',
      '  "waitFor":{"type":"NAVIGATION|ELEMENT|TIMEOUT|FUNCTION|NETWORK_IDLE","value":"...","timeout":${this.elementTimeout}},',
      '  "retries":{"maxAttempts":2,"delay":1000,"backoff":true},',
      `  "timeout":${this.navigationTimeout},`,
      '  "description":"...",',
      '  "isOptional":false }',
      '示例（仅供参考，不要在最终输出中包含本行或任何解释文本）：',
      '{"steps":[',
      ` {"action":"NAVIGATE","selectorCandidates":[],"params":{"url":"https://example.com"},"waitFor":{"type":"NAVIGATION","timeout":${this.navigationTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.navigationTimeout},"description":"打开主页","isOptional":false},`,
      ` {"action":"TYPE","selectorCandidates":[{"type":"css","value":"input[type=\\"search\\"]","score":85,"description":"站内搜索框"}],"params":{"text":"iPhone 15"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"输入关键词","isOptional":false},`,
      ` {"action":"PRESS_KEY","selectorCandidates":[],"params":{"key":"Enter"},"waitFor":{"type":"NAVIGATION","timeout":${this.navigationTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.navigationTimeout},"description":"提交搜索","isOptional":false},`,
      ` {"action":"EXTRACT","selectorCandidates":[{"type":"css","value":".product-item","score":70,"description":"商品卡片"}],"params":{"options":{"fields":["title","price","link"]}},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"抽取商品信息","isOptional":false}`,
      ']}'
    ].join('\n');

    // 基于意图/上下文动态拼接扩展的小样例集
    const toLower = (s?: string) => (s || '').toLowerCase();
    const strIncludesAny = (s: string, kws: string[]) => kws.some(k => s.includes(k));
    const inferDomains = () => {
      const domains = new Set<string>();
      const url = toLower(context?.currentUrl);
      const urlHost = url.replace(/^https?:\/\//, '');
      for (const it of intents) {
        const d = toLower(it.context?.domain);
        const p = toLower(it.context?.pageType);
        const g = toLower(it.context?.userGoal);
        const text = `${d} ${p} ${g} ${urlHost}`;
        
        // 电商领域
        if (strIncludesAny(text, ['jd.com','tmall','taobao','pinduoduo','pdd','amazon','ebay','购物','电商','shop'])) domains.add('ecommerce');
        
        // 搜索引擎
        if (strIncludesAny(text, ['google','bing','baidu','duckduckgo','搜索','search'])) domains.add('search');
        
        // 表单
        if (strIncludesAny(text, ['表单','form','submit','registration','login','注册','登录'])) domains.add('forms');
        
        // 新闻
        if (strIncludesAny(text, ['news','新闻','xinhuanet','people.com.cn','bbc','cnn','nytimes','guardian','reuters','sohu','163.com','ifeng','sina','qq.com','36kr','huxiu','cnbeta'])) domains.add('news');
        
        // 社交媒体
        if (strIncludesAny(text, ['weibo','twitter','x.com','facebook','instagram','reddit','douyin','tiktok','bilibili','zhihu','xiaohongshu','小红书','社交'])) domains.add('social');
        
        // 视频网站
        if (strIncludesAny(text, ['youtube','bilibili','youku','iqiyi','tencent','qq.com/v','优酷','爱奇艺','腾讯视频','视频','video','watch','播放'])) domains.add('video');
        
        // 地图导航
        if (strIncludesAny(text, ['maps','baidu.com/map','amap','gaode','谷歌地图','百度地图','高德地图','导航','地图','route','navigation'])) domains.add('maps');
        
        // 文档/学术
        if (strIncludesAny(text, ['scholar','arxiv','researchgate','pubmed','cnki','万方','维普','学术','论文','文档','document','pdf','paper'])) domains.add('documents');
        
        // 在线工具
        if (strIncludesAny(text, ['tool','converter','generator','在线工具','转换器','生成器','processor','editor'])) domains.add('tools');
        
        // 金融/股票
        if (strIncludesAny(text, ['finance','stock','yahoo.finance','sina.finance','eastmoney','金融','股票','财经','基金','investment'])) domains.add('finance');
      }
      
      // 若无明显领域，根据动作简单推断
      if (domains.size === 0) {
        const hasType = intents.some(i => i.action?.toString().includes('type'));
        const hasExtract = intents.some(i => i.action?.toString().includes('extract'));
        if (hasType) domains.add('search');
        if (hasExtract) domains.add('news');
      }
      return Array.from(domains);
    };

    const domains = inferDomains();

    const domainExamples: string[] = [];
    
    // 新闻领域示例
    if (domains.includes('news')) {
      domainExamples.push(
        '// 新闻网站示例',
        '{"steps":[',
        ' {"action":"NAVIGATE","selectorCandidates":[],"params":{"url":"https://news.example.com"},"waitFor":{"type":"NAVIGATION","timeout":${this.navigationTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.navigationTimeout},"description":"打开新闻站点","isOptional":false},',
        ' {"action":"EXTRACT","selectorCandidates":[{"type":"css","value":".news-item","score":70,"description":"新闻列表项"}],"params":{"options":{"fields":["title","time","source","link"]}},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"抽取新闻信息","isOptional":false}',
        ']}'
      );
    }
    
    // 社交媒体示例
    if (domains.includes('social')) {
      domainExamples.push(
        '// 社交媒体示例',
        '{"steps":[',
        ` {"action":"NAVIGATE","selectorCandidates":[],"params":{"url":"https://social.example.com/search"},"waitFor":{"type":"NAVIGATION","timeout":${this.navigationTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.navigationTimeout},"description":"进入社交搜索页","isOptional":false},`,
        ' {"action":"TYPE","selectorCandidates":[{"type":"css","value":"input[type=\\"search\\"]","score":80,"description":"站内搜索框"}],"params":{"text":"热点话题"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"输入关键词","isOptional":false},',
        ` {"action":"PRESS_KEY","selectorCandidates":[],"params":{"key":"Enter"},"waitFor":{"type":"NAVIGATION","timeout":${this.navigationTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.navigationTimeout},"description":"提交搜索","isOptional":false},`,
        ' {"action":"SCROLL","selectorCandidates":[],"params":{"value":"page_down"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":1,"delay":500,"backoff":false},"timeout":${this.elementTimeout},"description":"滚动加载更多","isOptional":true},',
        ' {"action":"EXTRACT","selectorCandidates":[{"type":"css","value":".post-card","score":70,"description":"帖子卡片"}],"params":{"options":{"fields":["author","time","content","link"]}},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"抽取帖子数据","isOptional":false}',
        ']}'
      );
    }
    
    // 视频网站示例
    if (domains.includes('video')) {
      domainExamples.push(
        '// 视频网站示例',
        '{"steps":[',
        ` {"action":"NAVIGATE","selectorCandidates":[],"params":{"url":"https://video.example.com"},"waitFor":{"type":"NAVIGATION","timeout":${this.navigationTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.navigationTimeout},"description":"打开视频网站","isOptional":false},`,
        ' {"action":"TYPE","selectorCandidates":[{"type":"css","value":"input[placeholder*=\\"搜索\\"]","score":85,"description":"视频搜索框"}],"params":{"text":"教程视频"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"输入搜索关键词","isOptional":false},',
        ` {"action":"PRESS_KEY","selectorCandidates":[],"params":{"key":"Enter"},"waitFor":{"type":"NAVIGATION","timeout":${this.navigationTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.navigationTimeout},"description":"提交搜索","isOptional":false},`,
        ` {"action":"CLICK","selectorCandidates":[{"type":"css","value":".video-item:first-child .video-title","score":75,"description":"第一个视频标题"}],"params":{},"waitFor":{"type":"NAVIGATION","timeout":${this.navigationTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.navigationTimeout},"description":"点击视频进入播放页","isOptional":false},`,
        ' {"action":"EXTRACT","selectorCandidates":[{"type":"css","value":".video-info","score":70,"description":"视频信息区域"}],"params":{"options":{"fields":["title","author","views","duration","description"]}},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"抽取视频信息","isOptional":false}',
        ']}'
      );
    }
    
    // 地图导航示例
    if (domains.includes('maps')) {
      domainExamples.push(
        '// 地图导航示例',
        '{"steps":[',
        ' {"action":"NAVIGATE","selectorCandidates":[],"params":{"url":"https://maps.example.com"},"waitFor":{"type":"NAVIGATION","timeout":' + this.navigationTimeout + '},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":' + this.navigationTimeout + ',"description":"打开地图网站","isOptional":false},',
        ' {"action":"TYPE","selectorCandidates":[{"type":"css","value":"#origin","score":90,"description":"起点输入框"}],"params":{"text":"北京站"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"输入起点","isOptional":false},',
        ' {"action":"TYPE","selectorCandidates":[{"type":"css","value":"#destination","score":90,"description":"终点输入框"}],"params":{"text":"天安门广场"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"输入终点","isOptional":false},',
        ' {"action":"CLICK","selectorCandidates":[{"type":"css","value":".route-search-btn","score":85,"description":"搜索路线按钮"}],"params":{},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"搜索路线","isOptional":false},',
        ' {"action":"EXTRACT","selectorCandidates":[{"type":"css","value":".route-result","score":75,"description":"路线结果"}],"params":{"options":{"fields":["distance","duration","route_steps"]}},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"抽取路线信息","isOptional":false}',
        ']}'
      );
    }
    
    // 文档/学术示例
    if (domains.includes('documents')) {
      domainExamples.push(
        '// 学术文档示例',
        '{"steps":[',
        ' {"action":"NAVIGATE","selectorCandidates":[],"params":{"url":"https://scholar.example.com"},"waitFor":{"type":"NAVIGATION","timeout":' + this.navigationTimeout + '},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":' + this.navigationTimeout + ',"description":"打开学术搜索","isOptional":false},',
        ' {"action":"TYPE","selectorCandidates":[{"type":"css","value":"input[name=\\"q\\"]","score":85,"description":"学术搜索框"}],"params":{"text":"machine learning"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"输入搜索关键词","isOptional":false},',
        ' {"action":"CLICK","selectorCandidates":[{"type":"css","value":"button[type=\\"submit\\"]","score":80,"description":"搜索按钮"}],"params":{},"waitFor":{"type":"NAVIGATION","timeout":' + this.navigationTimeout + '},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":' + this.navigationTimeout + ',"description":"提交搜索","isOptional":false},',
        ' {"action":"EXTRACT","selectorCandidates":[{"type":"css","value":".paper-item","score":70,"description":"论文条目"}],"params":{"options":{"fields":["title","authors","abstract","doi","pdf_link"]}},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"抽取论文信息","isOptional":false}',
        ']}'
      );
    }
    
    // 在线工具示例
    if (domains.includes('tools')) {
      domainExamples.push(
        '// 在线工具示例',
        '{"steps":[',
        ' {"action":"NAVIGATE","selectorCandidates":[],"params":{"url":"https://tool.example.com"},"waitFor":{"type":"NAVIGATION","timeout":' + this.navigationTimeout + '},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":' + this.navigationTimeout + ',"description":"打开在线工具","isOptional":false},',
        ' {"action":"TYPE","selectorCandidates":[{"type":"css","value":".text-input","score":80,"description":"文本输入区域"}],"params":{"text":"待处理的文本内容"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"输入待处理内容","isOptional":false},',
        ' {"action":"CLICK","selectorCandidates":[{"type":"css","value":".process-btn","score":85,"description":"处理按钮"}],"params":{},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"启动处理","isOptional":false},',
        ' {"action":"WAIT","selectorCandidates":[],"params":{},"waitFor":{"type":"ELEMENT","value":".result-ready","timeout":${this.elementTimeout}},"retries":{"maxAttempts":1,"delay":2000,"backoff":false},"timeout":${this.elementTimeout},"description":"等待处理完成","isOptional":false},',
        ' {"action":"EXTRACT","selectorCandidates":[{"type":"css","value":".result-output","score":75,"description":"处理结果"}],"params":{"options":{"fields":["processed_text","download_link"]}},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"抽取处理结果","isOptional":false}',
        ']}'
      );
    }
    
    // 金融/股票示例
    if (domains.includes('finance')) {
      domainExamples.push(
        '// 金融股票示例',
        '{"steps":[',
        ' {"action":"NAVIGATE","selectorCandidates":[],"params":{"url":"https://finance.example.com"},"waitFor":{"type":"NAVIGATION","timeout":' + this.navigationTimeout + '},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":' + this.navigationTimeout + ',"description":"打开金融网站","isOptional":false},',
        ' {"action":"TYPE","selectorCandidates":[{"type":"css","value":"input[placeholder*=\\"股票代码\\"]","score":85,"description":"股票搜索框"}],"params":{"text":"AAPL"},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"输入股票代码","isOptional":false},',
        ' {"action":"PRESS_KEY","selectorCandidates":[],"params":{"key":"Enter"},"waitFor":{"type":"NAVIGATION","timeout":' + this.navigationTimeout + '},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":' + this.navigationTimeout + ',"description":"搜索股票","isOptional":false},',
        ' {"action":"EXTRACT","selectorCandidates":[{"type":"css","value":".stock-info","score":75,"description":"股票信息面板"}],"params":{"options":{"fields":["current_price","change_percent","volume","market_cap"]}},"waitFor":{"type":"ELEMENT","timeout":${this.elementTimeout}},"retries":{"maxAttempts":2,"delay":1000,"backoff":true},"timeout":${this.elementTimeout},"description":"抽取股票数据","isOptional":false}',
        ']}'
      );
    }

    // 将动态示例拼接到提示词末尾（若存在）
    let finalSystemPrompt = systemPrompt;
    if (domainExamples.length > 0) {
      finalSystemPrompt += '\n更多领域示例（仅供参考，不要在最终输出中包含本段或任何解释）：\n' + domainExamples.join('\n');
    }

    const payload = { intents, context };

    // 参数化重试机制
    let currentAttempt = 1;
    let currentTemperature = cfg.temperature ?? 0.2;
    let data: any;
    let rawSteps: any[] = [];

    while (currentAttempt <= maxAttempts) {
      try {
        this.logger.debug('AI Planner attempt', { 
          attempt: currentAttempt, 
          maxAttempts, 
          temperature: currentTemperature 
        });

        // 构建消息，重试时追加严格提示
        const messages: any[] = [
          { role: 'system', content: finalSystemPrompt },
          { role: 'user', content: JSON.stringify(payload) }
        ];

        if (currentAttempt > 1) {
          messages.push({
            role: 'system',
            content: `重试请求：${strictPrompt}`
          });
        }

        const resp = await client.chat.completions.create({
          model: cfg.plannerModel || cfg.model,
          messages,
          temperature: currentTemperature,
          max_tokens: cfg.maxTokens ?? 2048,
          top_p: cfg.topP ?? 1,
          response_format: { type: 'json_object' }
        });

        const text = resp.choices?.[0]?.message?.content || '';

        // 尝试解析 JSON
        try {
          data = JSON.parse(extractJsonBlock(text));
          rawSteps = Array.isArray(data?.steps) ? data.steps : (Array.isArray(data) ? data : []);
          
          if (!rawSteps.length) {
            throw new Error('Empty steps array');
          }

          this.logger.debug('AI Planner JSON parsed successfully', { 
            stepsCount: rawSteps.length, 
            attempt: currentAttempt 
          });
          break; // 成功解析，退出重试循环

        } catch (parseError) {
          this.logger.warn('AI Planner JSON parse failed', { 
            attempt: currentAttempt, 
            preview: text.slice(0, 200),
            error: parseError instanceof Error ? parseError.message : 'Unknown parse error'
          });
          
          if (currentAttempt >= maxAttempts) {
            throw new Error(`AI Planner failed after ${maxAttempts} attempts: invalid JSON output`);
          }
        }

      } catch (error) {
        this.logger.error('AI Planner request failed', { 
          attempt: currentAttempt, 
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        if (currentAttempt >= maxAttempts) {
          throw new Error(`AI Planner failed after ${maxAttempts} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      // 准备下一次重试：降低温度
      currentAttempt++;
      currentTemperature = Math.max(0, currentTemperature - temperatureStepDown);
    }

    // 本地 schema 校验与自动修正：归一化为内部 Step 结构
    // 辅助：规范化 selectorCandidates
    const normalizeSelectorCandidates = (cands: any[]): SelectorCandidate[] => {
      if (!Array.isArray(cands)) return [];
      const allowed = new Set<SelectorType>([
        SelectorType.CSS,
        SelectorType.XPATH,
        SelectorType.TEXT,
        SelectorType.ARIA_LABEL,
        SelectorType.ROLE,
        SelectorType.DATA_TESTID,
        SelectorType.ID,
        SelectorType.CLASS,
        SelectorType.TAG,
        SelectorType.NAME
      ]);
      return cands.map((c: any) => {
        const rawType = (c?.type ?? 'css').toString().toLowerCase();
        // 将常见变体归一：aria_label -> aria-label 等
        const mapped = rawType.replace('_', '-');
        const type = (allowed.has(mapped as SelectorType) ? mapped : 'css') as SelectorType;
        const scoreNum = typeof c?.score === 'number' ? c.score : (typeof c?.confidence === 'number' ? Math.round(c.confidence * 100) : 50);
        const score = Math.max(0, Math.min(100, scoreNum));
        return {
          type,
          value: c?.value?.toString?.() || '',
          score,
          description: c?.description?.toString?.() || `${type}: ${c?.value || ''}`,
          fallback: Boolean(c?.fallback)
        } as SelectorCandidate;
      }).filter(c => typeof c.value === 'string');
    };

    const ensureRetries = (r: any): RetryConfig => {
      const ma = Math.max(0, Number.isFinite(r?.maxAttempts) ? Number(r.maxAttempts) : 2);
      const delay = Math.max(0, Number.isFinite(r?.delay) ? Number(r.delay) : 1000);
      const backoff = Boolean(r?.backoff ?? true);
      return { maxAttempts: ma, delay, backoff };
    };

    const ensureParams = (p: any, action: ActionType): StepParams => {
      const obj = typeof p === 'object' && p !== null ? p : {};
      const params: StepParams = {
        text: typeof obj.text === 'string' ? obj.text : undefined,
        url: typeof obj.url === 'string' ? obj.url : undefined,
        value: typeof obj.value === 'string' ? obj.value : undefined,
        key: typeof obj.key === 'string' ? obj.key : undefined,
        coordinates: (obj.coordinates && typeof obj.coordinates.x === 'number' && typeof obj.coordinates.y === 'number')
          ? { x: obj.coordinates.x, y: obj.coordinates.y } : undefined,
        options: typeof obj.options === 'object' && obj.options !== null ? obj.options : undefined
      };
      // 针对 PRESS_KEY 默认 key
      if (action === ActionType.PRESS_KEY && !params.key) params.key = 'Enter';
      return params;
    };

    const ensureTimeout = (t: any, action: ActionType): number => {
      const num = Number.isFinite(t) ? Number(t) : undefined;
      if (typeof num === 'number' && num > 0) return num;
      
      if (action === ActionType.NAVIGATE) return this.navigationTimeout;
      if (action === ActionType.WAIT) return this.elementTimeout;
      return this.elementTimeout;
    };

    const validateAndFixStep = (sl: any): Step => {
      const action = normalizeAction(sl?.action);
      const selectorCandidates = normalizeSelectorCandidates(sl?.selectorCandidates);
      const params = ensureParams(sl?.params, action);
      const waitFor = normalizeWait(sl?.waitFor, action);
      const retries = ensureRetries(sl?.retries);
      const timeout = ensureTimeout(sl?.timeout, action);
      const description = typeof sl?.description === 'string' && sl.description.trim().length > 0
        ? sl.description
        : `Execute ${action}`;
      const isOptional = Boolean(sl?.isOptional ?? false);

      const fixed: Step = {
        id: '',
        planId: '',
        order: 0,
        action,
        selectorCandidates,
        params,
        waitFor,
        retries,
        timeout,
        description,
        isOptional
      };
      return fixed;
    };

    // 补充上下文/意图中的 URL 以防缺失
    const intentUrl = intents.find(i => i.parameters?.url)?.parameters?.url
      || intents.find(i => i.target?.type === 'url' && i.target?.description)?.target?.description
      || context?.currentUrl
      || '';

    const steps: Step[] = rawSteps.map((sl: any): Step => {
      const step = validateAndFixStep(sl);
      if (step.action === ActionType.NAVIGATE && !step.params.url) {
        step.params.url = intentUrl;
      }
      return step;
    }).filter(s => s.action !== ActionType.NAVIGATE || !!s.params.url);

    // 分配顺序与 ID
    let stepOrder = 0;
    for (const step of steps) {
      step.order = stepOrder++;
      step.id = `${taskId}_step_${step.order}`;
    }

    // 估算风险与时长（简单启发式）
    const navCount = steps.filter(s => s.action === ActionType.NAVIGATE).length;
    const total = steps.length;
    const riskLevel = total <= 6 && navCount <= 1 ? RiskLevel.LOW : (total <= 12 ? RiskLevel.MEDIUM : RiskLevel.HIGH);

    const estimatedDuration = steps.reduce((acc, s) => {
      if (s.action === ActionType.NAVIGATE) return acc + (s.timeout || this.navigationTimeout);
      if (s.action === ActionType.WAIT) return acc + (s.waitFor?.timeout || 3000);
      return acc + Math.min(s.timeout || this.elementTimeout, this.elementTimeout);
    }, 0);

    // 生成元数据（简化）
    const metadata: PlanMetadata = {
      targetUrl: intentUrl || undefined,
      description: this.generateDescription(intents, steps),
      tags: ['ai-planner', ...domains.map(d => `domain-${d}`)],
      warnings: [],
      requirements: []
    };

    const plan: Plan = {
      id: `plan_${taskId}_${Date.now()}`,
      taskId,
      steps,
      riskLevel,
      meta: metadata,
      createdAt: new Date(),
      estimatedDuration
    };

    // 回填 planId 到步骤
    for (const step of plan.steps) {
      step.planId = plan.id;
    }

    // 验证计划
    const validation = this.validatePlan(plan);
    if (!validation.valid) {
      this.logger.error('Plan validation failed', { errors: validation.errors });
      throw new Error(`Plan validation failed: ${validation.errors.join(', ')}`);
    }
    if (validation.warnings.length > 0) {
      this.logger.warn('Plan validation warnings', { warnings: validation.warnings });
    }

    this.logger.info('Plan generated successfully (AI-only)', {
      planId: plan.id,
      stepsCount: plan.steps.length,
      riskLevel: plan.riskLevel,
      estimatedDuration: plan.estimatedDuration,
      domains: domains,
      attempts: currentAttempt - 1
    });

    // 打印详细的计划内容
    this.logger.info('=== Generated Plan Details ===');
    this.logger.info(`Plan ID: ${plan.id}`);
    this.logger.info(`Task ID: ${plan.taskId}`);
    this.logger.info(`Risk Level: ${plan.riskLevel}`);
    this.logger.info(`Estimated Duration: ${plan.estimatedDuration}ms`);
    this.logger.info(`Total Steps: ${plan.steps.length}`);
    this.logger.info('--- Plan Steps ---');
    
    plan.steps.forEach((step, index) => {
      this.logger.info(`Step ${index + 1}:`);
      this.logger.info(`  Action: ${step.action}`);
      this.logger.info(`  Description: ${step.description}`);
      
      if (step.selectorCandidates && step.selectorCandidates.length > 0) {
        this.logger.info(`  Selectors:`);
        step.selectorCandidates.forEach((selector, sIndex) => {
          this.logger.info(`    ${sIndex + 1}. ${selector.type}: "${selector.value}" (score: ${selector.score})`);
        });
      }
      
      if (step.params && Object.keys(step.params).length > 0) {
        this.logger.info(`  Parameters: ${JSON.stringify(step.params, null, 2)}`);
      }
      
      if (step.waitFor) {
        this.logger.info(`  Wait For: ${step.waitFor.type} (timeout: ${step.waitFor.timeout}ms)`);
      }
      
      if (step.retries) {
        this.logger.info(`  Retries: max ${step.retries.maxAttempts}, delay ${step.retries.delay}ms`);
      }
      
      this.logger.info(`  Timeout: ${step.timeout}ms`);
      this.logger.info(`  Optional: ${step.isOptional}`);
      this.logger.info('  ---');
    });
    
    if (plan.meta) {
      this.logger.info('--- Plan Metadata ---');
      this.logger.info(`Description: ${plan.meta.description}`);
      if (plan.meta.targetUrl) {
        this.logger.info(`Target URL: ${plan.meta.targetUrl}`);
      }
      if (plan.meta.tags && plan.meta.tags.length > 0) {
        this.logger.info(`Tags: ${plan.meta.tags.join(', ')}`);
      }
      if (plan.meta.warnings && plan.meta.warnings.length > 0) {
        this.logger.info(`Warnings: ${plan.meta.warnings.join(', ')}`);
      }
      if (plan.meta.requirements && plan.meta.requirements.length > 0) {
        this.logger.info(`Requirements: ${plan.meta.requirements.join(', ')}`);
      }
    }
    
    this.logger.info('=== End of Plan Details ===');

    // 优化计划步骤（包括调整超时配置）
    const optimizedSteps = this.optimizeSteps(plan.steps, context);
    plan.steps = optimizedSteps;

    // 重新分配步骤ID和顺序
    plan.steps.forEach((step, index) => {
      step.order = index;
      step.id = `${taskId}_step_${index}`;
      step.planId = plan.id;
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
      
      // 强制应用配置的超时设置
      if (step.action === ActionType.NAVIGATE) {
        adjustedStep.timeout = this.navigationTimeout;
        if (adjustedStep.waitFor) {
          adjustedStep.waitFor.timeout = this.navigationTimeout;
        }
      } else {
        adjustedStep.timeout = this.elementTimeout;
        if (adjustedStep.waitFor) {
          adjustedStep.waitFor.timeout = this.elementTimeout;
        }
      }
      
      // 应用用户偏好的超时设置（如果更大）
      if (userPrefs?.timeout && userPrefs.timeout > adjustedStep.timeout) {
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
      timeout: this.elementTimeout,
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
        waitFor: { type: WaitType.ELEMENT, timeout: this.elementTimeout },
        retries: { maxAttempts: 3, delay: 500, backoff: true },
        timeout: this.elementTimeout,
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
      timeout: this.elementTimeout,
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
    const timeout = intent.conditions?.timeout || this.elementTimeout;
    
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
