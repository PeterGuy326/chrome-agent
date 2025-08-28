/**
 * 数据抽取模块入口
 * 提供完整的数据抽取、规则管理和导出功能
 */

// 核心抽取器
export {
  DataExtractor,
  getDefaultExtractor,
  setDefaultExtractor,
  createExtractor
} from './extractor';

// 增强数据提取器
export {
  EnhancedDataExtractor,
  DataExtractionService
} from './enhanced-extractor';

// 增强数据提取器类型和接口
export type {
  EnhancedExtractionConfig,
  SmartExtractionRequest,
  EnhancedExtractionResult
} from './enhanced-extractor';

// 抽取器类型和接口
export type {
  ExtractionRule,
  ExtractionResult,
  ExtractionError,
  ExtractionMetadata,
  ExtractorConfig,
  FieldMapping,
  FilterRule,
  PaginationConfig,
  ValidationConfig,
  TransformFunction,
  FieldValidation
} from './extractor';

// 抽取器枚举
export {
  ExtractionType,
  FieldType,
  FilterOperator,
  TransformType,
  ErrorType
} from './extractor';

// 规则管理器
export {
  RuleManager,
  getDefaultRuleManager,
  setDefaultRuleManager,
  createRuleManager
} from './rule-manager';

// 规则管理器类型和接口
export type {
  RuleTemplate,
  RuleMatchResult
} from './rule-manager';

// 规则管理器枚举
export {
  RuleCategory
} from './rule-manager';

// 数据导出器
export {
  DataExporter,
  getDefaultExporter,
  setDefaultExporter,
  exportData
} from './exporter';

// 导出器类型和接口
export type {
  ExportOptions,
  ExportResult
} from './exporter';

// 导出器枚举
export {
  ExportFormat
} from './exporter';

// 便捷函数
import { Page } from 'puppeteer';
import { getDefaultExtractor } from './extractor';
import { getDefaultRuleManager, RuleCategory } from './rule-manager';
import { getDefaultExporter } from './exporter';

/**
 * 快速数据抽取
 * 使用默认配置进行数据抽取
 */
export async function quickExtract(
  page: Page,
  ruleId: string
) {
  const extractor = getDefaultExtractor();
  const ruleManager = getDefaultRuleManager();
  
  const rule = ruleManager.getRule(ruleId);
  if (!rule) {
    throw new Error(`Rule not found: ${ruleId}`);
  }
  
  return await extractor.extract(page, rule);
}

/**
 * 智能数据抽取
 * 自动匹配最佳规则进行数据抽取
 */
export async function smartExtract(
  page: Page,
  pageContent?: string
) {
  const extractor = getDefaultExtractor();
  const ruleManager = getDefaultRuleManager();
  
  const url = page.url();
  const matchResult = await ruleManager.matchRule(url, pageContent);
  
  if (!matchResult) {
    throw new Error('No suitable extraction rule found for this page');
  }
  
  return await extractor.extract(page, matchResult.rule);
}

/**
 * 抽取并导出
 * 一站式数据抽取和导出服务
 */
export async function extractAndExport(
  page: Page,
  ruleId: string,
  exportOptions: import('./exporter').ExportOptions
) {
  const extractionResult = await quickExtract(page, ruleId);
  const exporter = getDefaultExporter();
  
  return await exporter.export(extractionResult, exportOptions);
}

/**
 * 批量数据抽取
 * 对多个页面执行相同的抽取规则
 */
export async function batchExtract(
  pages: Page[],
  ruleId: string
) {
  const extractor = getDefaultExtractor();
  const ruleManager = getDefaultRuleManager();
  
  const rule = ruleManager.getRule(ruleId);
  if (!rule) {
    throw new Error(`Rule not found: ${ruleId}`);
  }
  
  const results = [];
  for (const page of pages) {
    try {
      const result = await extractor.extract(page, rule);
      results.push({
        url: page.url(),
        success: result.success,
        data: result.data,
        errors: result.errors
      });
    } catch (error) {
      results.push({
        url: page.url(),
        success: false,
        data: [],
        errors: [{
          type: 'EXTRACTION_FAILED' as any,
          message: error instanceof Error ? error.message : String(error)
        }]
      });
    }
  }
  
  return results;
}

/**
 * 验证抽取规则
 * 检查规则的有效性和完整性
 */
export function validateExtractionRule(rule: import('./extractor').ExtractionRule) {
  const ruleManager = getDefaultRuleManager();
  return ruleManager.validateRule(rule);
}

/**
 * 获取推荐模板
 * 根据URL推荐合适的抽取模板
 */
export function getRecommendedTemplates(url: string) {
  const ruleManager = getDefaultRuleManager();
  
  try {
    const urlObj = new URL(url);
    const domain = urlObj.hostname.replace('www.', '');
    
    // 根据域名获取模板
    const domainTemplates = ruleManager.getTemplatesByDomain(domain);
    if (domainTemplates.length > 0) {
      return domainTemplates;
    }
    
    // 根据路径推断类型
    const path = urlObj.pathname.toLowerCase();
    if (path.includes('product') || path.includes('item') || path.includes('shop')) {
      return ruleManager.getTemplatesByCategory(RuleCategory.ECOMMERCE);
    }
    
    if (path.includes('news') || path.includes('article') || path.includes('blog')) {
      return ruleManager.getTemplatesByCategory(RuleCategory.NEWS);
    }
    
    if (path.includes('contact') || path.includes('about')) {
      return ruleManager.getTemplatesByCategory(RuleCategory.BUSINESS);
    }
    
    // 返回通用模板
    return ruleManager.getTemplatesByCategory(RuleCategory.GENERAL);
    
  } catch (error) {
    // URL解析失败，返回通用模板
    return ruleManager.getTemplatesByCategory(RuleCategory.GENERAL);
  }
}
