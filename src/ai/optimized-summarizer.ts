/**
 * 优化版 AI 内容总结器
 * 根据任务类型（数据获取类 vs 执行类）生成不同的总结响应
 */

import { getAIClient, getAIClientManager } from './config';
import { getDefaultLogger } from '../core/logger';
import { ExecutionResult } from '../core/types';
import { containsEnglish, translateToChinese } from '../utils/translation-utils';

const logger = getDefaultLogger();

export interface OptimizedSummaryRequest {
  executionResult: ExecutionResult;
  taskType: 'data_extraction' | 'operation_execution' | 'navigation' | 'search' | 'form_filling' | 'unknown';
  userIntent: string;
  pageContent?: string;
  maxLength?: number;
  language?: string;
}

export interface OptimizedSummaryResult {
  success: boolean;
  response: string;
  summary: string;
  keyPoints: string[];
  wordCount: number;
  originalLength: number;
  compressionRatio: number;
  error?: string;
}

/**
 * 优化版 AI 内容总结器类
 */
export class OptimizedAISummarizer {
  private client: any | null = null;

  constructor() {
    this.initializeClient();
  }

  /**
   * 初始化 AI 客户端
   */
  private async initializeClient(): Promise<void> {
    try {
      const manager = getAIClientManager();
      if (manager.isEnabled()) {
        this.client = manager.getClient();
        logger.info('Optimized AI Summarizer initialized with AI client');
      } else {
        logger.warn('AI not enabled, Optimized AI Summarizer will not work');
      }
    } catch (error) {
      logger.error('Failed to initialize AI client for Optimized Summarizer', error);
    }
  }

