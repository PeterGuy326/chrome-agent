/**
 * 翻译工具函数
 * 提供英文检测和翻译功能
 */

import { getAIClientManager } from '../ai/config';
import { getDefaultLogger } from '../core/logger';

const logger = getDefaultLogger();

/**
 * 检测文本是否包含英文内容
 * @param text 要检测的文本
 * @returns 如果包含英文内容返回 true，否则返回 false
 */
export function containsEnglish(text: string): boolean {
  // 检查是否包含英文字母
  return /[a-zA-Z]/.test(text);
}

/**
 * 翻译英文内容为中文
 * @param content 要翻译的内容
 * @returns 翻译后的内容，如果翻译失败则返回原文
 */
export async function translateToChinese(content: string): Promise<string> {
  try {
    const manager = getAIClientManager();
    const client = manager.getClient();
    const cfg = manager.getConfig();
    
    if (!client) {
      logger.warn('AI client not available, returning original content');
      return content; // 如果没有AI客户端，返回原文
    }
    
    const selectedModel = cfg.intentModel || cfg.model;
    if (!selectedModel) {
      logger.warn('No model configured, returning original content');
      return content; // 如果没有配置模型，返回原文
    }
    
    const prompt = `请将以下英文内容翻译成中文：\n\n${content.substring(0, 4000)}${content.length > 4000 ? '...' : ''}`;
    
    const response = await client.chat.completions.create({
      model: selectedModel,
      messages: [
        { role: 'system', content: '你是一个专业的翻译助手，只需将英文内容翻译成中文，不要添加任何解释或其他内容。' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 1000
    });
    
    const translated = response.choices[0]?.message?.content?.trim();
    return translated || content;
  } catch (error) {
    logger.warn('Translation failed, returning original content', { error });
    return content; // 翻译失败时返回原文
  }
}
