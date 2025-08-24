/**
 * AI错误分析器
 * 当任务执行失败时，使用AI分析错误原因并生成用户友好的解释
 */

import { OpenAI } from 'openai';
import { getDefaultLogger } from '../core/logger';
import { getAIClientManager } from './config';
import { AgentError } from '../core/error-handler';

export interface ErrorAnalysisResult {
  summary: string;           // 错误摘要
  possibleCauses: string[];  // 可能的原因
  suggestions: string[];     // 解决建议
  severity: 'low' | 'medium' | 'high'; // 严重程度
  category: string;          // 错误类别
}

export class AIErrorAnalyzer {
  private logger = getDefaultLogger();
  private client: OpenAI | null = null;
  private systemPrompt: string;

  constructor() {
    this.systemPrompt = this.buildSystemPrompt();
  }

  /**
   * 初始化AI客户端
   */
  private async initializeClient(): Promise<void> {
    try {
      const aiManager = getAIClientManager();
      if (!aiManager.isEnabled()) {
        throw new Error('AI is not enabled');
      }
      this.client = aiManager.getClient();
    } catch (error) {
      this.logger.error('Failed to initialize AI Error Analyzer', error);
      throw error;
    }
  }

  /**
   * 分析错误并生成用户友好的解释
   */
  async analyzeError(
    error: Error | AgentError,
    context?: {
      task?: string;
      url?: string;
      step?: string;
      executionLogs?: string[];
    }
  ): Promise<ErrorAnalysisResult> {


    try {
      if (!this.client) {
        await this.initializeClient();
      }
      if (!this.client) {
        throw new Error('AI client not initialized');
      }

      const prompt = this.buildPrompt(error, context);
      const response = await this.client.chat.completions.create({
        model: getAIClientManager().getConfig().model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1024,
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
      return this.parseAIResponse(aiResult);
    } catch (error) {
      this.logger.error('AI error analysis failed', error);
      // 返回默认分析结果
      return this.getDefaultAnalysis(error as Error);
    }
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    return `你是一个专业的Chrome浏览器自动化错误分析专家。当用户的自动化任务失败时，你需要分析错误原因并提供有用的解决建议。

你的任务是：
1. 分析错误信息和上下文
2. 识别可能的错误原因
3. 提供具体的解决建议
4. 评估错误的严重程度
5. 对错误进行分类

请以JSON格式返回分析结果，包含以下字段：
{
  "summary": "错误的简洁摘要",
  "possibleCauses": ["可能的原因1", "可能的原因2"],
  "suggestions": ["解决建议1", "解决建议2"],
  "severity": "low|medium|high",
  "category": "错误类别（如：网络错误、元素定位错误、权限错误等）"
}

常见错误类别：
- 网络错误：连接超时、DNS解析失败、服务器无响应
- 元素定位错误：元素不存在、元素不可见、选择器错误
- 页面加载错误：页面加载超时、JavaScript错误、资源加载失败
- 权限错误：访问被拒绝、需要登录、地理位置限制
- 浏览器错误：浏览器崩溃、内存不足、版本不兼容
- 配置错误：参数错误、路径错误、环境配置问题

请用中文回答，语言要专业但易懂。`;
  }

  /**
   * 构建分析提示词
   */
  private buildPrompt(
    error: Error | AgentError,
    context?: {
      task?: string;
      url?: string;
      step?: string;
      executionLogs?: string[];
    }
  ): string {
    const errorInfo: any = {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n'), // 只取前5行堆栈
    };

    // 添加Error特有的属性
    if (error instanceof Error) {
      errorInfo.name = error.name;
    }

    // 添加AgentError特有的属性
    const agentError = error as AgentError;
    if (agentError.code) {
      errorInfo.code = agentError.code;
    }
    if (agentError.stepId) {
      errorInfo.stepId = agentError.stepId;
    }
    if (agentError.severity) {
      errorInfo.severity = agentError.severity;
    }

    const analysisContext = {
      error: errorInfo,
      context: context || {},
      timestamp: new Date().toISOString()
    };

    return JSON.stringify(analysisContext, null, 2);
  }

  /**
   * 解析AI响应
   */
  private parseAIResponse(aiResult: any): ErrorAnalysisResult {
    return {
      summary: aiResult.summary || '未知错误',
      possibleCauses: Array.isArray(aiResult.possibleCauses) ? aiResult.possibleCauses : ['未知原因'],
      suggestions: Array.isArray(aiResult.suggestions) ? aiResult.suggestions : ['请检查错误日志'],
      severity: ['low', 'medium', 'high'].includes(aiResult.severity) ? aiResult.severity : 'medium',
      category: aiResult.category || '未分类错误'
    };
  }

  /**
   * 获取默认分析结果（当AI分析失败时使用）
   */
  private getDefaultAnalysis(error: Error): ErrorAnalysisResult {
    let category = '未分类错误';
    let severity: 'low' | 'medium' | 'high' = 'medium';
    let suggestions = ['请检查错误日志', '尝试重新运行任务'];

    // 基于错误消息进行简单分类
    const message = error.message.toLowerCase();
    if (message.includes('network') || message.includes('connection') || message.includes('timeout')) {
      category = '网络错误';
      severity = 'high';
      suggestions = ['检查网络连接', '确认目标网站是否可访问', '尝试增加超时时间'];
    } else if (message.includes('element') || message.includes('selector')) {
      category = '元素定位错误';
      severity = 'medium';
      suggestions = ['检查页面结构是否发生变化', '验证选择器是否正确', '等待页面完全加载'];
    } else if (message.includes('permission') || message.includes('access')) {
      category = '权限错误';
      severity = 'high';
      suggestions = ['检查是否需要登录', '确认是否有访问权限', '检查地理位置限制'];
    }

    return {
      summary: `任务执行失败：${error.message}`,
      possibleCauses: ['具体原因需要进一步分析'],
      suggestions,
      severity,
      category
    };
  }
}

// 单例实例
let defaultAIErrorAnalyzer: AIErrorAnalyzer | null = null;

export function getDefaultAIErrorAnalyzer(): AIErrorAnalyzer {
  if (!defaultAIErrorAnalyzer) {
    defaultAIErrorAnalyzer = new AIErrorAnalyzer();
  }
  return defaultAIErrorAnalyzer;
}

export function setDefaultAIErrorAnalyzer(analyzer: AIErrorAnalyzer): void {
  defaultAIErrorAnalyzer = analyzer;
}