  /**
   * 根据任务类型生成优化的总结响应
   */
  async generateOptimizedSummary(request: OptimizedSummaryRequest): Promise<OptimizedSummaryResult> {
    logger.debug('Generating optimized AI summary', { 
      taskType: request.taskType, 
      intent: request.userIntent,
      hasPageContent: !!request.pageContent,
      pageContentLength: request.pageContent?.length || 0
    });

    try {
      if (!this.client) {
        await this.initializeClient();
      }

      if (!this.client) {
        return {
          success: false,
          response: '',
          summary: '',
          keyPoints: [],
          wordCount: 0,
          originalLength: request.pageContent?.length || 0,
          compressionRatio: 0,
          error: 'AI client not available'
        };
      }

      const cfg = getAIClientManager().getConfig();
      const selectedModel = cfg.intentModel || cfg.model;
      
      if (!selectedModel) {
        return {
          success: false,
          response: '',
          summary: '',
          keyPoints: [],
          wordCount: 0,
          originalLength: request.pageContent?.length || 0,
          compressionRatio: 0,
          error: 'No model configured'
        };
      }

      // 根据任务类型生成不同的响应
      let response = '';
      let summary = '';
      let keyPoints: string[] = [];

      switch (request.taskType) {
        case 'data_extraction':
          // 数据获取类任务：返回获取到的内容摘要
          response = await this.generateDataExtractionResponse(request);
          summary = await this.extractSummaryFromResponse(response);
          keyPoints = await this.extractKeyPointsFromResponse(response);
          break;
          
        case 'operation_execution':
          // 执行类任务：说明操作成功及操作内容
          response = await this.generateOperationExecutionResponse(request);
          summary = await this.extractSummaryFromResponse(response);
          keyPoints = await this.extractKeyPointsFromResponse(response);
          break;
          
        case 'search':
          // 搜索类任务：返回搜索结果摘要
          response = await this.generateSearchResponse(request);
          summary = await this.extractSummaryFromResponse(response);
          keyPoints = await this.extractKeyPointsFromResponse(response);
          break;
          
        case 'navigation':
          // 导航类任务：说明页面访问成功
          response = await this.generateNavigationResponse(request);
          summary = await this.extractSummaryFromResponse(response);
          keyPoints = await this.extractKeyPointsFromResponse(response);
          break;
          
        default:
          // 默认处理：通用任务总结
          response = await this.generateDefaultResponse(request);
          summary = await this.extractSummaryFromResponse(response);
          keyPoints = await this.extractKeyPointsFromResponse(response);
      }

      // 计算统计信息
      const wordCount = summary ? summary.split(/\s+/).length : 0;
      const originalLength = request.pageContent ? request.pageContent.split(/\s+/).length : 0;
      const compressionRatio = originalLength > 0 ? wordCount / originalLength : 0;

      const result: OptimizedSummaryResult = {
        success: true,
        response,
        summary,
        keyPoints,
        wordCount,
        originalLength,
        compressionRatio
      };

      logger.info('Optimized AI summarization completed', {
        taskType: request.taskType,
        originalWords: originalLength,
        summaryWords: wordCount,
        compressionRatio: compressionRatio.toFixed(2)
      });

      return result;
    } catch (error) {
      logger.error('Optimized AI summarization failed', error);
      
      return {
        success: false,
        response: '',
        summary: '',
        keyPoints: [],
        wordCount: 0,
        originalLength: request.pageContent?.length || 0,
        compressionRatio: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 生成数据获取类任务的响应
   */
  private async generateDataExtractionResponse(request: OptimizedSummaryRequest): Promise<string> {
    // 如果有页面内容，提取并总结
    if (request.pageContent && request.pageContent.length > 100) {
      const summaryResult = await this.summarizeContent({
        content: request.pageContent,
        type: 'webpage',
        maxLength: request.maxLength || 300,
        language: request.language || '中文'
      });
      
      if (summaryResult.success) {
        // 检查响应内容是否包含英文，如果是则翻译为中文
        let response = `已为您获取到相关数据内容：\n\n${summaryResult.summary}\n\n` +
               (summaryResult.keyPoints.length > 0 ? 
                `关键信息点：\n${summaryResult.keyPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}\n\n` : '') +
               `任务执行耗时：${request.executionResult.duration}ms\n`;
        
        // 检查是否包含英文内容
        if (containsEnglish(response)) {
          response = await translateToChinese(response);
        }
        
        // 将任务执行成功的消息以特殊样式显示（卡片样式）
        response += `\n[卡片样式: 任务执行成功，耗时${request.executionResult.duration}ms]`;
        
        return response;
      }
    }
    
    // 默认响应
    let response = `数据获取任务执行成功！\n\n` +
           `已成功访问目标页面并提取相关内容。\n` +
           `任务执行耗时：${request.executionResult.duration}ms\n` +
           `执行了 ${request.executionResult.totalSteps} 个步骤，成功 ${request.executionResult.successfulSteps} 个`;
    
    // 检查是否包含英文内容
    if (containsEnglish(response)) {
      response = await translateToChinese(response);
    }
    
    // 将任务执行成功的消息以特殊样式显示（卡片样式）
    response += `\n[卡片样式: 任务执行成功，耗时${request.executionResult.duration}ms]`;
    
    return response;
  }

  /**
   * 生成执行类任务的响应
   */
  private async generateOperationExecutionResponse(request: OptimizedSummaryRequest): Promise<string> {
    return `操作执行成功！\n\n` +
           `已按照您的要求完成相关操作：${request.userIntent}\n` +
           `任务执行耗时：${request.executionResult.duration}ms\n` +
           `执行了 ${request.executionResult.totalSteps} 个步骤，成功 ${request.executionResult.successfulSteps} 个\n\n` +
           `操作已成功执行，请检查对应系统确认结果。`;
  }

  /**
   * 生成搜索类任务的响应
   */
  private async generateSearchResponse(request: OptimizedSummaryRequest): Promise<string> {
    // 如果有页面内容，提取搜索结果
    if (request.pageContent && request.pageContent.length > 100) {
      const summaryResult = await this.summarizeContent({
        content: request.pageContent,
        type: 'search_results',
        maxLength: request.maxLength || 300,
        language: request.language || '中文'
      });
      
      if (summaryResult.success) {
        return `搜索任务执行成功！\n\n` +
               `已为您搜索"${request.userIntent}"相关内容：\n\n` +
               `${summaryResult.summary}\n\n` +
               (summaryResult.keyPoints.length > 0 ? 
                `搜索结果要点：\n${summaryResult.keyPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}\n\n` : '') +
               `任务执行耗时：${request.executionResult.duration}ms`;
      }
    }
    
    // 默认响应
    return `搜索任务执行成功！\n\n` +
           `已为您执行搜索操作："${request.userIntent}"\n` +
           `任务执行耗时：${request.executionResult.duration}ms\n` +
           `执行了 ${request.executionResult.totalSteps} 个步骤，成功 ${request.executionResult.successfulSteps} 个`;
  }

  /**
   * 生成导航类任务的响应
   */
  private async generateNavigationResponse(request: OptimizedSummaryRequest): Promise<string> {
    return `页面访问成功！\n\n` +
           `已成功访问页面：${request.executionResult.finalUrl}\n` +
           `任务执行耗时：${request.executionResult.duration}ms\n` +
           `执行了 ${request.executionResult.totalSteps} 个步骤，成功 ${request.executionResult.successfulSteps} 个\n\n` +
           `页面已成功加载，您可以继续进行相关操作。`;
  }

  /**
   * 生成默认响应
   */
  private async generateDefaultResponse(request: OptimizedSummaryRequest): Promise<string> {
    // 如果有页面内容，进行总结
    if (request.pageContent && request.pageContent.length > 100) {
      const summaryResult = await this.summarizeContent({
        content: request.pageContent,
        type: 'webpage',
        maxLength: request.maxLength || 300,
        language: request.language || '中文'
      });
      
      if (summaryResult.success) {
        return `任务执行成功！\n\n` +
               `页面内容总结：\n${summaryResult.summary}\n\n` +
               (summaryResult.keyPoints.length > 0 ? 
                `关键要点：\n${summaryResult.keyPoints.map((point, i) => `${i + 1}. ${point}`).join('\n')}\n\n` : '') +
               `任务执行耗时：${request.executionResult.duration}ms`;
      }
    }
    
    // 默认响应
    return `任务执行成功！\n\n` +
           `已按照您的要求完成操作：${request.userIntent}\n` +
           `任务执行耗时：${request.executionResult.duration}ms\n` +
           `执行了 ${request.executionResult.totalSteps} 个步骤，成功 ${request.executionResult.successfulSteps} 个`;
  }

  /**
   * 对内容进行总结
   */
  private async summarizeContent(options: {
    content: string;
    type: 'webpage' | 'search_results' | 'execution_result';
    maxLength?: number;
    language?: string;
  }): Promise<{ success: boolean; summary: string; keyPoints: string[] }> {
    try {
      const cfg = getAIClientManager().getConfig();
      const selectedModel = cfg.intentModel || cfg.model;
      
      if (!selectedModel) {
        return { success: false, summary: '', keyPoints: [] };
      }

      const prompt = this.buildSummaryPrompt(options);
      
      const response = await this.client.chat.completions.create({
        model: selectedModel,
        messages: [
          { role: 'system', content: this.buildSummarySystemPrompt(options) },
          { role: 'user', content: prompt }
        ],
        temperature: cfg.temperature || 0.3,
        max_tokens: options.maxLength ? Math.min(options.maxLength * 2, 1000) : 500,
        response_format: { type: 'json_object' }
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from AI');
      }

      // 处理可能包含markdown代码块的JSON响应
      let cleanContent = content.trim();
      if (cleanContent.startsWith('```json')) {
        cleanContent = cleanContent.replace(/^```json\s*/, '').replace(/\s*```$/, '');
      } else if (cleanContent.startsWith('```')) {
        cleanContent = cleanContent.replace(/^```\s*/, '').replace(/\s*```$/, '');
      }

      const aiResult = JSON.parse(cleanContent);
      
      return {
        success: true,
        summary: aiResult.summary || '',
        keyPoints: Array.isArray(aiResult.keyPoints) ? aiResult.keyPoints : []
      };
    } catch (error) {
      logger.error('Content summarization failed', error);
      return { success: false, summary: '', keyPoints: [] };
    }
  }

  /**
   * 构建总结系统提示词
   */
  private buildSummarySystemPrompt(options: { 
    content: string; 
    type: 'webpage' | 'search_results' | 'execution_result'; 
    maxLength?: number; 
    language?: string 
  }): string {
    const language = options.language || '中文';
    
    return `你是一个专业的AI内容总结助手。你的任务是将用户提供的内容进行智能总结和要点提取。

请根据内容类型和用户要求，返回一个JSON对象，包含以下结构：
{
  "summary": "内容的精炼总结",
  "keyPoints": ["要点1", "要点2", "要点3"]
}

规则：
1. 总结必须使用${language}
2. 保持客观和准确，不要添加个人观点
3. 突出最重要的信息
4. keyPoints数组应该包含3-5个核心要点
5. 如果是网页内容，重点关注标题、主要内容和关键信息
6. 如果是搜索结果，重点关注相关性最高的条目
7. 如果是执行结果，重点关注成功/失败状态、关键数据和结论
8. 确保返回有效的JSON格式`;
  }

  /**
   * 构建总结用户提示词
   */
  private buildSummaryPrompt(options: { 
    content: string; 
    type: 'webpage' | 'search_results' | 'execution_result'; 
    maxLength?: number; 
    language?: string 
  }): string {
    let prompt = `请对以下内容进行总结和要点提取：\n\n`;
    
    // 根据内容类型添加特定指导
    switch (options.type) {
      case 'webpage':
        prompt += '这是一段网页内容，请提取页面的主要信息和关键要点：\n';
        break;
      case 'search_results':
        prompt += '这是一组搜索结果，请总结最相关的信息和要点：\n';
        break;
      case 'execution_result':
        prompt += '这是一个任务执行结果，请总结执行状态、关键数据和结论：\n';
        break;
      default:
        prompt += '请对以下内容进行总结：\n';
    }
    
    // 添加长度限制（如果提供）
    if (options.maxLength) {
      prompt += `\n总结长度请控制在${options.maxLength}字以内。\n`;
    }
    
    prompt += `\n内容：\n${options.content.substring(0, 8000)}${options.content.length > 8000 ? '...' : ''}`;
    
    prompt += '\n\n请返回JSON格式的总结结果。';
    
    return prompt;
  }

  /**
   * 从响应中提取总结
   */
  private async extractSummaryFromResponse(response: string): Promise<string> {
    // 简单提取第一段作为总结
    const lines = response.split('\n');
    for (const line of lines) {
      if (line.trim().length > 20 && !line.includes('任务执行') && !line.includes('耗时')) {
        return line.trim();
      }
    }
    return response.substring(0, 100) + (response.length > 100 ? '...' : '');
  }

  /**
   * 从响应中提取要点
   */
  private async extractKeyPointsFromResponse(response: string): Promise<string[]> {
    const keyPoints: string[] = [];
    const lines = response.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      // 匹配数字开头的要点
      if (/^[\d一二三四五六七八九]\s*[\.、]/.test(trimmed)) {
        keyPoints.push(trimmed.replace(/^[\d一二三四五六七八九]\s*[\.、]\s*/, ''));
      }
    }
    
    return keyPoints.length > 0 ? keyPoints : ['任务执行成功', '已按要求完成操作'];
  }
}

// 默认实例管理
let defaultOptimizedSummarizer: OptimizedAISummarizer | null = null;

export function getDefaultOptimizedAISummarizer(): OptimizedAISummarizer {
  if (!defaultOptimizedSummarizer) {
    defaultOptimizedSummarizer = new OptimizedAISummarizer();
  }
  return defaultOptimizedSummarizer;
}

export function setDefaultOptimizedAISummarizer(summarizer: OptimizedAISummarizer): void {
  defaultOptimizedSummarizer = summarizer;
}
