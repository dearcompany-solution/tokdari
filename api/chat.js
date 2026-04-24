const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

// 링크 접근 가능 여부 체크
async function isLinkAccessible(url){
  try{
    const resp=await fetch(url,{
      method:'HEAD',
      timeout:3000,
      headers:{'User-Agent':'Mozilla/5.0 (compatible; Googlebot/2.1)'}
    });
    // 200~299, 301, 302는 접근 가능
    return resp.status<400;
  }catch(e){return false;}
}

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
    const noSearchNeeded = !isExpertMode && /힘들어|피곤|슬퍼|기뻐|화나|보고싶|사랑|ㅋㅋ|ㅠㅠ|밥|잠|자야|놀자|심심|날씨|기온|온도|습도|비와|눈와|춥|덥/.test(lastUserMsg);
    const needsSearch = isExpertMode || (
      !noSearchNeeded &&
      lastUserMsg.length > 10 &&
      /뭐야|뭔데|어때|알아|맞아|언제|어디|누구|얼마|몇|어떻게|왜|뉴스|최신|요즘|트렌드|연예|스포츠|주가|날씨|정보|알려줘|찾아봐|검색/.test(lastUserMsg)
    );
    const needsImage = /사진|이미지|그림|보여줘|어떻게생겼|어떻게 생겼/.test(lastUserMsg);
    const searchCount = isExpertMode ? 5 : 3;

    // 페이월/접근불가 도메인 차단 목록
    const BLOCKED = [
      'chosun.com','joongang.co.kr','donga.com','hani.co.kr','kmib.co.kr',
      'munhwa.com','segye.com','sedaily.com','hankyung.com','mk.co.kr',
      'economist.com','wsj.com','ft.com','nytimes.com','bloomberg.com',
      'thetimes.co.uk','telegraph.co.uk','joins.com','heraldcorp.com',
      'biz.chosun.com','news.chosun.com'
    ];

    // 안정적으로 접근 가능한 사이트 우선순위
    const PREFERRED = [
      'yna.co.kr','yonhapnews.co.kr','kbs.co.kr','mbc.co.kr','sbs.co.kr',
      'jtbc.co.kr','ytn.co.kr','newsis.com','news1.kr','ohmynews.com',
      'wikipedia.org','namu.wiki','github.com','stackoverflow.com',
      'youtube.com','reddit.com','naver.com','daum.net'
    ];

    let searchContext = '';
    let imageContext = '';

    // 웹 검색
    if (needsSearch && process.env.BRAVE_API_KEY) {
      try {
        const searchResp = await fetch(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(lastUserMsg)}&count=10&search_lang=ko&country=KR`,
          { headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': process.env.BRAVE_API_KEY } }
        );
        const searchData = await searchResp.json();
        const rawResults = searchData.web?.results || [];

        // 1차: 차단 도메인 필터링
        const filtered = rawResults.filter(r => {
          if(!r.url || !r.url.startsWith('http')) return false;
          return !BLOCKED.some(b => r.url.includes(b));
        });

        // 2차: 우선 사이트 정렬
        const sorted = [
          ...filtered.filter(r => PREFERRED.some(p => r.url.includes(p))),
          ...filtered.filter(r => !PREFERRED.some(p => r.url.includes(p)))
        ];

        // 3차: 실제 링크 접근 가능 여부 병렬 체크 (상위 6개만)
        const candidates = sorted.slice(0, 6);
        const accessChecks = await Promise.all(
          candidates.map(async r => {
            const ok = await isLinkAccessible(r.url);
            return ok ? r : null;
          })
        );

        const validResults = accessChecks
          .filter(Boolean)
          .slice(0, searchCount);

        if(validResults.length > 0){
          const results = validResults
            .map(r => `제목: ${r.title}\n설명: ${r.description||''}\nURL: ${r.url}`)
            .join('\n\n');
          searchContext = `\n\n[실시간 검색 결과 - 아래는 실제 접근 가능한 링크만 골라서 줬어. URL 절대 변형하지 말고 그대로 전달해]\n${results}\n\n주의: 링크가 없거나 불확실하면 "링크를 못 찾겠어" 라고 솔직하게 말해.`;
        } else {
          // 유효한 링크가 하나도 없으면 검색 결과 없다고 표시
          searchContext = `\n\n[검색 결과 없음: 접근 가능한 링크를 찾지 못했어. 링크 없이 알고 있는 정보로만 답해줘.]`;
        }
      } catch(e) {
        searchContext = `\n\n[검색 오류: 검색을 못했어. 알고 있는 정보로만 답해줘.]`;
      }
    }

    // 이미지 검색
    if (needsImage && process.env.BRAVE_API_KEY) {
      try {
        const imgResp = await fetch(
          `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(lastUserMsg)}&count=5`,
          { headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': process.env.BRAVE_API_KEY } }
        );
        const imgData = await imgResp.json();

        // 이미지도 접근 가능 여부 체크
        const imgCandidates = imgData.results?.slice(0,5).filter(r=>r.url&&r.url.startsWith('http'))||[];
        const imgChecks = await Promise.all(
          imgCandidates.map(async r=>{
            const ok=await isLinkAccessible(r.url);
            return ok?r:null;
          })
        );
        const validImgs = imgChecks.filter(Boolean).slice(0,3);

        if(validImgs.length>0){
          const imgs = validImgs.map(r=>`이미지: ${r.url}`).join('\n');
          imageContext = `\n\n[이미지 검색 결과 - 접근 가능한 이미지만]\n${imgs}\n위 이미지 URL 그대로 전달해줘.`;
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
