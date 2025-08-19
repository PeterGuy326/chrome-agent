/**
 * 抽取规则管理器
 * 负责管理和应用数据抽取规则
 */

import { ExtractionRule, ExtractionType, FieldType, FilterOperator, TransformType } from './extractor';
import { getDefaultLogger } from '../core/logger';

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  category: RuleCategory;
  domains: string[];
  template: Partial<ExtractionRule>;
}

export enum RuleCategory {
  ECOMMERCE = 'ecommerce',
  NEWS = 'news',
  SOCIAL = 'social',
  BUSINESS = 'business',
  EDUCATION = 'education',
  GOVERNMENT = 'government',
  GENERAL = 'general'
}

export interface RuleMatchResult {
  rule: ExtractionRule;
  confidence: number;
  reason: string;
}

export class RuleManager {
  private rules: Map<string, ExtractionRule> = new Map();
  private templates: Map<string, RuleTemplate> = new Map();
  private logger = getDefaultLogger();

  constructor() {
    this.initializeDefaultTemplates();
  }

  /**
   * 注册抽取规则
   */
  registerRule(rule: ExtractionRule): void {
    this.rules.set(rule.id, rule);
    this.logger.debug('Registered extraction rule', { ruleId: rule.id, type: rule.type });
  }

  /**
   * 获取抽取规则
   */
  getRule(id: string): ExtractionRule | undefined {
    return this.rules.get(id);
  }

