// api/auth.js
const { createClient } = require('@supabase/supabase-js');

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

      const { data: profile, error: profileErr } = await sb.from('profiles')
        .select('*')
        .eq('auth_id', data.user.id)
        .single();

      if (profileErr || !profile) {
        return res.status(404).json({ error: '프로필을 찾을 수 없어! 관리자에게 문의해줘', detail: profileErr?.message });
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

  // ── 비밀번호 찾기 (로그아웃 상태) ──
  if (action === 'resetPassword') {
    if (!email || !password) return res.status(400).json({ error: '이메일과 비밀번호를 입력해줘' });
    try {
      const { data: profiles, error: profileErr } = await sb.from('profiles')
        .select('auth_id')
        .eq('email', email);
      const profile = profiles?.[0];
      if (profileErr) return res.status(500).json({ error: '조회 오류: ' + profileErr.message });
      if (!profile?.auth_id) return res.status(404).json({ error: '가입된 이메일이 아니야', debug: profiles });

      const { error: updateErr } = await sb.auth.admin.updateUserById(profile.auth_id, { password });
      if (updateErr) return res.status(500).json({ error: '비밀번호 변경 실패: ' + updateErr.message });

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
      // profiles.id(PK) 또는 auth_id 둘 다 시도
      const { data: profile, error: profileErr } = await sb.from('profiles')
        .select('email, auth_id')
        .or(`id.eq.${authId},auth_id.eq.${authId}`)
        .maybeSingle();
      if (profileErr || !profile) return res.status(404).json({ error: '유저를 찾을 수 없어' });

      // 현재 비밀번호 검증
      const { error: signInErr } = await sb.auth.signInWithPassword({
        email: profile.email,
        password: currentPassword
      });
      if (signInErr) return res.status(401).json({ error: '현재 비밀번호가 틀렸어!' });

      // 새 비밀번호로 변경 — profiles.auth_id 사용
      const realAuthId = profile.auth_id || authId;
      const { error: updateErr } = await sb.auth.admin.updateUserById(realAuthId, { password: newPassword });
      if (updateErr) return res.status(500).json({ error: '비밀번호 변경 실패: ' + updateErr.message });

      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(400).json({ error: '잘못된 요청' });
};
