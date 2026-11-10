import Anthropic from '@anthropic-ai/sdk';
import { aiFetch } from './http';
import { SYSTEM_PROMPT, userText, type SheetRequest } from './prompt';
import { ANALYSIS_SCHEMA, parseAnalysis, type SheetAnalysis } from './schema';
import type { AiSettings } from './settings';

/** Read a sheet with Claude. */
export async function analyzeWithClaude(settings: AiSettings, req: SheetRequest, signal: AbortSignal): Promise<SheetAnalysis> {
  // The key is the estimator's own, entered on their own computer, and the app has no server
  // to hide it behind, so calling the API directly from the app is the intended design.
  const client = new Anthropic({ apiKey: settings.anthropicKey, dangerouslyAllowBrowser: true, fetch: aiFetch, maxRetries: 1 });
  try {
    const response = await client.beta.messages.create(
      {
        model: settings.anthropicModel,
        max_tokens: 16000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
        // If a safety filter declines the request, let the API retry it on another model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: req.imageBase64 } },
              { type: 'text', text: userText(req) },
            ],
          },
        ],
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to read this sheet.');
    if (response.stop_reason === 'max_tokens') throw new Error('The sheet has more rooms than fit in one reply. Zoom in and run the agent on what is on screen.');
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') throw new Error('Claude returned no result.');
    return parseAnalysis(text.text);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Claude rejected the API key. Check it in AI settings.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new Error('This API key is not allowed to use that Claude model.');
    if (e instanceof Anthropic.NotFoundError) throw new Error(`Claude does not recognise the model "${settings.anthropicModel}".`);
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude is rate limiting this key. Wait a minute and try again.');
    if (e instanceof Anthropic.APIUserAbortError) throw new Error('Cancelled.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Could not reach Claude. Check the internet connection.');
    if (e instanceof Anthropic.APIError) throw new Error(`Claude returned an error (${e.status}): ${e.message}`);
    throw e;
  }
}
