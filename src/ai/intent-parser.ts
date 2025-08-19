/**
 * AI 意图解析器
 * 使用 LLM 将自然语言指令转换为半结构化的任务需求
 */

import { OpenAI } from 'openai';
import { ActionType, SelectorType } from '../core/types';
import { ParsedIntent, IntentPattern } from '../core/types';
import { getDefaultLogger } from '../core/logger';
import { getAIClientManager } from './config';

/**
 * AI 意图解析器类
 * 与传统 IntentParser 接口兼容
 */
export class AIIntentParser {
  private logger = getDefaultLogger();
  private client: OpenAI | null = null;
  private patterns: IntentPattern[] = []; // 为兼容性保留
  private systemPrompt: string;

  constructor() {
    this.systemPrompt = this.buildSystemPrompt();
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
        this.logger.info('AI Intent Parser initialized with AI client');
      } else {
        this.logger.warn('AI not enabled, AI Intent Parser will use fallback');
      }
    } catch (error) {
      this.logger.error('Failed to initialize AI client for Intent Parser', error);
    }
  }

  /**
   * 解析自然语言意图
   */
  async parseIntent(text: string, context?: {
    currentUrl?: string;
    pageTitle?: string;
    userHistory?: string[];
  }): Promise<ParsedIntent[]> {
    this.logger.debug('AI parsing intent', { text, context });
  
    try {
      if (!this.client) {
        await this.initializeClient();
      }
      if (!this.client) {
        throw new Error('AI client not initialized or disabled');
      }
  
       const prompt = this.buildPrompt(text, context);
       const response = await this.client.chat.completions.create({
         model: getAIClientManager().getConfig().model,
         messages: [
           { role: 'system', content: this.systemPrompt },
           { role: 'user', content: prompt }
         ],
         temperature: getAIClientManager().getConfig().temperature || 0.2,
         max_tokens: 2048,
         response_format: { type: 'json_object' }
       });
  
       const content = response.choices[0]?.message?.content;
       if (!content) {
         throw new Error('Empty response from AI');
       }
  
       const aiResult = JSON.parse(content);
       const intents = this.parseAIResponse(aiResult);
       
       this.logger.info(`AI parsed ${intents.length} intent candidates`, {
         text: text.substring(0, 100),
         topCandidate: intents[0]?.action,
         confidence: intents[0]?.confidence
       });
  
       return intents;
     } catch (error) {
      this.logger.error('AI intent parsing failed', error);
      throw error;
     }
   }

  /**
   * 注册自定义模式（为兼容性保留）
   */
  registerPattern(pattern: IntentPattern): void {
    this.patterns.push(pattern);
    this.logger.debug(`Registered pattern: ${pattern.id}`);
  }

  /**
   * 获取支持的动作类型
   */
  getSupportedActions(): ActionType[] {
    return Object.values(ActionType);
  }

  /**
   * 验证解析结果
   */
  validateIntent(intent: ParsedIntent): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 检查必需字段
    if (!intent.action) {
      errors.push('Missing action');
    }

    // 检查动作特定的要求
    switch (intent.action) {
      case ActionType.NAVIGATE:
        if (!intent.parameters?.url) {
          errors.push('Navigate action requires URL parameter');
        }
        break;
      
      case ActionType.TYPE:
        if (!intent.parameters?.text) {
          errors.push('Type action requires text parameter');
        }
        if (!intent.target) {
          errors.push('Type action requires target element');
        }
        break;
      
      case ActionType.CLICK:
      case ActionType.HOVER:
        if (!intent.target) {
          errors.push(`${intent.action} action requires target element`);
        }
        break;
      
      case ActionType.SELECT:
        if (!intent.parameters?.value) {
          errors.push('Select action requires value parameter');
        }
        if (!intent.target) {
          errors.push('Select action requires target element');
        }
        break;
    }

    // 检查置信度
    if (intent.confidence < 0 || intent.confidence > 1) {
      errors.push('Confidence must be between 0 and 1');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    const actionTypes = Object.values(ActionType).join(', ');
    const selectorTypes = Object.values(SelectorType).join(', ');

    return `你是一个智能的浏览器自动化意图解析助手。你的任务是将用户的自然语言指令转换为结构化的浏览器操作意图。

支持的动作类型: ${actionTypes}
支持的选择器类型: ${selectorTypes}

请根据用户指令，返回一个JSON对象，包含以下结构：
{
  "intents": [
    {
      "action": "动作类型（必须是支持的ActionType之一）",
      "target": {
        "type": "element|url|data",
        "description": "目标描述",
        "selectors": [
          {
            "type": "选择器类型",
            "value": "选择器值",
            "confidence": 0.8
          }
        ]
      },
      "parameters": {
        "text": "要输入的文本（如果适用）",
        "url": "要导航的URL（如果适用）",
        "value": "要选择的值（如果适用）",
        "options": {}
      },
      "conditions": {
        "waitFor": "等待条件",
        "timeout": 30000,
        "retries": 3
      },
      "context": {
        "userGoal": "用户目标描述"
      },
      "confidence": 0.85
    }
  ]
}

规则：
1. 置信度范围 0-1，越高表示越确定
2. 为每个意图生成合适的选择器候选项
3. 根据上下文推断最可能的操作
4. 如果指令模糊，提供多个候选意图
5. 优先使用语义明确的选择器（如 text, aria-label, role）
6. 确保返回有效的JSON格式`;
  }

  /**
   * 构建用户提示词
   */
  private buildPrompt(text: string, context?: {
    currentUrl?: string;
    pageTitle?: string;
    userHistory?: string[];
  }): string {
    let prompt = `用户指令: "${text}"`;

    if (context) {
      prompt += '\n\n上下文信息:';
      if (context.currentUrl) {
        prompt += `\n- 当前页面URL: ${context.currentUrl}`;
      }
      if (context.pageTitle) {
        prompt += `\n- 页面标题: ${context.pageTitle}`;
      }
      if (context.userHistory && context.userHistory.length > 0) {
        prompt += `\n- 用户历史操作: ${context.userHistory.slice(-3).join(', ')}`;
      }
    }

    prompt += '\n\n请解析这个指令并返回结构化的意图JSON。';
    return prompt;
  }

  /**
   * 解析 AI 响应
   */
  private parseAIResponse(aiResult: any): ParsedIntent[] {
    try {
      const intents: ParsedIntent[] = [];
      
      if (!aiResult.intents || !Array.isArray(aiResult.intents)) {
        throw new Error('Invalid AI response format');
      }

      for (const intent of aiResult.intents) {
        // 验证并转换动作类型
        if (!Object.values(ActionType).includes(intent.action)) {
          this.logger.warn(`Unknown action type: ${intent.action}, skipping`);
          continue;
        }

        const parsedIntent: ParsedIntent = {
          action: intent.action as ActionType,
          confidence: Math.max(0, Math.min(1, intent.confidence || 0.5))
        };

        // 处理目标
        if (intent.target) {
          parsedIntent.target = {
            type: intent.target.type || 'element',
            description: intent.target.description || '',
            selectors: this.parseSelectors(intent.target.selectors)
          };
        }

        // 处理参数
        if (intent.parameters) {
          parsedIntent.parameters = { ...intent.parameters };
        }

        // 处理条件
        if (intent.conditions) {
          parsedIntent.conditions = { ...intent.conditions };
        }

        // 处理上下文
        if (intent.context) {
          parsedIntent.context = { ...intent.context };
        }

        intents.push(parsedIntent);
      }

      // 按置信度排序
      intents.sort((a, b) => b.confidence - a.confidence);
      return intents;
    } catch (error) {
      this.logger.error('Failed to parse AI response', error);
      return [];
    }
  }

  /**
   * 解析选择器
   */
  private parseSelectors(selectors: any[]): Array<{
    type: SelectorType;
    value: string;
    confidence: number;
  }> {
    if (!Array.isArray(selectors)) {
      return [];
    }

    return selectors
      .filter(selector => 
        selector.type && 
        Object.values(SelectorType).includes(selector.type) &&
        selector.value
      )
      .map(selector => ({
        type: selector.type as SelectorType,
        value: selector.value,
        confidence: Math.max(0, Math.min(1, selector.confidence || 0.5))
      }));
  }

  /**
   * 回退解析方法（使用简单规则）
   */
  private async fallbackParse(text: string, context?: any): Promise<ParsedIntent[]> {
    const normalizedText = text.toLowerCase().trim();
    
    // 简单的关键词匹配
    if (normalizedText.includes('打开') || normalizedText.includes('访问') || normalizedText.includes('跳转')) {
      const urlMatch = text.match(/(https?:\/\/[^\s]+)/);
      return [{
        action: ActionType.NAVIGATE,
        parameters: {
          url: urlMatch ? urlMatch[1] : context?.currentUrl || 'about:blank'
        },
        confidence: 0.6,
        context: {
          userGoal: text
        }
      }];
    }

    if (normalizedText.includes('点击')) {
      return [{
        action: ActionType.CLICK,
        target: {
          type: 'element',
          description: text,
          selectors: [{
            type: SelectorType.TEXT,
            value: text.replace(/点击|按钮|链接/g, '').trim(),
            confidence: 0.5
          }]
        },
        confidence: 0.5,
        context: {
          userGoal: text
        }
      }];
    }

    if (normalizedText.includes('输入') || normalizedText.includes('填写')) {
      return [{
        action: ActionType.TYPE,
        target: {
          type: 'element',
          description: '输入框',
          selectors: [{
            type: SelectorType.TAG,
            value: 'input',
            confidence: 0.5
          }]
        },
        parameters: {
          text: text.replace(/输入|填写/g, '').trim()
        },
        confidence: 0.5,
        context: {
          userGoal: text
        }
      }];
    }

    // 默认返回一个低置信度的通用意图
    return [{
      action: ActionType.EVALUATE,
      parameters: {
        text: text
      },
      confidence: 0.3,
      context: {
        userGoal: text
      }
    }];
  }
}

// 导出默认实例管理函数
let defaultAIIntentParser: AIIntentParser | null = null;

export function getDefaultAIIntentParser(): AIIntentParser {
  if (!defaultAIIntentParser) {
    defaultAIIntentParser = new AIIntentParser();
  }
  return defaultAIIntentParser;
}

export function setDefaultAIIntentParser(parser: AIIntentParser): void {
  defaultAIIntentParser = parser;
}