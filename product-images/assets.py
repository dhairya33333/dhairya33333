#!/usr/bin/env python3
"""Sample artwork used as the 'customer content' on product renders.

Everything here is generated procedurally (no stock photos, no licensing):
placeholder photos, print designs, logo marks. Output: <out>/assets/*.png|jpg
Usage: python3 assets.py <out_dir>
"""
import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONTS = '/usr/share/fonts/opentype/inter/'
NAVY, SKY, MID, ICE = (18, 50, 79), (111, 177, 240), (30, 91, 148), (232, 241, 251)


def font(size, weight='ExtraBold', display=True):
    name = ('InterDisplay-' if display else 'Inter-') + weight + '.otf'
    return ImageFont.truetype(FONTS + name, size)


def rng(seed):
    return np.random.default_rng(seed)


# ------------------------------------------------------------ placeholder photos
def _grad(h, w, stops):
    """vertical gradient from list of (pos, (r,g,b))"""
    y = np.linspace(0, 1, h)[:, None]
    out = np.zeros((h, w, 3))
    for c in range(3):
        xs = [s[0] for s in stops]
        ys = [s[1][c] for s in stops]
        out[:, :, c] = np.interp(y, xs, ys)[:, :1] * np.ones((1, w))
    return out


def _ridge(w, r, base, amp, rough):
    x = np.linspace(0, 1, w)
    y = np.zeros(w)
    for o in range(1, 7):
        f = rough * 2 ** o / 4
        y += (r.random() - 0.5) * 0 + np.sin(x * f * 2 * math.pi + r.random() * 6.28) * amp / (1.6 ** o)
    return base + y


def _finish(arr, r, grain=0.035, vig=0.28):
    h, w, _ = arr.shape
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2)
    arr = arr * (1 - vig * np.clip(d - 0.35, 0, 1))[:, :, None]
    arr = arr + r.normal(0, grain * 255, arr.shape[:2])[:, :, None]
    return Image.fromarray(np.clip(arr, 0, 255).astype('uint8'))


def photo(kind, w=1600, h=1200, seed=1):
    r = rng(seed)
    if kind == 'sunset':
        a = _grad(h, w, [(0, (28, 36, 90)), (.35, (190, 80, 110)), (.55, (250, 160, 90)), (.58, (255, 205, 140)),
                         (.585, (60, 80, 120)), (1, (14, 24, 50))])
        yy, xx = np.mgrid[0:h, 0:w]
        sx, sy = w * .62, h * .55
        d = np.sqrt((xx - sx) ** 2 + (yy - sy) ** 2)
        glow = np.exp(-(d / (w * .22)) ** 2)[:, :, None]
        a = a + glow * np.array([255, 190, 110]) * .55
        a[d < w * .035] = [255, 244, 214]
        sea = yy > h * .585
        refl = np.exp(-(((xx - sx) / (w * .05)) ** 2)) * (r.random((h, 1)) > .35) * sea
        a += refl[:, :, None] * np.array([255, 170, 90]) * .6
        img = _finish(a, r)
        dr = ImageDraw.Draw(img)
        dr.polygon([(0, h), (0, h * .86), (w * .12, h * .9), (w * .3, h * .96), (w * .4, h)], fill=(8, 12, 24))
        return img.filter(ImageFilter.GaussianBlur(.6))
    if kind == 'mountain':
        a = _grad(h, w, [(0, (96, 150, 214)), (.55, (214, 228, 244)), (1, (240, 240, 235))])
        img = Image.fromarray(a.astype('uint8'))
        dr = ImageDraw.Draw(img)
        cols = [(150, 176, 206), (110, 142, 176), (74, 104, 140), (40, 66, 96), (22, 40, 64)]
        for i, c in enumerate(cols):
            base = h * (.50 + i * .1)
            ys = _ridge(w, r, base, h * (.14 - i * .015), 3 + i)
            pts = [(x, ys[x]) for x in range(0, w, 4)] + [(w, h), (0, h)]
            dr.polygon(pts, fill=c)
            if i < 3:
                img = img.filter(ImageFilter.GaussianBlur(1.2 - i * .3))
                dr = ImageDraw.Draw(img)
        return _finish(np.asarray(img).astype(float), r)
    if kind == 'city':
        a = _grad(h, w, [(0, (20, 28, 70)), (.5, (150, 90, 130)), (.8, (240, 160, 110)), (1, (30, 30, 50))])
        img = Image.fromarray(a.astype('uint8'))
        dr = ImageDraw.Draw(img)
        x = 0
        while x < w:
            bw = int(r.integers(60, 150))
            bh = int(r.integers(int(h * .18), int(h * .62)))
            col = int(r.integers(14, 34))
            dr.rectangle([x, h - bh, x + bw, h], fill=(col, col + 4, col + 18))
            for wy in range(h - bh + 14, h - 10, 26):
                for wx in range(x + 8, x + bw - 10, 20):
                    if r.random() > .55:
                        dr.rectangle([wx, wy, wx + 8, wy + 12], fill=(255, 214, 120))
            x += bw + int(r.integers(0, 10))
        return _finish(np.asarray(img).astype(float), r).filter(ImageFilter.GaussianBlur(.7))
    if kind == 'bokeh':
        a = _grad(h, w, [(0, (240, 120, 150)), (.5, (250, 190, 120)), (1, (120, 90, 170))])
        base = Image.fromarray(a.astype('uint8'))
        lay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        dr = ImageDraw.Draw(lay)
        for _ in range(60):
            rad = int(r.integers(30, 120))
            x, y = int(r.integers(0, w)), int(r.integers(0, h))
            c = (int(r.integers(220, 255)), int(r.integers(190, 255)), int(r.integers(150, 255)), int(r.integers(40, 110)))
            dr.ellipse([x - rad, y - rad, x + rad, y + rad], fill=c)
        lay = lay.filter(ImageFilter.GaussianBlur(5))
        base.paste(lay, (0, 0), lay)
        return _finish(np.asarray(base).astype(float), r, vig=.2)
    if kind == 'meadow':
        a = _grad(h, w, [(0, (140, 196, 240)), (.5, (214, 236, 250)), (.52, (110, 170, 90)), (1, (40, 96, 52))])
        img = Image.fromarray(a.astype('uint8'))
        dr = ImageDraw.Draw(img)
        for _ in range(900):
            x, y = int(r.integers(0, w)), int(r.integers(int(h * .55), h))
            s = 2 + (y - h * .55) / h * 14
            c = [(255, 250, 240), (250, 214, 90), (244, 150, 170), (190, 160, 240)][int(r.integers(0, 4))]
            dr.ellipse([x - s, y - s, x + s, y + s], fill=c)
        return _finish(np.asarray(img.filter(ImageFilter.GaussianBlur(.8))).astype(float), r)
    # 'abstract'
    a = _grad(h, w, [(0, (30, 70, 140)), (.5, (110, 70, 190)), (1, (240, 110, 150))])
    img = Image.fromarray(a.astype('uint8'))
    dr = ImageDraw.Draw(img, 'RGBA')
    for _ in range(14):
        rad = int(r.integers(80, 340))
        x, y = int(r.integers(0, w)), int(r.integers(0, h))
        dr.ellipse([x - rad, y - rad, x + rad, y + rad], fill=(255, 255, 255, int(r.integers(14, 46))))
    return _finish(np.asarray(img).astype(float), r, vig=.18)


