/**
 * Provider-aware factory that returns an OpenAI-compatible client
 * All returned clients expose chat.completions.create(...)
 */

import { OpenAI } from 'openai';
import { createGeminiOpenAICompatClient } from './gemini-client';

export interface ClientFactoryOptions {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  organization?: string;
  project?: string;
}

/**
 * Create an OpenAI-compatible client based on provider.
 * - provider === 'google' -> Gemini OpenAI-compatible wrapper
 * - provider === 'deepseek' -> OpenAI SDK with DeepSeek baseURL default
 * - provider === 'modelscope' -> OpenAI SDK (requires baseUrl)
 * - provider === 'custom' -> OpenAI SDK (requires baseUrl)
 * - others/openai -> OpenAI SDK
 */
export function createOpenAICompatibleClient(provider: string, options: ClientFactoryOptions): any {
  if (!provider) throw new Error('AI provider is required');
  if (!options?.apiKey) throw new Error('AI apiKey is required');

  const p = provider.toLowerCase();

  if (p === 'google') {
    return createGeminiOpenAICompatClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl
    });
  }

  const clientConfig: any = {
    apiKey: options.apiKey,
    timeout: options.timeout
  };

  if (options.organization) clientConfig.organization = options.organization;
  if (options.project) clientConfig.project = options.project;

  switch (p) {
    case 'deepseek':
      clientConfig.baseURL = options.baseUrl || 'https://api.deepseek.com';
      break;
    case 'modelscope':
      if (!options.baseUrl) throw new Error('Provider "modelscope" requires baseUrl.');
      clientConfig.baseURL = options.baseUrl;
      break;
    case 'custom':
      if (!options.baseUrl) throw new Error('Provider "custom" requires baseUrl.');
      clientConfig.baseURL = options.baseUrl;
      break;
    case 'openai':
    default:
      if (options.baseUrl) clientConfig.baseURL = options.baseUrl;
      break;
  }

  return new OpenAI(clientConfig);
}