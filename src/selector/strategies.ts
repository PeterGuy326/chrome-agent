/**
 * 选择器策略集合
 * 实现各种元素定位策略
 */

import { 
  SelectorStrategy, 
  SelectorContext 
} from './selector-engine';
import { 
  SelectorCandidate, 
  SelectorType, 
  ActionType 
} from '../core/types';

/**
 * 文本内容策略
 */
export class TextContentStrategy implements SelectorStrategy {
  id = 'text-content';
  name = 'Text Content Strategy';
  type = SelectorType.TEXT;
  priority = 80;

  canHandle(description: string, actionType: ActionType): boolean {
    // 适用于包含具体文本的描述
    const textKeywords = ['点击', 'click', '按钮', 'button', '链接', 'link', '文本', 'text'];
    return textKeywords.some(keyword => description.toLowerCase().includes(keyword));
  }

  generateCandidates(description: string, actionType: ActionType): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    
    // 提取可能的文本内容
    const textMatches = this.extractTextFromDescription(description);
    
    textMatches.forEach((text, index) => {
      candidates.push({
        type: SelectorType.TEXT,
        value: text,
        score: 90 - index * 10, // 第一个匹配的文本得分最高
        description: `Text content: "${text}"`
      });
    });

    return candidates;
  }

  score(candidate: SelectorCandidate, context: SelectorContext): number {
    let score = candidate.score / 100;
    
    // 根据动作类型调整分数
    if (context.actionType === ActionType.CLICK && candidate.value.includes('按钮')) {
      score += 0.2;
    }
    
    // 文本长度影响分数（太短或太长都不好）
    const textLength = candidate.value.length;
    if (textLength >= 2 && textLength <= 20) {
      score += 0.1;
    }
    
    return Math.min(1, score);
  }

  private extractTextFromDescription(description: string): string[] {
    const texts: string[] = [];
    
    // 提取引号中的文本
    const quotedTexts = description.match(/["'](.*?)["']/g);
    if (quotedTexts) {
      texts.push(...quotedTexts.map(t => t.slice(1, -1)));
    }
    
    // 提取常见的按钮文本
    const buttonTexts = description.match(/(?:点击|click)\s*["']?([^"'\s]+)["']?/gi);
    if (buttonTexts) {
      texts.push(...buttonTexts.map(t => t.replace(/(?:点击|click)\s*["']?/i, '').replace(/["']?$/, '')));
    }
    
    return [...new Set(texts)]; // 去重
  }
}

/**
 * ID 属性策略
 */
export class IdStrategy implements SelectorStrategy {
  id = 'id-attribute';
  name = 'ID Attribute Strategy';
  type = SelectorType.ID;
  priority = 90;

  canHandle(description: string, actionType: ActionType): boolean {
    // 检查描述中是否包含可能的ID
    return /id[:\s]*["']?([a-zA-Z][\w-]*)/i.test(description);
  }

  generateCandidates(description: string, actionType: ActionType): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    const idMatches = description.match(/id[:\s]*["']?([a-zA-Z][\w-]*)/gi);
    
    if (idMatches) {
      idMatches.forEach((match, index) => {
        const id = match.replace(/id[:\s]*["']?/i, '').replace(/["']?$/, '');
        candidates.push({
          type: SelectorType.ID,
          value: id,
          score: 95 - index * 5,
          description: `Element with ID: ${id}`
        });
      });
    }

    return candidates;
  }

  score(candidate: SelectorCandidate, context: SelectorContext): number {
    let score = candidate.score / 100;
    
    // ID选择器通常很可靠
    score += 0.1;
    
    // 检查ID的语义性
    const semanticKeywords = ['btn', 'button', 'link', 'input', 'form', 'submit', 'cancel'];
    if (semanticKeywords.some(keyword => candidate.value.toLowerCase().includes(keyword))) {
      score += 0.1;
    }
    
    return Math.min(1, score);
  }
}

/**
 * CSS 类策略
 */
export class ClassStrategy implements SelectorStrategy {
  id = 'css-class';
  name = 'CSS Class Strategy';
  type = SelectorType.CLASS;
  priority = 70;

  canHandle(description: string, actionType: ActionType): boolean {
    return /class[:\s]*["']?([a-zA-Z][\w-]*)/i.test(description) ||
           /\.([a-zA-Z][\w-]*)/i.test(description);
  }

  generateCandidates(description: string, actionType: ActionType): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    
    // 匹配 class: 或 class= 格式
    const classMatches = description.match(/class[:\s]*["']?([a-zA-Z][\w-]*)/gi);
    if (classMatches) {
      classMatches.forEach((match, index) => {
        const className = match.replace(/class[:\s]*["']?/i, '').replace(/["']?$/, '');
        candidates.push({
          type: SelectorType.CLASS,
          value: className,
          score: 75 - index * 5,
          description: `Element with class: ${className}`
        });
      });
    }
    
    // 匹配 .className 格式
    const dotClassMatches = description.match(/\.([a-zA-Z][\w-]*)/g);
    if (dotClassMatches) {
      dotClassMatches.forEach((match, index) => {
        const className = match.substring(1);
        candidates.push({
          type: SelectorType.CLASS,
          value: className,
          score: 70 - index * 5,
          description: `Element with class: ${className}`
        });
      });
    }

    return candidates;
  }

  score(candidate: SelectorCandidate, context: SelectorContext): number {
    let score = candidate.score / 100;
    
    // 检查类名的语义性
    const semanticKeywords = ['btn', 'button', 'link', 'input', 'form', 'submit', 'primary', 'secondary'];
    if (semanticKeywords.some(keyword => candidate.value.toLowerCase().includes(keyword))) {
      score += 0.1;
    }
    
    return Math.min(1, score);
  }
}

/**
 * ARIA 标签策略
 */
export class AriaLabelStrategy implements SelectorStrategy {
  id = 'aria-label';
  name = 'ARIA Label Strategy';
  type = SelectorType.ARIA_LABEL;
  priority = 85;

  canHandle(description: string, actionType: ActionType): boolean {
    return /aria-label[:\s]*["']?([^"']*)/i.test(description) ||
           description.includes('无障碍') ||
           description.includes('accessibility');
  }

  generateCandidates(description: string, actionType: ActionType): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    
    const ariaMatches = description.match(/aria-label[:\s]*["']?([^"']*)/gi);
    if (ariaMatches) {
      ariaMatches.forEach((match, index) => {
        const label = match.replace(/aria-label[:\s]*["']?/i, '').replace(/["']?$/, '');
        candidates.push({
          type: SelectorType.ARIA_LABEL,
          value: label,
          score: 85 - index * 5,
          description: `Element with aria-label: ${label}`
        });
      });
    }

    return candidates;
  }

  score(candidate: SelectorCandidate, context: SelectorContext): number {
    let score = candidate.score / 100;
    
    // ARIA标签通常很可靠，特别是对于无障碍访问
    score += 0.15;
    
    return Math.min(1, score);
  }
}

/**
 * 角色策略
 */
export class RoleStrategy implements SelectorStrategy {
  id = 'role-attribute';
  name = 'Role Attribute Strategy';
  type = SelectorType.ROLE;
  priority = 75;

  canHandle(description: string, actionType: ActionType): boolean {
    const roleKeywords = ['button', 'link', 'textbox', 'checkbox', 'radio', 'tab', 'menu'];
    return roleKeywords.some(role => description.toLowerCase().includes(role)) ||
           /role[:\s]*["']?([a-zA-Z]+)/i.test(description);
  }

  generateCandidates(description: string, actionType: ActionType): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    
    // 直接从描述中提取角色
    const roleMatches = description.match(/role[:\s]*["']?([a-zA-Z]+)/gi);
    if (roleMatches) {
      roleMatches.forEach((match, index) => {
        const role = match.replace(/role[:\s]*["']?/i, '').replace(/["']?$/, '');
        candidates.push({
          type: SelectorType.ROLE,
          value: role,
          score: 80 - index * 5,
          description: `Element with role: ${role}`
        });
      });
    }
    
    // 根据动作类型推断角色
    const actionRoleMap: Partial<Record<ActionType, string[]>> = {
      [ActionType.CLICK]: ['button', 'link'],
      [ActionType.TYPE]: ['textbox', 'searchbox'],
      [ActionType.SELECT]: ['option', 'listbox'],
      [ActionType.SCROLL]: ['main', 'region'],
      [ActionType.WAIT]: [],
      [ActionType.NAVIGATE]: ['link'],
      [ActionType.EXTRACT]: ['main', 'article']
    };
    
    const suggestedRoles = actionRoleMap[actionType] || [];
    suggestedRoles.forEach((role, index) => {
      candidates.push({
        type: SelectorType.ROLE,
        value: role,
        score: 70 - index * 10,
        description: `Inferred role for ${actionType}: ${role}`
      });
    });

    return candidates;
  }

  score(candidate: SelectorCandidate, context: SelectorContext): number {
    let score = candidate.score / 100;
    
    // 角色与动作类型的匹配度
    const actionRoleCompatibility: Record<string, ActionType[]> = {
      'button': [ActionType.CLICK],
      'link': [ActionType.CLICK, ActionType.NAVIGATE],
      'textbox': [ActionType.TYPE],
      'searchbox': [ActionType.TYPE],
      'checkbox': [ActionType.CLICK],
      'radio': [ActionType.CLICK]
    };
    
    const compatibleActions = actionRoleCompatibility[candidate.value] || [];
    if (compatibleActions.includes(context.actionType)) {
      score += 0.2;
    }
    
    return Math.min(1, score);
  }
}

/**
 * 测试ID策略
 */
export class TestIdStrategy implements SelectorStrategy {
  id = 'test-id';
  name = 'Test ID Strategy';
  type = SelectorType.DATA_TESTID;
  priority = 95;

  canHandle(description: string, actionType: ActionType): boolean {
    return /data-testid[:\s]*["']?([a-zA-Z][\w-]*)/i.test(description) ||
           /testid[:\s]*["']?([a-zA-Z][\w-]*)/i.test(description);
  }

  generateCandidates(description: string, actionType: ActionType): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    
    const testIdMatches = description.match(/(?:data-)?testid[:\s]*["']?([a-zA-Z][\w-]*)/gi);
    if (testIdMatches) {
      testIdMatches.forEach((match, index) => {
        const testId = match.replace(/(?:data-)?testid[:\s]*["']?/i, '').replace(/["']?$/, '');
        candidates.push({
          type: SelectorType.DATA_TESTID,
          value: testId,
          score: 95 - index * 2,
          description: `Element with data-testid: ${testId}`
        });
      });
    }

    return candidates;
  }

  score(candidate: SelectorCandidate, context: SelectorContext): number {
    let score = candidate.score / 100;
    
    // 测试ID通常是最可靠的选择器
    score += 0.2;
    
    return Math.min(1, score);
  }
}

/**
 * 标签名策略
 */
export class TagNameStrategy implements SelectorStrategy {
  id = 'tag-name';
  name = 'Tag Name Strategy';
  type = SelectorType.TAG;
  priority = 50;

  canHandle(description: string, actionType: ActionType): boolean {
    const htmlTags = ['button', 'input', 'a', 'div', 'span', 'form', 'select', 'textarea'];
    return htmlTags.some(tag => description.toLowerCase().includes(tag));
  }

  generateCandidates(description: string, actionType: ActionType): SelectorCandidate[] {
    const candidates: SelectorCandidate[] = [];
    
    // 根据动作类型推荐标签
    const actionTagMap: Partial<Record<ActionType, string[]>> = {
      [ActionType.CLICK]: ['button', 'a', 'input[type="button"]', 'input[type="submit"]'],
      [ActionType.TYPE]: ['input', 'textarea'],
      [ActionType.SELECT]: ['select', 'option'],
      [ActionType.SCROLL]: ['div', 'main', 'section'],
      [ActionType.WAIT]: [],
      [ActionType.NAVIGATE]: ['a'],
      [ActionType.EXTRACT]: ['div', 'span', 'p', 'article']
    };
    
    const suggestedTags = actionTagMap[actionType] || [];
    suggestedTags.forEach((tag, index) => {
      candidates.push({
        type: SelectorType.TAG,
        value: tag,
        score: 60 - index * 10,
        description: `Tag selector: ${tag}`
      });
    });

    return candidates;
  }

  score(candidate: SelectorCandidate, context: SelectorContext): number {
    let score = candidate.score / 100;
    
    // 标签选择器通常不够具体，分数较低
    score -= 0.1;
    
    return Math.max(0, score);
  }
}

// 导出所有策略
export const DEFAULT_STRATEGIES = [
  new TextContentStrategy(),
  new IdStrategy(),
  new ClassStrategy(),
  new AriaLabelStrategy(),
  new RoleStrategy(),
  new TestIdStrategy(),
  new TagNameStrategy()
];

export function createDefaultStrategies(): SelectorStrategy[] {
  return DEFAULT_STRATEGIES;
}