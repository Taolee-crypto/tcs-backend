import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createService, Fault } from './service.mjs';
export function createApi(service,credentials){
 if(!Array.isArray(credentials)||!credentials.length||credentials.some(c=>typeof c.token!=='string'||c.token.length<32||!c.id||!c.tenant||!['creator','reviewer','platform'].includes(c.role)||(c.role==='platform'&&!c.platformId))||new Set(credentials.map(c=>c.token)).size!==credentials.length)throw Error('Valid unique 32+ character TCS credentials are required');
 return createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  try{
   const token=(req.headers.authorization||'').replace(/^Bearer /,'');
   const identity=credentials.find(c=>Buffer.byteLength(token)===Buffer.byteLength(c.token)&&timingSafeEqual(Buffer.from(token),Buffer.from(c.token)));
   if(!identity)throw new Fault(401,'AUTH_REQUIRED');
   let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)throw new Fault(413,'BODY_TOO_LARGE');}
   let parsed={};try{parsed=body?JSON.parse(body):{}}catch{throw new Fault(400,'INVALID_JSON')}
   if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Fault(400,'INVALID_JSON');
   const result=service.execute(identity,req.method,new URL(req.url,'http://localhost').pathname,parsed);
   res.end(JSON.stringify({ok:true,data:result}));
  }catch(e){res.statusCode=e instanceof Fault?e.status:500;res.end(JSON.stringify({ok:false,error:e instanceof Fault?e.message:'INTERNAL_ERROR'}));}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const credentials=JSON.parse(process.env.TCS_CREDENTIALS||'[]');
 const service=createService(process.env.TCS_DB||'tcs-pilot.sqlite');
 const server=createApi(service,credentials);
 server.listen(Number(process.env.PORT||8788),'127.0.0.1',()=>console.log('TCS pilot API: http://127.0.0.1:8788 (local only)'));
 const stop=()=>server.close(()=>{service.close();process.exit(0)});process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
