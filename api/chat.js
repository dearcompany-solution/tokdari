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
    // 마지막 유저 메시지에서 검색 필요 여부 판단
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    // 검색 불필요한 것 (감정/일상 대화)
const noSearchNeeded = /힘들어|피곤|슬퍼|기뻐|화나|보고싶|사랑|ㅋㅋ|ㅠㅠ|밥|잠|자야|놀자|심심/.test(lastUserMsg);

// 사실/정보 관련이면 검색
const needsSearch = !noSearchNeeded && (
  lastUserMsg.length > 10 && // 너무 짧은 건 검색 안 함
  /뭐야|뭔데|어때|알아|맞아|언제|어디|누구|얼마|몇|어떻게|왜|뉴스|최신|요즘|트렌드|요새|지금|현재|오늘|어제|이번주|연예|스포츠|주가|날씨|새로나온|신작|개봉|출시|정보|알려줘|찾아봐|검색/.test(lastUserMsg)
);

    let searchContext = '';
    if (needsSearch && process.env.BRAVE_API_KEY) {
      try {
        const searchResp = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(lastUserMsg)}&count=3&search_lang=ko&country=KR`,
          {
            headers: {
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip',
              'X-Subscription-Token': process.env.BRAVE_API_KEY
            }
          }
        );
        const searchData = await searchResp.json();
        const results = searchData.web?.results?.slice(0, 3)
          .map(r => `${r.title}: ${r.description}`)
          .join('\n') || '';
        if (results) {
          searchContext = `\n\n[실시간 검색 결과]\n${results}\n위 내용을 참고해서 자연스럽게 답해줘.`;
        }
      } catch(e) {
        // 검색 실패해도 계속 진행
      }
    }

    // 시스템 메시지에 검색 결과 추가
    const messagesWithSearch = messages.map((m, i) => {
      if (m.role === 'system' && searchContext) {
        return { ...m, content: m.content + searchContext };
      }
      return m;
    });

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: messagesWithSearch,
        max_tokens: 500,
        temperature: 0.9,
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
