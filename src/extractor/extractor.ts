/**
 * 数据抽取器
 * 负责从网页中识别和提取结构化数据
 */

import { Page, ElementHandle } from 'puppeteer';
import { getDefaultLogger } from '../core/logger';

export interface ExtractionRule {
  id: string;
  name: string;
  description: string;
  selector: string;
  type: ExtractionType;
  fields: FieldMapping[];
  filters?: FilterRule[];
  pagination?: PaginationConfig;
  validation?: ValidationConfig;
}

export enum ExtractionType {
  LIST = 'list',           // 列表数据
  TABLE = 'table',         // 表格数据
  FORM = 'form',           // 表单数据
  CARD = 'card',           // 卡片数据
  SINGLE = 'single'        // 单个数据项
}

export interface FieldMapping {
  name: string;
  selector: string;
  type: FieldType;
  required: boolean;
  defaultValue?: any;
  transform?: TransformFunction;
  validation?: FieldValidation;
}

export enum FieldType {
  TEXT = 'text',
  NUMBER = 'number',
  DATE = 'date',
  URL = 'url',
  EMAIL = 'email',
  BOOLEAN = 'boolean',
  IMAGE = 'image',
  HTML = 'html'
}

export interface FilterRule {
  field: string;
  operator: FilterOperator;
  value: any;
}

export enum FilterOperator {
  EQUALS = 'equals',
  NOT_EQUALS = 'not_equals',
  CONTAINS = 'contains',
  NOT_CONTAINS = 'not_contains',
  STARTS_WITH = 'starts_with',
  ENDS_WITH = 'ends_with',
  GREATER_THAN = 'greater_than',
  LESS_THAN = 'less_than',
  REGEX = 'regex'
}

export interface PaginationConfig {
  enabled: boolean;
  nextButtonSelector?: string;
  pageNumberSelector?: string;
  maxPages?: number;
  waitTime?: number;
}

export interface ValidationConfig {
  minItems?: number;
  maxItems?: number;
  requiredFields?: string[];
  uniqueField?: string;
}

export interface TransformFunction {
  type: TransformType;
  params?: Record<string, any>;
}

export enum TransformType {
  TRIM = 'trim',
  UPPERCASE = 'uppercase',
  LOWERCASE = 'lowercase',
  PARSE_NUMBER = 'parse_number',
  PARSE_DATE = 'parse_date',
  EXTRACT_DOMAIN = 'extract_domain',
  REMOVE_HTML = 'remove_html',
  CUSTOM = 'custom'
}

export interface FieldValidation {
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
}

export interface ExtractionResult {
  success: boolean;
  data: any[];
  totalItems: number;
  extractedFields: string[];
  errors: ExtractionError[];
  metadata: ExtractionMetadata;
  executionTime: number;
}

export interface ExtractionError {
  type: ErrorType;
  message: string;
  field?: string;
  itemIndex?: number;
  selector?: string;
}

export enum ErrorType {
  SELECTOR_NOT_FOUND = 'selector_not_found',
  FIELD_VALIDATION_FAILED = 'field_validation_failed',
  TRANSFORMATION_FAILED = 'transformation_failed',
  PAGINATION_FAILED = 'pagination_failed',
  TIMEOUT = 'timeout'
}

export interface ExtractionMetadata {
  url: string;
  timestamp: Date;
  pageTitle: string;
  totalPages: number;
  extractionRule: string;
  userAgent: string;
}

export interface ExtractorConfig {
  timeout: number;
  maxRetries: number;
  waitForSelector: number;
  enableScreenshots: boolean;
  screenshotPath?: string;
}

export class DataExtractor {
  private config: ExtractorConfig;
  private logger = getDefaultLogger();

  constructor(config: Partial<ExtractorConfig> = {}) {
    this.config = {
      timeout: 30000,
      maxRetries: 3,
      waitForSelector: 5000,
      enableScreenshots: false,
      ...config
    };
  }