PHOTO_KINDS = ['sunset', 'mountain', 'city', 'bokeh', 'meadow', 'abstract']


# ------------------------------------------------------------ marks and designs
def mark(size=512, fg=NAVY, bg=None):
    """Neutral sample-brand mark (two interlocking rounded shapes)."""
    im = Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = size
    d.rounded_rectangle([s * .18, s * .12, s * .58, s * .62], radius=s * .2, outline=fg, width=int(s * .09))
    d.rounded_rectangle([s * .42, s * .38, s * .82, s * .88], radius=s * .2, outline=fg, width=int(s * .09))
    return im


def text_center(d, xy, text, f, fill, anchor='mm'):
    d.text(xy, text, font=f, fill=fill, anchor=anchor)


def card_front(w=1800, h=1050, brand='NOVA STUDIO', accent=SKY):
    im = Image.new('RGB', (w, h), NAVY)
    d = ImageDraw.Draw(im)
    for i in range(6):
        d.ellipse([w * .55 + i * 40, -h * .5 + i * 30, w * 1.4 + i * 40, h * .9 + i * 30], outline=(26 + i * 4, 66 + i * 5, 104 + i * 6), width=3)
    m = mark(420, (255, 255, 255))
    im.paste(m, (int(w * .08), int(h * .10)), m)
    text_center(d, (w * .08, h * .72), brand, font(86), (255, 255, 255), 'lm')
    text_center(d, (w * .08, h * .84), 'DESIGN  •  PRINT  •  BRAND', font(38, 'SemiBold', False), accent, 'lm')
    return im


def card_back(w=1800, h=1050, accent=SKY):
    im = Image.new('RGB', (w, h), (250, 250, 248))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w * .04, h], fill=accent)
    text_center(d, (w * .12, h * .24), 'Aarav Mehta', font(92), NAVY, 'lm')
    text_center(d, (w * .12, h * .35), 'Founder & Creative Director', font(44, 'Medium', False), MID, 'lm')
    rows = [('+91 98765 43210', 'T'), ('hello@novastudio.in', 'E'), ('www.novastudio.in', 'W'), ('Dombivli, Mumbai 421201', 'A')]
    for i, (t, k) in enumerate(rows):
        y = h * (.52 + i * .1)
        d.ellipse([w * .12, y - 24, w * .12 + 48, y + 24], fill=NAVY)
        text_center(d, (w * .12 + 24, y), k, font(26, 'Bold', False), (255, 255, 255))
        text_center(d, (w * .12 + 84, y), t, font(44, 'Medium', False), NAVY, 'lm')
    m = mark(360, NAVY)
    im.paste(m, (int(w * .70), int(h * .30)), m)
    return im


