// Reads a photographed paper scorecard with Claude vision and returns structured scores.
// The image is processed in memory only — it is not stored.
//
// Secrets (supabase secrets set ...):
//   ANTHROPIC_API_KEY   required
//   SCAN_MODEL          optional, defaults to claude-opus-5-5
//   SCAN_MONTHLY_LIMIT  optional, free scans per user per month (default 10)

import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';

import { corsHeaders, json, userClient } from '../_shared/http.ts';

const MODEL = Deno.env.get('SCAN_MODEL') ?? 'claude-opus-5-5';
const MONTHLY_LIMIT = Number(Deno.env.get('SCAN_MONTHLY_LIMIT') ?? '10');
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const nullableInt = { type: ['integer', 'null'] };
const holeArray = { type: 'array', items: nullableInt };

// Structured output schema: the response is guaranteed to match this shape.
const SCAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['course_name', 'played_on', 'holes_count', 'notation', 'pars', 'players', 'confidence'],
  properties: {
    course_name: { type: ['string', 'null'] },
    played_on: { type: ['string', 'null'], description: 'YYYY-MM-DD if a date is written on the card' },
    holes_count: { type: 'integer', enum: [9, 18] },
    notation: {
      type: 'string',
      enum: ['strokes', 'to_par'],
      description: 'strokes = absolute strokes per hole; to_par = written relative to par (0, +1, -1, circles)',
    },
    pars: holeArray,
    players: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'scores', 'putts'],
        properties: {
          name: { type: ['string', 'null'] },
          scores: holeArray,
          putts: holeArray,
        },
      },
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

const PROMPT = `This is a photo of a golf scorecard filled in by hand.
Extract it exactly as written:
- pars: the par row, hole 1 first. null for a hole you cannot read.
- players: one entry per player row that has handwritten scores, in the order they appear. Use the written name if any.
- scores: one value per hole, in the card's own notation. If the card is written relative to par (0, +1, -1, or symbols such as a circle for birdie / square for bogey), set notation to "to_par" and give the relative numbers; otherwise give absolute strokes.
- putts: only if a putts row is written for that player, else all null.
- Use null for any cell that is blank or unreadable. Never guess a number you cannot see.
- holes_count: 9 if only one nine is filled in, else 18. Arrays must have exactly holes_count entries.
- confidence: low if the image is blurry, cropped, or not a scorecard.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await userClient(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: { imageBase64?: string; mediaType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const { imageBase64, mediaType } = body;
  if (!imageBase64 || !MEDIA_TYPES.includes(mediaType as MediaType)) return json({ error: 'invalid_image' }, 400);
  if ((imageBase64.length * 3) / 4 > MAX_IMAGE_BYTES) return json({ error: 'image_too_large' }, 413);

  // Charge the quota before calling the model so concurrent requests can't exceed it.
  const { data: remaining, error: quotaError } = await caller.client.rpc('consume_scan_quota', { p_limit: MONTHLY_LIMIT });
  if (quotaError) return json({ error: 'quota_check_failed' }, 500);
  if (remaining === -1) return json({ error: 'quota_exceeded', limit: MONTHLY_LIMIT }, 429);

  const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // On a safety-classifier decline the API retries on Anthropic's recommended fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: SCAN_SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType as MediaType, data: imageBase64 } },
            { type: 'text', text: PROMPT },
          ],
        },
      ],
    });

    if (response.stop_reason === 'refusal') return json({ error: 'unreadable' }, 422);
    if (response.stop_reason === 'max_tokens') return json({ error: 'truncated' }, 502);

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return json({ error: 'empty_response' }, 502);
    return json({ result: JSON.parse(text.text), remaining });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json({ error: 'busy' }, 503);
    if (err instanceof Anthropic.APIError) return json({ error: 'model_error', status: err.status }, 502);
    return json({ error: 'internal' }, 500);
  }
});
