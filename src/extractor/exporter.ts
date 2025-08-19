/**
 * 数据导出器
 * 支持多种格式的数据导出
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { ExtractionResult } from './extractor';
import { getDefaultLogger } from '../core/logger';

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  XML = 'xml',
  EXCEL = 'excel',
  HTML = 'html',
  MARKDOWN = 'markdown'
}

export interface ExportOptions {
  format: ExportFormat;
  outputPath: string;
  includeMetadata: boolean;
  includeErrors: boolean;
  customTemplate?: string;
  encoding?: string;
  delimiter?: string; // For CSV
  headers?: string[]; // For CSV
  sheetName?: string; // For Excel
}

export interface ExportResult {
  success: boolean;
  outputPath: string;
  fileSize: number;
  recordCount: number;
  format: ExportFormat;
  error?: string;
  executionTime: number;
}

export class DataExporter {
  private logger = getDefaultLogger();

  /**
   * 导出数据
   */
  async export(
    extractionResult: ExtractionResult,
    options: ExportOptions
  ): Promise<ExportResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Starting data export', {
        format: options.format,
        recordCount: extractionResult.data.length,
        outputPath: options.outputPath
      });

      // 确保输出目录存在
      await this.ensureDirectoryExists(path.dirname(options.outputPath));

      let content: string;
      let actualPath = options.outputPath;

      // 根据格式生成内容
      switch (options.format) {
        case ExportFormat.JSON:
          content = await this.exportToJSON(extractionResult, options);
          actualPath = this.ensureExtension(actualPath, '.json');
          break;

        case ExportFormat.CSV:
          content = await this.exportToCSV(extractionResult, options);
          actualPath = this.ensureExtension(actualPath, '.csv');
          break;

        case ExportFormat.XML:
          content = await this.exportToXML(extractionResult, options);
          actualPath = this.ensureExtension(actualPath, '.xml');
          break;

        case ExportFormat.HTML:
          content = await this.exportToHTML(extractionResult, options);
          actualPath = this.ensureExtension(actualPath, '.html');
          break;

        case ExportFormat.MARKDOWN:
          content = await this.exportToMarkdown(extractionResult, options);
          actualPath = this.ensureExtension(actualPath, '.md');
          break;

        case ExportFormat.EXCEL:
          // Excel 需要特殊处理，因为它是二进制格式
          return await this.exportToExcel(extractionResult, options);

        default:
          throw new Error(`Unsupported export format: ${options.format}`);
      }

      // 写入文件
      const encoding = (options.encoding as BufferEncoding) || 'utf8';
      await fs.writeFile(actualPath, content, { encoding });

      const stats = await fs.stat(actualPath);

      const result: ExportResult = {
        success: true,
        outputPath: actualPath,
        fileSize: stats.size,
        recordCount: extractionResult.data.length,
        format: options.format,
        executionTime: Date.now() - startTime
      };

      this.logger.info('Data export completed', result);
      return result;

    } catch (error) {
      this.logger.error('Data export failed', { error, options });

      return {
        success: false,
        outputPath: options.outputPath,
        fileSize: 0,
        recordCount: 0,
        format: options.format,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime
      };
    }
  }

  /**
   * 导出为JSON格式
   */
  private async exportToJSON(
    result: ExtractionResult,
    options: ExportOptions
  ): Promise<string> {
    const exportData: any = {
      data: result.data
    };

    if (options.includeMetadata) {
      exportData.metadata = result.metadata;
      exportData.summary = {
        totalItems: result.totalItems,
        extractedFields: result.extractedFields,
        executionTime: result.executionTime,
        success: result.success
      };
    }

    if (options.includeErrors && result.errors.length > 0) {
      exportData.errors = result.errors;
    }

    return JSON.stringify(exportData, null, 2);
  }

  /**
   * 导出为CSV格式
   */
  private async exportToCSV(
    result: ExtractionResult,
    options: ExportOptions
  ): Promise<string> {
    if (result.data.length === 0) {
      return '';
    }

    const delimiter = options.delimiter || ',';
    const headers = options.headers || Object.keys(result.data[0]);
    
    // 构建CSV内容
    const csvLines: string[] = [];
    
    // 添加标题行
    csvLines.push(headers.map(h => this.escapeCsvValue(h)).join(delimiter));
    
    // 添加数据行
    for (const item of result.data) {
      const row = headers.map(header => {
        const value = item[header];
        return this.escapeCsvValue(this.formatCsvValue(value));
      });
      csvLines.push(row.join(delimiter));
    }

    // 如果包含元数据，添加到文件末尾
    if (options.includeMetadata) {
      csvLines.push('');
      csvLines.push('# Metadata');
      csvLines.push(`# URL: ${result.metadata.url}`);
      csvLines.push(`# Extraction Time: ${result.metadata.timestamp}`);
      csvLines.push(`# Total Items: ${result.totalItems}`);
      csvLines.push(`# Execution Time: ${result.executionTime}ms`);
    }

    return csvLines.join('\n');
  }

  /**
   * 导出为XML格式
   */
  private async exportToXML(
    result: ExtractionResult,
    options: ExportOptions
  ): Promise<string> {
    const xmlLines: string[] = [];
    
    xmlLines.push('<?xml version="1.0" encoding="UTF-8"?>');
    xmlLines.push('<extraction>');

    // 添加元数据
    if (options.includeMetadata) {
      xmlLines.push('  <metadata>');
      xmlLines.push(`    <url>${this.escapeXml(result.metadata.url)}</url>`);
      xmlLines.push(`    <timestamp>${result.metadata.timestamp.toISOString()}</timestamp>`);
      xmlLines.push(`    <totalItems>${result.totalItems}</totalItems>`);
      xmlLines.push(`    <executionTime>${result.executionTime}</executionTime>`);
      xmlLines.push(`    <success>${result.success}</success>`);
      xmlLines.push('  </metadata>');
    }

    // 添加数据
    xmlLines.push('  <data>');
    for (const item of result.data) {
      xmlLines.push('    <item>');
      for (const [key, value] of Object.entries(item)) {
        const xmlValue = this.escapeXml(String(value || ''));
        xmlLines.push(`      <${key}>${xmlValue}</${key}>`);
      }
      xmlLines.push('    </item>');
    }
    xmlLines.push('  </data>');

    // 添加错误信息
    if (options.includeErrors && result.errors.length > 0) {
      xmlLines.push('  <errors>');
      for (const error of result.errors) {
        xmlLines.push('    <error>');
        xmlLines.push(`      <type>${error.type}</type>`);
        xmlLines.push(`      <message>${this.escapeXml(error.message)}</message>`);
        if (error.field) {
          xmlLines.push(`      <field>${error.field}</field>`);
        }
        xmlLines.push('    </error>');
      }
      xmlLines.push('  </errors>');
    }

    xmlLines.push('</extraction>');
    return xmlLines.join('\n');
  }

  /**
   * 导出为HTML格式
   */
  private async exportToHTML(
    result: ExtractionResult,
    options: ExportOptions
  ): Promise<string> {
    const htmlLines: string[] = [];
    
    htmlLines.push('<!DOCTYPE html>');
    htmlLines.push('<html lang="en">');
    htmlLines.push('<head>');
    htmlLines.push('  <meta charset="UTF-8">');
    htmlLines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
    htmlLines.push('  <title>Extraction Results</title>');
    htmlLines.push('  <style>');
    htmlLines.push('    body { font-family: Arial, sans-serif; margin: 20px; }');
    htmlLines.push('    table { border-collapse: collapse; width: 100%; margin: 20px 0; }');
    htmlLines.push('    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }');
    htmlLines.push('    th { background-color: #f2f2f2; }');
    htmlLines.push('    .metadata { background-color: #f9f9f9; padding: 15px; margin: 20px 0; }');
    htmlLines.push('    .error { color: red; margin: 5px 0; }');
    htmlLines.push('  </style>');
    htmlLines.push('</head>');
    htmlLines.push('<body>');
    
    htmlLines.push(`  <h1>Extraction Results</h1>`);

    // 添加元数据
    if (options.includeMetadata) {
      htmlLines.push('  <div class="metadata">');
      htmlLines.push('    <h2>Metadata</h2>');
      htmlLines.push(`    <p><strong>URL:</strong> ${this.escapeHtml(result.metadata.url)}</p>`);
      htmlLines.push(`    <p><strong>Extraction Time:</strong> ${result.metadata.timestamp.toLocaleString()}</p>`);
      htmlLines.push(`    <p><strong>Total Items:</strong> ${result.totalItems}</p>`);
      htmlLines.push(`    <p><strong>Execution Time:</strong> ${result.executionTime}ms</p>`);
      htmlLines.push(`    <p><strong>Success:</strong> ${result.success ? 'Yes' : 'No'}</p>`);
      htmlLines.push('  </div>');
    }

    // 添加数据表格
    if (result.data.length > 0) {
      htmlLines.push('  <h2>Data</h2>');
      htmlLines.push('  <table>');
      
      // 表头
      const headers = Object.keys(result.data[0]);
      htmlLines.push('    <thead>');
      htmlLines.push('      <tr>');
      for (const header of headers) {
        htmlLines.push(`        <th>${this.escapeHtml(header)}</th>`);
      }
      htmlLines.push('      </tr>');
      htmlLines.push('    </thead>');
      
      // 数据行
      htmlLines.push('    <tbody>');
      for (const item of result.data) {
        htmlLines.push('      <tr>');
        for (const header of headers) {
          const value = item[header];
          htmlLines.push(`        <td>${this.escapeHtml(String(value || ''))}</td>`);
        }
        htmlLines.push('      </tr>');
      }
      htmlLines.push('    </tbody>');
      htmlLines.push('  </table>');
    }

    // 添加错误信息
    if (options.includeErrors && result.errors.length > 0) {
      htmlLines.push('  <h2>Errors</h2>');
      for (const error of result.errors) {
        htmlLines.push(`  <div class="error">${this.escapeHtml(error.message)}</div>`);
      }
    }

    htmlLines.push('</body>');
    htmlLines.push('</html>');
    
    return htmlLines.join('\n');
  }

  /**
   * 导出为Markdown格式
   */
  private async exportToMarkdown(
    result: ExtractionResult,
    options: ExportOptions
  ): Promise<string> {
    const mdLines: string[] = [];
    
    mdLines.push('# Extraction Results');
    mdLines.push('');

    // 添加元数据
    if (options.includeMetadata) {
      mdLines.push('## Metadata');
      mdLines.push('');
      mdLines.push(`- **URL:** ${result.metadata.url}`);
      mdLines.push(`- **Extraction Time:** ${result.metadata.timestamp.toLocaleString()}`);
      mdLines.push(`- **Total Items:** ${result.totalItems}`);
      mdLines.push(`- **Execution Time:** ${result.executionTime}ms`);
      mdLines.push(`- **Success:** ${result.success ? 'Yes' : 'No'}`);
      mdLines.push('');
    }

    // 添加数据表格
    if (result.data.length > 0) {
      mdLines.push('## Data');
      mdLines.push('');
      
      const headers = Object.keys(result.data[0]);
      
      // 表头
      mdLines.push(`| ${headers.join(' | ')} |`);
      mdLines.push(`| ${headers.map(() => '---').join(' | ')} |`);
      
      // 数据行
      for (const item of result.data) {
        const row = headers.map(header => {
          const value = item[header];
          return this.escapeMarkdown(String(value || ''));
        });
        mdLines.push(`| ${row.join(' | ')} |`);
      }
      mdLines.push('');
    }

    // 添加错误信息
    if (options.includeErrors && result.errors.length > 0) {
      mdLines.push('## Errors');
      mdLines.push('');
      for (const error of result.errors) {
        mdLines.push(`- ${this.escapeMarkdown(error.message)}`);
      }
      mdLines.push('');
    }

    return mdLines.join('\n');
  }

  /**
   * 导出为Excel格式
   */
  private async exportToExcel(
    result: ExtractionResult,
    options: ExportOptions
  ): Promise<ExportResult> {
    // 注意：这里需要安装 xlsx 库来支持 Excel 导出
    // 为了简化，这里只是一个占位实现
    throw new Error('Excel export requires xlsx library. Please install it first.');
  }

  /**
   * 确保目录存在
   */
  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      await fs.access(dirPath);
    } catch {
      await fs.mkdir(dirPath, { recursive: true });
    }
  }

  /**
   * 确保文件扩展名
   */
  private ensureExtension(filePath: string, extension: string): string {
    if (!filePath.endsWith(extension)) {
      return filePath + extension;
    }
    return filePath;
  }

  /**
   * 转义CSV值
   */
  private escapeCsvValue(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  /**
   * 格式化CSV值
   */
  private formatCsvValue(value: any): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  /**
   * 转义XML值
   */
  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 转义HTML值
   */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 转义Markdown值
   */
  private escapeMarkdown(value: string): string {
    return value
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br>')
      .replace(/\r/g, '');
  }
}

// 便捷导出函数
export async function exportData(
  extractionResult: ExtractionResult,
  options: ExportOptions
): Promise<ExportResult> {
  const exporter = new DataExporter();
  return await exporter.export(extractionResult, options);
}

// 默认实例管理
let defaultExporter: DataExporter | null = null;

export function getDefaultExporter(): DataExporter {
  if (!defaultExporter) {
    defaultExporter = new DataExporter();
  }
  return defaultExporter;
}

export function setDefaultExporter(exporter: DataExporter): void {
  defaultExporter = exporter;
}