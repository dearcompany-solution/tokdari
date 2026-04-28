const fetch=(...args)=>import('node-fetch').then(({default:f})=>f(...args));

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).end();

  const{messages,date,userName}=req.body;
  if(!messages?.length)return res.status(400).json({error:'메시지 없음'});

  // user/assistant 대화만 정리
  const conv=messages
    .filter(m=>m.role==='user'||m.role==='assistant')
    .map(m=>`${m.role==='user'?(userName||'나'):'다리'}: ${m.content}`)
    .join('\n');

  try{
    const resp=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({
        model:'gpt-4o',
        max_tokens:600,
        temperature:0.7,
        messages:[
          {
            role:'system',
            content:`너는 일기 작성 도우미야. 아래는 ${userName||'나'}와 AI 친구 다리의 대화야.
이 대화를 바탕으로 ${userName||'나'}의 시점에서 일기를 작성해줘.

[작성 규칙]
- 날짜: ${date}
- 반드시 ${userName||'나'}의 1인칭 시점으로 작성 (나는, 오늘은)
- ${userName||'나'}이 한 말과 경험 중심으로 작성
- 다리(AI)의 말은 참고만 하고 내용 중심은 ${userName||'나'}의 이야기
- 자연스러운 일기체로 150~250자
- 이모지 1~2개만

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
