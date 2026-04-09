// api/summarize.js
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const { messages, date } = req.body;

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `대화 내용을 분석해서 아래 JSON 형식으로만 응답해. 다른 말 하지 마.
{
  "summary": "오늘 있었던 일 2~3줄 요약",
  "keywords": ["장소", "음식", "인물", "활동"],
  "mood": "😊 또는 😐 또는 😢 또는 😤 또는 🤬 중 하나",
  "highlight": "오늘의 핵심 한 줄"
}`
        },
        {
          role: 'user',
          content: `${date} 대화 내용:\n${messages.map(m => `${m.role==='user'?'나':'친구'}: ${m.content}`).join('\n')}`
        }
      ],
      max_tokens: 300
    })
  });

  const data = await response.json();
  const text = data.choices[0].message.content;
  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    res.status(200).json(parsed);
  } catch {
    res.status(200).json({ summary: text, keywords: [], mood: '😊', highlight: '' });
  }
}
