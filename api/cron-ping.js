const webpush = require('web-push');

const { createClient } = require('@supabase/supabase-js');
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const webpush = require('web-push');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

webpush.setVapidDetails(
  process.env.VAPID_EMAIL,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: '인증 실패' });
  }

  try {
    const { data: subs } = await sb.from('push_subscriptions')
      .select('user_id, subscription');

    if (!subs?.length) return res.status(200).json({ ok: true, sent: 0 });

    let totalSent = 0;

    for (const sub of subs) {
      const { data: rooms } = await sb.from('room_profiles')
        .select('*, chatrooms(name, nickname, avatar)')
        .eq('user_id', sub.user_id)
        .limit(5);

      if (!rooms?.length) continue;

      const room = rooms[Math.floor(Math.random() * rooms.length)];
      const chatroom = room.chatrooms;

      // GPT로 맞춤 선톡 생성
      const msgResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{
            role: 'system',
            content: `너는 ${chatroom?.name || '친구'}야.
대화 특성: ${room.summary || '친한 친구'}
주로 나눈 주제: ${room.topics?.join(', ') || '일상'}
분위기: ${room.mood || '밝음'}
이 사람한테 먼저 짧게 선톡 보내줘. 10~20글자 이내. 반말로.`
          }],
          max_tokens: 50,
          temperature: 1.0
        })
      });

      const msgData = await msgResp.json();
      const pingMsg = msgData.choices?.[0]?.message?.content?.trim() || '야 어디있어 나 심심한데ㅋㅋ';

      // /api/notify 통해서 발송 (기존 notify.js 활용)
      try {
        await fetch(`https://tokdari.vercel.app/api/notify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: sub.user_id,
            title: chatroom?.name || '톡다리',
            body: pingMsg
          })
        });
        totalSent++;
      } catch(e) {}
    }

    return res.status(200).json({ ok: true, sent: totalSent });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
