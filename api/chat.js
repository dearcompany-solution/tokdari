

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

const rateLimitMap = new Map();

module.exports = async function handler(req, res) {
  const allowedOrigins=['https://tokdari.vercel.app','http://localhost:3000'];
  const origin=req.headers.origin||'';
  if(allowedOrigins.includes(origin))res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  // 입력값 길이 제한
  const bodyStr = JSON.stringify(req.body);
  if (bodyStr.length > 50000) {
    return res.status(400).json({ error: '메시지가 너무 길어!' });
  }

  // IP 기반 rate limiting — 1분에 15회
  const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 15;
  if (!rateLimitMap.has(ip)) rateLimitMap.set(ip, []);
  const timestamps = rateLimitMap.get(ip).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) {
    return res.status(429).json({ error: '너무 빠르게 보내고 있어! 잠깐만 기다려줘' });
  }
  timestamps.push(now);
  rateLimitMap.set(ip, timestamps);
  // 오래된 IP 정리 (메모리 누수 방지)
  if (rateLimitMap.size > 10000) {
    for (const [k, v] of rateLimitMap) {
      if (v.every(t => now - t > windowMs)) rateLimitMap.delete(k);
    }
  }

  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 필요' });
  }

  // 유해 콘텐츠 필터링
  const lastUserMsg2 = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const harmfulPatterns = /자살|자해|죽고싶|죽을래|목숨|극단적|칼로|약물.*과다|폭탄.*만들|총.*구매|마약.*구매|살인.*방법|해킹.*방법/;
  const adultPatterns = /성관계|야동|포르노|섹스|강간|몰카/;
  if(harmfulPatterns.test(lastUserMsg2)){
    return res.status(200).json({
      choices:[{message:{role:'assistant',content:'야 그런 얘기는 나한테 하면 안돼. 혹시 힘든 일 있으면 전문 상담 받아봐. 자살예방상담전화 1393, 정신건강위기상담전화 1577-0199 로 전화해봐. 24시간 상담 가능해.'}}]
    });
  }
  if(adultPatterns.test(lastUserMsg2)){
    return res.status(200).json({
      choices:[{message:{role:'assistant',content:'야 그런 얘기는 좀ㅋㅋ 다른 얘기 하자'}}]
    });
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
        // 검색 쿼리 최적화 — 불필요한 말투 제거
        const searchQuery = lastUserMsg
          .replace(/[?!~ㅋㅋㅎㅎㅠㅠㅜㅜ]/g,'')
          .replace(/뭐야|뭔데|알려줘|찾아봐|검색해줘|궁금해|알고싶어|뭐임/g,'')
          .replace(/요즘|최근|지금|올해/g,'2026년 5월')
          .trim() || lastUserMsg;
        // 검색어에 연도 없으면 추가
        const finalQuery = /\d{4}/.test(searchQuery) ? searchQuery : searchQuery + ' 2026';
        let rawResults = await doSearch(finalQuery, isNewsSearch ? 'pw' : 'pm');

        // 결과 없거나 너무 적으면 — 쿼리 단순화해서 재검색
        if(rawResults.length < 3){
          const simpleQuery = lastUserMsg.replace(/[?!~ㅋㅋㅎㅎㅠㅠ]/g,'').trim().split(' ').slice(0,4).join(' ') + ' 2026';
          rawResults = await doSearch(simpleQuery, 'pm');
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
            .map((r,i) => `${r.title}\n${r.description||''}\n${r.url}${r.age?'\n'+r.age:''}`)
            .join('\n\n');
          searchContext = `\n\n====검색결과====\n${results}\n====끝====\n\n[규칙]\n1. 위 내용 기반으로 자연스럽게 답해\n2. 링크 줄 때는 "여기서 볼 수 있어" "이거 참고해봐" 같이 자연스럽게 문장에 넣어\n3. 위에 없는 URL 절대 만들지 마\n4. "출처" "참고" 같은 딱딱한 표현 쓰지 마\n5. 반말로 짧게 친구처럼\n6. 검색결과 형식 그대로 보여주지 마. 네가 아는 것처럼 자연스럽게 말해`;
        } else {
            const fallback = sorted.slice(0, searchCount);
            if(fallback.length > 0){
              const results = fallback
                .map((r,i) => `${r.title}\n${r.description||''}${r.age?'\n'+r.age:''}`)
                .join('\n\n');
              searchContext = `\n\n====검색결과====\n${results}\n====끝====\n\n[규칙]\n1. 위 내용 기반으로 자연스럽게 답해\n2. 링크는 없으니까 URL 절대 주지 마. 네가 아는 URL도 쓰지 마\n3. 그냥 네가 아는 것처럼 자연스럽게 말해\n4. "출처" "참고" "검색결과" 같은 단어 쓰지 마\n5. 반말로 짧게 친구처럼`;
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
            const ok=await isLinkAccessible(r.properties?.url||r.url);
            return ok?{...r,directUrl:r.properties?.url||r.url}:null;
          })
        );
        const validImgs = imgChecks.filter(Boolean).slice(0,3);
        if(validImgs.length>0){
          imageContext = `\n\n[이미지]\n${validImgs.map(r=>`이미지: ${r.directUrl}\n출처: ${r.url}`).join('\n')}\n위 이미지 URL을 그대로 전달해. 없는 URL 지어내지 마.`;
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
        max_tokens: 500,
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
