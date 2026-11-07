// Supabase Edge Function: hands Multiplayer short-lived TURN credentials from
// Cloudflare's TURN service, so two players whose networks block a direct
// connection can still connect through a relay. The Cloudflare key stays
// here, in the function's secrets; browsers only ever see logins that expire
// after a day. Setup: README, "Multiplayer relay (TURN)".
//
//   supabase secrets set CLOUDFLARE_TURN_KEY_ID=... CLOUDFLARE_TURN_KEY_API_TOKEN=...
//   supabase functions deploy turn-credentials
//
// Returns { iceServers: [...] } (an RTCPeerConnection iceServers list).

const KEY_ID = Deno.env.get('CLOUDFLARE_TURN_KEY_ID') ?? '';
const TOKEN = Deno.env.get('CLOUDFLARE_TURN_KEY_API_TOKEN') ?? '';
const TTL_S = 24 * 60 * 60;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

// One set of credentials is shared by everyone for an hour, so a busy room
// list doesn't ask Cloudflare once per player.
let cached: { body: string; until: number } | null = null;

function json(body: unknown, status = 200) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=600' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!KEY_ID || !TOKEN) return json({ error: 'TURN is not configured' }, 501);
  if (cached && cached.until > Date.now()) return json(cached.body);
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_S }),
  });
  if (!res.ok) return json({ error: `Cloudflare answered ${res.status}` }, 502);
  const data = await res.json();
  // Either { iceServers: [...] } or { iceServers: { urls, username, credential } }.
  const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
  const body = JSON.stringify({ iceServers: list.filter(Boolean) });
  cached = { body, until: Date.now() + 60 * 60 * 1000 };
  return json(body);
});
