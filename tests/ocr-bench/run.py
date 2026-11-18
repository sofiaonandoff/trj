import asyncio, json, os, re, sys, base64, unicodedata
from playwright.async_api import async_playwright
HERE=os.path.dirname(os.path.abspath(__file__))
NM=os.path.join(HERE,'../../node_modules/')
# 인터넷이 막힌 곳에서는 언어 데이터 npm 패키지(@tesseract.js-data/*)를 받은 폴더를 TESSDATA_NODE_MODULES로 알려 준다
TD=os.environ.get('TESSDATA_NODE_MODULES','')
B=os.path.join(HERE,'out')+'/'
APP=os.environ.get('APP','http://localhost:5173/')
truth=json.load(open(B+'truth.json'))
def local(url):
    m=re.match(r'https://cdn\.jsdelivr\.net/npm/(@[^/]+/[^/@]+|[^/@]+)(?:@[^/]+)?/(.*)',url)
    if not m: return None
    for base in [x for x in (NM,TD) if x]:
        p=os.path.join(base,m.group(1),m.group(2))
        if os.path.exists(p): return p
def norm(s): return re.sub(r'[\s\W_]+','',unicodedata.normalize('NFKC',s or '').lower())
def sim(a,b):
    a,b=norm(a),norm(b)
    if not a or not b: return 0
    import difflib; return difflib.SequenceMatcher(None,a,b).ratio()
async def main(tag):
    async with async_playwright() as p:
        b=await p.chromium.launch(**({'executable_path':os.environ['CHROME']} if os.environ.get('CHROME') else {}),args=['--no-sandbox'])
        ctx=await b.new_context(service_workers='block')
        async def cdn(r):
            f=local(r.request.url)
            if not f: return await r.continue_()
            await r.fulfill(path=f,content_type='application/wasm' if f.endswith('.wasm') else 'application/javascript' if f.endswith('.js') else 'application/octet-stream',headers={'Access-Control-Allow-Origin':'*'})
        await ctx.route('https://cdn.jsdelivr.net/**',cdn)
        await ctx.route('http://bench.local/**',lambda r:r.fulfill(path=B+r.request.url.split('/')[-1]))
        pg=await ctx.new_page(); await pg.goto(APP); await pg.wait_for_timeout(1500)
        score={}; rows=[]
        for t in truth:
            langs=[['eng','kor'],['eng',t.get('langs','tha')]]
            out=await pg.evaluate('''async ([f,langs])=>{
              const ocr=await import('/src/lib/ocr.ts'); const rc=await import('/src/lib/receipt.ts')
              const blob=await (await fetch('http://bench.local/'+f)).blob()
              const t0=performance.now()
              const lines=await ocr.recognizeLines(blob,langs)
              const r=rc.readText(lines,['2026-12-02','2026-12-03','2026-12-04','2026-12-05'],'THB')
              return {r, ms:Math.round(performance.now()-t0), text:lines.map(l=>l.text).join(' | ')}
            }''',[t['file'],langs])
            r=out['r']; ok={}
            if 'name' in t and t['name']: ok['name']=sim(r.get('name'),t['name'])>=0.8
            if 'date' in t: ok['date']=r.get('date')==t['date']
            if 'amount' in t: ok['amount']=abs((r.get('amount') or 0)-t['amount'])<0.01
            if 'currency' in t: ok['currency']=r.get('currency')==t['currency']
            if 'flight' in t: ok['flight']=any(f['flightNo']==t['flight'] for f in r.get('flights',[]))
            if 'code' in t: ok['code']=r.get('code')==t['code']
            if t.get('costOnly'): ok['costOnly']=bool(r.get('costOnly'))
            for k,v in ok.items(): score.setdefault(k,[0,0]); score[k][0]+=v; score[k][1]+=1
            rows.append((t['file'],out['ms'],{k:('✓' if v else '✗') for k,v in ok.items()},r.get('name'),r.get('date'),r.get('amount'),r.get('currency')))
            print(t['file'],out['ms'],'ms',' '.join(f"{k}{'✓' if v else '✗'}" for k,v in ok.items()),'|',r.get('name'),r.get('date'),r.get('amount'),r.get('currency'),r.get('code'), flush=True)
            if '-v' in sys.argv: print('   ',out['text'][:300])
        tot=sum(v[0] for v in score.values()); n=sum(v[1] for v in score.values())
        print(tag,'TOTAL',f'{tot}/{n}', {k:f'{v[0]}/{v[1]}' for k,v in score.items()})
        await b.close()
asyncio.run(main(sys.argv[1] if len(sys.argv)>1 else 'run'))
