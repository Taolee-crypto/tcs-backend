import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
export class Fault extends Error { constructor(status, message){super(message);this.status=status;} }
const fail=(status,message)=>{throw new Fault(status,message)};
const text=(v,max=200)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():fail(400,'INVALID_TEXT');
const hash=v=>/^[a-f0-9]{64}$/.test(v||'')?v:fail(400,'SHA256_REQUIRED');
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v?v:fail(400,'UTC_TIMESTAMP_REQUIRED');
const roles=(p,...r)=>r.includes(p.role)||fail(403,'ROLE_FORBIDDEN');
const rights=['composition','recording','performance'];
const scopes=['store_broadcast','central_radio','personal_listening'];
const arr=(v,allowed)=>Array.isArray(v)&&v.length>0&&new Set(v).size===v.length&&v.every(x=>allowed.includes(x))?v:fail(400,'INVALID_SCOPE');
export function createService(path=':memory:',clock=()=>new Date().toISOString()){
 const db=new DatabaseSync(path);db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS records(kind TEXT, id TEXT PRIMARY KEY, tenant TEXT NOT NULL, body TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS by_tenant ON records(tenant,kind);
 CREATE TABLE IF NOT EXISTS usage(tenant TEXT,platform TEXT,event TEXT,body TEXT NOT NULL,PRIMARY KEY(tenant,platform,event));
 CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY AUTOINCREMENT,tenant TEXT,actor TEXT,at TEXT,action TEXT,record_id TEXT,body TEXT);
 `);
 const get=(p,kind,id)=>{const r=db.prepare('SELECT body FROM records WHERE tenant=? AND kind=? AND id=?').get(p.tenant,kind,id);return r?JSON.parse(r.body):fail(404,'NOT_FOUND')};
 const all=(p,kind)=>db.prepare('SELECT body FROM records WHERE tenant=? AND kind=? ORDER BY rowid DESC').all(p.tenant,kind).map(x=>JSON.parse(x.body));
 const put=(p,kind,r)=>db.prepare('INSERT INTO records VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(kind,r.id,p.tenant,JSON.stringify(r));
 const audit=(p,action,id,b)=>db.prepare('INSERT INTO audit(tenant,actor,at,action,record_id,body) VALUES(?,?,?,?,?,?)').run(p.tenant,p.id,clock(),action,id,JSON.stringify(b));
 const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}};
 function execute(p,method,path,b={}){
  if(!p||!p.id||!p.tenant||!['creator','reviewer','platform'].includes(p.role))fail(401,'AUTH_REQUIRED');
  const parts=path.split('/').filter(Boolean);const [,resource,id,action]=parts;
  if(parts[0]!=='v1')fail(404,'NOT_FOUND');
  if(method==='GET'&&path==='/v1/session')return {id:p.id,tenant:p.tenant,role:p.role,platformId:p.platformId||null,mode:'pilot'};
  if(method==='GET'&&path==='/v1/works'){
   const ws=all(p,'work');if(p.role==='reviewer')return ws;if(p.role==='creator')return ws.filter(w=>w.owner===p.id);
   const ids=new Set(all(p,'grant').filter(g=>g.platformId===p.platformId&&g.status==='active'&&g.start<=clock()&&clock()<g.end).map(g=>g.workId));
   return ws.filter(w=>ids.has(w.id)&&w.status==='approved').map(({id,title,sha256})=>({id,title,sha256}));
  }
  if(method==='GET'&&path==='/v1/grants')return all(p,'grant').filter(g=>p.role==='reviewer'||(p.role==='platform'?g.platformId===p.platformId:get(p,'work',g.workId).owner===p.id));
  if(method==='GET'&&path==='/v1/usage'){
   const us=db.prepare('SELECT body FROM usage WHERE tenant=?').all(p.tenant).map(x=>JSON.parse(x.body));
   return us.filter(u=>p.role==='reviewer'||(p.role==='platform'?u.platformId===p.platformId:get(p,'work',u.workId).owner===p.id));
  }
  if(method==='GET'&&path==='/v1/audit'){roles(p,'reviewer');return db.prepare('SELECT seq,actor,at,action,record_id FROM audit WHERE tenant=? ORDER BY seq DESC LIMIT 200').all(p.tenant)}
  if(method!=='POST')fail(404,'NOT_FOUND');
  return transaction(()=>{
   if(path==='/v1/works'){
    roles(p,'creator');const r={id:randomUUID(),owner:p.id,title:text(b.title),sha256:hash(b.sha256),status:'draft',createdAt:clock()};
    if(all(p,'work').some(w=>w.sha256===r.sha256))fail(409,'DUPLICATE_RECORDING');put(p,'work',r);audit(p,'work.created',r.id,r);return r;
   }
   if(resource==='works'&&action==='submit'&&parts.length===4){
    roles(p,'creator');const r=get(p,'work',id);if(r.owner!==p.id)fail(403,'OWNER_REQUIRED');if(r.status!=='draft')fail(409,'INVALID_STATE');
    if(!Array.isArray(b.evidence)||b.evidence.length!==3)fail(400,'ALL_RIGHTS_EVIDENCE_REQUIRED');
    r.evidence=b.evidence.map(e=>({right:arr([e.right],rights)[0],holder:text(e.holder),authority:text(e.authority,2000),documentSha256:hash(e.documentSha256)}));
    if(new Set(r.evidence.map(e=>e.right)).size!==3)fail(400,'ALL_RIGHTS_EVIDENCE_REQUIRED');
    r.existingAgreements=text(b.existingAgreements,2000);r.status='submitted';put(p,'work',r);audit(p,'work.submitted',id,r);return r;
   }
   if(resource==='works'&&action==='review'&&parts.length===4){
    roles(p,'reviewer');const r=get(p,'work',id);if(r.owner===p.id)fail(403,'SELF_APPROVAL_FORBIDDEN');if(r.status!=='submitted')fail(409,'INVALID_STATE');
    if(!['approved','rejected'].includes(b.decision))fail(400,'INVALID_DECISION');r.review={reviewer:p.id,at:clock(),note:text(b.note,2000),decision:b.decision};r.status=b.decision;put(p,'work',r);audit(p,'work.reviewed',id,r.review);return r;
   }
   if(path==='/v1/grants'){
    roles(p,'reviewer');const w=get(p,'work',text(b.workId));if(w.status!=='approved')fail(409,'RIGHTS_NOT_APPROVED');
    const r={id:randomUUID(),workId:w.id,platformId:text(b.platformId),start:date(b.start),end:date(b.end),territory:text(b.territory),scope:arr([b.scope],scopes)[0],permissions:arr(b.permissions,['server_storage','tl3_packaging','platform_delivery']),agreementSha256:hash(b.agreementSha256),agreementRef:text(b.agreementRef),basis:text(b.basis,2000),status:'active',createdAt:clock()};
    if(r.start<r.createdAt||r.end<=r.start||!/^[A-Z]{2}$/.test(r.territory)||r.permissions.length!==3)fail(400,'INVALID_GRANT');
    // A signed agreement reference is registered; this is not electronic signing or a rights proof.
    put(p,'grant',r);audit(p,'grant.registered',r.id,r);return r;
   }
   if(resource==='grants'&&action==='revoke'&&parts.length===4){roles(p,'reviewer');const r=get(p,'grant',id);if(r.status!=='active')fail(409,'INVALID_STATE');r.revokedAt=clock();r.reason=text(b.reason,2000);r.status='revoked';put(p,'grant',r);audit(p,'grant.revoked',id,r);return r;}
   if(path==='/v1/usage'){
    roles(p,'platform');if(!p.platformId)fail(403,'PLATFORM_REQUIRED');
    const u={eventId:text(b.eventId),grantId:text(b.grantId),platformId:p.platformId,deviceId:text(b.deviceId),startedAt:date(b.startedAt),endedAt:date(b.endedAt),territory:text(b.territory),scope:arr([b.scope],scopes)[0],seconds:b.seconds};
    if(!Number.isSafeInteger(u.seconds)||u.seconds<=0||u.seconds>86400||u.endedAt<=u.startedAt||u.endedAt>clock()||u.seconds*1000>Date.parse(u.endedAt)-Date.parse(u.startedAt))fail(400,'INVALID_DURATION');
    const digest=createHash('sha256').update(JSON.stringify(u)).digest('hex');const old=db.prepare('SELECT body FROM usage WHERE tenant=? AND platform=? AND event=?').get(p.tenant,p.platformId,u.eventId);
    if(old){const existing=JSON.parse(old.body);if(existing.digest!==digest)fail(409,'IDEMPOTENCY_CONFLICT');return {...existing,replayed:true};}
    const g=get(p,'grant',u.grantId);if(g.platformId!==p.platformId)fail(403,'PLATFORM_MISMATCH');
    if(u.startedAt<g.start||u.endedAt>g.end||(g.revokedAt&&u.endedAt>g.revokedAt)||g.territory!==u.territory||g.scope!==u.scope)fail(403,'OUTSIDE_GRANT');
    const history=db.prepare('SELECT body FROM usage WHERE tenant=? AND platform=?').all(p.tenant,p.platformId).map(x=>JSON.parse(x.body));
    if(history.some(x=>x.deviceId===u.deviceId&&x.startedAt<u.endedAt&&u.startedAt<x.endedAt))fail(409,'OVERLAPPING_DEVICE_USAGE');
    const result={...u,workId:g.workId,digest,baseTl:u.seconds,appliedTl:null,fee:null,verification:'reported_unverified',receivedAt:clock(),grantSnapshot:g};
    db.prepare('INSERT INTO usage VALUES(?,?,?,?)').run(p.tenant,p.platformId,u.eventId,JSON.stringify(result));audit(p,'usage.received',u.eventId,{digest,seconds:u.seconds,platformId:p.platformId});return result;
   }
   fail(404,'NOT_FOUND');
  });
 }
 return {execute,close:()=>db.close()};
}