def mask_of(img_fn, w=1800, h=1050):
    """White where artwork should be glossy / foiled (the mark + brand name)."""
    im = Image.new('L', (w, h), 0)
    d = ImageDraw.Draw(im)
    m = mark(420, (255, 255, 255)).split()[3]
    im.paste(255, (int(w * .08), int(h * .10)), m)
    d.text((w * .08, h * .72), 'NOVA STUDIO', font=font(86), fill=255, anchor='lm')
    return im


def letterhead(w=1240, h=1754, brand='NOVA STUDIO'):
    im = Image.new('RGB', (w, h), (252, 252, 250))
    d = ImageDraw.Draw(im)
    m = mark(150, NAVY)
    im.paste(m, (90, 80), m)
    d.text((260, 120), brand, font=font(44), fill=NAVY, anchor='lm')
    d.text((260, 168), 'DESIGN • PRINT • BRAND', font=font(18, 'SemiBold', False), fill=MID, anchor='lm')
    d.rectangle([90, 250, w - 90, 254], fill=SKY)
    y = 380
    for i in range(18):
        ln = w - 180 - (i % 5) * 90 - (60 if i in (5, 11) else 0)
        d.rounded_rectangle([90, y, 90 + ln, y + 12], radius=6, fill=(214, 220, 228))
        y += 44 if i not in (5, 11) else 90
    d.rectangle([0, h - 110, w, h], fill=NAVY)
    d.text((90, h - 55), 'www.novastudio.in   •   hello@novastudio.in   •   +91 98765 43210', font=font(24, 'Medium', False), fill=(255, 255, 255), anchor='lm')
    return im


def flyer(w=1240, h=1754):
    im = Image.new('RGB', (w, h), SKY)
    d = ImageDraw.Draw(im)
    d.rectangle([0, h * .55, w, h], fill=NAVY)
    d.ellipse([w * .35, h * .08, w * 1.2, h * .8], fill=(140, 198, 248))
    d.text((90, 160), 'GRAND', font=font(220), fill=NAVY, anchor='lm')
    d.text((90, 380), 'OPENING', font=font(220), fill=(255, 255, 255), anchor='lm')
    d.text((90, 560), 'SALE', font=font(150), fill=NAVY, anchor='lm')
    d.text((90, h * .64), 'Flat 30% off on all services', font=font(60, 'Bold', False), fill=(255, 255, 255), anchor='lm')
    d.rounded_rectangle([90, h * .72, 560, h * .72 + 120], radius=60, fill=SKY)
    d.text((325, h * .72 + 60), 'VISIT US TODAY', font=font(38), fill=NAVY, anchor='mm')
    d.text((90, h * .93), 'www.novastudio.in   |   +91 98765 43210', font=font(34, 'Medium', False), fill=(220, 235, 250), anchor='lm')
    return im


def envelope_art(w=1800, h=800):
    im = Image.new('RGB', (w, h), (250, 250, 246))
    d = ImageDraw.Draw(im)
    m = mark(190, NAVY)
    im.paste(m, (70, 60), m)
    d.text((290, 110), 'NOVA STUDIO', font=font(54), fill=NAVY, anchor='lm')
    d.text((290, 164), 'Dombivli, Mumbai 421201', font=font(26, 'Medium', False), fill=MID, anchor='lm')
    d.rectangle([0, h - 28, w, h], fill=SKY)
    return im


def banner_art(w=2400, h=800, text='GRAND OPENING', sub='NOVA STUDIO  •  OPENING SOON  •  DOMBIVLI'):
    im = Image.new('RGB', (w, h), NAVY)
    d = ImageDraw.Draw(im)
    for i in range(8):
        d.ellipse([w * (.6 + i * .03), -h * .6, w * 1.5, h * 1.3], outline=(26 + i * 4, 66 + i * 5, 104 + i * 6), width=4)
    m = mark(300, (255, 255, 255))
    im.paste(m, (90, int(h * .5 - 150)), m)
    d.text((470, h * .40), text, font=font(190), fill=(255, 255, 255), anchor='lm')
    d.text((474, h * .74), sub, font=font(52, 'SemiBold', False), fill=SKY, anchor='lm')
    return im


def mug_wrap(photo_img, text, w=2400, h=1000, dark=False):
    from PIL import ImageOps
    bg = (20, 22, 26) if dark else (255, 255, 255)
    im = Image.new('RGB', (w, h), bg)
    ph = ImageOps.fit(photo_img, (760, 820))
    im.paste(ph, (500, 90))
    d = ImageDraw.Draw(im)
    fg = (255, 255, 255) if dark else NAVY
    d.text((1330, 360), text[0], font=font(135), fill=fg, anchor='lm')
    d.text((1330, 520), text[1], font=font(135), fill=SKY if not dark else (255, 200, 120), anchor='lm')
    d.text((1334, 690), text[2], font=font(46, 'Medium', False), fill=fg, anchor='lm')
    return im



