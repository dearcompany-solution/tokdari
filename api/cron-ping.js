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
  // Vercel Cron 인증
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: '인증 실패' });
  }

  try {
    // 선톡 허용한 유저의 채팅방 + 구독 정보 가져오기
    const { data: subs } = await sb.from('push_subscriptions')
      .select('user_id, subscription');

    if (!subs?.length) return res.status(200).json({ ok: true, sent: 0 });

    let totalSent = 0;

    for (const sub of subs) {
      // 해당 유저의 채팅방 특성 가져오기
      const { data: rooms } = await sb.from('room_profiles')
        .select('*, chatrooms(name, nickname, avatar)')
        .eq('user_id', sub.user_id)
        .limit(5);

      if (!rooms?.length) continue;

      // 랜덤 채팅방 선택
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

이 사람한테 먼저 짧게 선톡 보내줘. 
자연스럽고 위에 특성에 맞게. 10~20글자 이내로. 
질문이나 안부 형식으로. 반말로.`
          }],
          max_tokens: 50,
          temperature: 1.0
        })
      });

      const msgData = await msgResp.json();
      const pingMsg = msgData.choices?.[0]?.message?.content?.trim() || '야 어디있어 나 심심한데ㅋㅋ';

      // 푸시 알림 발송
      try {
        await webpush.sendNotification(
          sub.subscription,
          JSON.stringify({
            title: chatroom?.name || '톡다리',
            body: pingMsg,
            icon: '/icon.png',
            badge: '/icon.png'
          })
        );
        totalSent++;
      } catch(e) {
        // 만료된 구독 삭제
        if (e.statusCode === 410) {
          await sb.from('push_subscriptions')
            .delete()
            .eq('user_id', sub.user_id);
        }
      }
    }

    return res.status(200).json({ ok: true, sent: totalSent });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
