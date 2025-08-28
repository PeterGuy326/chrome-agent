/**
 * 聊天接口路由
 * 兼容 Open WebUI 的聊天接口规范
 */

import { Router } from 'express';
import { getDefaultLogger } from '../../core/logger';
import { getDefaultEventBus } from '../../core/event-bus';
import { getDefaultTaskManager } from '../../core/task-manager';
// AI-only 模式：不再使用传统 IntentParser
import { initializeAI, getAIClientManager } from '../../ai/config';
import { getDefaultAIIntentParser } from '../../ai/intent-parser';
import { getDefaultPlanner } from '../../planner';
import { getDefaultExecutor } from '../../executor';
import { getDefaultAISummarizer } from '../../ai/summarizer';
import { getDefaultOptimizedAISummarizer } from '../../ai/optimized-summarizer';
import { EventType, TaskStatus } from '../../core/types';
import { containsEnglish, translateToChinese } from '../../utils/translation-utils';

const router = Router();
const logger = getDefaultLogger();
const eventBus = getDefaultEventBus();

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  user?: string;
}

interface ChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * 聊天完成接口
 * POST /api/v1/chat/completions
 */
router.post('/completions', async (req, res) => {
  const requestId = req.headers['x-request-id'] as string || generateRequestId();
  const startTime = Date.now();
  
  try {
    const chatRequest: ChatRequest = req.body;
    
    // 验证请求
    if (!chatRequest.model || !chatRequest.messages || !Array.isArray(chatRequest.messages)) {
      return res.status(400).json({
        error: 'Invalid request',
        message: 'Missing required fields: model, messages',
        timestamp: new Date().toISOString()
      });
    }
    
    // 检查模型支持
    if (chatRequest.model !== 'chrome-agent-v1') {
      return res.status(400).json({
        error: 'Model not supported',
        message: `Model '${chatRequest.model}' is not supported`,
        timestamp: new Date().toISOString()
      });
    }
    
    // 获取用户消息
    const userMessages = chatRequest.messages.filter(msg => msg.role === 'user');
    if (userMessages.length === 0) {
      return res.status(400).json({
        error: 'No user message found',
        message: 'At least one user message is required',
        timestamp: new Date().toISOString()
      });
    }
    
    const lastUserMessage = userMessages[userMessages.length - 1];
    const userInput = lastUserMessage.content;
    
    logger.info(`Processing chat request: ${userInput}`);
    
    // 如果是流式响应
    if (chatRequest.stream) {
      return handleStreamingResponse(req, res, userInput, requestId, chatRequest);
    }
    
    // 非流式响应
    const result = await processUserRequest(userInput, requestId);
    
    const response: ChatResponse = {
      id: `chatcmpl-${requestId}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: chatRequest.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.response,
            timestamp: new Date().toISOString()
          },
          finish_reason: result.success ? 'stop' : 'error'
        }
      ],
      usage: {
        prompt_tokens: estimateTokens(userInput),
        completion_tokens: estimateTokens(result.response),
        total_tokens: estimateTokens(userInput) + estimateTokens(result.response)
      }
    };
    
    res.json(response);
    
  } catch (error: any) {
    logger.error('Chat completion failed:', error);
    
    eventBus.emit(EventType.API_ERROR, {
      requestId,
      error: error.message,
      stack: error.stack,
      endpoint: '/chat/completions'
    });
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 处理流式响应
 */
async function handleStreamingResponse(
  req: any,
  res: any,
  userInput: string,
  requestId: string,
  chatRequest: ChatRequest
) {
  res.writeHead(200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Transfer-Encoding': 'chunked',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  try {
    // 发送开始事件
    const startChunk = {
      id: `chatcmpl-${requestId}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: chatRequest.model,
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant'
          },
          finish_reason: null
        }
      ]
    };
    
    res.write(`data: ${JSON.stringify(startChunk)}\n\n`);
    
    // 处理用户请求并流式返回结果
    await processUserRequestStreaming(userInput, requestId, (chunk: string) => {
      const dataChunk = {
        id: `chatcmpl-${requestId}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: chatRequest.model,
        choices: [
          {
            index: 0,
            delta: {
              content: chunk
            },
            finish_reason: null
          }
        ]
      };
      
      res.write(`data: ${JSON.stringify(dataChunk)}\n\n`);
    });
    
    // 发送结束事件
    const endChunk = {
      id: `chatcmpl-${requestId}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: chatRequest.model,
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: 'stop'
        }
      ]
    };
    
    res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
    
  } catch (error: any) {
    logger.error('Streaming response failed:', error);
    
    const errorChunk = {
      id: `chatcmpl-${requestId}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: chatRequest.model,
      choices: [
        {
          index: 0,
          delta: {
            content: `错误: ${error.message}`
          },
          finish_reason: 'error'
        }
      ]
    };
    
    res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

/**
 * 处理用户请求（非流式）
 */
async function processUserRequest(userInput: string, requestId: string) {
  try {
    const taskManager = getDefaultTaskManager();
    // 初始化AI（AI-only，失败直接抛错）
    await initializeAI();
    const intentParser = getDefaultAIIntentParser();
    const planner = getDefaultPlanner();
    const executor = getDefaultExecutor();
    const summarizer = getDefaultAISummarizer();
    const optimizedSummarizer = getDefaultOptimizedAISummarizer();
    
    // 1. 解析用户意图
    logger.info('Parsing user intent...');
    const intents = await intentParser.parseIntent(userInput);
    logger.info(`Parsed ${intents.length} intents:`, intents.map(i => ({ action: i.action, confidence: i.confidence })));
    
    // 2. 生成执行计划 - 使用所有相关意图
    logger.info('Generating plan...');
    const plan = await planner.generatePlan(requestId, intents);
  
  // 3. 创建任务
  const task = await taskManager.createTask(userInput, {
    name: `Chat Request ${requestId}`,
    userId: 'api-user',
    metadata: { requestId, intents }
  });
  
  // 4. 执行任务
  logger.info('Executing task...');
  const executionResult = await executor.executePlan(plan);
  
  // 5. 更新任务状态
  await taskManager.updateTaskStatus(task.id, executionResult.success ? TaskStatus.COMPLETED : TaskStatus.FAILED);
    
    // 6. 生成响应
    let response = '';
    if (executionResult.success) {
      // 使用优化的AI总结器生成响应
      try {
        // 获取执行上下文中的页面
        const page = executor['contexts'].get(plan.id)?.page;
        let pageContent = '';
        if (page) {
          // 提取页面内容
          pageContent = await executor.extractPageContent(page);
        }
        
        // 生成优化的总结响应
        response = await executor.generateOptimizedSummary(plan, executionResult, pageContent);
        
        // 检查响应内容是否包含英文，如果是则翻译为中文
        if (containsEnglish(response)) {
          response = await translateToChinese(response);
        }
        
        // 将任务执行成功的消息以特殊样式显示
        const durationMatch = response.match(/任务执行耗时[：:]([\d,]+)ms/);
        if (durationMatch) {
          const duration = durationMatch[1];
          // 移除原消息中的耗时信息
          response = response.replace(/任务执行耗时[：:][\d,]+ms\s*/g, '');
          // 添加特殊样式的耗时信息（卡片样式）
          response += `\n\n[卡片样式: 任务执行成功，耗时${duration}ms]`;
        }
      } catch (summaryError) {
        logger.warn('Failed to generate optimized AI summary, using default response', { error: summaryError });
        // 如果优化总结失败，使用默认响应
        response = '任务执行成功！\n\n';
        response += `执行时间: ${executionResult.duration}ms\n`;
        response += `最终页面: ${executionResult.finalUrl}\n`;
        response += `执行了 ${executionResult.totalSteps} 个步骤，成功 ${executionResult.successfulSteps} 个\n\n`;
        
        // 如果是搜索或导航任务，尝试提取页面内容并进行AI总结
        if (executionResult.finalUrl && executionResult.metadata?.executionContext?.endTime) {
          try {
            // 获取执行上下文中的页面
            const page = executor['contexts'].get(plan.id)?.page;
            if (page) {
              // 提取页面内容
              const pageContent = await executor.extractPageContent(page);
              if (pageContent && pageContent.length > 100) {
                // 使用AI进行总结
                const summaryResult = await summarizer.summarize({
                  content: pageContent,
                  type: 'webpage',
                  maxLength: 300,
                  language: '中文'
                });
                
                if (summaryResult.success && summaryResult.summary) {
                  response += '页面内容总结：\n';
                  response += summaryResult.summary + '\n\n';
                  
                  if (summaryResult.keyPoints && summaryResult.keyPoints.length > 0) {
                    response += '关键要点：\n';
                    summaryResult.keyPoints.forEach((point, index) => {
                      response += `${index + 1}. ${point}\n`;
                    });
                  }
                }
              }
            }
          } catch (summaryError) {
            logger.warn('Failed to generate AI summary', { error: summaryError });
          }
        }
      }
    } else {
      response = `任务执行失败: ${executionResult.error || '未知错误'}`;
    }
    
    return {
      success: executionResult.success,
      response,
      data: null,
      metadata: {
        taskId: task.id,
        planId: plan.id,
        duration: executionResult.duration,
        stepCount: executionResult.totalSteps
      }
    };
    
  } catch (error: any) {
    logger.error('Failed to process user request:', error);
    return {
      success: false,
      response: `处理请求时发生错误: ${error.message}`,
      data: null,
      screenshots: []
    };
  }
}

/**
 * 处理用户请求（流式）
 */
async function processUserRequestStreaming(
  userInput: string,
  requestId: string,
  onChunk: (chunk: string) => void
) {
  try {
    const taskManager = getDefaultTaskManager();
    await initializeAI();
    const intentParser = getDefaultAIIntentParser();
    const planner = getDefaultPlanner();
    const executor = getDefaultExecutor();
    const summarizer = getDefaultAISummarizer();
    const optimizedSummarizer = getDefaultOptimizedAISummarizer();
    
    // 1. 解析用户意图
    onChunk('正在解析用户意图...\n');
    const intents = await intentParser.parseIntent(userInput);
    onChunk(`意图解析完成: 识别到${intents.length}个意图\n`);
    
    // 2. 生成执行计划 - 使用所有相关意图
    onChunk('正在生成执行计划...\n');
    const plan = await planner.generatePlan(requestId, intents);
    onChunk(`计划生成完成，共 ${plan.steps.length} 个步骤\n`);
    
    // 3. 创建任务
    const task = await taskManager.createTask(userInput, {
      name: `Chat Request ${requestId}`,
      userId: 'api-user',
      metadata: { requestId, intents }
    });
    
    // 4. 执行任务（带进度回调）
    onChunk('开始执行任务...\n');
    
    const executionResult = await executor.executePlan(plan);
    
    // 5. 更新任务状态
    await taskManager.updateTaskStatus(task.id, executionResult.success ? TaskStatus.COMPLETED : TaskStatus.FAILED);
    
    // 6. 发送最终结果
    if (executionResult.success) {
      onChunk('\n✅ 任务执行成功！\n');
      onChunk(`\n执行时间: ${executionResult.duration}ms\n`);
      onChunk(`最终页面: ${executionResult.finalUrl}\n`);
      onChunk(`执行了 ${executionResult.totalSteps} 个步骤，成功 ${executionResult.successfulSteps} 个\n`);
      
      // 使用优化的AI总结器生成响应
      try {
        // 获取执行上下文中的页面
        const page = executor['contexts'].get(plan.id)?.page;
        let pageContent = '';
        if (page) {
          onChunk('\n正在提取页面内容...\n');
          // 提取页面内容
          pageContent = await executor.extractPageContent(page);
        }
        
        // 生成优化的总结响应
        const optimizedResponse = await executor.generateOptimizedSummary(plan, executionResult, pageContent);
        onChunk('\n' + optimizedResponse + '\n');
      } catch (summaryError) {
        logger.warn('Failed to generate optimized AI summary, using default response', { error: summaryError });
        onChunk('\n任务执行成功！\n');
        
        // 如果优化总结失败，使用默认响应
        // 如果是搜索或导航任务，尝试提取页面内容并进行AI总结
        if (executionResult.finalUrl && executionResult.metadata?.executionContext?.endTime) {
          try {
            // 获取执行上下文中的页面
            const page = executor['contexts'].get(plan.id)?.page;
            if (page) {
              onChunk('\n正在提取页面内容...\n');
              
              // 提取页面内容
              const pageContent = await executor.extractPageContent(page);
              if (pageContent && pageContent.length > 100) {
                onChunk('正在生成AI总结...\n');
                
                // 使用AI进行总结
                const summaryResult = await summarizer.summarize({
                  content: pageContent,
                  type: 'webpage',
                  maxLength: 300,
                  language: '中文'
                });
                
                if (summaryResult.success && summaryResult.summary) {
                  onChunk('\n页面内容总结：\n');
                  onChunk(summaryResult.summary + '\n\n');
                  
                  if (summaryResult.keyPoints && summaryResult.keyPoints.length > 0) {
                    onChunk('关键要点：\n');
                    summaryResult.keyPoints.forEach((point, index) => {
                      onChunk(`${index + 1}. ${point}\n`);
                    });
                  }
                } else {
                  onChunk('页面内容提取完成，但未能生成总结。\n');
                }
              } else {
                onChunk('页面内容较短，无需总结。\n');
              }
            }
          } catch (summaryError) {
            logger.warn('Failed to generate AI summary', { error: summaryError });
            onChunk('页面内容总结生成失败。\n');
          }
        }
      }
    } else {
      onChunk(`\n❌ 任务执行失败: ${executionResult.error || '未知错误'}\n`);
    }
    
  } catch (error: any) {
    logger.error('Failed to process streaming request:', error);
    onChunk(`\n处理请求时发生错误: ${error.message}\n`);
  }
}

/**
 * 估算token数量（简单实现）
 */
function estimateTokens(text: string): number {
  // 简单的token估算：大约4个字符=1个token
  return Math.ceil(text.length / 4);
}

/**
 * 生成请求ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export { router as chatRouter };
export default router;
