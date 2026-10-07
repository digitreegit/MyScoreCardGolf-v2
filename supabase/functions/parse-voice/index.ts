// AI fallback for voice score entry: interprets a speech-recognizer transcript the on-device
// rule parser could not understand. Only the transcript text and the round's hole/par table are
// sent — no audio, no location. Opt-in per device (Settings), signed-in users only, monthly quota.
//
// Secrets: ANTHROPIC_API_KEY (required), VOICE_MODEL (default claude-haiku-5-5),
//          VOICE_MONTHLY_LIMIT (default 300)

import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';

import { corsHeaders, json, userClient } from '../_shared/http.ts';

const MODEL = Deno.env.get('VOICE_MODEL') ?? 'claude-haiku-5-5';
const MONTHLY_LIMIT = Number(Deno.env.get('VOICE_MONTHLY_LIMIT') ?? '300');

const nullableInt = { type: ['integer', 'null'] };
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['understood', 'hole', 'strokes', 'putts'],
  properties: {
    understood: { type: 'boolean', description: 'false if the transcript does not state a score or putts' },
    hole: { ...nullableInt, description: 'hole number only if the speaker named one, else null' },
    strokes: { ...nullableInt, description: 'absolute strokes on that hole; convert birdie/bogey/etc. using its par' },
    putts: nullableInt,
  },
};

const SYSTEM = `You convert a golfer's spoken score into structured data. The text comes from a speech recognizer and often mishears golf words; infer the most likely golf meaning by sound. Seen in testing: "party", "Brody", "birdy", "bertie" → birdie; "bogie", "boogie", "bogy" → bogey; "part", "Parr" → par; "pets", "puts", "parts" → putts; "or one", "all one", "whole one" → hole one; digits can run together ("on 31 part" = on hole 3, 1 putt). The speaker may use English or Korean golf terms (버디, 보기, 더블, 양파 = double par, 퍼트, 번 홀).
Rules:
- hole: only if a hole number was spoken; otherwise null (the app uses the currently selected hole).
- strokes: absolute strokes. Convert relative terms with the par of the hole the score is for (named hole, else the current hole): eagle -2, birdie -1, par 0, bogey +1, double +2, triple +3, double par = 2x par, hole in one = 1.
- putts: only if spoken.
- If nothing about strokes or putts can be inferred with reasonable confidence, set understood=false and the other fields null. Never invent numbers.`;

interface Body {
  transcript?: string;
  holes?: Array<{ hole_number: number; par: number }>;
  currentHole?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await userClient(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const transcript = body.transcript?.trim() ?? '';
  const holes = (body.holes ?? []).filter((h) => Number.isInteger(h.hole_number) && Number.isInteger(h.par)).slice(0, 36);
  if (!transcript || transcript.length > 300 || !holes.length) return json({ error: 'invalid_input' }, 400);

  const { data: remaining, error: quotaError } = await caller.client.rpc('consume_ai_quota', {
    p_feature: 'voice',
    p_limit: MONTHLY_LIMIT,
  });
  if (quotaError) return json({ error: 'quota_check_failed' }, 500);
  if (remaining === -1) return json({ error: 'quota_exceeded', limit: MONTHLY_LIMIT }, 429);

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });
  const parTable = holes.map((h) => `${h.hole_number}:${h.par}`).join(' ');

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: RESULT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Pars (hole:par): ${parTable}\nCurrent hole: ${body.currentHole ?? 'unknown'}\nTranscript: ${JSON.stringify(transcript)}`,
        },
      ],
    });

    if (response.stop_reason === 'refusal') return json({ result: { understood: false, hole: null, strokes: null, putts: null }, remaining });
    if (response.stop_reason === 'max_tokens') return json({ error: 'truncated' }, 502);
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json({ error: 'empty_response' }, 502);
    return json({ result: JSON.parse(text.text), remaining, model: response.model });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'busy' }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: 'model_error', status: err.status }, 502);
    return json({ error: 'internal' }, 500);
  }
});
