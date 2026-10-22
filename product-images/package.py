"""Assemble the final deliverable: combined manifest (CSV), EXIF captions on digital mock-ups, README, zip."""
import csv, json, os, sys, zipfile
from PIL import Image

root = sys.argv[1]; zip_path = sys.argv[2]
rows = list(csv.DictReader(open(os.path.join(root, 'manifest_physical.csv'), encoding='utf-8')))
rows = [r for r in rows if os.path.exists(os.path.join(root, r['file']))]
dig = json.load(open(os.path.join(root, 'manifest_digital.json')))
for r in dig:
    p = os.path.join(root, r['file'])
    if not os.path.exists(p):
        continue
    try:
        im = Image.open(p); ex = Image.Exif(); ex[270] = r['alt_text']; ex[315] = 'Devdha'
        im.save(p, quality=93, exif=ex.tobytes(), subsampling=0)
    except Exception as e:
        print('exif skip', p, e)
    rows.append(r)
rows.sort(key=lambda r: (int(r['product_id']), r['file']))
fields = ['product_id', 'product', 'variant', 'view', 'file', 'alt_text', 'caption']
with open(os.path.join(root, 'manifest.csv'), 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=fields); w.writeheader(); w.writerows({k: r[k] for k in fields} for r in rows)
readme = f"""DEVDHA — PRODUCT IMAGES (catalogue of 22 Oct 2026)

{len(rows)} images, 1000 x 1000 px JPEG, one folder per product:  <product-id>-<product-name>/
File names:  <id>-<name>_<variant>_<NN>-<view>.jpg   e.g. 216-11oz-photo-mug/216-11oz-photo-mug_plain-white_01-front.jpg
manifest.csv lists every file with its product, variant, view, alt text and caption.

IMPORTANT — what these images are
- Physical products: studio-lit 3D renders, NOT camera photographs. Customisable items show Devdha branding with
  "YOUR DESIGN HERE" / "YOUR PHOTO HERE". Use the caption "Preview: your design on the <product>" (it is in manifest.csv,
  in each image's alt text and in the JPEG metadata) and replace with real photos when you have them.
- Print products (cards, envelopes, letterheads, banners) show sample artwork; caption "Preview: sample artwork".
- Digital services: illustrative mock-ups (devices / printed pieces) - captioned "Preview: illustrative mock-up".
  Image 03 of each service is an info card (what it is, turnaround, delivered digitally). No prices are shown on any image.
- Colour variants (mug trims, T-shirt colours, frame finishes) are examples; adjust to what you actually stock.
"""
open(os.path.join(root, 'README.txt'), 'w', encoding='utf-8').write(readme)
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for r in rows:
        z.write(os.path.join(root, r['file']), r['file'])
    z.write(os.path.join(root, 'manifest.csv'), 'manifest.csv'); z.write(os.path.join(root, 'README.txt'), 'README.txt')
print(len(rows), 'images packaged ->', zip_path, round(os.path.getsize(zip_path) / 1e6, 1), 'MB')