  /**
   * 执行数据抽取
   */
  async extract(
    page: Page,
    rule: ExtractionRule
  ): Promise<ExtractionResult> {
    const startTime = Date.now();
    
    try {
      this.logger.info('Starting data extraction', {
        ruleId: rule.id,
        type: rule.type,
        url: page.url()
      });

      // 1. 等待页面加载
      await this.waitForPageReady(page, rule);

      // 2. 提取数据
      let allData: any[] = [];
      let currentPage = 1;
      let totalPages = 1;

      do {
        this.logger.debug(`Extracting data from page ${currentPage}`);
        
        const pageData = await this.extractFromCurrentPage(page, rule);
        allData.push(...pageData);

        // 3. 处理分页
        if (rule.pagination?.enabled && currentPage < (rule.pagination.maxPages || 10)) {
          const hasNextPage = await this.goToNextPage(page, rule.pagination);
          if (!hasNextPage) break;
          
          currentPage++;
          totalPages = currentPage;
          
          // 等待新页面加载
          await this.waitForPageReady(page, rule);
        } else {
          break;
        }
      } while (true);

      // 4. 应用过滤器
      if (rule.filters && rule.filters.length > 0) {
        allData = this.applyFilters(allData, rule.filters);
      }

      // 5. 验证结果
      const errors = this.validateResults(allData, rule.validation);

      // 6. 生成元数据
      const metadata: ExtractionMetadata = {
        url: page.url(),
        timestamp: new Date(),
        pageTitle: await page.title(),
        totalPages,
        extractionRule: rule.id,
        userAgent: await page.evaluate(() => navigator.userAgent)
      };

      const result: ExtractionResult = {
        success: errors.length === 0,
        data: allData,
        totalItems: allData.length,
        extractedFields: rule.fields.map(f => f.name),
        errors,
        metadata,
        executionTime: Date.now() - startTime
      };

      this.logger.info('Data extraction completed', {
        success: result.success,
        totalItems: result.totalItems,
        executionTime: result.executionTime
      });

      return result;
    } catch (error) {
      this.logger.error('Data extraction failed', { error, ruleId: rule.id });
      
      return {
        success: false,
        data: [],
        totalItems: 0,
        extractedFields: [],
        errors: [{
          type: ErrorType.TIMEOUT,
          message: error instanceof Error ? error.message : String(error)
        }],
        metadata: {
          url: page.url(),
          timestamp: new Date(),
          pageTitle: '',
          totalPages: 0,
          extractionRule: rule.id,
          userAgent: ''
        },
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * 从当前页面提取数据
   */
  private async extractFromCurrentPage(
    page: Page,
    rule: ExtractionRule
  ): Promise<any[]> {
    const data: any[] = [];

    try {
      // 根据抽取类型选择不同的策略
      switch (rule.type) {
        case ExtractionType.LIST:
          return await this.extractListData(page, rule);
        
        case ExtractionType.TABLE:
          return await this.extractTableData(page, rule);
        
        case ExtractionType.FORM:
          return await this.extractFormData(page, rule);
        
        case ExtractionType.CARD:
          return await this.extractCardData(page, rule);
        
        case ExtractionType.SINGLE:
          const singleItem = await this.extractSingleData(page, rule);
          return singleItem ? [singleItem] : [];
        
        default:
          throw new Error(`Unsupported extraction type: ${rule.type}`);
      }
    } catch (error) {
      this.logger.error('Failed to extract data from current page', { error });
      return [];
    }
  }

  /**
   * 提取列表数据
   */
  private async extractListData(page: Page, rule: ExtractionRule): Promise<any[]> {
    const items = await page.$$(rule.selector);
    const data: any[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const itemData = await this.extractFieldsFromElement(item, rule.fields, page);
      
      if (Object.keys(itemData).length > 0) {
        data.push(itemData);
      }
    }

    return data;
  }

  /**
   * 提取表格数据
   */
  private async extractTableData(page: Page, rule: ExtractionRule): Promise<any[]> {
    const table = await page.$(rule.selector);
    if (!table) return [];

    const rows = await table.$$('tr');
    const data: any[] = [];

    // 跳过表头
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const itemData = await this.extractFieldsFromElement(row, rule.fields, page);
      
      if (Object.keys(itemData).length > 0) {
        data.push(itemData);
      }
    }

    return data;
  }

  /**
   * 提取表单数据
   */
  private async extractFormData(page: Page, rule: ExtractionRule): Promise<any[]> {
    const form = await page.$(rule.selector);
    if (!form) return [];

    const formData = await this.extractFieldsFromElement(form, rule.fields, page);
    return Object.keys(formData).length > 0 ? [formData] : [];
  }

  /**
   * 提取卡片数据
   */
  private async extractCardData(page: Page, rule: ExtractionRule): Promise<any[]> {
    return await this.extractListData(page, rule); // 卡片数据类似列表数据
  }

  /**
   * 提取单个数据项
   */
  private async extractSingleData(page: Page, rule: ExtractionRule): Promise<any | null> {
    const element = await page.$(rule.selector);
    if (!element) return null;

    const data = await this.extractFieldsFromElement(element, rule.fields, page);
    return Object.keys(data).length > 0 ? data : null;
  }

  /**
   * 从元素中提取字段数据
   */
  private async extractFieldsFromElement(
    element: ElementHandle,
    fields: FieldMapping[],
    page: Page
  ): Promise<Record<string, any>> {
    const data: Record<string, any> = {};

    for (const field of fields) {
      try {
        let value = await this.extractFieldValue(element, field, page);
        
        // 应用转换
        if (field.transform) {
          value = this.applyTransform(value, field.transform);
        }
        
        // 验证字段
        if (field.validation) {
          const isValid = this.validateField(value, field.validation);
          if (!isValid && field.required) {
            continue; // 跳过无效的必填字段
          }
        }
        
        // 设置值或默认值
        if (value !== null && value !== undefined) {
          data[field.name] = value;
        } else if (field.defaultValue !== undefined) {
          data[field.name] = field.defaultValue;
        } else if (field.required) {
          // 必填字段缺失，跳过整个项目
          return {};
        }
      } catch (error) {
        this.logger.warn(`Failed to extract field ${field.name}`, { error });
        
        if (field.required) {
          return {}; // 必填字段提取失败，跳过整个项目
        }
      }
    }

    return data;
  }

  /**
   * 提取字段值
   */
  private async extractFieldValue(
    element: ElementHandle,
    field: FieldMapping,
    page: Page
  ): Promise<any> {
    let targetElement = element;
    
    // 如果有选择器，查找子元素
    if (field.selector) {
      const subElement = await element.$(field.selector);
      if (subElement) {
        targetElement = subElement;
      } else {
        return null;
      }
    }

    // 根据字段类型提取值
    switch (field.type) {
      case FieldType.TEXT:
        return await targetElement.evaluate(el => el.textContent?.trim() || '');
      
      case FieldType.HTML:
        return await targetElement.evaluate(el => el.innerHTML);
      
      case FieldType.URL:
        return await targetElement.evaluate(el => {
          if (el.tagName === 'A') {
            return (el as HTMLAnchorElement).href;
          }
          if (el.tagName === 'IMG') {
            return (el as HTMLImageElement).src;
          }
          return el.getAttribute('href') || el.getAttribute('src') || '';
        });
      
      case FieldType.IMAGE:
        return await targetElement.evaluate(el => {
          if (el.tagName === 'IMG') {
            return (el as HTMLImageElement).src;
          }
          return el.getAttribute('src') || '';
        });
      
      case FieldType.NUMBER:
        const textValue = await targetElement.evaluate(el => el.textContent?.trim() || '');
        const numValue = parseFloat(textValue.replace(/[^\d.-]/g, ''));
        return isNaN(numValue) ? null : numValue;
      
      case FieldType.DATE:
        const dateText = await targetElement.evaluate(el => el.textContent?.trim() || '');
        const date = new Date(dateText);
        return isNaN(date.getTime()) ? null : date.toISOString();
      
      case FieldType.BOOLEAN:
        return await targetElement.evaluate(el => {
          if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'checkbox') {
            return (el as HTMLInputElement).checked;
          }
          const text = el.textContent?.toLowerCase().trim() || '';
          return ['true', 'yes', '是', '1', 'on'].includes(text);
        });
      
      case FieldType.EMAIL:
        const emailText = await targetElement.evaluate(el => el.textContent?.trim() || '');
        const emailMatch = emailText.match(/[\w.-]+@[\w.-]+\.\w+/);
        return emailMatch ? emailMatch[0] : null;
      
      default:
        return await targetElement.evaluate(el => el.textContent?.trim() || '');
    }
  }

  /**
   * 应用数据转换
   */
  private applyTransform(value: any, transform: TransformFunction): any {
    if (value === null || value === undefined) return value;

    try {
      switch (transform.type) {
        case TransformType.TRIM:
          return typeof value === 'string' ? value.trim() : value;
        
        case TransformType.UPPERCASE:
          return typeof value === 'string' ? value.toUpperCase() : value;
        
        case TransformType.LOWERCASE:
          return typeof value === 'string' ? value.toLowerCase() : value;
        
        case TransformType.PARSE_NUMBER:
          if (typeof value === 'string') {
            const num = parseFloat(value.replace(/[^\d.-]/g, ''));
            return isNaN(num) ? value : num;
          }
          return value;
        
        case TransformType.PARSE_DATE:
          if (typeof value === 'string') {
            const date = new Date(value);
            return isNaN(date.getTime()) ? value : date.toISOString();
          }
          return value;
        
        case TransformType.EXTRACT_DOMAIN:
          if (typeof value === 'string') {
            try {
              const url = new URL(value);
              return url.hostname;
            } catch {
              return value;
            }
          }
          return value;
        
        case TransformType.REMOVE_HTML:
          if (typeof value === 'string') {
            return value.replace(/<[^>]*>/g, '').trim();
          }
          return value;
        
        default:
          return value;
      }
    } catch (error) {
      this.logger.warn('Transform failed', { transform: transform.type, error });
      return value;
    }
  }

  /**
   * 验证字段值
   */
  private validateField(value: any, validation: FieldValidation): boolean {
    if (value === null || value === undefined) return false;

    try {
      if (validation.pattern) {
        const regex = new RegExp(validation.pattern);
        if (!regex.test(String(value))) return false;
      }

      if (typeof value === 'string') {
        if (validation.minLength && value.length < validation.minLength) return false;
        if (validation.maxLength && value.length > validation.maxLength) return false;
      }

      if (typeof value === 'number') {
        if (validation.min !== undefined && value < validation.min) return false;
        if (validation.max !== undefined && value > validation.max) return false;
      }

      return true;
    } catch (error) {
      this.logger.warn('Field validation failed', { validation, error });
      return false;
    }
  }

  /**
   * 应用过滤器
   */
  private applyFilters(data: any[], filters: FilterRule[]): any[] {
    return data.filter(item => {
      return filters.every(filter => {
        const fieldValue = item[filter.field];
        return this.evaluateFilter(fieldValue, filter);
      });
    });
  }

  /**
   * 评估过滤条件
   */
  private evaluateFilter(value: any, filter: FilterRule): boolean {
    const filterValue = filter.value;

    switch (filter.operator) {
      case FilterOperator.EQUALS:
        return value === filterValue;
      
      case FilterOperator.NOT_EQUALS:
        return value !== filterValue;
      
      case FilterOperator.CONTAINS:
        return String(value).includes(String(filterValue));
      
      case FilterOperator.NOT_CONTAINS:
        return !String(value).includes(String(filterValue));
      
      case FilterOperator.STARTS_WITH:
        return String(value).startsWith(String(filterValue));
      
      case FilterOperator.ENDS_WITH:
        return String(value).endsWith(String(filterValue));
      
      case FilterOperator.GREATER_THAN:
        return Number(value) > Number(filterValue);
      
      case FilterOperator.LESS_THAN:
        return Number(value) < Number(filterValue);
      
      case FilterOperator.REGEX:
        try {
          const regex = new RegExp(String(filterValue));
          return regex.test(String(value));
        } catch {
          return false;
        }
      
      default:
        return true;
    }
  }

  /**
   * 验证抽取结果
   */
  private validateResults(data: any[], validation?: ValidationConfig): ExtractionError[] {
    const errors: ExtractionError[] = [];

    if (!validation) return errors;

    // 检查最小项目数
    if (validation.minItems && data.length < validation.minItems) {
      errors.push({
        type: ErrorType.FIELD_VALIDATION_FAILED,
        message: `Expected at least ${validation.minItems} items, got ${data.length}`
      });
    }

    // 检查最大项目数
    if (validation.maxItems && data.length > validation.maxItems) {
      errors.push({
        type: ErrorType.FIELD_VALIDATION_FAILED,
        message: `Expected at most ${validation.maxItems} items, got ${data.length}`
      });
    }

    // 检查必填字段
    if (validation.requiredFields) {
      data.forEach((item, index) => {
        validation.requiredFields!.forEach(field => {
          if (!(field in item) || item[field] === null || item[field] === undefined) {
            errors.push({
              type: ErrorType.FIELD_VALIDATION_FAILED,
              message: `Required field '${field}' is missing`,
              field,
              itemIndex: index
            });
          }
        });
      });
    }

    // 检查唯一字段
    if (validation.uniqueField) {
      const values = new Set();
      data.forEach((item, index) => {
        const value = item[validation.uniqueField!];
        if (values.has(value)) {
          errors.push({
            type: ErrorType.FIELD_VALIDATION_FAILED,
            message: `Duplicate value '${value}' in unique field '${validation.uniqueField}'`,
            field: validation.uniqueField,
            itemIndex: index
          });
        }
        values.add(value);
      });
    }

    return errors;
  }

  /**
   * 等待页面准备就绪
   */
  private async waitForPageReady(page: Page, rule: ExtractionRule): Promise<void> {
    try {
      await page.waitForSelector(rule.selector, {
        timeout: this.config.waitForSelector
      });
      
      // 额外等待一点时间确保动态内容加载完成
      await page.waitForTimeout(1000);
    } catch (error) {
      this.logger.warn('Selector not found within timeout', {
        selector: rule.selector,
        timeout: this.config.waitForSelector
      });
    }
  }

  /**
   * 跳转到下一页
   */
  private async goToNextPage(page: Page, pagination: PaginationConfig): Promise<boolean> {
    try {
      if (pagination.nextButtonSelector) {
        const nextButton = await page.$(pagination.nextButtonSelector);
        if (nextButton) {
          await nextButton.click();
          
          // 等待页面加载
          if (pagination.waitTime) {
            await page.waitForTimeout(pagination.waitTime);
          } else {
            await page.waitForNavigation({ waitUntil: 'networkidle0' });
          }
          
          return true;
        }
      }
      
      return false;
    } catch (error) {
      this.logger.warn('Failed to navigate to next page', { error });
      return false;
    }
  }
}

// 默认实例管理
let defaultExtractor: DataExtractor | null = null;

export function getDefaultExtractor(): DataExtractor {
  if (!defaultExtractor) {
    defaultExtractor = new DataExtractor();
  }
  return defaultExtractor;
}

export function setDefaultExtractor(extractor: DataExtractor): void {
  defaultExtractor = extractor;
}

export function createExtractor(config?: Partial<ExtractorConfig>): DataExtractor {
  return new DataExtractor(config);
}