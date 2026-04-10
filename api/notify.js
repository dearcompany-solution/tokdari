const { createClient } = require('@supabase/supabase-js');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { userId, title, body } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId 필요' });

  try {
    const { data: subs } = await sb.from('push_subscriptions')
      .select('*')
      .eq('user_id', userId);

    if (!subs?.length) return res.status(200).json({ ok: true, sent: 0 });

    // web-push를 dynamic import로 로드
    const webpushModule = await import('web-push');
    const webpush = webpushModule.default || webpushModule;

    webpush.setVapidDetails(
      process.env.VAPID_EMAIL,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    );

    let sent = 0;
    for (const row of subs) {
      try {
        await webpush.sendNotification(
          row.subscription,
          JSON.stringify({
            title: title || '톡다리',
            body: body || '야 어디있어?',
            icon: '/icon.png',
            badge: '/icon.png'
          })
        );
        sent++;
      } catch(e) {
        if (e.statusCode === 410) {
          await sb.from('push_subscriptions').delete().eq('id', row.id);
        }
      }
    }

    return res.status(200).json({ ok: true, sent });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
