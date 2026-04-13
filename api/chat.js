const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 필요' });
  }

  try {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const systemMsg = messages.find(m => m.role === 'system')?.content || '';

    const isExpertMode = /척척박사|뉴스박사|건강박사|경제박사/.test(systemMsg);
    const noSearchNeeded = !isExpertMode && /힘들어|피곤|슬퍼|기뻐|화나|보고싶|사랑|ㅋㅋ|ㅠㅠ|밥|잠|자야|놀자|심심/.test(lastUserMsg);
    const needsSearch = isExpertMode || (
      !noSearchNeeded &&
      lastUserMsg.length > 10 &&
      /뭐야|뭔데|어때|알아|맞아|언제|어디|누구|얼마|몇|어떻게|왜|뉴스|최신|요즘|트렌드|연예|스포츠|주가|날씨|정보|알려줘|찾아봐|검색/.test(lastUserMsg)
    );
    const needsImage = /사진|이미지|그림|보여줘|어떻게생겼|어떻게 생겼/.test(lastUserMsg);
    const searchCount = isExpertMode ? 5 : 3;

    let searchContext = '';
    let imageContext = '';

    // 웹 검색
    if (needsSearch && process.env.BRAVE_API_KEY) {
      try {
        const searchResp = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(lastUserMsg)}&count=${searchCount}&search_lang=ko&country=KR`,
          { headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': process.env.BRAVE_API_KEY } }
        );
        const searchData = await searchResp.json();
        const rawResults = searchData.web?.results?.slice(0, searchCount) || [];
        const results = rawResults
          .filter(r => r.url && r.url.startsWith('http'))
          .map(r => `제목: ${r.title}\n설명: ${r.description}\nURL: ${r.url}`)
          .join('\n\n') || '';
        if (results) {
          searchContext = `\n\n[실시간 검색 결과 - 아래 URL은 실제 링크야. 그대로 복사해서 전달해]\n${results}\n\n규칙: URL 절대 변형하지 말고 그대로 전달해.`;
        }
      } catch(e) {}
    }

    // 이미지 검색
    if (needsImage && process.env.BRAVE_API_KEY) {
      try {
        const imgResp = await fetch(
          `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(lastUserMsg)}&count=3`,
          { headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': process.env.BRAVE_API_KEY } }
        );
        const imgData = await imgResp.json();
        const imgs = imgData.results?.slice(0, 3)
          .filter(r => r.url && r.url.startsWith('http'))
          .map(r => `이미지: ${r.url}`)
          .join('\n') || '';
        if (imgs) imageContext = `\n\n[이미지 검색 결과]\n${imgs}\n위 이미지 URL 그대로 전달해줘.`;
      } catch(e) {}
    }

    const messagesWithSearch = messages.map(m => {
      if (m.role === 'system' && (searchContext || imageContext)) {
        return { ...m, content: m.content + searchContext + imageContext };
      }
      return m;
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: messagesWithSearch,
        max_tokens: 600,
        temperature: 1.1,
        presence_penalty: 0.6,
        frequency_penalty: 0.3
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || '오류' });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
