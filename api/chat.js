// api/chat.js
export default async function handler(req, res) {
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
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 500,
        temperature: 0.9,
        presence_penalty: 0.6,
        frequency_penalty: 0.3,
        // 웹서치 툴 연동
        tools: [{
          type: 'function',
          function: {
            name: 'search_web',
            description: '최신 뉴스, 연예, 트렌드, 스포츠 정보를 검색할 때 사용',
            parameters: {
              type: 'object',
              properties: {
                query: { type: 'string', description: '검색어' }
              },
              required: ['query']
            }
          }
        }],
        tool_choice: 'auto'
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(response.status).json({ error: err.error?.message || '오류' });
    }

    const data = await response.json();

    // 웹서치 필요한 경우 처리
    if (data.choices[0].finish_reason === 'tool_calls') {
      const toolCall = data.choices[0].message.tool_calls[0];
      const query = JSON.parse(toolCall.function.arguments).query;

      // Brave Search API 또는 간단히 GPT에게 최신 정보 요청
      const searchResult = await fetchLatestInfo(query);

      // 검색 결과 포함해서 재요청
      const messagesWithSearch = [
        ...messages,
        data.choices[0].message,
        {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: searchResult
        }
      ];

      const finalResp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: messagesWithSearch,
          max_tokens: 500,
          temperature: 0.9
        })
      });

      const finalData = await finalResp.json();
      return res.status(200).json(finalData);
    }

    return res.status(200).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

async function fetchLatestInfo(query) {
  // Brave Search API 키가 있으면 실제 검색
  if (process.env.BRAVE_API_KEY) {
    try {
      const r = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3&search_lang=ko`,
        { headers: { 'Accept': 'application/json', 'X-Subscription-Token': process.env.BRAVE_API_KEY } }
      );
      const data = await r.json();
      const results = data.web?.results?.slice(0,3).map(r=>`${r.title}: ${r.description}`).join('\n') || '';
      return results || `${query}에 대한 최신 정보를 찾지 못했어.`;
    } catch(e) {
      return `${query} 검색 실패`;
    }
  }
  // API 키 없으면 GPT 자체 지식으로
  return `${query}에 대해 네가 알고 있는 가장 최신 정보로 답변해줘. 2025~2026년 기준으로.`;
}
