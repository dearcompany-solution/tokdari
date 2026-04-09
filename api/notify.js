import webpush from 'web-push';

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, title, body } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId 필요' });

  const supabaseUrl = process.env.SUPABASE_URL || 'https://aeswnjssbaoqwicmgarb.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;

  try {
    // 해당 유저의 구독 정보 가져오기
    const resp = await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?user_id=eq.${userId}`, {
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    const subs = await resp.json();
    if (!subs.length) return res.status(200).json({ ok: true, sent: 0 });

    const payload = JSON.stringify({ title: title || '톡다리', body: body || '야 어디있어? 나 심심한데ㅋㅋ' });

    let sent = 0;
    for (const row of subs) {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent++;
      } catch(e) {
        // 만료된 구독이면 삭제
        if (e.statusCode === 410) {
          await fetch(`${supabaseUrl}/rest/v1/push_subscriptions?id=eq.${row.id}`, {
            method: 'DELETE',
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
          });
        }
      }
    }
    return res.status(200).json({ ok: true, sent });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
