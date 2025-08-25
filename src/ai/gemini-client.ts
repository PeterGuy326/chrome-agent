/**
 * Google Gemini client with an OpenAI-compatible surface (minimal subset)
 * This wrapper exposes chat.completions.create so it can be used by existing code
 */

export interface GoogleCompatClientOptions {
  apiKey: string;
  baseUrl?: string; // default: https://generativelanguage.googleapis.com/v1beta
}

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIChatCompletionsCreateParams {
  model: string;
  messages: OpenAIChatMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: { type: string };
}

// Minimal OpenAI-like response structure
interface OpenAIChatCompletionsResponseLike {
  id?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index?: number;
    message: { role: 'assistant'; content: string };
    finish_reason?: string;
  }>
}

export function createGeminiOpenAICompatClient(options: GoogleCompatClientOptions) {
  const base = (options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const apiKey = options.apiKey;

  async function generateContent(model: string, body: any) {
    const url = `${base}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    // Prefer global fetch (Node 18+). If unavailable, throw with guidance.
    if (typeof fetch !== 'function') {
      throw new Error('Global fetch is not available in this runtime. Please use Node.js v18+ or polyfill fetch.');
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google Gemini API error: ${res.status} ${res.statusText} - ${text}`);
    }

    return await res.json();
  }

  function mapOpenAIMessagesToGemini(messages: OpenAIChatMessage[]) {
    let systemInstruction: any | undefined = undefined;
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Gemini v1.5 supports systemInstruction separately
        systemInstruction = {
          role: 'system',
          parts: [{ text: msg.content }]
        };
        continue;
      }
      const role = msg.role === 'assistant' ? 'model' : 'user';
      contents.push({ role, parts: [{ text: msg.content }] });
    }

    return { systemInstruction, contents };
  }

  async function chatCompletionsCreate(params: OpenAIChatCompletionsCreateParams): Promise<OpenAIChatCompletionsResponseLike> {
    const { model, messages, temperature, max_tokens, top_p, response_format } = params;
    const { systemInstruction, contents } = mapOpenAIMessagesToGemini(messages);

    const generationConfig: any = {};
    if (typeof temperature === 'number') generationConfig.temperature = temperature;
    if (typeof max_tokens === 'number') generationConfig.maxOutputTokens = max_tokens;
    if (typeof top_p === 'number') generationConfig.topP = top_p;

    // If OpenAI response_format requests JSON, set Gemini response MIME type
    if (response_format && response_format.type === 'json_object') {
      generationConfig.response_mime_type = 'application/json';
    }

    const body: any = {
      contents,
      generationConfig
    };

    if (systemInstruction) body.systemInstruction = systemInstruction;

    const data = await generateContent(model, body);

    // Extract the first candidate text
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    return {
      id: 'gemini.generateContent',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop'
        }
      ]
    };
  }

  // Expose OpenAI-compatible surface
  return {
    chat: {
      completions: {
        create: chatCompletionsCreate
      }
    }
  };
}