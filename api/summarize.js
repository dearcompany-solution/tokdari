const{createClient}=require('@supabase/supabase-js');
const sb=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).end();

  const{messages,date}=req.body;
  if(!messages?.length)return res.status(400).json({error:'메시지 없음'});

  // 대화 내용 정리
  const conv=messages
    .filter(m=>m.role==='user'||m.role==='assistant')
    .map(m=>`${m.role==='user'?'나':'다리'}: ${m.content}`)
    .join('\n');

  try{
    const resp=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({
        model:'gpt-4o',
        max_tokens:800,
        messages:[
          {
            role:'system',
            content:`너는 일기 작성 도우미야. 아래 대화 내용을 바탕으로 일기를 작성해줘.

[작성 규칙]
- 날짜: ${date}
- 1인칭 시점으로 작성 (나는, 오늘은)
- 대화 흐름 순서대로 자연스럽게 정리
- 어떤 얘기를 나눴는지, 어떤 감정이었는지 담아줘
- 너무 딱딱하지 않게, 일기처럼 편하게
- 길이: 150~250자
- 이모지 1~2개만 자연스럽게

[응답 형식 - JSON만 반환, 다른 텍스트 없이]
{
  "mood": "감정 이모지 1개",
  "highlight": "오늘 대화 한줄 요약 (20자 이내)",
  "summary": "일기 본문"
}`
          },
          {role:'user',content:`[${date} 대화 내용]\n${conv}`}
        ]
      })
    });

    const data=await resp.json();
    const raw=data.choices?.[0]?.message?.content?.trim()||'{}';
    const clean=raw.replace(/```json|```/g,'').trim();
    const result=JSON.parse(clean);
    return res.status(200).json(result);
  }catch(e){
    return res.status(500).json({error:e.message});
  }
};
