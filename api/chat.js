const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));

// 링크 접근 가능 여부 체크 — GET으로 변경 (HEAD 막는 사이트 대응)
async function isLinkAccessible(url){
  try{
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),2000);
    const resp=await fetch(url,{
      method:'GET',
      signal:controller.signal,
      headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
    });
    clearTimeout(timer);
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
    const today = new Date().toISOString().slice(0,10);

    const isExpertMode = /척척박사|뉴스박사|건강박사|경제박사/.test(systemMsg);
    const noSearchNeeded = !isExpertMode && /힘들어|피곤|슬퍼|기뻐|화나|보고싶|사랑|ㅋㅋ|ㅠㅠ|밥|잠|자야|놀자|심심/.test(lastUserMsg);
    const needsSearch = isExpertMode || (
      !noSearchNeeded &&
      lastUserMsg.length > 5 &&
      /뭐야|뭔데|어때|알아|맞아|언제|어디|누구|얼마|몇|어떻게|왜|뉴스|최신|요즘|트렌드|연예|스포츠|주가|날씨|정보|알려줘|찾아봐|검색|모르|궁금|알고싶|뭐지|뭐임|어디야|누구야|맞아|사실|진짜/.test(lastUserMsg)
    );
    const needsImage = /사진|이미지|그림|보여줘|어떻게생겼|어떻게 생겼/.test(lastUserMsg);
    const isNewsSearch = /뉴스|최신|요즘|최근|오늘|어제|이번주/.test(lastUserMsg);
    const searchCount = isExpertMode ? 5 : 3;

    const BLOCKED = [
      'chosun.com','joongang.co.kr','donga.com','hani.co.kr','kmib.co.kr',
      'munhwa.com','segye.com','sedaily.com','hankyung.com','mk.co.kr',
      'economist.com','wsj.com','ft.com','nytimes.com','bloomberg.com',
      'thetimes.co.uk','telegraph.co.uk','joins.com','heraldcorp.com',
      'biz.chosun.com','news.chosun.com'
    ];

    const PREFERRED = [
      'yna.co.kr','yonhapnews.co.kr','kbs.co.kr','mbc.co.kr','sbs.co.kr',
      'jtbc.co.kr','ytn.co.kr','newsis.com','news1.kr','ohmynews.com',
      'naver.com','daum.net','wikipedia.org','namu.wiki'
    ];

    // 검색 실행 함수 — 쿼리 바꿔서 재시도 가능
    async function doSearch(query, freshness=''){
      const freshnessParam = freshness ? `&freshness=${freshness}` : '';
      const resp = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&search_lang=ko&country=KR${freshnessParam}`,
        { headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip',
          'X-Subscription-Token': process.env.BRAVE_API_KEY
        }}
      );
      const data = await resp.json();
      return data.web?.results || [];
    }

    let searchContext = '';
    let imageContext = '';

    if (needsSearch && process.env.BRAVE_API_KEY) {
      try {
        // 뉴스면 최신 1주일 우선, 아니면 전체
        let rawResults = await doSearch(lastUserMsg, isNewsSearch ? 'pw' : '');

        // 결과 없거나 너무 적으면 — 쿼리 단순화해서 재검색
        if(rawResults.length < 3){
          const simpleQuery = lastUserMsg.replace(/[?!~ㅋㅋㅎㅎㅠㅠ]/g,'').trim().split(' ').slice(0,4).join(' ');
          rawResults = await doSearch(simpleQuery, '');
        }

        // 1차: 차단 도메인 필터
        const filtered = rawResults.filter(r => {
          if(!r.url || !r.url.startsWith('http')) return false;
          return !BLOCKED.some(b => r.url.includes(b));
        });

        // 2차: 우선 사이트 정렬
        const sorted = [
          ...filtered.filter(r => PREFERRED.some(p => r.url.includes(p))),
          ...filtered.filter(r => !PREFERRED.some(p => r.url.includes(p)))
        ];

        // 3차: 상위 8개 병렬 접근 체크
        const candidates = sorted.slice(0, 8);
        const accessChecks = await Promise.all(
          candidates.map(async r => {
            const ok = await isLinkAccessible(r.url);
            return ok ? r : null;
          })
        );

        const validResults = accessChecks.filter(Boolean).slice(0, searchCount);

        if(validResults.length > 0){
          const results = validResults
            .map((r,i) => `[${i+1}] 제목: ${r.title}\n내용: ${r.description||'(설명 없음)'}\nURL: ${r.url}${r.age?'\n날짜: '+r.age:''}`)
            .join('\n\n');
          searchContext = `\n\n====실시간검색결과(${today})=====\n${results}\n====여기까지====\n\n[규칙]\n1. 위 내용 기반으로만 답해. 학습 데이터로 추측 금지\n2. URL 그대로 줘 (접근 확인된 링크)\n3. 날짜 있으면 같이 알려줘\n4. 반말로 짧게 핵심만`;
        } else {
          // 살아있는 링크 없어도 내용은 전달 — URL만 빼고
          const fallback = sorted.slice(0, searchCount);
          if(fallback.length > 0){
            const results = fallback
              .map((r,i) => `[${i+1}] 제목: ${r.title}\n내용: ${r.description||'(설명 없음)'}${r.age?'\n날짜: '+r.age:''}`)
              .join('\n\n');
            searchContext = `\n\n====실시간검색결과(${today})=====\n${results}\n====여기까지====\n\n[주의] 링크가 불안정해. URL은 주지 말고 내용만 요약해. 출처(KBS, 연합뉴스 등)는 언급해도 돼.`;
          } else {
            // 검색 결과 아예 없으면 — 다시 검색 시도 (영어로)
            const engQuery = lastUserMsg.replace(/[가-힣]/g,'').trim();
            if(engQuery.length > 2){
              const engResults = await doSearch(engQuery);
              if(engResults.length > 0){
                const results = engResults.slice(0,3)
                  .map((r,i) => `[${i+1}] ${r.title}: ${r.description||''}`)
                  .join('\n');
                searchContext = `\n\n[검색 결과 - 한국어 결과 없어서 영문 검색]\n${results}\n내용 번역해서 요약해줘.`;
              } else {
                searchContext = `\n\n[검색 결과 없음] 알고 있는 정보로 최대한 답하되 "정확하지 않을 수 있어"라고 말해. 모른다고만 하지 마.`;
              }
            } else {
              searchContext = `\n\n[검색 결과 없음] 알고 있는 정보로 최대한 답하되 "정확하지 않을 수 있어"라고 말해. 모른다고만 하지 마.`;
            }
          }
        }
      } catch(e) {
        searchContext = `\n\n[검색 실패] 알고 있는 정보로 최대한 답해. 절대 "모르겠어"로만 끝내지 마.`;
      }
    }

    // 이미지 검색
    if (needsImage && process.env.BRAVE_API_KEY) {
      try {
        const imgResp = await fetch(
          `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(lastUserMsg)}&count=5`,
          { headers: { 'Accept': 'application/json', 'Accept-Encoding': 'gzip', 'X-Subscription-Token': process.env.BRAVE_API_KEY }}
        );
        const imgData = await imgResp.json();
        const imgCandidates = imgData.results?.slice(0,5).filter(r=>r.url?.startsWith('http'))||[];
        const imgChecks = await Promise.all(
          imgCandidates.map(async r=>{
            const ok=await isLinkAccessible(r.url);
            return ok?r:null;
          })
        );
        const validImgs = imgChecks.filter(Boolean).slice(0,3);
        if(validImgs.length>0){
          imageContext = `\n\n[이미지 - 접근 확인됨]\n${validImgs.map(r=>`이미지: ${r.url}`).join('\n')}\nURL 그대로 전달해줘.`;
        }
      } catch(e){}
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
        max_tokens: 300,
        temperature: 0.85,
        presence_penalty: 0.5,
        frequency_penalty: 0.5
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      console.error('OpenAI 오류:', err.error?.message);
      return res.status(500).json({ error: '일시적인 오류가 생겼어. 다시 해봐!' });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