  /**
   * 获取所有规则
   */
  getAllRules(): ExtractionRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * 删除规则
   */
  removeRule(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * 根据URL和内容匹配最佳规则
   */
  async matchRule(url: string, pageContent?: string): Promise<RuleMatchResult | null> {
    const candidates: RuleMatchResult[] = [];

    for (const rule of this.rules.values()) {
      const confidence = this.calculateRuleConfidence(rule, url, pageContent);
      if (confidence > 0) {
        candidates.push({
          rule,
          confidence,
          reason: this.generateMatchReason(rule, url, confidence)
        });
      }
    }

    // 按置信度排序，返回最佳匹配
    candidates.sort((a, b) => b.confidence - a.confidence);
    return candidates.length > 0 ? candidates[0] : null;
  }

  /**
   * 从模板创建规则
   */
  createRuleFromTemplate(templateId: string, customizations: Partial<ExtractionRule>): ExtractionRule | null {
    const template = this.templates.get(templateId);
    if (!template) {
      this.logger.warn('Template not found', { templateId });
      return null;
    }

    const rule: ExtractionRule = {
      id: customizations.id || `${templateId}_${Date.now()}`,
      name: customizations.name || template.name,
      description: customizations.description || template.description,
      selector: customizations.selector || template.template.selector || '',
      type: customizations.type || template.template.type || ExtractionType.LIST,
      fields: customizations.fields || template.template.fields || [],
      filters: customizations.filters || template.template.filters,
      pagination: customizations.pagination || template.template.pagination,
      validation: customizations.validation || template.template.validation
    };

    this.registerRule(rule);
    return rule;
  }

  /**
   * 注册规则模板
   */
  registerTemplate(template: RuleTemplate): void {
    this.templates.set(template.id, template);
    this.logger.debug('Registered rule template', { templateId: template.id, category: template.category });
  }

  /**
   * 获取模板
   */
  getTemplate(id: string): RuleTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 根据分类获取模板
   */
  getTemplatesByCategory(category: RuleCategory): RuleTemplate[] {
    return Array.from(this.templates.values()).filter(t => t.category === category);
  }

  /**
   * 根据域名获取模板
   */
  getTemplatesByDomain(domain: string): RuleTemplate[] {
    return Array.from(this.templates.values()).filter(t => 
      t.domains.some(d => domain.includes(d) || d.includes(domain))
    );
  }

  /**
   * 验证规则
   */
  validateRule(rule: ExtractionRule): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 基本字段验证
    if (!rule.id) errors.push('Rule ID is required');
    if (!rule.name) errors.push('Rule name is required');
    if (!rule.selector) errors.push('Rule selector is required');
    if (!rule.fields || rule.fields.length === 0) errors.push('At least one field is required');

    // 字段验证
    rule.fields.forEach((field, index) => {
      if (!field.name) errors.push(`Field ${index}: name is required`);
      if (!field.selector && rule.type !== ExtractionType.SINGLE) {
        errors.push(`Field ${index}: selector is required for ${rule.type} extraction`);
      }
      if (!Object.values(FieldType).includes(field.type)) {
        errors.push(`Field ${index}: invalid field type ${field.type}`);
      }
    });

    // 过滤器验证
    if (rule.filters) {
      rule.filters.forEach((filter, index) => {
        if (!filter.field) errors.push(`Filter ${index}: field is required`);
        if (!Object.values(FilterOperator).includes(filter.operator)) {
          errors.push(`Filter ${index}: invalid operator ${filter.operator}`);
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 计算规则匹配置信度
   */
  private calculateRuleConfidence(rule: ExtractionRule, url: string, pageContent?: string): number {
    let confidence = 0;

    // URL匹配（基础分数）
    const domain = this.extractDomain(url);
    if (rule.description.toLowerCase().includes(domain.toLowerCase())) {
      confidence += 30;
    }

    // 选择器存在性检查（如果有页面内容）
    if (pageContent) {
      // 简单的选择器存在性检查
      if (this.selectorExistsInContent(rule.selector, pageContent)) {
        confidence += 40;
      }

      // 字段选择器检查
      const fieldMatches = rule.fields.filter(field => 
        field.selector && this.selectorExistsInContent(field.selector, pageContent)
      ).length;
      
      confidence += (fieldMatches / rule.fields.length) * 20;
    }

    // 规则类型适配性
    if (pageContent) {
      const typeScore = this.calculateTypeScore(rule.type, pageContent);
      confidence += typeScore * 10;
    }

    return Math.min(confidence, 100);
  }

  /**
   * 检查选择器是否在内容中存在
   */
  private selectorExistsInContent(selector: string, content: string): boolean {
    // 简单的选择器存在性检查
    // 这里可以使用更复杂的DOM解析，但为了性能考虑使用简单的字符串匹配
    
    // CSS类选择器
    if (selector.startsWith('.')) {
      const className = selector.substring(1);
      return content.includes(`class="${className}"`) || content.includes(`class='${className}'`);
    }
    
    // ID选择器
    if (selector.startsWith('#')) {
      const id = selector.substring(1);
      return content.includes(`id="${id}"`) || content.includes(`id='${id}'`);
    }
    
    // 标签选择器
    if (/^[a-zA-Z]+$/.test(selector)) {
      return content.includes(`<${selector}`) || content.includes(`<${selector.toUpperCase()}`);
    }
    
    return false;
  }

  /**
   * 计算类型适配分数
   */
  private calculateTypeScore(type: ExtractionType, content: string): number {
    const lowerContent = content.toLowerCase();
    
    switch (type) {
      case ExtractionType.LIST:
        if (lowerContent.includes('<ul>') || lowerContent.includes('<ol>') || 
            lowerContent.includes('list') || lowerContent.includes('item')) {
          return 1;
        }
        break;
      
      case ExtractionType.TABLE:
        if (lowerContent.includes('<table>') || lowerContent.includes('<tr>') || 
            lowerContent.includes('<td>')) {
          return 1;
        }
        break;
      
      case ExtractionType.FORM:
        if (lowerContent.includes('<form>') || lowerContent.includes('<input>') || 
            lowerContent.includes('<select>')) {
          return 1;
        }
        break;
      
      case ExtractionType.CARD:
        if (lowerContent.includes('card') || lowerContent.includes('product') || 
            lowerContent.includes('item')) {
          return 1;
        }
        break;
    }
    
    return 0.5; // 默认适配度
  }

  /**
   * 生成匹配原因
   */
  private generateMatchReason(rule: ExtractionRule, url: string, confidence: number): string {
    const domain = this.extractDomain(url);
    
    if (confidence >= 80) {
      return `High confidence match for ${domain} using ${rule.type} extraction`;
    } else if (confidence >= 60) {
      return `Good match for ${domain} with ${rule.type} pattern`;
    } else if (confidence >= 40) {
      return `Moderate match based on URL and selector patterns`;
    } else {
      return `Low confidence match, manual verification recommended`;
    }
  }

  /**
   * 提取域名
   */
  private extractDomain(url: string): string {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url;
    }
  }

  /**
   * 初始化默认模板
   */
  private initializeDefaultTemplates(): void {
    // 电商产品列表模板
    this.registerTemplate({
      id: 'ecommerce_product_list',
      name: 'E-commerce Product List',
      description: 'Extract product information from e-commerce sites',
      category: RuleCategory.ECOMMERCE,
      domains: ['amazon', 'ebay', 'taobao', 'tmall', 'jd'],
      template: {
        type: ExtractionType.LIST,
        selector: '.product-item, .item, .product, [data-testid*="product"]',
        fields: [
          {
            name: 'title',
            selector: '.title, .name, .product-title, h3, h4',
            type: FieldType.TEXT,
            required: true
          },
          {
            name: 'price',
            selector: '.price, .cost, .amount, [class*="price"]',
            type: FieldType.NUMBER,
            required: true,
            transform: { type: TransformType.PARSE_NUMBER }
          },
          {
            name: 'image',
            selector: 'img',
            type: FieldType.IMAGE,
            required: false
          },
          {
            name: 'link',
            selector: 'a',
            type: FieldType.URL,
            required: false
          }
        ]
      }
    });

    // 新闻文章列表模板
    this.registerTemplate({
      id: 'news_article_list',
      name: 'News Article List',
      description: 'Extract news articles from news websites',
      category: RuleCategory.NEWS,
      domains: ['news', 'cnn', 'bbc', 'reuters', 'xinhua'],
      template: {
        type: ExtractionType.LIST,
        selector: '.article, .news-item, .story, [class*="article"]',
        fields: [
          {
            name: 'headline',
            selector: '.headline, .title, h2, h3',
            type: FieldType.TEXT,
            required: true
          },
          {
            name: 'summary',
            selector: '.summary, .excerpt, .description, p',
            type: FieldType.TEXT,
            required: false
          },
          {
            name: 'publishDate',
            selector: '.date, .time, .published, [class*="date"]',
            type: FieldType.DATE,
            required: false,
            transform: { type: TransformType.PARSE_DATE }
          },
          {
            name: 'author',
            selector: '.author, .byline, .writer',
            type: FieldType.TEXT,
            required: false
          },
          {
            name: 'link',
            selector: 'a',
            type: FieldType.URL,
            required: false
          }
        ]
      }
    });

    // 表格数据模板
    this.registerTemplate({
      id: 'table_data',
      name: 'Table Data',
      description: 'Extract data from HTML tables',
      category: RuleCategory.GENERAL,
      domains: [],
      template: {
        type: ExtractionType.TABLE,
        selector: 'table tbody tr',
        fields: [
          {
            name: 'column1',
            selector: 'td:nth-child(1)',
            type: FieldType.TEXT,
            required: true
          },
          {
            name: 'column2',
            selector: 'td:nth-child(2)',
            type: FieldType.TEXT,
            required: false
          },
          {
            name: 'column3',
            selector: 'td:nth-child(3)',
            type: FieldType.TEXT,
            required: false
          }
        ]
      }
    });

    // 联系信息模板
    this.registerTemplate({
      id: 'contact_info',
      name: 'Contact Information',
      description: 'Extract contact information from business pages',
      category: RuleCategory.BUSINESS,
      domains: ['contact', 'about', 'company'],
      template: {
        type: ExtractionType.SINGLE,
        selector: 'body',
        fields: [
          {
            name: 'phone',
            selector: '[href^="tel:"], .phone, .telephone',
            type: FieldType.TEXT,
            required: false
          },
          {
            name: 'email',
            selector: '[href^="mailto:"], .email',
            type: FieldType.EMAIL,
            required: false
          },
          {
            name: 'address',
            selector: '.address, .location, [class*="address"]',
            type: FieldType.TEXT,
            required: false
          },
          {
            name: 'website',
            selector: '[href^="http"], .website, .url',
            type: FieldType.URL,
            required: false
          }
        ]
      }
    });

    this.logger.info('Initialized default extraction templates', {
      templateCount: this.templates.size
    });
  }
}

// 默认实例管理
let defaultRuleManager: RuleManager | null = null;

export function getDefaultRuleManager(): RuleManager {
  if (!defaultRuleManager) {
    defaultRuleManager = new RuleManager();
  }
  return defaultRuleManager;
}

export function setDefaultRuleManager(manager: RuleManager): void {
  defaultRuleManager = manager;
}

export function createRuleManager(): RuleManager {
  return new RuleManager();
}