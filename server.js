const express=require('express'),fs=require('fs'),crypto=require('crypto');
let mail=null;try{if(process.env.SMTP_HOST)mail=require('nodemailer').createTransport({host:process.env.SMTP_HOST,port:+process.env.SMTP_PORT||587,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}})}catch{}
const F=process.env.DATA_FILE||'data.json',ADMIN=process.env.ADMIN_PASSWORD||'admin123',tokens=new Set();
if(!process.env.ADMIN_PASSWORD)console.warn('WARNING: set ADMIN_PASSWORD, using default "admin123"');
let D={questions:[],attempts:[],settings:{minutes:45,counts:{Quant:10,Logical:10,Verbal:10}}};
try{D={...D,...JSON.parse(fs.readFileSync(F))}}catch{}
const save=()=>fs.writeFileSync(F,JSON.stringify(D));
const shuf=a=>a.map(x=>[Math.random(),x]).sort((p,q)=>p[0]-q[0]).map(x=>x[1]);
const find=id=>D.questions.find(x=>x.id==id);
const mk=b=>({id:crypto.randomUUID(),section:String(b.section||'General').trim(),text:b.text||'',image:b.image||'',options:b.options||[],answer:+b.answer,explanation:b.explanation||''});
function csv(t){const r=[];let row=[],c='',q=false;for(let i=0;i<t.length;i++){const h=t[i];if(q){if(h=='"'){if(t[i+1]=='"'){c+='"';i++}else q=false}else c+=h}else if(h=='"')q=true;else if(h==',')row.push(c),c='';else if(h=='\n'){row.push(c.replace(/\r$/,''));r.push(row);row=[];c=''}else c+=h}if(c||row.length){row.push(c);r.push(row)}return r}
const sec=a=>Object.entries(a.by).map(([k,v])=>k+' '+v.c+'/'+v.t).join('; ');
function fin(a,reason){if(a.done)return;a.done=true;a.reason=reason;a.score=0;a.by={};
a.qids.forEach(id=>{const q=find(id);if(!q)return;const s=a.by[q.section]=a.by[q.section]||{c:0,t:0};s.t++;if(a.answers[id]===q.answer){s.c++;a.score++}});
a.total=a.qids.length;a.at=Date.now();save();
if(mail&&process.env.ADMIN_EMAIL)mail.sendMail({from:process.env.SMTP_USER,to:process.env.ADMIN_EMAIL,subject:`${a.name}: ${a.score}/${a.total}`,text:`${a.name} <${a.email}> scored ${a.score}/${a.total}\n${sec(a)}\nEnded by: ${reason}, tab switches: ${a.switches}`}).catch(console.error)}
const app=express();app.use(express.json({limit:'5mb'}),express.static('public'));
app.post('/api/start',(q,s)=>{const name=(q.body.name||'').trim(),email=(q.body.email||'').trim().toLowerCase();
if(!name||!/^\S+@\S+\.\S+$/.test(email))return s.json({error:'Enter a valid name and email.'});
let a=D.attempts.find(x=>x.email==email&&!x.done&&Date.now()<x.end);
if(!a){D.attempts.filter(x=>x.email==email&&!x.done).forEach(x=>fin(x,'time up'));
const qids=[];for(const[k,n]of Object.entries(D.settings.counts))qids.push(...shuf(D.questions.filter(x=>x.section==k)).slice(0,n).map(x=>x.id));
if(!qids.length)return s.json({error:'No questions have been added yet.'});
a={id:crypto.randomUUID(),name,email,qids,answers:{},switches:0,start:Date.now(),end:Date.now()+D.settings.minutes*60000,done:false};D.attempts.push(a);save()}
s.json({id:a.id})});
const get=(q,s,n)=>{const a=D.attempts.find(x=>x.id==q.params.id);if(!a)return s.json({error:'Not found'});if(!a.done&&Date.now()>a.end)fin(a,'time up');q.a=a;n()};
app.get('/api/attempt/:id',get,(q,s)=>{const a=q.a;if(a.done)return s.json({done:true});
s.json({questions:a.qids.map(find).filter(Boolean).map(({answer,explanation,...x})=>x),answers:a.answers,switches:a.switches,left:a.end-Date.now()})});
app.post('/api/attempt/:id/save',get,(q,s)=>{const a=q.a;if(!a.done){a.answers=q.body.answers||{};a.switches=Math.max(a.switches,q.body.switches|0);if(a.switches>=3)fin(a,'tab switching');save()}s.json({done:a.done})});
app.post('/api/attempt/:id/submit',get,(q,s)=>{if(!q.a.done)q.a.answers=q.body.answers||q.a.answers;fin(q.a,'submitted');s.json({done:true})});
app.get('/api/attempt/:id/result',get,(q,s)=>{const a=q.a;if(!a.done)return s.json({error:'Not finished'});
s.json({score:a.score,total:a.total,by:a.by,review:a.qids.map(find).filter(Boolean).map(x=>({text:x.text,options:x.options,answer:x.answer,explanation:x.explanation,mine:a.answers[x.id]??null,ok:a.answers[x.id]===x.answer}))})});
app.post('/api/admin/login',(q,s)=>{if(q.body.password!==ADMIN)return s.status(401).json({error:'Wrong password'});const t=crypto.randomUUID();tokens.add(t);s.json({token:t})});
const ad=express.Router();ad.use((q,s,n)=>tokens.has(q.get('x-token'))?n():s.status(401).json({error:'Login required'}));
ad.get('/settings',(q,s)=>s.json(D.settings));
ad.put('/settings',(q,s)=>{D.settings=q.body;save();s.json({ok:1})});
ad.get('/questions',(q,s)=>s.json(D.questions));
ad.post('/questions',(q,s)=>{D.questions.push(mk(q.body));save();s.json({ok:1})});
ad.delete('/questions/:id',(q,s)=>{D.questions=D.questions.filter(x=>x.id!=q.params.id);save();s.json({ok:1})});
ad.post('/upload',(q,s)=>{const rows=csv(q.body.csv).slice(1).filter(r=>r.length>=8);
rows.forEach(r=>D.questions.push(mk({section:r[0],text:r[1],image:r[2],options:[r[3],r[4],r[5],r[6]],answer:'ABCD'.indexOf(r[7].trim().toUpperCase()),explanation:r[8]})));save();s.json({added:rows.length})});
ad.get('/results',(q,s)=>s.json(D.attempts.filter(a=>a.done).sort((x,y)=>y.at-x.at)));
ad.get('/leaderboard',(q,s)=>{const b={};D.attempts.filter(a=>a.done).forEach(a=>{if(!b[a.email]||a.score>b[a.email].score)b[a.email]=a});s.json(Object.values(b).sort((x,y)=>y.score-x.score))});
ad.get('/export',(q,s)=>{const c=v=>'"'+String(v).replace(/"/g,'""')+'"';
s.type('text/csv').send(['Name,Email,Score,Total,Sections,Tab switches,Ended by,Date'].concat(D.attempts.filter(a=>a.done).map(a=>[a.name,a.email,a.score,a.total,sec(a),a.switches,a.reason,new Date(a.at).toISOString()].map(c).join(','))).join('\n'))});
app.use('/api/admin',ad);
app.listen(process.env.PORT||3000,()=>console.log('Running on port '+(process.env.PORT||3000)));
