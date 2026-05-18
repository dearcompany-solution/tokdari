// api/auth.js
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);
 
module.exports = async function handler(req, res) {
  const allowedOrigins=['https://tokdari.vercel.app','http://localhost:3000'];
  const origin=req.headers.origin||'';
  if(allowedOrigins.includes(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { action, email, password, name, username } = req.body;

  // ── 회원가입 ──
  if (action === 'signup') {
    try {
      const { data: authData, error: authErr } = await sb.auth.admin.createUser({
        email,
        password,
        email_confirm: true
      });
      if (authErr) return res.status(400).json({ error: authErr.message });

      const { error: profileErr } = await sb.from('profiles').insert({
        auth_id: authData.user.id,
        username: username || email.split('@')[0],
        name,
        email,
        friend_name: '',
        friend_nickname: '',
        avatar: '',
        talk_style: '',
        roles: []
      });

      if (profileErr) {
        await sb.auth.admin.deleteUser(authData.user.id);
        return res.status(400).json({ error: profileErr.message });
      }

      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 로그인 ──
  if (action === 'login') {
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) return res.status(401).json({ error: '이메일 또는 비밀번호가 틀렸어!' });

      const { data: profiles, error: profileErr } = await sb.from('profiles')
        .select('*')
        .eq('auth_id', data.user.id);
console.log('profiles count:', profiles?.length, 'profileErr:', profileErr?.message);
      console.log('auth_id:', data.user.id);
      console.log('profiles:', JSON.stringify(profiles));
      console.log('profileErr:', profileErr?.message);

      const profile = profiles?.[0];
      if (profileErr || !profile) {
        return res.status(404).json({ error: '프로필을 찾을 수 없어!', detail: profileErr?.message, auth_id: data.user.id });
      }

      return res.status(200).json({
        ok: true,
        token: data.session.access_token,
        profile
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 비밀번호 찾기: 인증 코드 발송 ──
  if (action === 'sendResetCode') {
    if (!email) return res.status(400).json({ error: '이메일을 입력해줘' });
    try {
      const { data: profiles, error: profileErr } = await sb.from('profiles')
        .select('auth_id, name')
        .eq('email', email);
      const profile = profiles?.[0];
      if (profileErr || !profile?.auth_id) return res.status(404).json({ error: '가입된 이메일이 아니야' });

      // 6자리 인증 코드 생성
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10분 유효

      // profiles에 인증 코드 임시 저장
      await sb.from('profiles').update({
        reset_code: code,
        reset_code_expires: expiresAt
      }).eq('auth_id', profile.auth_id);

      // Supabase 내장 이메일로 인증 코드 발송
      const { error: inviteErr } = await sb.auth.admin.generateLink({
        type: 'magiclink',
        email: email,
      });
      // magiclink와 별개로 직접 이메일 발송 (Supabase Edge Function 또는 간단한 방식)
      // 여기서는 profiles에 코드를 저장하고, 유저에게 코드를 알려주는 방식 사용
      // 실제 이메일 발송은 아래 fetch로 처리

      try {
        await fetch('https://api.emailjs.com/api/v1.0/email/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            service_id: process.env.EMAILJS_SERVICE_ID || '',
            template_id: process.env.EMAILJS_TEMPLATE_ID || '',
            user_id: process.env.EMAILJS_PUBLIC_KEY || '',
            template_params: {
              to_email: email,
              to_name: profile.name || '회원',
              reset_code: code
            }
          })
        });
      } catch(emailErr) {
        console.error('이메일 발송 실패:', emailErr);
      }

      return res.status(200).json({ success: true, message: '인증 코드를 이메일로 보냈어!' });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 비밀번호 찾기: 인증 코드 확인 ──
  if (action === 'verifyResetCode') {
    if (!email || !req.body.code) return res.status(400).json({ error: '이메일과 인증 코드를 입력해줘' });
    try {
      const { data: profiles } = await sb.from('profiles')
        .select('reset_code, reset_code_expires')
        .eq('email', email);
      const profile = profiles?.[0];
      if (!profile) return res.status(404).json({ error: '유저를 찾을 수 없어' });
      if (profile.reset_code !== req.body.code) return res.status(401).json({ error: '인증 코드가 틀렸어!' });
      if (new Date() > new Date(profile.reset_code_expires)) return res.status(401).json({ error: '인증 코드가 만료됐어. 다시 요청해줘!' });

      return res.status(200).json({ success: true, verified: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 비밀번호 찾기: 새 비밀번호 설정 ──
  if (action === 'resetPassword') {
    if (!email || !password || !req.body.code) return res.status(400).json({ error: '모든 항목을 입력해줘' });
    try {
      const { data: profiles } = await sb.from('profiles')
        .select('auth_id, reset_code, reset_code_expires')
        .eq('email', email);
      const profile = profiles?.[0];
      if (!profile?.auth_id) return res.status(404).json({ error: '가입된 이메일이 아니야' });
      if (profile.reset_code !== req.body.code) return res.status(401).json({ error: '인증 코드가 틀렸어!' });
      if (new Date() > new Date(profile.reset_code_expires)) return res.status(401).json({ error: '인증 코드가 만료됐어' });

      const { error: updateErr } = await sb.auth.admin.updateUserById(profile.auth_id, { password });
      if (updateErr) return res.status(500).json({ error: '비밀번호 변경 실패: ' + updateErr.message });

      // 인증 코드 삭제
      await sb.from('profiles').update({ reset_code: null, reset_code_expires: null }).eq('auth_id', profile.auth_id);

      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 비밀번호 변경 (로그인 상태) ──
  if (action === 'changePassword') {
    const { authId, currentPassword, newPassword } = req.body;
    if (!authId || !currentPassword || !newPassword) {
      return res.status(400).json({ error: '모든 항목을 입력해줘' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: '새 비밀번호는 6자리 이상이어야 해' });
    }
    try {
      let profile = null;
      const { data: p1 } = await sb.from('profiles')
        .select('email, auth_id')
        .eq('id', authId)
        .maybeSingle();
      if (p1) {
        profile = p1;
      } else {
        const { data: p2 } = await sb.from('profiles')
          .select('email, auth_id')
          .eq('auth_id', authId)
          .maybeSingle();
        if (p2) profile = p2;
      }
      if (!profile) return res.status(404).json({ error: '유저를 찾을 수 없어' });

      const { error: signInErr } = await sb.auth.signInWithPassword({
        email: profile.email,
        password: currentPassword
      });
      if (signInErr) return res.status(401).json({ error: '현재 비밀번호가 틀렸어!' });

      const realAuthId = profile.auth_id || authId;
      const { error: updateErr } = await sb.auth.admin.updateUserById(realAuthId, { password: newPassword });
      if (updateErr) return res.status(500).json({ error: '비밀번호 변경 실패: ' + updateErr.message });

      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 회원 탈퇴 ──
  if (action === 'deleteAccount') {
    const { authId } = req.body;
    if (!authId) return res.status(400).json({ error: '인증 정보가 없어' });
    try {
      const { data: profile } = await sb.from('profiles')
        .select('id, auth_id')
        .or(`id.eq.${authId},auth_id.eq.${authId}`)
        .maybeSingle();
      if (!profile) return res.status(404).json({ error: '유저를 찾을 수 없어' });
      const userId = profile.id;
      const realAuthId = profile.auth_id || authId;

      await sb.from('messages').delete().eq('user_id', userId);
      await sb.from('diary').delete().eq('user_id', userId);
      await sb.from('schedules').delete().eq('user_id', userId);
      await sb.from('user_characters').delete().eq('user_id', userId);
      await sb.from('profiles').delete().eq('id', userId);
      await sb.auth.admin.deleteUser(realAuthId);

      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 친밀도 저장 (앱 종료 시) ──
  if (action === 'saveBond') {
    const { userId, bondData } = req.body;
    if (!userId || !bondData) return res.status(400).json({ error: '데이터 없음' });
    try {
      const parsed = typeof bondData === 'string' ? JSON.parse(bondData) : bondData;
      await sb.from('user_characters').update({
        bond: parsed.bond,
        total_msgs: parsed.total_msgs,
        chat_days: parsed.chat_days,
        personality_data: parsed.personality_data,
        updated_at: parsed.updated_at || new Date().toISOString()
      }).eq('user_id', userId);
      return res.status(200).json({ ok: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: '잘못된 요청' });
};