def _arc_pts(cx, cy, r, a0, a1, n=40):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def _devdha_piece():
    # same geometry as the vector logo used in the videos (viewBox 170 80 320 495)
    pts = [(243, 360), (243, 208.75)]
    pts += _arc_pts(361.5, 208.75, 118.75, 180, 360)          # outer arch (y down => angles 180->360 go over the top)
    pts += [(480, 445), (437, 408), (437, 208.75)]
    pts += _arc_pts(361.5, 208.75, 74.75, 360, 180)           # inner arch
    pts += [(287, 325)]
    return pts


def devdha_logo(h=800, color=(255, 255, 255, 255), ss=3):
    """Devdha mark as an RGBA image (two interlocking U shapes)."""
    w0, h0, x0, y0 = 320, 495, 170, 80
    sc = h * ss / h0
    im = Image.new('RGBA', (int(w0 * sc), int(h0 * sc)), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    top = _devdha_piece()
    bot = [(2 * 329 - x, 2 * 327.5 - y) for (x, y) in top]
    for poly in (top, bot):
        d.polygon([((x - x0) * sc, (y - y0) * sc) for x, y in poly], fill=color)
    return im.resize((int(w0 * h / h0), h), Image.LANCZOS)


def mug_wrap_devdha(w=2400, h=1000):
    """Plain-mug print: Devdha branding + 'customise your design' message."""
    im = Image.new('RGBA', (w, h), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    lg = devdha_logo(470, NAVY + (255,))
    im.paste(lg, (700, 265), lg)
    d.text((1050, 360), 'Devdha', font=font(170), fill=NAVY, anchor='lm')
    d.rectangle([1056, 470, 1560, 478], fill=SKY)
    d.text((1056, 550), 'YOUR DESIGN HERE', font=font(70), fill=MID, anchor='lm')
    d.text((1056, 640), 'Customise with your photo,', font=font(42, 'SemiBold', False), fill=NAVY, anchor='lm')
    d.text((1056, 700), 'name or logo  •  devdha.in', font=font(42, 'SemiBold', False), fill=NAVY, anchor='lm')
    return im


def tee_print(text=('MAKE IT', 'REAL'), color=NAVY, w=1400, h=1400):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    m = mark(560, color)
    im.paste(m, (w // 2 - 280, 120), m)
    d.text((w // 2, 840), text[0], font=font(190), fill=color, anchor='mm')
    d.text((w // 2, 1040), text[1], font=font(190), fill=SKY if color == NAVY else (255, 255, 255), anchor='mm')
    return im


def kid_print(w=1400, h=1400):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([200, 140, 1200, 1140], fill=(255, 214, 90, 255))
    for (x, y) in [(520, 560), (880, 560)]:
        d.ellipse([x - 70, y - 70, x + 70, y + 70], fill=(40, 40, 60, 255))
    d.arc([420, 520, 980, 960], 20, 160, fill=(40, 40, 60, 255), width=36)
    d.text((700, 1280), 'LITTLE STAR', font=font(150), fill=(30, 91, 148, 255), anchor='mm')
    return im


def calendar_page(photo_img, w=1600, h=1200, month='JANUARY', year='2027'):
    im = Image.new('RGB', (w, h), (252, 252, 250))
    ph = photo_img.copy().resize((w - 160, int(h * .52)))
    im.paste(ph, (80, 70))
    d = ImageDraw.Draw(im)
    d.text((80, h * .67), month, font=font(80), fill=NAVY, anchor='lm')
    d.text((w - 80, h * .67), year, font=font(80, 'Medium'), fill=SKY, anchor='rm')
    cw = (w - 160) / 7
    for i, dn in enumerate('MTWTFSS'):
        d.text((80 + cw * (i + .5), h * .75), dn, font=font(30, 'Bold', False), fill=MID, anchor='mm')
    n = 0
    for row in range(5):
        for col in range(7):
            n += 1
            if n > 31:
                break
            d.text((80 + cw * (col + .5), h * (.81 + row * .052)), str(n), font=font(34, 'Medium', False), fill=(200, 60, 60) if col == 6 else NAVY, anchor='mm')
    return im


def bookmark_art(photo_img, w=500, h=1600):
    im = Image.new('RGB', (w, h), (255, 255, 255))
    ph = photo_img.copy().resize((w - 60, 1100))
    im.paste(ph, (30, 30))
    d = ImageDraw.Draw(im)
    d.text((w // 2, 1280), 'Happy', font=font(86), fill=NAVY, anchor='mm')
    d.text((w // 2, 1380), 'Reading', font=font(86), fill=SKY, anchor='mm')
    return im


def mousepad_art(photo_img, w=2000, h=1700):
    return photo_img.copy().resize((w, h))


def sipper_wrap(w=2400, h=1400):
    im = Image.new('RGB', (w, h), NAVY)
    d = ImageDraw.Draw(im)
    for i in range(14):
        d.ellipse([w * (.1 + i * .06), -h * .3, w * (.7 + i * .06), h * 1.2], outline=(26 + i * 6, 66 + i * 6, 104 + i * 8), width=5)
    m = mark(440, (255, 255, 255))
    im.paste(m, (260, 480), m)
    d.text((780, 600), 'STAY', font=font(210), fill=(255, 255, 255), anchor='lm')
    d.text((780, 830), 'HYDRATED', font=font(210), fill=SKY, anchor='lm')
    return im


def keychain_art(w=900, h=600, text='ARYA'):
    im = Image.new('RGB', (w, h), (255, 255, 255))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w, h * .12], fill=SKY)
    d.text((w // 2, h * .52), text, font=font(220), fill=NAVY, anchor='mm')
    d.text((w // 2, h * .84), 'Made with love', font=font(46, 'Medium', False), fill=MID, anchor='mm')
    return im


def lanyard_art(w=3000, h=160, text='NOVA STUDIO  '):
    im = Image.new('RGB', (w, h), NAVY)
    d = ImageDraw.Draw(im)
    x = 40
    while x < w:
        d.text((x, h / 2), text, font=font(92), fill=(255, 255, 255), anchor='lm')
        x += int(d.textlength(text, font=font(92))) + 40
        d.ellipse([x - 24, h / 2 - 12, x, h / 2 + 12], fill=SKY)
        x += 40
    return im


def invitation_art(w=1200, h=1700):
    im = Image.new('RGB', (w, h), (250, 244, 232))
    d = ImageDraw.Draw(im)
    d.rectangle([50, 50, w - 50, h - 50], outline=(176, 138, 70), width=6)
    d.rectangle([80, 80, w - 80, h - 80], outline=(176, 138, 70), width=2)
    d.text((w // 2, 420), 'You are invited', font=font(60, 'Medium', False), fill=(120, 90, 40), anchor='mm')
    d.text((w // 2, 640), 'Riya & Kabir', font=font(150), fill=(60, 40, 20), anchor='mm')
    d.text((w // 2, 860), '14 February 2027  •  7 PM', font=font(54, 'Medium', False), fill=(120, 90, 40), anchor='mm')
    d.text((w // 2, 1010), 'Grand Ballroom, Mumbai', font=font(54, 'Medium', False), fill=(120, 90, 40), anchor='mm')
    return im


def build(out):
    A = os.path.join(out, 'assets')
    os.makedirs(A, exist_ok=True)
    photos = {}
    for i, k in enumerate(PHOTO_KINDS):
        im = photo(k, seed=10 + i)
        im.save(os.path.join(A, f'photo_{k}.jpg'), quality=94)
        photos[k] = im
    mark(1024, NAVY).save(os.path.join(A, 'mark_navy.png'))
    mark(1024, (255, 255, 255)).save(os.path.join(A, 'mark_white.png'))
    card_front().save(os.path.join(A, 'card_front.png'))
    card_back().save(os.path.join(A, 'card_back.png'))
    mask_of(None).save(os.path.join(A, 'card_front_mask.png'))
    letterhead().save(os.path.join(A, 'letterhead.png'))
    flyer().save(os.path.join(A, 'flyer.png'))
    envelope_art().save(os.path.join(A, 'envelope.png'))
    banner_art().save(os.path.join(A, 'banner.png'))
    banner_art(2400, 800, 'OPEN NOW', 'DOMBIVLI  •  MON-SAT  •  10AM-8PM').save(os.path.join(A, 'banner_open.png'))
    mug_wrap_devdha().save(os.path.join(A, 'mug_wrap_devdha.png'))
    devdha_logo(1024, NAVY + (255,)).save(os.path.join(A, 'devdha_logo_navy.png'))
    mug_wrap(photos['sunset'], ('Best Dad', 'Ever', 'Happy Father’s Day')).save(os.path.join(A, 'mug_wrap_1.png'))
    mug_wrap(photos['meadow'], ('Good', 'Vibes', 'Only • Always')).save(os.path.join(A, 'mug_wrap_2.png'))
    mug_wrap(photos['city'], ('Team', 'Nova', 'Work • Create • Repeat'), dark=True).save(os.path.join(A, 'mug_wrap_magic_dark.png'))
    tee_print(color=NAVY).save(os.path.join(A, 'tee_print_navy.png'))
    tee_print(color=(255, 255, 255)).save(os.path.join(A, 'tee_print_white.png'))
    kid_print().save(os.path.join(A, 'tee_print_kid.png'))
    calendar_page(photos['mountain']).save(os.path.join(A, 'calendar_page.png'))
    bookmark_art(photos['meadow']).save(os.path.join(A, 'bookmark.png'))
    mousepad_art(photos['abstract']).save(os.path.join(A, 'mousepad.jpg'), quality=93)
    sipper_wrap().save(os.path.join(A, 'sipper_wrap.png'))
    keychain_art().save(os.path.join(A, 'keychain.png'))
    keychain_art(text='NOVA').save(os.path.join(A, 'keychain_2.png'))
    lanyard_art().save(os.path.join(A, 'lanyard.png'))
    invitation_art().save(os.path.join(A, 'invitation.png'))
    print('assets ->', A, len(os.listdir(A)), 'files')
    globals()['build_branded'](out)



# ------------------------------------------------------------------ branded placeholders (customisable products)
def ph_photo(w=1200, h=1200, hue=0, label='YOUR PHOTO HERE'):
    """Brand-blue gradient 'photo' placeholder with the Devdha mark and a prompt."""
    import colorsys
    r = rng(100 + hue)
    top = np.array([18, 50, 79]) + hue * np.array([6, 4, -4])
    bot = np.array([60, 130, 200]) + hue * np.array([-8, 6, 10])
    a = np.zeros((h, w, 3))
    y = np.linspace(0, 1, h)[:, None]
    for c in range(3):
        a[:, :, c] = (top[c] * (1 - y) + bot[c] * y) * np.ones((1, w))
    yy, xx = np.mgrid[0:h, 0:w]
    glow = np.exp(-(((xx - w * .72) / (w * .5)) ** 2 + ((yy - h * .25) / (h * .5)) ** 2))
    a += glow[:, :, None] * np.array([70, 90, 110])
    img = _finish(np.clip(a, 0, 255), r, grain=0.012, vig=0.2)
    d = ImageDraw.Draw(img)
    lg = devdha_logo(int(h * .30), (255, 255, 255, 255))
    img.paste(lg, ((w - lg.width) // 2, int(h * .22)), lg)
    d.text((w // 2, int(h * .66)), label, font=font(int(h * .062)), fill=(255, 255, 255), anchor='mm')
    d.text((w // 2, int(h * .75)), 'devdha.in', font=font(int(h * .038), 'SemiBold', False), fill=(170, 210, 250), anchor='mm')
    return img


def ink_design(w, h, color=NAVY, sub=True, aspect_lines=True):
    """Transparent-background 'YOUR DESIGN HERE' ink artwork (logo + wordmark + prompt)."""
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lg = devdha_logo(int(h * .42), color + (255,))
    im.paste(lg, ((w - lg.width) // 2, int(h * .08)), lg)
    d.text((w // 2, int(h * .62)), 'Devdha', font=font(int(h * .16)), fill=color + (255,), anchor='mm')
    d.text((w // 2, int(h * .78)), 'YOUR DESIGN HERE', font=font(int(h * .075)), fill=MID + (255,) if color == NAVY else SKY + (255,), anchor='mm')
    if sub:
        d.text((w // 2, int(h * .88)), 'Customise with your photo, name or logo', font=font(int(h * .042), 'SemiBold', False), fill=color + (255,), anchor='mm')
    return im


def patch_wrap(w=2400, h=1000):
    """White rounded print patch with branded ink (for patch mugs)."""
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([w * .26, h * .12, w * .74, h * .88], radius=60, fill=(255, 255, 255, 255))
    ink = ink_design(int(w * .40), int(h * .70))
    im.paste(ink, (int(w * .30), int(h * .17)), ink)
    return im


def magic_hot(w=2400, h=1000):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    ink = ink_design(int(w * .42), int(h * .78), color=(255, 255, 255))
    im.paste(ink, (int(w * .29), int(h * .11)), ink)
    return im


def calendar_branded(w=1600, h=1200):
    im = Image.new('RGB', (w, h), (252, 252, 250))
    ph = ph_photo(w - 160, int(h * .52))
    im.paste(ph, (80, 70))
    d = ImageDraw.Draw(im)
    d.text((80, h * .67), 'MONTH', font=font(80), fill=NAVY, anchor='lm')
    d.text((w - 80, h * .67), 'YEAR', font=font(80, 'Medium'), fill=SKY, anchor='rm')
    cw = (w - 160) / 7
    for i, dn in enumerate('MTWTFSS'):
        d.text((80 + cw * (i + .5), h * .75), dn, font=font(30, 'Bold', False), fill=MID, anchor='mm')
    n = 0
    for row in range(5):
        for col in range(7):
            n += 1
            if n > 31:
                break
            d.text((80 + cw * (col + .5), h * (.81 + row * .052)), str(n), font=font(34, 'Medium', False), fill=(200, 60, 60) if col == 6 else NAVY, anchor='mm')
    return im


def bookmark_branded(w=500, h=1600):
    im = ph_photo(w, h)
    return im


def build_branded(out):
    A = os.path.join(out, 'assets')
    for hue in range(6):
        ph_photo(1200, 1200, hue).save(os.path.join(A, f'ph_photo_{hue}.jpg'), quality=93)
    ph_photo(1600, 1200, 0).save(os.path.join(A, 'ph_photo_wide.jpg'), quality=93)
    ph_photo(1400, 1000, 1, 'YOUR PHOTO HERE').save(os.path.join(A, 'ph_photo_land.jpg'), quality=93)
    ink_design(1400, 1400).save(os.path.join(A, 'tee_ink_navy.png'))
    ink_design(1400, 1400, color=(255, 255, 255)).save(os.path.join(A, 'tee_ink_white.png'))
    _ink = ink_design(1100, 1250)
    _cv = Image.new('RGBA', (2500, 1250), (0, 0, 0, 0))
    _cv.paste(_ink, (700, 0), _ink)
    _cv.save(os.path.join(A, 'sipper_wrap_devdha.png'))
    ink_design(900, 560, sub=False).save(os.path.join(A, 'keychain_ink.png'))
    patch_wrap().save(os.path.join(A, 'mug_wrap_patch.png'))
    magic_hot().save(os.path.join(A, 'mug_wrap_magic_hot.png'))
    calendar_branded().save(os.path.join(A, 'calendar_branded.png'))
    bookmark_branded().save(os.path.join(A, 'bookmark_branded.jpg'), quality=93)
    # lanyard strap: repeating wordmark
    w, h = 3200, 180
    im = Image.new('RGB', (w, h), NAVY)
    d = ImageDraw.Draw(im)
    x = 40
    lg = devdha_logo(110, (255, 255, 255, 255))
    while x < w:
        im.paste(lg, (x, 35), lg)
        x += lg.width + 30
        d.text((x, h // 2), 'Devdha', font=font(100), fill=(255, 255, 255), anchor='lm')
        x += int(d.textlength('Devdha', font=font(100))) + 50
        d.ellipse([x - 22, h / 2 - 11, x, h / 2 + 11], fill=SKY)
        x += 60
    im.save(os.path.join(A, 'lanyard_devdha.png'))
    print('branded assets ok')


def card_front_devdha(w=1800, h=1050):
    im = Image.new('RGB', (w, h), NAVY)
    d = ImageDraw.Draw(im)
    for i in range(6):
        d.ellipse([w * .50 + i * 40, -h * .5 + i * 30, w * 1.4 + i * 40, h * .9 + i * 30], outline=(26 + i * 4, 66 + i * 5, 104 + i * 6), width=3)
    lg = devdha_logo(560, (255, 255, 255, 255))
    im.paste(lg, (int(w * .08), int(h * .10)), lg)
    d.text((w * .30, h * .36), 'Devdha', font=font(190), fill=(255, 255, 255), anchor='lm')
    d.text((w * .30, h * .58), 'YOUR DESIGN HERE', font=font(82), fill=SKY, anchor='lm')
    d.text((w * .30, h * .74), 'devdha.in', font=font(54, 'SemiBold', False), fill=(200, 224, 250), anchor='lm')
    return im


def card_back_devdha(w=1800, h=1050):
    im = Image.new('RGB', (w, h), (250, 250, 248))
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, w * .035, h], fill=SKY)
    d.text((w * .10, h * .22), 'Your Name', font=font(100), fill=NAVY, anchor='lm')
    d.text((w * .10, h * .34), 'Your title or business', font=font(46, 'Medium', False), fill=MID, anchor='lm')
    for i, t in enumerate(['+91 00000 00000', 'you@yourbrand.in', 'www.yourbrand.in', 'Your address, City']):
        y = h * (.52 + i * .1)
        d.ellipse([w * .10, y - 22, w * .10 + 44, y + 22], fill=NAVY)
        d.text((w * .10 + 80, y), t, font=font(44, 'Medium', False), fill=NAVY, anchor='lm')
    lg = devdha_logo(300, NAVY + (255,))
    im.paste(lg, (int(w * .74), int(h * .32)), lg)
    d.text((w * .765, h * .88), 'devdha.in', font=font(40, 'SemiBold', False), fill=SKY, anchor='lm')
    return im


def card_uv_alpha(w=1800, h=1050):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    lg = devdha_logo(560, (255, 255, 255, 255))
    im.paste(lg, (int(w * .08), int(h * .10)), lg)
    d.text((w * .30, h * .36), 'Devdha', font=font(190), fill=(255, 255, 255, 255), anchor='lm')
    return im


def letterhead_devdha(w=1240, h=1754):
    im = Image.new('RGB', (w, h), (252, 252, 250))
    d = ImageDraw.Draw(im)
    lg = devdha_logo(170, NAVY + (255,))
    im.paste(lg, (90, 70), lg)
    d.text((300, 120), 'Devdha', font=font(70), fill=NAVY, anchor='lm')
    d.text((300, 180), 'YOUR LETTERHEAD HERE', font=font(26, 'Bold', False), fill=MID, anchor='lm')
    d.rectangle([90, 280, w - 90, 285], fill=SKY)
    y = 400
    for i in range(18):
        ln = w - 180 - (i % 5) * 90 - (60 if i in (5, 11) else 0)
        d.rounded_rectangle([90, y, 90 + ln, y + 12], radius=6, fill=(214, 220, 228))
        y += 44 if i not in (5, 11) else 90
    d.rectangle([0, h - 110, w, h], fill=NAVY)
    d.text((90, h - 55), 'devdha.in   •   Customise your letterhead with your logo and details', font=font(24, 'Medium', False), fill=(255, 255, 255), anchor='lm')
    return im


def flyer_devdha(w=1240, h=1754):
    im = Image.new('RGB', (w, h), SKY)
    d = ImageDraw.Draw(im)
    d.rectangle([0, h * .55, w, h], fill=NAVY)
    d.ellipse([w * .35, h * .08, w * 1.2, h * .8], fill=(140, 198, 248))
    lg = devdha_logo(300, NAVY + (255,))
    im.paste(lg, (90, 80), lg)
    d.text((90, 520), 'YOUR', font=font(190), fill=NAVY, anchor='lm')
    d.text((90, 700), 'DESIGN', font=font(190), fill=(255, 255, 255), anchor='lm')
    d.text((90, 880), 'HERE', font=font(190), fill=NAVY, anchor='lm')
    d.text((90, h * .64), 'Flyers, pamphlets and leaflets', font=font(56, 'Bold', False), fill=(255, 255, 255), anchor='lm')
    d.rounded_rectangle([90, h * .72, 560, h * .72 + 120], radius=60, fill=SKY)
    d.text((325, h * .72 + 60), 'devdha.in', font=font(46), fill=NAVY, anchor='mm')
    return im


def envelope_devdha(w=1800, h=800):
    im = Image.new('RGB', (w, h), (250, 250, 246))
    d = ImageDraw.Draw(im)
    lg = devdha_logo(200, NAVY + (255,))
    im.paste(lg, (70, 60), lg)
    d.text((250, 110), 'Devdha', font=font(70), fill=NAVY, anchor='lm')
    d.text((250, 170), 'YOUR LOGO & ADDRESS HERE', font=font(30, 'Bold', False), fill=MID, anchor='lm')
    d.rectangle([0, h - 28, w, h], fill=SKY)
    for i in range(3):
        d.rounded_rectangle([w * .52, h * (.52 + i * .1), w * (.52 + .34 - i * .06), h * (.52 + i * .1) + 14], radius=7, fill=(205, 212, 222))
    return im


def banner_devdha(w=2400, h=800, text='YOUR BANNER HERE'):
    im = Image.new('RGB', (w, h), NAVY)
    d = ImageDraw.Draw(im)
    for i in range(8):
        d.ellipse([w * (.6 + i * .03), -h * .6, w * 1.5, h * 1.3], outline=(26 + i * 4, 66 + i * 5, 104 + i * 6), width=4)
    lg = devdha_logo(380, (255, 255, 255, 255))
    im.paste(lg, (110, int(h * .5 - 190)), lg)
    d.text((520, h * .38), text, font=font(150), fill=(255, 255, 255), anchor='lm')
    d.text((524, h * .70), 'Devdha  •  devdha.in', font=font(66, 'SemiBold', False), fill=SKY, anchor='lm')
    return im


def greeting_card(w=1000, h=1400):
    im = Image.new('RGB', (w, h), (250, 248, 242))
    d = ImageDraw.Draw(im)
    d.rectangle([40, 40, w - 40, h - 40], outline=NAVY, width=6)
    lg = devdha_logo(360, NAVY + (255,))
    im.paste(lg, ((w - lg.width) // 2, 200), lg)
    d.text((w // 2, 760), 'YOUR MESSAGE', font=font(96), fill=NAVY, anchor='mm')
    d.text((w // 2, 880), 'HERE', font=font(96), fill=SKY, anchor='mm')
    d.text((w // 2, 1100), 'Custom card by Devdha', font=font(46, 'Medium', False), fill=MID, anchor='mm')
    return im


def build_print(out):
    A = os.path.join(out, 'assets')
    card_front_devdha().save(os.path.join(A, 'card_front_devdha.png'))
    card_back_devdha().save(os.path.join(A, 'card_back_devdha.png'))
    card_uv_alpha().save(os.path.join(A, 'card_uv_alpha.png'))
    letterhead_devdha().save(os.path.join(A, 'letterhead_devdha.png'))
    flyer_devdha().save(os.path.join(A, 'flyer_devdha.png'))
    envelope_devdha().save(os.path.join(A, 'envelope_devdha.png'))
    banner_devdha().save(os.path.join(A, 'banner_devdha.png'))
    banner_devdha(2400, 1600, 'YOUR BOARD HERE').save(os.path.join(A, 'board_devdha.png'))
    greeting_card().save(os.path.join(A, 'greeting_card.png'))
    v = ink_design(2000, 1000, color=(255, 255, 255))
    v.save(os.path.join(A, 'vinyl_devdha.png'))
    print('print assets ok')


if __name__ == '__main__':
    build(sys.argv[1])
    build_print(sys.argv[1])
