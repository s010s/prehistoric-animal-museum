"""Local-only E00 preview/evidence sink. Run from repository root; no browser launch."""
import argparse, base64, csv, json, re, subprocess
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
parser = argparse.ArgumentParser()
parser.add_argument('--port', type=int, default=4384)
parser.add_argument('--results', default='docs/research/island-e00/results')
args = parser.parse_args()
output = Path(args.results).resolve()
output.mkdir(parents=True, exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory='prototypes/island-exploration/.review-dist', **kw)
    def do_POST(self):
        origin = self.headers.get('Origin')
        if origin not in {f'http://127.0.0.1:{args.port}', 'http://127.0.0.1:4385'}:
            self.send_error(403, 'Local preview origin required'); return
        match = re.fullmatch(r'/(__e00|__e00-video|__e00-shot)/([a-zA-Z0-9-]+)', self.path)
        length = int(self.headers.get('Content-Length', '0'))
        if not match or not 0 < length <= 300_000_000:
            self.send_error(400); return
        data = self.rfile.read(length)
        folder = (output/'visual-comparison'/match[2]) if match[1]=='__e00-shot' else output / match[2]
        folder.mkdir(parents=True, exist_ok=True)
        if match[1] == '__e00-shot':
            record = json.loads(data)
            image = record.pop('image')
            if not image.startswith('data:image/png;base64,'):
                self.send_error(400, 'PNG canvas capture required'); return
            (folder/'frame.png').write_bytes(base64.b64decode(image.split(',',1)[1]))
            (folder/'state.json').write_text(json.dumps(record,indent=2,ensure_ascii=False))
        elif match[1] == '__e00-video':
            (folder / ('motion.mp4' if 'mp4' in self.headers.get('Content-Type','') else 'motion.webm')).write_bytes(data)
        else:
            record = json.loads(data)
            record['source']['actualHead'] = subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
            record['source']['actualBranch'] = subprocess.check_output(['git','branch','--show-current'],text=True).strip()
            for index, frame in enumerate(record.get('visualRecords', [])):
                image = frame.get('image', '')
                if image.startswith('data:image/png;base64,'):
                    images = folder/'screenshots'; images.mkdir(exist_ok=True)
                    (images/f'{index:03d}-{frame.get("kind","frame")}-{frame.get("tick",0)}.png').write_bytes(base64.b64decode(image.split(',',1)[1]))
            (folder/'record.json').write_text(json.dumps(record, ensure_ascii=False))
            for key in ['frames','gpu']:
                rows = record[key]
                if rows:
                    columns = list(dict.fromkeys(k for row in rows for k in row))
                    with (folder / ('frames.csv' if key=='frames' else 'gpu-passes.csv')).open('w') as f:
                        writer=csv.DictWriter(f,fieldnames=columns);writer.writeheader()
                        writer.writerows({k:json.dumps(v) if isinstance(v,(dict,list)) else v for k,v in row.items()} for row in rows)
            for name,value in [('metadata', {k:v for k,v in record.items() if k not in ['frames','gpu','resources','events','visualRecords']}),('resources',record['resources']),('events',record['events'])]:
                (folder/(name+'.json')).write_text(json.dumps(value,indent=2,ensure_ascii=False))
        self.send_response(200);self.send_header('Access-Control-Allow-Origin', origin);self.end_headers();self.wfile.write(b'{"saved":true}')
    def log_message(self, fmt, *a):
        if self.command == 'POST' or str(a[1] if len(a)>1 else '').startswith(('4','5')):
            super().log_message(fmt, *a)
ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
