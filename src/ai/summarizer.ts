/**
 * AI 内容总结器
 * 使用 LLM 对网页内容或执行结果进行智能总结
 */

import { getAIClient, getAIClientManager } from './config';
import { getDefaultLogger } from '../core/logger';

const logger = getDefaultLogger();

export interface SummaryRequest {
  content: string;
  type: 'webpage' | 'execution_result' | 'search_results' | 'custom';
  maxLength?: number;
  language?: string;
  focusPoints?: string[];
}

export interface SummaryResult {
  success: boolean;
  summary: string;
  keyPoints: string[];
  wordCount: number;
  originalLength: number;
  compressionRatio: number;
  error?: string;
}

/**
 * AI 内容总结器类
 */
export class AISummarizer {
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
        logger.info('AI Summarizer initialized with AI client');
      } else {
        logger.warn('AI not enabled, AI Summarizer will not work');
      }
    } catch (error) {
      logger.error('Failed to initialize AI client for Summarizer', error);
    }
  }

  /**
   * 对内容进行智能总结
   */
  async summarize(request: SummaryRequest): Promise<SummaryResult> {
    logger.debug('AI summarizing content', { type: request.type, length: request.content.length });

    try {
      if (!this.client) {
        await this.initializeClient();
      }

      if (!this.client) {
        return {
          success: false,
          summary: '',
          keyPoints: [],
          wordCount: 0,
          originalLength: request.content.length,
          compressionRatio: 0,
          error: 'AI client not available'
        };
      }

      const cfg = getAIClientManager().getConfig();
      const selectedModel = cfg.intentModel || cfg.model;
      
      if (!selectedModel) {
        return {
          success: false,
          summary: '',
          keyPoints: [],
          wordCount: 0,
          originalLength: request.content.length,
          compressionRatio: 0,
          error: 'No model configured'
        };
      }

      const prompt = this.buildPrompt(request);
      
      const response = await this.client.chat.completions.create({
        model: selectedModel,
        messages: [
          { role: 'system', content: this.buildSystemPrompt(request) },
          { role: 'user', content: prompt }
        ],
        temperature: cfg.temperature || 0.3,
        max_tokens: request.maxLength ? Math.min(request.maxLength * 2, 1000) : 500,
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
      
      // 计算统计信息
      const wordCount = aiResult.summary ? aiResult.summary.split(/\s+/).length : 0;
      const originalLength = request.content.split(/\s+/).length;
      const compressionRatio = originalLength > 0 ? wordCount / originalLength : 0;

      const result: SummaryResult = {
        success: true,
        summary: aiResult.summary || '',
        keyPoints: Array.isArray(aiResult.keyPoints) ? aiResult.keyPoints : [],
        wordCount,
        originalLength,
        compressionRatio
      };

      logger.info('AI summarization completed', {
        type: request.type,
        originalWords: originalLength,
        summaryWords: wordCount,
        compressionRatio: compressionRatio.toFixed(2)
      });

      return result;
    } catch (error) {
      logger.error('AI summarization failed', error);
      
      return {
        success: false,
        summary: '',
        keyPoints: [],
        wordCount: 0,
        originalLength: request.content.length,
        compressionRatio: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(request: SummaryRequest): string {
    const language = request.language || '中文';
    
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
6. 如果是执行结果，重点关注成功/失败状态、关键数据和结论
7. 如果是搜索结果，重点关注相关性最高的条目
8. 确保返回有效的JSON格式`;
  }

  /**
   * 构建用户提示词
   */
  private buildPrompt(request: SummaryRequest): string {
    let prompt = `请对以下内容进行总结和要点提取：\n\n`;
    
    // 根据内容类型添加特定指导
    switch (request.type) {
      case 'webpage':
        prompt += '这是一段网页内容，请提取页面的主要信息和关键要点：\n';
        break;
      case 'execution_result':
        prompt += '这是一个任务执行结果，请总结执行状态、关键数据和结论：\n';
        break;
      case 'search_results':
        prompt += '这是一组搜索结果，请总结最相关的信息和要点：\n';
        break;
      default:
        prompt += '请对以下内容进行总结：\n';
    }
    
    // 添加焦点要点（如果提供）
    if (request.focusPoints && request.focusPoints.length > 0) {
      prompt += `\n请特别关注以下方面：${request.focusPoints.join('、')}\n`;
    }
    
    // 添加长度限制（如果提供）
    if (request.maxLength) {
      prompt += `\n总结长度请控制在${request.maxLength}字以内。\n`;
    }
    
    prompt += `\n内容：\n${request.content.substring(0, 8000)}${request.content.length > 8000 ? '...' : ''}`;
    
    prompt += '\n\n请返回JSON格式的总结结果。';
    
    return prompt;
  }
}

// 默认实例管理
let defaultSummarizer: AISummarizer | null = null;

export function getDefaultAISummarizer(): AISummarizer {
  if (!defaultSummarizer) {
    defaultSummarizer = new AISummarizer();
  }
  return defaultSummarizer;
}

export function setDefaultAISummarizer(summarizer: AISummarizer): void {
  defaultSummarizer = summarizer;
}
