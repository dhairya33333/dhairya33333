"""Build jobs.json (Blender shots) + base manifest rows for the physical products from the catalogue spreadsheet."""
import csv, json, os, re, sys
import openpyxl

XLSX, OUT = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(XLSX, read_only=True)
names = {r[0]: r[1] for r in list(wb['Products'].iter_rows(values_only=True))[1:]}


def slug(t):
    t = t.lower().replace('&', 'and').replace('—', '-').replace('/', '-')
    return re.sub(r'[^a-z0-9]+', '-', t).strip('-')


PRODUCT_NOUN = {216: 'mug', 217: 'magic mug', 221: 'sipper bottle', 219: 'keychain', 220: 'lanyard keychain', 218: 'mouse pad', 232: 'bookmark', 233: 'desk calendar',
                225: 'photo frame', 226: 'photo frame', 227: 'photo frame', 228: 'polaroid prints', 229: 'polaroid prints', 230: 'polaroid prints', 231: 'polaroid prints',
                222: 'T-shirt', 223: 'polo T-shirt', 224: 'kids T-shirt', 235: 'gift set', 236: 'gift set', 237: 'gift set', 238: 'gift set',
                239: 'visiting cards', 240: 'envelopes', 241: 'letterhead and pamphlets', 242: 'banner'}
VIEW_TXT = {'front': 'front view', 'threequarter': 'three-quarter view', 'back': 'back view', 'top': 'top view', 'angled': 'angled view', 'detail': 'close-up', 'side': 'side view',
            'stack': 'stack', 'flat': 'flat-lay', 'fan': 'fanned', 'macro': 'finish close-up', 'open': 'open flap', 'edge': 'edge detail'}
PRINT_ONLY = {239, 240, 241, 242}   # printing products show sample artwork, wording differs


def vtxt(v):
    return v.replace('-', ' ')


# id -> list of (shot key, [(variant, [views])])
PLAN = {
    216: ('mug', [('plain-white', ['front', 'threequarter', 'back', 'top'])] + [('two-tone-' + c, ['threequarter']) for c in ('blue', 'red', 'black', 'green', 'yellow')] + [('patch-' + c, ['threequarter']) for c in ('black', 'blue', 'red')]),
    217: ('mug', [('magic-cold', ['front', 'threequarter']), ('magic-hot', ['front', 'threequarter', 'top'])]),
    221: ('sipper', [('plain', ['front', 'threequarter', 'back', 'detail'])]),
    219: ('keychain_sub', [('plain', ['top', 'angled', 'detail'])]),
    220: ('keychain_lan', [('plain', ['top', 'angled', 'detail'])]),
    218: ('mousepad', [('plain', ['angled', 'top', 'edge'])]),
    232: ('bookmark', [('plain', ['angled', 'top', 'detail'])]),
    233: ('calendar', [('plain', ['front', 'angled', 'detail'])]),
    225: ('frame', [('a5-black', ['front', 'angled', 'detail', 'side']), ('a5-oak', ['angled'])]),
    226: ('frame', [('a4-black', ['front', 'angled', 'detail', 'side']), ('a4-oak', ['angled'])]),
    227: ('frame', [('a3-black', ['front', 'angled', 'detail', 'side']), ('a3-oak', ['angled'])]),
    228: ('polaroid', [('7-pack', ['top', 'angled', 'side', 'detail'])]),
    229: ('polaroid', [('20-pack', ['top', 'angled', 'side', 'detail'])]),
    230: ('polaroid', [('50-pack', ['top', 'angled', 'side', 'detail'])]),
    231: ('polaroid', [('100-pack', ['top', 'angled', 'side', 'detail'])]),
    222: ('tee', [('round-white', ['front', 'angled', 'detail'])] + [('round-' + c, ['front']) for c in ('black', 'navy', 'red', 'sky')]),
    223: ('tee', [('polo-white', ['front', 'angled', 'detail'])] + [('polo-' + c, ['front']) for c in ('black', 'navy', 'red')]),
    224: ('tee', [('kids-white', ['front', 'angled', 'detail'])] + [('kids-' + c, ['front']) for c in ('yellow', 'sky', 'red')]),
    235: ('bundle', [('birthday-mini', ['top', 'angled', 'detail'])]),
    236: ('bundle', [('birthday-memory', ['top', 'angled', 'detail'])]),
    237: ('bundle', [('couple', ['top', 'angled', 'detail'])]),
    238: ('bundle', [('kids', ['top', 'angled', 'detail'])]),
    239: ('cards', [('standard', ['stack', 'flat', 'fan', 'macro'])] + [(f, ['stack', 'macro']) for f in ('spot-uv', 'foil', 'texture', 'diecut')]),
    240: ('envelope', [('dl', ['front', 'back', 'stack', 'open']), ('c5', ['front']), ('large', ['front'])]),
    241: ('letterhead', [('a4', ['stack', 'flat', 'fan', 'detail']), ('a3', ['stack', 'detail'])]),
    242: ('flex', [('flex', ['front', 'angled', 'detail']), ('sunboard', ['front', 'angled', 'side']), ('vinyl', ['front', 'angled', 'detail'])]),
}

jobs, rows = [], []
for pid, (key, variants) in PLAN.items():
    name = names[pid]
    ps = f'{pid}-{slug(name)}'
    n = 0
    for variant, views in variants:
        for v in views:
            n += 1
            fn = f'{ps}_{variant}_{n:02d}-{v}.jpg'
            noun = PRODUCT_NOUN[pid]
            if pid in PRINT_ONLY:
                alt = f'Preview: sample artwork on {name.split(":")[0].lower()} — {vtxt(variant)}, {VIEW_TXT[v]}'
            else:
                alt = f'Preview: your design on the {noun} — {vtxt(variant)}, {VIEW_TXT[v]}'
            jobs.append(dict(key=key, variant=variant, view=v, bg='blue', out=os.path.join(OUT, ps, fn), alt=alt))
            rows.append(dict(product_id=pid, product=name, variant=variant, view=v, file=f'{ps}/{fn}', alt_text=alt,
                             caption='Preview: your design on the ' + noun if pid not in PRINT_ONLY else 'Preview: sample artwork'))
json.dump(jobs, open(os.path.join(OUT, 'jobs.json'), 'w'), indent=1)
with open(os.path.join(OUT, 'manifest_physical.csv'), 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
print(len(jobs), 'jobs for', len(PLAN), 'products')
