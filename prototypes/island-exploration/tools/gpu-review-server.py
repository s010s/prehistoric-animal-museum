"""Local-only bounded review sink; never launches a browser or uploads telemetry."""
import argparse,base64,json,re,subprocess
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
p=argparse.ArgumentParser()
p.add_argument('--port',type=int,default=4386)
p.add_argument('--directory',default='prototypes/island-exploration/.review-dist')
p.add_argument('--results',default='docs/research/gpu-governance/results')
a=p.parse_args();output=Path(a.results).resolve();output.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kw):super().__init__(*args,directory=a.directory,**kw)
    def do_POST(self):
        if self.headers.get('Origin')!=f'http://127.0.0.1:{a.port}':self.send_error(403);return
        video=re.fullmatch('/__gpu-video/([a-zA-Z0-9-]+)',self.path)
        if video:
            n=int(self.headers.get('Content-Length','0'))
            if not 0<n<=180000000:self.send_error(400);return
            folder=output/video[1];folder.mkdir(exist_ok=True)
            target=folder/'capture.webm'
            with target.open('wb') as stream:
                remaining=n
                while remaining:
                    chunk=self.rfile.read(min(1048576,remaining))
                    if not chunk:self.send_error(400);return
                    stream.write(chunk);remaining-=len(chunk)
            self.send_response(200);self.end_headers();self.wfile.write(json.dumps({'saved':True,'path':str(target)}).encode());return
        m=re.fullmatch('/__gpu/([a-zA-Z0-9-]+)',self.path)
        n=int(self.headers.get('Content-Length','0'))
        if not m or not 0<n<=24000000:self.send_error(400);return
        r=json.loads(self.rfile.read(n))
        folder=output/m[1];folder.mkdir(exist_ok=True)
        r['serverHead']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
        image=r.pop('image',None)
        if image:
            if not image.startswith('data:image/png;base64,'):self.send_error(400);return
            (folder/'frame.png').write_bytes(base64.b64decode(image.split(',',1)[1]))
        (folder/'record.json').write_text(json.dumps(r,ensure_ascii=False,indent=2))
        self.send_response(200);self.end_headers();self.wfile.write(b'{"saved":true}')
    def log_message(self,fmt,*args):
        if self.command=='POST' or str(args[1] if len(args)>1 else '').startswith(('4','5')):super().log_message(fmt,*args)
ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
