/**
 * 选择器模块入口
 * 导出定位引擎和相关工具
 */

export {
  SelectorEngine,
  getDefaultSelectorEngine,
  setDefaultSelectorEngine,
  createSelectorEngine
} from './selector-engine';

export type {
  SelectorStrategy,
  SelectorContext,
  SelectorResult,
  SelectorEngineConfig
} from './selector-engine';

export {
  TextContentStrategy,
  IdStrategy,
  ClassStrategy,
  AriaLabelStrategy,
  RoleStrategy,
  TestIdStrategy,
  TagNameStrategy,
  DEFAULT_STRATEGIES,
  createDefaultStrategies
} from './strategies';

import { ActionType, SelectorCandidate } from '../core/types';
import { SelectorContext, getDefaultSelectorEngine } from './selector-engine';

// 便捷函数
export async function findElement(
  description: string,
  actionType: ActionType,
  context: SelectorContext
) {
  const engine = getDefaultSelectorEngine();
  return await engine.findElement(description, actionType, context);
}

export async function findElements(
  description: string,
  actionType: ActionType,
  context: SelectorContext,
  maxResults?: number
) {
  const engine = getDefaultSelectorEngine();
  return await engine.findElements(description, actionType, context, maxResults);
}

export async function validateSelector(
  candidate: SelectorCandidate,
  context: SelectorContext
) {
  const engine = getDefaultSelectorEngine();
  return await engine.validateSelector(candidate, context);
}