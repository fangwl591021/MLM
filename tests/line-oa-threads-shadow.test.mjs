import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../src/router/router.js';
import { createApp } from '../src/app.js';
import { listLineOaThreadsCandidate, registerLineOaThreadsShadowRoute } from '../src/modules/line-oa/line-oa-threads.routes.js';

function dbMock() {
  const queries=[];
  return {queries,prepare(sql){const q={sql:String(sql).replace(/\s+/g,' ').trim(),bindings:[]};queries.push(q);return{bind(...b){q.bindings=b;return this},async all(){
    if(q.sql.includes('FROM threads t LEFT JOIN profiles')) return {results:[{id:'user:U1',floor_id:'main',user_id:'U1',display_name:'王小明',summary:'測試',status:'pending',risk:'low',tags:'[]',note:'',last_message_at:1,updated_at:1}]};
    if(q.sql.includes('FROM messages WHERE thread_id IN')) return {results:[{id:1,thread_id:'user:U1',floor_id:'main',user_id:'U1',sender_role:'user',message_type:'text',text:'你好',created_at:1,suggestions:'[]',important:0,raw_json:'{}'}]};
    return {results:[]};
  }}}}};
}

test('candidate reads local D1 only and maps threads', async()=>{const DB=dbMock();const rows=await listLineOaThreadsCandidate({DB},'main');assert.equal(rows.length,1);assert.equal(rows[0].name,'王小明');assert.equal(rows[0].messages[0].text,'你好');assert.equal(DB.queries.length,2);for(const q of DB.queries){assert.match(q.sql,/^SELECT/i);assert.doesNotMatch(q.sql,/\b(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|REPLACE)\b/i)}});

test('admin query overfetches and gateway scan stays select-only', async()=>{const DB=dbMock();await listLineOaThreadsCandidate({DB},'admin');assert.equal(DB.queries[0].bindings[1],620)});

test('flag disabled stays legacy',async()=>{const router=createRouter();let calls=0;const legacyFetch=async()=>{calls++;return Response.json({legacy:true})};registerLineOaThreadsShadowRoute(router,{legacyFetch});const app=createApp({router,legacyFetch});const res=await app.fetch(new Request('https://x/api/line-oa/threads'),{SHADOW_LINE_OA_THREADS_ENABLED:'false'},{});assert.equal(res.headers.get('x-mlm-router'),'legacy');assert.equal(calls,1)});

test('candidate runs only after legacy 200',async()=>{const router=createRouter();const DB=dbMock();const body={success:true,status:'success',data:[{legacy:true}]};registerLineOaThreadsShadowRoute(router,{legacyFetch:async()=>Response.json(body),logger:{info(){},error(){}}});const app=createApp({router,legacyFetch:async()=>{throw new Error('fallback')}});const res=await app.fetch(new Request('https://x/api/line-oa/threads'),{SHADOW_LINE_OA_THREADS_ENABLED:'true',DB},{});assert.deepEqual(await res.json(),body);assert.equal(DB.queries.length,2)});

test('legacy auth failure skips candidate',async()=>{const router=createRouter();const DB=dbMock();registerLineOaThreadsShadowRoute(router,{legacyFetch:async()=>Response.json({status:'error'},{status:401}),logger:{info(){},error(){}}});const app=createApp({router,legacyFetch:async()=>{throw new Error('fallback')}});const res=await app.fetch(new Request('https://x/api/line-oa/threads'),{SHADOW_LINE_OA_THREADS_ENABLED:'true',DB},{});assert.equal(res.status,401);assert.equal(DB.queries.length,0)});

test('metadata is high-risk read-only',()=>{const router=createRouter();registerLineOaThreadsShadowRoute(router,{legacyFetch:async()=>Response.json({})});assert.deepEqual(router.list(),[{method:'GET',id:'LINE-OA-THREADS-SHADOW-001',path:'/api/line-oa/threads',risk:'high',write:false,mode:'shadow-read-after-legacy',featureFlag:'SHADOW_LINE_OA_THREADS_ENABLED'}])});
