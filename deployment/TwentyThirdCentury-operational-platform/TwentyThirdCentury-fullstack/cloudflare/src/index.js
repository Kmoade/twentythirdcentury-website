const enc = new TextEncoder(), dec = new TextDecoder(), limits = new Map();
const out = (data, status=200) => new Response(JSON.stringify(data), {status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const clean = (v,n) => typeof v==="string" ? v.trim().slice(0,n) : "";
const b64 = b => { let s=""; for(const x of new Uint8Array(b)) s+=String.fromCharCode(x); return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,""); };
const un64 = s => Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((s.length+3)%4)),c=>c.charCodeAt(0));
async function hashPass(p,s) {
  const salt=s?un64(s):crypto.getRandomValues(new Uint8Array(16));
  const k=await crypto.subtle.importKey("raw",enc.encode(p),"PBKDF2",false,["deriveBits"]);
  const h=await crypto.subtle.deriveBits({name:"PBKDF2",hash:"SHA-256",salt,iterations:60000},k,256);
  return {salt:b64(salt),hash:b64(h)};
}
async function checkPass(p,stored) {
  const a=String(stored||"").split("$"); if(a.length!==4||a[0]!=="pbkdf2"||a[1]!=="60000") return false;
  const h=un64((await hashPass(p,a[2])).hash), expected=un64(a[3]); if(h.length!==expected.length)return false;
  let diff=0; for(let i=0;i<h.length;i++)diff|=h[i]^expected[i]; return diff===0;
}
async function tokenFor(user,secret) {
  const h=b64(enc.encode(JSON.stringify({alg:"HS256",typ:"JWT"}))), now=Math.floor(Date.now()/1000);
  const p=b64(enc.encode(JSON.stringify({id:user.id,username:user.username,iss:"twentythirdcentury",iat:now,exp:now+43200}))), data=h+"."+p;
  const key=await crypto.subtle.importKey("raw",enc.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return data+"."+b64(await crypto.subtle.sign("HMAC",key,enc.encode(data)));
}
async function currentUser(req,env) {
  const t=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").split(".");
  if(t.length!==3)return null;
  try {
    const k=await crypto.subtle.importKey("raw",enc.encode(env.JWT_SECRET),{name:"HMAC",hash:"SHA-256"},false,["verify"]);
    if(!await crypto.subtle.verify("HMAC",k,un64(t[2]),enc.encode(t[0]+"."+t[1])))return null;
    const p=JSON.parse(dec.decode(un64(t[1])));
    if(p.iss!=="twentythirdcentury"||p.exp<Date.now()/1000)return null;
    return await env.DB.prepare("SELECT id,username FROM users WHERE id=?").bind(p.id).first();
  } catch{return null;}
}
async function admin(u,env) {
  return u&&env.ADMIN_EMAIL?Boolean(await env.DB.prepare("SELECT 1 FROM users WHERE id=? AND lower(email)=lower(?)").bind(u.id,env.ADMIN_EMAIL).first()):false;
}
function limited(req,key,max,ms) {
  const now=Date.now(), id=key+":"+(req.headers.get("CF-Connecting-IP")||"unknown");
  let x=limits.get(id); if(!x||now-x.at>ms)x={at:now,n:0}; x.n++; limits.set(id,x);
  if(limits.size>3000)for(const [k,v] of limits)if(now-v.at>3600000)limits.delete(k);
  return x.n<=max;
}
const fail = e => { if(String(e?.message||"").includes("UNIQUE"))return out({error:"That username or email is already registered."},409); console.error(e); return out({error:"Something went wrong. Please try again."},500); };
async function api(req,env) {
  const u=new URL(req.url), p=u.pathname, m=req.method;
  if(p==="/api/health"&&m==="GET"){try{await env.DB.prepare("SELECT 1").first();return out({ok:true,service:"TwentyThirdCentury",database:"connected",time:new Date().toISOString()});}catch{return out({ok:false,database:"unavailable"},503);}}
  if(p==="/api/auth/register"&&m==="POST"){
    if(!limited(req,"reg",8,3600000))return out({error:"Too many registration attempts. Please try again later."},429);
    const b=await req.json().catch(()=>({})), username=clean(b.username,24),email=clean(b.email,254).toLowerCase(),password=typeof b.password==="string"?b.password:"";
    if(!/^[a-zA-Z0-9_]{3,24}$/.test(username))return out({error:"Username must be 3–24 characters using letters, numbers or underscores."},400);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return out({error:"Enter a valid email address."},400);
    if(password.length<10||password.length>128)return out({error:"Password must be at least 10 characters."},400);
    const h=await hashPass(password);
    try{const r=await env.DB.prepare("INSERT INTO users(username,email,password_hash) VALUES(?,?,?)").bind(username,email,"pbkdf2$60000$"+h.salt+"$"+h.hash).run();const user={id:r.meta.last_row_id,username};return out({token:await tokenFor(user,env.JWT_SECRET),user},201);}catch(e){return fail(e);}
  }
  if(p==="/api/auth/login"&&m==="POST"){
    if(!limited(req,"login",12,900000))return out({error:"Too many sign-in attempts. Please try again later."},429);
    const b=await req.json().catch(()=>({})), email=clean(b.email,254).toLowerCase(),password=typeof b.password==="string"?b.password:"";
    const row=await env.DB.prepare("SELECT id,username,password_hash FROM users WHERE email=?").bind(email).first();
    if(!row||!await checkPass(password,row.password_hash))return out({error:"Email or password is incorrect."},401);
    const user={id:row.id,username:row.username};return out({token:await tokenFor(user,env.JWT_SECRET),user});
  }
  const user=await currentUser(req,env);
  if(p==="/api/me"&&m==="GET"){if(!user)return out({error:"Sign in to do that."},401);return out({user,isAdmin:await admin(user,env)});}
  if(p==="/api/me"&&m==="DELETE"){
    if(!user)return out({error:"Sign in to do that."},401);const b=await req.json().catch(()=>({}));
    const row=await env.DB.prepare("SELECT password_hash FROM users WHERE id=?").bind(user.id).first();
    if(!row||!await checkPass(typeof b.password==="string"?b.password:"",row.password_hash))return out({error:"Your password is incorrect."},401);
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(user.id).run();return out({deleted:true,message:"Your account and associated community data have been deleted."});
  }
  if(p==="/api/posts"&&m==="GET"){
    const rows=await env.DB.prepare("SELECT p.id,p.body,p.created_at,u.username,(SELECT COUNT(*) FROM likes l WHERE l.post_id=p.id) AS likes,(SELECT COUNT(*) FROM comments c WHERE c.post_id=p.id) AS comments,EXISTS(SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?) AS liked FROM posts p JOIN users u ON u.id=p.user_id WHERE p.status='active' ORDER BY p.id DESC LIMIT 60").bind(user?.id||0).all();
    const comments=await env.DB.prepare("SELECT c.id,c.post_id,c.body,c.created_at,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id IN (SELECT id FROM posts WHERE status='active' ORDER BY id DESC LIMIT 60) ORDER BY c.post_id,c.id").all();
    const byPost=new Map();for(const c of comments.results||[]){const list=byPost.get(c.post_id)||[];if(list.length<30)list.push({id:c.id,body:c.body,created_at:c.created_at,username:c.username});byPost.set(c.post_id,list);}
    const posts=(rows.results||[]).map(x=>({...x,liked:Boolean(x.liked),commentsList:byPost.get(x.id)||[]}));return out({posts});
  }
  if(p==="/api/posts"&&m==="POST"){
    if(!user)return out({error:"Sign in to do that."},401);const b=await req.json().catch(()=>({})),body=clean(b.body,1200);if(body.length<3)return out({error:"Write at least 3 characters."},400);
    const r=await env.DB.prepare("INSERT INTO posts(user_id,body) VALUES(?,?)").bind(user.id,body).run();
    const x=await env.DB.prepare("SELECT p.id,p.body,p.created_at,u.username,0 AS likes,0 AS comments,0 AS liked FROM posts p JOIN users u ON u.id=p.user_id WHERE p.id=?").bind(r.meta.last_row_id).first();
    return out({post:{...x,liked:false,commentsList:[]}},201);
  }
  let match=p.match(/^\/api\/posts\/(\d+)\/(like|comments|report)$/);
  if(match){
    const id=Number(match[1]),action=match[2],exists=await env.DB.prepare("SELECT id FROM posts WHERE id=? AND status='active'").bind(id).first();
    if(!exists)return out({error:"Post not found."},404);if(!user)return out({error:"Sign in to do that."},401);
    if(action==="like"&&m==="POST"){
      const old=await env.DB.prepare("SELECT 1 FROM likes WHERE user_id=? AND post_id=?").bind(user.id,id).first();
      if(old)await env.DB.prepare("DELETE FROM likes WHERE user_id=? AND post_id=?").bind(user.id,id).run();else await env.DB.prepare("INSERT INTO likes(user_id,post_id) VALUES(?,?)").bind(user.id,id).run();
      const n=await env.DB.prepare("SELECT COUNT(*) AS n FROM likes WHERE post_id=?").bind(id).first();return out({liked:!old,likes:n.n});
    }
    if(action==="comments"&&m==="POST"){
      const b=await req.json().catch(()=>({})),body=clean(b.body,500);if(!body)return out({error:"Comment can't be empty."},400);
      const r=await env.DB.prepare("INSERT INTO comments(post_id,user_id,body) VALUES(?,?,?)").bind(id,user.id,body).run();
      return out({comment:{id:r.meta.last_row_id,body,username:user.username,created_at:new Date().toISOString()}},201);
    }
    if(action==="report"&&m==="POST"){
      if(!limited(req,"report",10,3600000))return out({error:"Too many reports. Please try again later."},429);
      const b=await req.json().catch(()=>({})),reason=clean(b.reason,24),details=clean(b.details,300);
      if(!["spam","harassment","hate","misinformation","other"].includes(reason))return out({error:"Choose a valid report reason."},400);
      try{await env.DB.prepare("INSERT INTO reports(reporter_id,post_id,reason,details) VALUES(?,?,?,?)").bind(user.id,id,reason,details).run();return out({reported:true,message:"Thank you. Your report has been sent for review."},201);}catch(e){if(String(e?.message||"").includes("UNIQUE"))return out({error:"You have already reported this post."},409);throw e;}
    }
  }
  if(p==="/api/checkins"&&(m==="POST"||m==="GET")){
    if(!user)return out({error:"Sign in to do that."},401);
    if(m==="POST"){const b=await req.json().catch(()=>({})),mood=clean(b.mood,12),note=clean(b.note,240);if(!["great","good","okay","low","rough"].includes(mood))return out({error:"Choose a valid mood."},400);await env.DB.prepare("INSERT INTO checkins(user_id,mood,note) VALUES(?,?,?)").bind(user.id,mood,note).run();return out({saved:true,message:"Check-in saved. Thank you for checking in with yourself."},201);}
    const rows=await env.DB.prepare("SELECT mood,note,created_at FROM checkins WHERE user_id=? ORDER BY id DESC LIMIT 30").bind(user.id).all();return out({checkins:rows.results||[]});
  }
  if(p==="/api/chat"&&m==="POST"){
    if(!limited(req,"chat",20,60000))return out({error:"Please slow down and try again in a moment."},429);
    const b=await req.json().catch(()=>({})),message=clean(b.message,1200),agent=["nova","byte","sol"].includes(b.agent)?b.agent:"nova";if(!message)return out({error:"Type a message first."},400);
    const q=message.toLowerCase();
    let reply,topic="general";
    if(agent==="sol"){
      topic="wellbeing";
      reply=/suicid|kill myself|end my life|self.harm|hurt myself|can't go on/i.test(message)?"I'm really sorry things feel this heavy. You deserve support right now, not to handle this alone. If you're in immediate danger, call your local emergency number (112 from a mobile phone in South Africa), go to the nearest emergency department, or contact someone you trust and ask them to stay with you. I'm not an emergency or clinical service.":"Thank you for sharing that with me. You don't have to solve everything at once. What is one small thing that might make the next ten minutes a little easier—water, a breath of fresh air, messaging someone you trust, or telling me a bit more about what's going on?";
    } else if(/what.*(technology|tech|innovation)|promising.*(innovation|technology)|future of tech|emerging tech|technology.*(improve|change|life)/i.test(q)){
      topic="technology";
      reply="Here are five promising areas to watch over the next decade:\n\n1. **AI copilots and practical automation** — tools that help people learn, write, design, diagnose faults and run small businesses. The opportunity is making them reliable, affordable and accessible.\n2. **Cleaner, more resilient energy** — cheaper solar, better batteries, smart electricity networks and microgrids could reduce outages and expand energy access.\n3. **Medical technology** — AI-assisted screening, remote monitoring and faster diagnostics could help health workers reach more people. These tools should support, not replace, qualified clinicians.\n4. **Precision agriculture and water technology** — sensors, satellite data and smarter irrigation can help farmers use water and fertiliser more efficiently.\n5. **Affordable connectivity and digital education** — better networks, local-language learning tools and low-cost devices can widen access to skills and opportunity.\n\nThe biggest benefits will come when these technologies solve real local problems, protect people's data and remain affordable. Which area would you like to explore first?";
    } else if(/teach.*(skill|technology|tech)|beginner|learn.*(coding|programming|technology)|start.*(coding|programming)/i.test(q)){
      topic="learning";
      reply="Let's start with a useful beginner skill: **building a simple web page with HTML**. HTML gives a page its structure.\n\n**Your first 15-minute exercise**\n1. Open Notepad or another text editor.\n2. Type this: &lt;!doctype html&gt;&lt;html&gt;&lt;body&gt;&lt;h1&gt;Hello, future!&lt;/h1&gt;&lt;p&gt;I'm learning to build for the web.&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;\n3. Save the file as index.html (choose All files if Notepad adds .txt), then double-click it to open it in your browser.\n\nYou have made a real web page. Next, learn a little CSS to change its colours, spacing and layout. After that, JavaScript can make it interactive. Would you like the next lesson to be HTML, CSS, JavaScript, or basic computer skills?";
    } else if(/3.step|three.step|turn.*idea.*plan|make.*plan|action plan|big idea/i.test(q)){
      topic="planning";
      reply="Let's turn the idea into a small, testable plan:\n\n**1. Define the problem.** Write one sentence describing who you want to help and what difficulty they face.\n\n**2. Build the smallest useful test.** Choose one feature or service you can demonstrate without spending much money. Sketch it, make a sample, or create a simple landing page.\n\n**3. Get real feedback.** Show it to 3–5 people who experience the problem. Ask what is useful, what is confusing and whether they would use it. Improve it based on what you learn.\n\nTell me your idea in one or two sentences and I'll tailor these three steps to it.";
    } else if(agent==="byte" || /how do i|how to|debug|code|website|computer|software|technology skill/i.test(q)){
      topic="technology-help";
      reply="I can help you work through this practically. Here's a useful way to start:\n\n1. **State the outcome:** what do you want the device, app or code to do?\n2. **Check the basics:** note the device or software, its version, and the exact error or behaviour.\n3. **Try one safe change at a time:** make a backup before changing important files or settings, then test whether the result changed.\n\nShare the task or exact error message, plus the device or software you're using, and I'll give you steps suited to it.";
    } else {
      topic="idea-coaching";
      reply="I'd be glad to help you shape that. Let's make it concrete:\n\n- **Who is it for?** Name the people who would benefit.\n- **What problem does it solve?** Describe the difficulty in everyday language.\n- **What is the smallest test?** Pick one simple version you could show someone this week.\n\nShare a little more about your question or idea, and I'll suggest a useful next step.";
    }
    return out({reply,mode:"guided",topic});
  }
  if(p==="/api/admin/reports"&&m==="GET"){
    if(!user)return out({error:"Sign in to do that."},401);if(!await admin(user,env))return out({error:"Administrator access is required."},403);
    const r=await env.DB.prepare("SELECT r.id,r.reason,r.details,r.status,r.created_at,p.id AS post_id,p.body AS post_body,u.username AS reporter,a.username AS author FROM reports r JOIN posts p ON p.id=r.post_id JOIN users u ON u.id=r.reporter_id JOIN users a ON a.id=p.user_id ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END,r.id DESC LIMIT 100").all();return out({reports:r.results||[]});
  }
  match=p.match(/^\/api\/admin\/reports\/(\d+)\/resolve$/);
  if(match&&m==="POST"){
    if(!user)return out({error:"Sign in to do that."},401);if(!await admin(user,env))return out({error:"Administrator access is required."},403);
    const id=Number(match[1]),b=await req.json().catch(()=>({})),action=b.action==="hide"?"hide":"dismiss",r=await env.DB.prepare("SELECT post_id FROM reports WHERE id=?").bind(id).first();
    if(!r)return out({error:"Report not found."},404);if(action==="hide")await env.DB.prepare("UPDATE posts SET status='hidden' WHERE id=?").bind(r.post_id).run();await env.DB.prepare("UPDATE reports SET status='resolved' WHERE post_id=?").bind(r.post_id).run();return out({resolved:true,action});
  }
  return out({error:"Not found."},404);
}
export default { async fetch(req,env) {
  const url=new URL(req.url);let res;
  if(url.pathname.startsWith("/api/")){
    if(!env.DB||!env.JWT_SECRET||env.JWT_SECRET.length<32)return out({error:"The platform backend is not configured yet."},503);
    try{res=await api(req,env);}catch(e){res=fail(e);}
  }else res=await env.ASSETS.fetch(req);
  const h=new Headers(res.headers);h.set("x-content-type-options","nosniff");h.set("referrer-policy","strict-origin-when-cross-origin");h.set("x-frame-options","DENY");h.set("permissions-policy","camera=(), microphone=(), geolocation=()");h.set("content-security-policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  return new Response(res.body,{status:res.status,statusText:res.statusText,headers:h});
}};
