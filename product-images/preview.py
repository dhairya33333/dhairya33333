"""preview.py <outdir> key:variant:view [key:variant:view ...]  -> low-res renders + contact sheet (uses system python; calls bpy python)"""
import json, os, subprocess, sys
from PIL import Image
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
jobs = []
for spec in sys.argv[2:]:
    k, v, w = spec.split(':')[:3]
    bg = spec.split(':')[3] if spec.count(':') > 2 else 'blue'
    jobs.append(dict(key=k, variant=v, view=w, bg=bg, out=os.path.join(out, f'{k}_{v}_{w}.jpg')))
jf = os.path.join(out, 'jobs.json'); json.dump(jobs, open(jf, 'w'))
env = dict(os.environ, RES=os.environ.get('RES', '420'), SAMPLES=os.environ.get('SAMPLES', '14'))
r = subprocess.run([os.environ['BPY'], '-I', 'shoot.py', '--', jf], env=env, capture_output=True, text=True)
for line in (r.stdout + r.stderr).splitlines():
    if 'Traceback' in line or 'Error' in line and 'CUEW' not in line or line.startswith('  File') or 'Exception' in line:
        print(line)
n = len(jobs); cols = min(n, 5); rows = (n + cols - 1) // cols; S = int(env['RES'])
sheet = Image.new('RGB', (cols * S, rows * S), (30, 30, 30))
for i, j in enumerate(jobs):
    if os.path.exists(j['out']):
        sheet.paste(Image.open(j['out']).resize((S, S)), ((i % cols) * S, (i // cols) * S))
sheet.save(os.path.join(out, 'sheet.jpg')); print('sheet', n)
