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
      lastUserMsg.length > 8 &&
      /뭐야|뭔데|어때|알아|언제|어디|누구|얼마|몇|어떻게|왜|뉴스|최신|요즘|트렌드|연예|스포츠|주가|날씨|기온|온도|습도|비|눈|정보|알려줘|찾아봐|검색|개봉|출시|발표|순위|결과/.test(lastUserMsg)
    );
    const needsImage = /사진|이미지|그림|보여줘|어떻게생겼|어떻게 생겼/.test(lastUserMsg);
    const searchCount = isExpertMode ? 5 : 3;

    // 페이월 차단 도메인
    const BLOCKED = [
      'chosun.com','joongang.co.kr','donga.com','hani.co.kr','kmib.co.kr',
      'munhwa.com','segye.com','sedaily.com','hankyung.com','mk.co.kr',
      'economist.com','wsj.com','ft.com','nytimes.com','bloomberg.com',
      'thetimes.co.uk','telegraph.co.uk','joins.com','heraldcorp.com',
      'biz.chosun.com','news.chosun.com'
    ];

    // 신뢰도 높은 사이트 우선
    const PREFERRED = [
      'yna.co.kr','yonhapnews.co.kr','kbs.co.kr','mbc.co.kr','sbs.co.kr',
      'jtbc.co.kr','ytn.co.kr','newsis.com','news1.kr','ohmynews.com',
      'naver.com','daum.net','wikipedia.org','namu.wiki'
    ];

    let searchContext = '';
    let imageContext = '';

    // 웹 검색 (링크 접근 체크 제거 → 속도 개선)
    if (needsSearch && process.env.BRAVE_API_KEY) {
      try {
        const today = new Date().toISOString().slice(0, 10);
        const searchResp = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(lastUserMsg)}&count=10&search_lang=ko&country=KR&freshness=pw`,
          {
            headers: {
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip',
              'X-Subscription-Token': process.env.BRAVE_API_KEY
            }
          }
        );
        const searchData = await searchResp.json();
        const rawResults = searchData.web?.results || [];

        // 차단 도메인 필터
        const filtered = rawResults.filter(r => {
          if (!r.url || !r.url.startsWith('http')) return false;
          return !BLOCKED.some(b => r.url.includes(b));
        });

        // 우선 사이트 정렬
        const sorted = [
          ...filtered.filter(r => PREFERRED.some(p => r.url.includes(p))),
          ...filtered.filter(r => !PREFERRED.some(p => r.url.includes(p)))
        ].slice(0, searchCount);

        if (sorted.length > 0) {
          const results = sorted
            .map(r => `제목: ${r.title}\n설명: ${r.description || ''}\nURL: ${r.url}${r.age ? '\n날짜: ' + r.age : ''}`)
            .join('\n\n');
          searchContext = `\n\n[오늘(${today}) 기준 실시간 검색 결과]\n${results}\n\n★ 반드시 위 검색 결과 기반으로만 답해. URL은 절대 변형하지 마. 검색 결과에 없는 내용은 "확실하지 않아"라고 솔직하게 말해.`;
        } else {
          searchContext = `\n\n[검색 결과 없음: 알고 있는 정보로만 답하되, 최신 정보가 아닐 수 있다고 말해줘.]`;
        }
      } catch(e) {
        searchContext = `\n\n[검색 실패: 알고 있는 정보로만 답해줘.]`;
      }
    }

    // 이미지 검색
    if (needsImage && process.env.BRAVE_API_KEY) {
      try {
        const imgResp = await fetch(
          `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(lastUserMsg)}&count=3`,
          {
            headers: {
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip',
              'X-Subscription-Token': process.env.BRAVE_API_KEY
            }
          }
        );
        const imgData = await imgResp.json();
        const imgs = imgData.results?.slice(0, 3).filter(r => r.url?.startsWith('http')) || [];
        if (imgs.length > 0) {
          imageContext = `\n\n[이미지 검색 결과]\n${imgs.map(r => `이미지: ${r.url}`).join('\n')}\nURL 그대로 전달해줘.`;
        }
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: messagesWithSearch,
        max_tokens: 300,       // ✅ 600→300 (짧게 답하므로 충분, 속도 개선)
        temperature: 0.85,     // ✅ 1.1→0.85 (자연스럽고 일관되게)
        presence_penalty: 0.5,
        frequency_penalty: 0.5 // ✅ 반복 표현 줄임
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
