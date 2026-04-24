const fetch=(...args)=>import('node-fetch').then(({default:f})=>f(...args));

module.exports=async function handler(req,res){
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS')return res.status(200).end();
  if(req.method!=='POST')return res.status(405).end();

  const{text,today,tomorrow,dayAfter}=req.body;
  if(!text)return res.status(400).json({error:'text 필요'});

  try{
    const resp=await fetch('https://api.openai.com/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OPENAI_API_KEY}`},
      body:JSON.stringify({
        model:'gpt-4o',
        max_tokens:200,
        temperature:0,
        messages:[
          {
            role:'system',
            content:`일정 추출 전문가. 아래 텍스트에서 일정을 추출해 JSON만 반환.
오늘:${today} 내일:${tomorrow} 모레:${dayAfter}

일정 있으면: {"title":"제목","date":"YYYY-MM-DD","time":"HH:MM","content":"메모"}
일정 없으면: null

규칙:
- 약속/예약/일정/예정/병원/미팅/면접/시험/모임/여행/출장/콘서트/결혼식/생일 포함시 추출
- 내일=${tomorrow}, 모레=${dayAfter}
- 오후2시=14:00, 오전10시=10:00
- 시간 없으면 time=null
- JSON만 반환. 마크다운/설명 절대 금지`
          },
          {role:'user',content:text}
        ]
      })
    });

    const data=await resp.json();
    const raw=data.choices?.[0]?.message?.content?.trim()||'null';
    const clean=raw.replace(/```json|```/g,'').trim();

    try{
      const result=JSON.parse(clean);
      return res.status(200).json(result||{});
    }catch(e){
      return res.status(200).json({});
    }
  }catch(e){
    return res.status(500).json({error:e.message});
  }
};
