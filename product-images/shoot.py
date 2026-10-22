"""Job runner. Run inside a Python that has bpy:
   python shoot.py -- <jobs.json> [start end]        render jobs[start:end]
   python shoot.py -- one <key> <variant> <view> <out.jpg> [bg]
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import registry
import models_a  # noqa: F401  (registers builders)
for _m in ('models_b', 'models_c'):
    try:
        __import__(_m)
    except ModuleNotFoundError:
        pass

args = sys.argv[sys.argv.index('--') + 1:]
if args[0] == 'one':
    jobs = [dict(key=args[1], variant=args[2], view=args[3], out=args[4], bg=args[5] if len(args) > 5 else 'blue')]
else:
    jobs = json.load(open(args[0]))
    if len(args) >= 3:
        jobs = jobs[int(args[1]):int(args[2])]
for j in jobs:
    t0 = time.time()
    os.makedirs(os.path.dirname(j['out']), exist_ok=True)
    if os.environ.get('SKIP_EXISTING') and os.path.exists(j['out']):
        continue
    try:
        registry.BUILDERS[j['key']](j)
        print('DONE', j['out'], round(time.time() - t0, 1), 's', flush=True)
    except Exception as e:      # keep going; failures are listed in errors.log for a re-run
        import traceback
        with open(os.environ.get('ERRLOG', 'errors.log'), 'a') as fh:
            fh.write(j['out'] + '\n' + traceback.format_exc() + '\n')
        print('FAIL', j['out'], e, flush=True)
