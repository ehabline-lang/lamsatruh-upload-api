const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const sharp = require('sharp');
const handler = require('../api/upload');
const { configuration, createLimiter, uploadPermission, verifyToken } = require('../lib/security');

const env = { FIREBASE_PROJECT_ID: 'demo-lamsat-upload', FIREBASE_API_KEY: 'test-key', BUNNY_STORAGE_ENDPOINT: 'https://storage.bunnycdn.com/test-zone', BUNNY_API_KEY: 'private-test-key', BUNNY_CDN_URL: 'https://test-zone.b-cdn.net' };
const validClaims = { uid: 'admin-test', email_verified: true, auth_time: 100, firebase: { sign_in_second_factor: 'totp' } };
const response = (value, status=200) => new Response(JSON.stringify(value), { status });

test('configuration fails closed and never accepts unsafe storage URLs', () => {
  assert.equal(configuration(env).projectId, 'demo-lamsat-upload');
  for (const patch of [{FIREBASE_PROJECT_ID:''},{BUNNY_API_KEY:''},{BUNNY_CDN_URL:'http://cdn.test'},{BUNNY_STORAGE_ENDPOINT:'https://secret@host.test/x'},{ALLOWED_ORIGINS:'https://*.example.com/path'}]) assert.throws(()=>configuration({...env,...patch}));
});
test('upload permissions match active admin, manager, products and explicit roles', () => {
  for (const role of ['admin','manager','products']) assert.equal(uploadPermission({active:true,role}),true);
  assert.equal(uploadPermission({active:true,role:'viewer',permissions:['media.upload']}),true);
  for (const profile of [{active:false,role:'admin'},{active:true,role:'viewer'},{active:true,role:'content'},{}]) assert.equal(uploadPermission(profile),false);
});
test('limiter is bounded, denies sixth attempt and resets after one minute', () => {
  let time=0;const allow=createLimiter({now:()=>time,maxUsers:1});
  for(let i=0;i<5;i++)assert.equal(allow('a'),true);
  assert.equal(allow('a'),false);assert.equal(allow('b'),false);time=60000;assert.equal(allow('b'),true);
});
test('real Firebase verifier rejects malformed and unsigned tokens', async()=>{
  await assert.rejects(verifyToken('not-a-token',configuration(env)));
  const unsigned=Buffer.from(JSON.stringify({alg:'none'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({aud:env.FIREBASE_PROJECT_ID,sub:'admin-test'})).toString('base64url')+'.';
  await assert.rejects(verifyToken(unsigned,configuration(env)));
});

test('actual HTTP multipart upload security and compatibility', async t => {
  let claims={...validClaims},profile={active:{booleanValue:true},role:{stringValue:'admin'}},disabled=false,revoked=false,upstreamFailure=false,fetchFailure=false,blocked=false,putCalls=0,lastBody,lastUrl,lastHeaders;
  const fetcher=async(url,options)=>{
    if(fetchFailure)throw Error('INTERNAL_SECRET_MUST_NOT_LEAK');
    assert.equal(options.redirect,'error');assert.ok(options.signal);
    if(url.includes('identitytoolkit'))return response({users:[{localId:'admin-test',emailVerified:true,disabled,validSince:revoked?'200':'50'}]});
    if(url.includes('firestore.googleapis.com'))return response({fields:profile});
    putCalls++;lastBody=options.body;lastUrl=url;lastHeaders=options.headers;
    return response(upstreamFailure?{secret:'BUNNY_SECRET_MUST_NOT_LEAK'}:{},upstreamFailure?500:201);
  };
  const app=handler.createHandler({env,fetcher,verify:async token=>{if(token!=='good-token')throw Error('invalid');return claims;},allow:()=>!blocked});
  const server=http.createServer((req,res)=>{
    res.status=code=>{res.statusCode=code;return res;};res.json=body=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return res;};
    app(req,res).catch(error=>{res.statusCode=500;res.end('unexpected');});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address='http://127.0.0.1:'+server.address().port;
  const originalDirs=(await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('lamsat-upload-'));
  const jpg=await sharp({create:{width:20,height:20,channels:3,background:'#cba52d'}}).jpeg().toBuffer();
  const png=await sharp(jpg).png().toBuffer(),webp=await sharp(jpg).webp().toBuffer();
  const form=(bytes=jpg,type='image/jpeg',name='عطر.jpg')=>{const data=new FormData();data.append('file',new Blob([bytes],{type}),name);return data;};
  const request=(body=form(),headers={})=>fetch(address,{method:'POST',headers:{Authorization:'Bearer good-token',Origin:'https://lamsatruh.com',...headers},body});
  try {
    await t.test('preflight, allowed www and method constraints',async()=>{
      const pre=await fetch(address,{method:'OPTIONS',headers:{Origin:'https://www.lamsatruh.com'}});assert.equal(pre.status,204);assert.equal(pre.headers.get('access-control-allow-origin'),'https://www.lamsatruh.com');assert.equal(pre.headers.get('cache-control'),'no-store');
      assert.equal((await fetch(address)).status,405);
      assert.equal((await fetch(address,{method:'OPTIONS',headers:{Origin:'https://lamsatruh.com.evil.test'}})).status,403);
    });
    await t.test('missing/forged tokens and absent TOTP or email are denied before upload',async()=>{
      assert.equal((await request(form(),{Authorization:''})).status,401);
      assert.equal((await request(form(),{Authorization:'Bearer forged'})).status,401);
      claims={...validClaims,firebase:{}};assert.equal((await request()).status,403);
      claims={...validClaims,email_verified:false};assert.equal((await request()).status,403);claims={...validClaims};assert.equal(putCalls,0);
    });
    await t.test('disabled/revoked Auth and inactive/removed permission are denied',async()=>{
      disabled=true;assert.equal((await request()).status,403);disabled=false;
      revoked=true;assert.equal((await request()).status,401);revoked=false;
      profile={active:{booleanValue:false},role:{stringValue:'admin'}};assert.equal((await request()).status,403);
      profile={active:{booleanValue:true},role:{stringValue:'viewer'}};assert.equal((await request()).status,403);
      profile={active:{booleanValue:true},role:{stringValue:'admin'}};
    });
    await t.test('real JPG/PNG/WEBP decode into safe JPEG with stable response contract',async()=>{
      for(const [bytes,type,name] of [[jpg,'image/jpeg','oud.jpg'],[png,'image/png','oud.png'],[webp,'image/webp','oud.webp']]){
        const result=await request(form(bytes,type,name));assert.equal(result.status,200);const data=await result.json();assert.equal(data.success,true);assert.match(data.path,/^products\/[0-9a-f-]{36}\.jpg$/);assert.equal(data.url,env.BUNNY_CDN_URL+'/'+data.path);assert.equal(lastUrl,env.BUNNY_STORAGE_ENDPOINT+'/'+data.path);assert.equal(lastHeaders['Content-Type'],'image/jpeg');assert.equal(lastHeaders.AccessKey,'private-test-key');assert.equal((await sharp(lastBody).metadata()).format,'jpeg');
      }
    });
    await t.test('explicit upload permission works without admin email allowlist',async()=>{
      profile={active:{booleanValue:true},role:{stringValue:'viewer'},permissions:{arrayValue:{values:[{stringValue:'media.upload'}]}}};assert.equal((await request()).status,200);profile={active:{booleanValue:true},role:{stringValue:'admin'}};
    });
    await t.test('rate-limited requests return retry advice without storing a file',async()=>{
      const before=putCalls;blocked=true;const result=await request();assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'60');assert.equal(putCalls,before);blocked=false;
    });
    await t.test('fake content, wrong extension, multiple files/fields and oversized images rejected',async()=>{
      const before=putCalls;
      assert.equal((await request(form(Buffer.from('<script>evil</script>')))).status,400);
      assert.equal((await request(form(png,'image/jpeg','fake.jpg'))).status,400);
      assert.equal((await request(form(jpg,'image/jpeg','evil.html'))).status,400);
      const multi=form();multi.append('file',new Blob([jpg],{type:'image/jpeg'}),'second.jpg');assert.equal((await request(multi)).status,413);
      const fields=form();fields.append('admin','true');assert.equal((await request(fields)).status,413);
      assert.equal((await request(form(Buffer.alloc(4*1024*1024+1),'image/jpeg','large.jpg'))).status,413);
      const tooWide=await sharp({create:{width:8193,height:1,channels:3,background:'#fff'}}).png().toBuffer();assert.equal((await request(form(tooWide,'image/png','wide.png'))).status,400);
      assert.equal(putCalls,before);
    });
    await t.test('storage/network errors do not disclose internal messages or secrets',async()=>{
      upstreamFailure=true;const failed=await request();assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes('SECRET'));upstreamFailure=false;
      fetchFailure=true;const unavailable=await request();assert.equal(unavailable.status,503);assert.ok(!(await unavailable.text()).includes('SECRET'));fetchFailure=false;
    });
  } finally {
    await new Promise(resolve=>server.close(resolve));
    const remaining=(await fs.readdir(os.tmpdir())).filter(name=>name.startsWith('lamsat-upload-')&&!originalDirs.includes(name));assert.deepEqual(remaining,[],'request temp folders must be cleaned');
  }
});

test('Vercel parser configuration survives CommonJS export assignment',()=>assert.equal(handler.config.api.bodyParser,false));
