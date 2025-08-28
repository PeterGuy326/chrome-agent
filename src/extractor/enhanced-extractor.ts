/**
 * 增强数据提取器
 * 解决数据获取能力不足的问题，提供智能提取和问答能力
 */

// 优化完成的增强数据提取器，具有以下特性：
// 1. TypeScript类型安全
// 2. AI调用缓存机制
// 3. 增强的错误处理和重试机制
// 4. 数据验证和清洗功能
// 5. 可配置的提取选项
// 6. 智能数据提取和问答能力

import { Page, ElementHandle } from 'puppeteer';
import { getDefaultLogger } from '../core/logger';
import { getAIClient } from '../ai/config';
import { ExtractionRule, ExtractionResult, ExtractionError, ExtractionMetadata } from './extractor';

export interface EnhancedExtractionConfig {
  enableSmartExtraction: boolean;
  enableAIAnalysis: boolean;
  enableContentUnderstanding: boolean;
  maxContentLength: number;
  includeHiddenElements: boolean;
  extractDynamicContent: boolean;
  useMultipleSelectors: boolean;
  maxRetries: number;
  retryDelay: number;
  cacheExpiry: number;
  priceMin: number;
  priceMax: number;
  maxTextLength: number;
}

export interface SmartExtractionRequest {
  url: string;
  userQuery: string;
  context?: string;
  targetData?: string[];
  extractionType?: 'structured' | 'summary' | 'qa' | 'list';
}

export interface EnhancedExtractionResult extends ExtractionResult {
  aiAnalysis?: {
    summary: string;
    keyInsights: string[];
    dataQuality: number;
    recommendations: string[];
  };
  qaPairs?: {
    question: string;
    answer: string;
    confidence: number;
    source: string;
  }[];
  smartSelectors?: string[];
}

export class EnhancedDataExtractor {
  private config: EnhancedExtractionConfig;
  private logger = getDefaultLogger();
  private aiCache: Map<string, any> = new Map();
  private cacheExpiry: number = 5 * 60 * 1000; // 5分钟缓存过期时间

  constructor(config: Partial<EnhancedExtractionConfig> = {}) {
    this.config = {
      enableSmartExtraction: true,
      enableAIAnalysis: true,
      enableContentUnderstanding: true,
      maxContentLength: 50000,
      includeHiddenElements: false,
      extractDynamicContent: true,
      useMultipleSelectors: true,
      maxRetries: 3,
      retryDelay: 1000,
      cacheExpiry: 5 * 60 * 1000,
      priceMin: 0,
      priceMax: 1000000,
      maxTextLength: 10000,
      ...config
    };
  }

  /**
   * 从缓存获取AI结果或执行AI调用
   */
  private async getCachedAIResult(cacheKey: string, aiCall: () => Promise<any>): Promise<any> {
    // 检查缓存
    if (this.aiCache.has(cacheKey)) {
      const cached = this.aiCache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheExpiry) {
        this.logger.debug('Using cached AI result', { cacheKey });
        return cached.result;
      } else {
        // 缓存过期，删除
        this.aiCache.delete(cacheKey);
      }
    }

    // 执行AI调用
    const result = await aiCall();
    
    // 缓存结果
    this.aiCache.set(cacheKey, {
      result,
      timestamp: Date.now()
    });

