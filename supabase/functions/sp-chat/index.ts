// Optional LLM fallback for the SafePath chatbot.
// Deploy:  supabase functions deploy sp-chat
//          supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
// The key stays server-side; the browser only calls this function.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
};
const SYSTEM = `You are SafePath's assistant for travel in Mumbai, India (walking, driving, taxi/auto/cab,
BEST bus, metro, local trains) and personal safety while travelling.
Rules: be concise (under 150 words). Never invent exact fares, timings or crime statistics — give rough
ranges and say to verify in M-Indicator / Mumbai1 / Chalo apps. For safety, give practical, non-alarmist tips
(women's compartments, well-lit routes, sharing trip status). For emergencies mention 112, 1091 (women), 139 (railways)
and the app's SOS button. Politely decline topics unrelated to Mumbai travel or safety.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { message, history = [], hour } = await req.json();
    const msgs = [...history.slice(-6), { role: 'user', content: String(message).slice(0, 500) }];
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY')!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 500, system: `${SYSTEM}\nUser's local hour: ${hour}.`, messages: msgs }),
    });
    const d = await r.json();
    const reply = d.content?.map((c: { text?: string }) => c.text ?? '').join('') ?? '';
    return new Response(JSON.stringify({ reply }), { headers: { ...cors, 'content-type': 'application/json' } });
  } catch (_e) {
    return new Response(JSON.stringify({ reply: null }), { status: 500, headers: cors });
  }
});