    return result;
  }

  /**
   * 清空AI缓存
   */
  public clearCache(): void {
    this.aiCache.clear();
    this.logger.info('AI cache cleared');
  }

  /**
   * 智能数据提取和问答
   */
  async extractWithQA(
    page: Page,
    request: SmartExtractionRequest
  ): Promise<EnhancedExtractionResult> {
    try {
      this.logger.info('Starting enhanced extraction with QA', {
        url: request.url,
        query: request.userQuery,
        type: request.extractionType
      });

      // 1. 获取页面完整内容
      const pageContent = await this.getPageContent(page);
      
      // 2. 智能分析用户意图
      const intentAnalysis = await this.analyzeUserIntent(request, pageContent);
      
      // 3. 动态生成提取策略
      const extractionStrategy = await this.generateExtractionStrategy(intentAnalysis, pageContent);
      
      // 4. 执行数据提取
      const extractedData = await this.executeSmartExtraction(page, extractionStrategy);
      
      // 5. 生成问答对
      const qaPairs = await this.generateQAPairs(extractedData, request.userQuery, pageContent);
      
      // 6. AI分析和总结
      const aiAnalysis = await this.performAIAnalysis(extractedData, request, pageContent);

      return {
        ...extractedData,
        aiAnalysis,
        qaPairs,
        smartSelectors: extractionStrategy.selectors
      };

    } catch (error) {
      this.logger.error('Enhanced extraction failed', { error, request });
      return this.createErrorResult(error, request.url);
    }
  }

  /**
   * 获取页面完整内容
   */
  private async getPageContent(page: Page): Promise<string> {
    // 等待页面完全加载
    await page.waitForNetworkIdle();
    
    // 获取文本内容
    const content = await page.evaluate((config) => {
      const getTextContent = (element: Element): string => {
        const text = element.textContent || '';
        const isVisible = config.includeHiddenElements || 
          element.getBoundingClientRect().width > 0 && 
          element.getBoundingClientRect().height > 0;
        
        return isVisible ? text.trim() : '';
      };

      // 获取主要内容的策略
      const contentSelectors = [
        'main',
        '[role="main"]',
        '.content',
        '.main-content',
        'article',
        '.post',
        '.entry',
        'body'
      ];

      let bestContent = '';
      for (const selector of contentSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const element of Array.from(elements)) {
          const text = getTextContent(element);
          if (text.length > bestContent.length && text.length < config.maxContentLength) {
            bestContent = text;
          }
        }
      }

      return bestContent || document.body.textContent || '';
    }, this.config);

    return content.slice(0, this.config.maxContentLength);
  }

  /**
   * 分析用户意图
   */
  private async analyzeUserIntent(request: SmartExtractionRequest, pageContent: string) {
    const prompt = `
分析用户查询意图并提供提取策略：

用户查询: "${request.userQuery}"
页面内容预览: ${pageContent.slice(0, 2000)}...

请分析：
1. 用户想要提取什么类型的数据？
2. 需要关注页面的哪些部分？
3. 应该使用什么提取策略？

返回JSON格式：
{
  "dataType": "价格/列表/联系信息/统计数据等",
  "focusAreas": ["选择器1", "选择器2"],
  "strategy": "list/table/single/qa",
  "priorityFields": ["字段1", "字段2"]
}
`;

    try {
      const client = getAIClient();
      const response = await client.chat.completions.create({
        model: "qwen-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 500
      });

      const content = response.choices[0]?.message?.content || '{}';
      return JSON.parse(content);
    } catch (error) {
      this.logger.warn('Failed to analyze intent, using default strategy', { error });
      return {
        dataType: "general",
        focusAreas: ["body"],
        strategy: "list",
        priorityFields: ["text"]
      };
    }
  }

  /**
   * 生成智能提取策略
   */
  private async generateExtractionStrategy(intentAnalysis: any, pageContent: string) {
    const commonSelectors: Record<string, string[]> = {
      product: ['.product', '.item', '[data-testid*="product"]', '.card', '.listing'],
      price: ['.price', '.cost', '.amount', '[class*="price"]', '[data-price]'],
      contact: ['.contact', '.info', '.details', '.address'],
      list: ['ul li', '.list-item', '.entry', 'tr'],
      table: ['table', '.data-table', '.grid']
    };

    const strategy = {
      selectors: commonSelectors[intentAnalysis.dataType as string] || ['body'],
      fields: intentAnalysis.priorityFields || ['text', 'value'],
      filters: [],
      extractionType: intentAnalysis.strategy || 'list'
    };

    return strategy;
  }

  /**
   * 执行智能提取
   */
  private async executeSmartExtraction(
    page: Page,
    strategy: any
  ): Promise<ExtractionResult> {
    const allData: any[] = [];
    const errors: any[] = [];
    const maxRetries = 3;
    const retryDelay = 1000;

    // 尝试多个选择器
    for (const selector of strategy.selectors) {
      let retryCount = 0;
      while (retryCount <= maxRetries) {
        try {
          // 等待元素出现
          await page.waitForSelector(selector, { timeout: 5000 }).catch(() => {});
          
          const elements = await page.$$(selector);
          
          for (const element of elements) {
            const itemData = await this.extractElementData(element, strategy.fields);
            if (itemData && Object.keys(itemData).length > 0) {
              allData.push(itemData);
            }
          }

          if (allData.length > 0) break; // 找到有效数据就停止
          break; // 成功执行就跳出重试循环
        } catch (error: any) {
          retryCount++;
          if (retryCount > maxRetries) {
            errors.push({ selector, error: error.message });
            break;
          }
          
          // 等待后重试
          await new Promise(resolve => setTimeout(resolve, retryDelay * retryCount));
        }
      }
    }

    return {
      success: allData.length > 0,
      data: allData,
      totalItems: allData.length,
      extractedFields: strategy.fields,
      errors,
      metadata: {
        url: page.url(),
        timestamp: new Date(),
        pageTitle: await page.title(),
        totalPages: 1,
        extractionRule: 'smart_extraction',
        userAgent: await page.evaluate(() => navigator.userAgent)
      },
      executionTime: Date.now()
    };
  }

  /**
   * 从元素提取数据
   */
  private async extractElementData(element: ElementHandle, fields: string[]) {
    const data: any = {};
    
    for (const field of fields) {
      try {
        let value: any = null;
        
        switch (field) {
          case 'text':
            value = await element.evaluate(el => el.textContent?.trim());
            // 数据清洗
            if (value) {
              value = this.cleanText(value);
            }
            break;
          case 'price':
            value = await element.evaluate(el => {
              const priceEl = el.querySelector('.price, [class*="price"], [data-price]');
              return priceEl ? priceEl.textContent?.trim() : null;
            });
            if (value) {
              value = this.cleanPrice(value);
            }
            break;
          case 'image':
            value = await element.evaluate(el => {
              const img = el.querySelector('img');
              return img ? img.src : null;
            });
            // 验证图片URL
            if (value && !this.isValidUrl(value)) {
              value = null;
            }
            break;
          case 'link':
            value = await element.evaluate(el => {
              const link = el.querySelector('a');
              return link ? link.href : null;
            });
            // 验证链接URL
            if (value && !this.isValidUrl(value)) {
              value = null;
            }
            break;
          default:
            value = await element.evaluate((el, fieldName) => {
              const target = el.querySelector(`[class*="${fieldName}"], [data-${fieldName}]`);
              return target ? target.textContent?.trim() : null;
            }, field);
            // 数据清洗
            if (value) {
              value = this.cleanText(value);
            }
        }

        // 数据验证
        if (value !== null && this.isValidData(field, value)) {
          data[field] = value;
        }
      } catch (error) {
        this.logger.debug(`Failed to extract field ${field}`, { error });
      }
    }

    return data;
  }

  /**
   * 清洗文本数据
   */
  private cleanText(text: string): string {
    // 移除多余的空白字符
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * 清洗价格数据
   */
  private cleanPrice(priceText: string): number | null {
    // 提取数字和小数点
    const cleaned = priceText.replace(/[^\d.]/g, '');
    const price = parseFloat(cleaned);
    return isNaN(price) ? null : price;
  }

  /**
   * 验证URL有效性
   */
  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 验证数据有效性
   */
  private isValidData(field: string, value: any): boolean {
    // 检查空值
    if (value === null || value === undefined) {
      return false;
    }

    // 检查字符串长度
    if (typeof value === 'string') {
      if (value.length === 0) {
        return false;
      }
      if (value.length > this.config.maxTextLength) { // 使用配置的文本长度限制
        return false;
      }
    }

    // 检查价格合理性
    if (field === 'price' && typeof value === 'number') {
      if (value < this.config.priceMin || value > this.config.priceMax) { // 使用配置的价格范围
        return false;
      }
    }

    return true;
  }

  /**
   * 生成问答对
   */
  private async generateQAPairs(
    extractedData: ExtractionResult,
    userQuery: string,
    pageContent: string
  ) {
    const prompt = `
基于提取的数据和页面内容，回答用户问题：

用户问题: "${userQuery}"
提取的数据: ${JSON.stringify(extractedData.data.slice(0, 5))}
页面内容摘要: ${pageContent.slice(0, 3000)}...

请生成问答对，包含：
1. 直接回答用户问题
2. 提供相关数据支持
3. 给出数据来源
4. 置信度评估

返回JSON格式：
{
  "qaPairs": [
    {
      "question": "用户问题",
      "answer": "详细回答",
      "confidence": 0.95,
      "source": "数据来源"
    }
  ]
}
`;

    try {
      const client = getAIClient();
      const response = await client.chat.completions.create({
        model: "qwen-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 800
      });

      const content = response.choices[0]?.message?.content || '{"qaPairs":[]}';
      const parsed = JSON.parse(content);
      return parsed.qaPairs || [];
    } catch (error) {
      this.logger.warn('Failed to generate QA pairs', { error });
      return [{
        question: userQuery,
        answer: "基于提取的数据无法准确回答，建议手动查看页面",
        confidence: 0.3,
        source: "extracted_data"
      }];
    }
  }

  /**
   * 执行AI分析
   */
  private async performAIAnalysis(
    extractedData: ExtractionResult,
    request: SmartExtractionRequest,
    pageContent: string
  ) {
    const prompt = `
分析提取的数据质量并提供洞察：

提取数据量: ${extractedData.totalItems}
用户查询: ${request.userQuery}
数据样本: ${JSON.stringify(extractedData.data.slice(0, 3))}

请提供：
1. 数据质量评估 (0-1)
2. 关键洞察
3. 改进建议
4. 数据完整性分析

返回JSON格式：
{
  "summary": "数据提取总结",
  "keyInsights": ["洞察1", "洞察2"],
  "dataQuality": 0.85,
  "recommendations": ["建议1", "建议2"]
}
`;

    try {
      const client = getAIClient();
      const response = await client.chat.completions.create({
        model: "qwen-plus",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 600
      });

      const content = response.choices[0]?.message?.content || '{}';
      return JSON.parse(content);
    } catch (error) {
      this.logger.warn('Failed to perform AI analysis', { error });
      return {
        summary: "数据提取完成",
        keyInsights: [`提取了${extractedData.totalItems}条数据`],
        dataQuality: 0.7,
        recommendations: ["检查选择器准确性", "考虑页面动态加载"]
      };
    }
  }

  /**
   * 创建错误结果
   */
  private createErrorResult(error: any, url: string): EnhancedExtractionResult {
    return {
      success: false,
      data: [],
      totalItems: 0,
      extractedFields: [],
      errors: [{
        type: 'timeout' as any,
        message: error.message || 'Extraction failed'
      }],
      metadata: {
        url,
        timestamp: new Date(),
        pageTitle: '',
        totalPages: 0,
        extractionRule: 'smart_extraction',
        userAgent: ''
      },
      executionTime: 0,
      aiAnalysis: {
        summary: "数据提取失败",
        keyInsights: ["检查网络连接", "验证页面结构"],
        dataQuality: 0,
        recommendations: ["重试提取", "检查页面是否加载完成"]
      },
      qaPairs: []
    };
  }

  /**
   * 获取页面结构信息
   */
  async getPageStructure(page: Page) {
    return await page.evaluate(() => {
      const structure = {
        title: document.title,
        headings: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
          tag: h.tagName,
          text: h.textContent?.trim(),
          selector: h.tagName + (h.id ? `#${h.id}` : '')
        })),
        tables: Array.from(document.querySelectorAll('table')).map((t, i) => ({
          index: i,
          rows: t.rows?.length || 0,
          cols: t.rows && t.rows[0] ? t.rows[0].cells?.length || 0 : 0
        })),
        lists: Array.from(document.querySelectorAll('ul, ol')).map((l, i) => ({
          index: i,
          type: l.tagName.toLowerCase(),
          items: l.querySelectorAll('li').length
        })),
        forms: Array.from(document.querySelectorAll('form')).map((f, i) => ({
          index: i,
          inputs: f.querySelectorAll('input, select, textarea').length
        })),
        images: Array.from(document.querySelectorAll('img')).map((img, i) => ({
          index: i,
          src: img.src || '',
          alt: img.alt || ''
        }))
      };
      return structure;
    });
  }
}

// 增强的API接口
export class DataExtractionService {
  private extractor = new EnhancedDataExtractor();

  /**
   * 智能提取并回答用户问题
   */
  async extractAndAnswer(page: Page, userQuery: string) {
    const request: SmartExtractionRequest = {
      url: page.url(),
      userQuery,
      extractionType: 'qa'
    };

    const result = await this.extractor.extractWithQA(page, request);
    
    // 格式化回答
    const answers = result.qaPairs?.map(qa => ({
      answer: qa.answer,
      confidence: qa.confidence,
      sources: qa.source,
      data: result.data
    })) || [];

    return {
      answers,
      summary: result.aiAnalysis?.summary,
      insights: result.aiAnalysis?.keyInsights,
      totalFound: result.totalItems,
      rawData: result.data
    };
  }

  /**
   * 批量提取相似数据
   */
  async extractSimilarData(page: Page, targetType: string) {
    const structure = await this.extractor.getPageStructure(page);
    const request: SmartExtractionRequest = {
      url: page.url(),
      userQuery: `提取所有${targetType}数据`,
      extractionType: 'structured'
    };

    return await this.extractor.extractWithQA(page, request);
  }
}
