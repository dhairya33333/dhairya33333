"""Group A: drinkware (mugs, sipper), keychains, mouse pad, bookmark, calendar."""
import math

import bpy

import common as C
import products as P
import shoot_lib as L
from registry import register

COL = {  # linear-ish colours for ceramics / fabrics
    'white': (0.92, 0.92, 0.90), 'blue': (0.035, 0.20, 0.55), 'red': (0.55, 0.04, 0.05), 'black': (0.018, 0.018, 0.02),
    'green': (0.04, 0.35, 0.12), 'yellow': (0.85, 0.62, 0.04), 'navy': (0.02, 0.07, 0.15), 'pink': (0.8, 0.25, 0.4),
}


# ------------------------------------------------------------------ mugs
@register('mug')
def mug(job):
    v = job['variant']                     # plain-white | two-tone-<c> | patch-<c> | magic-cold | magic-hot
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=1.0)
    if v == 'plain-white':
        m = P.mug()
    elif v.startswith('two-tone-'):
        m = P.mug(trim=COL[v.split('-')[2]])
    elif v.startswith('patch-'):
        c = COL[v.split('-')[1]]
        m = P.mug(wrap='mug_wrap_patch.png', body=c)
    elif v == 'magic-cold':
        m = P.mug(wrap=None, magic=True)
    elif v == 'magic-hot':
        m = P.mug(wrap='mug_wrap_magic_hot.png', magic=True)
    else:
        raise ValueError(v)
    tgt = (0.014, 0.0, 0.0475)
    if view == 'front':
        m.rotation_euler = (0, 0, 0)
        C.cam_fit(tgt, 0.118, az=0, el=11, lens=135, fill=0.72)
    elif view == 'threequarter':
        m.rotation_euler = (0, 0, math.radians(24))
        C.cam_fit(tgt, 0.118, az=0, el=13, lens=135, fill=0.72)
    elif view == 'back':
        m.rotation_euler = (0, 0, math.radians(180))
        C.cam_fit((-0.014, 0, 0.0475), 0.118, az=0, el=11, lens=135, fill=0.72)
    elif view == 'top':
        m.rotation_euler = (0, 0, math.radians(20))
        C.cam_fit(tgt, 0.118, az=0, el=36, lens=120, fill=0.72)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ sipper bottle
@register('sipper')
def sipper(job):
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=1.5, target=(0, 0, 0.15))
    r, H = 0.034, 0.215
    body_m = L.principled('bottle', (0.9, 0.9, 0.9), 0.32, **{'Coat_Weight': 0.25})
    prof = [(0.0, 0.0), (r - 0.006, 0.0)]
    prof += [(r - 0.006 + 0.006 * math.sin(a / 6 * math.pi / 2), 0.006 - 0.006 * math.cos(a / 6 * math.pi / 2)) for a in range(1, 7)]
    prof += [(r, 0.006 + (H - 0.006) * i / 12) for i in range(1, 13)]
    prof += [(r - 0.0155 * (1 - math.cos(a / 10 * math.pi / 2)) - 0.0, H + 0.025 * math.sin(a / 10 * math.pi / 2)) for a in range(1, 11)]
    prof += [(0.0185, H + 0.03), (0.0185, H + 0.036), (0.0, H + 0.036)]
    root = L.group('sipper')
    L.parent_to(L.lathe(prof, 'bottle', body_m, seg=128), root)
    cap_m = L.principled('cap', COL['navy'], 0.35, **{'Coat_Weight': 0.2})
    z0 = H + 0.034
    cap = [(0.0, z0), (0.0215, z0), (0.0225, z0 + 0.004), (0.0225, z0 + 0.024), (0.0205, z0 + 0.031), (0.012, z0 + 0.034), (0.0, z0 + 0.034)]
    L.parent_to(L.lathe(cap, 'cap', cap_m, seg=96), root)
    straw = L.tube([(0.0, 0.0, z0 + 0.03), (0.0, 0.0, z0 + 0.058), (0.009, 0.0, z0 + 0.072)], 0.0055, 'straw', L.plastic((0.92, 0.92, 0.94), 0.25))
    L.parent_to(straw, root)
    loop = L.tube([(0.021, 0.0, z0 + 0.018), (0.040, 0.0, z0 + 0.026), (0.040, 0.0, z0 + 0.004), (0.021, 0.0, z0 + 0.008)], 0.0028, 'loop', cap_m)
    L.parent_to(loop, root)
    # printed wrap (front, 190 degrees)
    span = math.radians(190)
    wd = (r + 0.0003) * span
    asp = 2500 / 1250
    hh = wd / asp
    z_c = 0.105
    nx, ny = 70, 14
    me = bpy.data.meshes.new('sip_print')
    verts, faces = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            phi = (i / nx - 0.5) * span
            verts.append(((r + 0.0003) * math.sin(phi), -(r + 0.0003) * math.cos(phi), z_c - hh / 2 + hh * j / ny))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
    me.from_pydata(verts, [], faces)
    uv = me.uv_layers.new(name='UV')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            j, i = divmod(vi, nx + 1)
            uv.data[li].uv = (i / nx, j / ny)
    L.parent_to(L.to_obj(me, 'sip_print', L.textured('sip_mat', 'sipper_wrap_devdha.png', rough=0.3, clearcoat=0.3, alpha=True), True), root)
    tgt = (0.0, 0.0, 0.155)
    if view == 'front':
        root.rotation_euler = (0, 0, 0)
        C.cam_fit(tgt, 0.36, az=0, el=6, lens=135, fill=0.92)
    elif view == 'threequarter':
        root.rotation_euler = (0, 0, math.radians(18))
        C.cam_fit(tgt, 0.36, az=0, el=12, lens=135, fill=0.92)
    elif view == 'back':
        root.rotation_euler = (0, 0, math.radians(150))
        C.cam_fit(tgt, 0.36, az=0, el=8, lens=135, fill=0.92)
    elif view == 'detail':
        root.rotation_euler = (0, 0, math.radians(-12))
        C.cam_fit((0, 0, 0.24), 0.17, az=14, el=10, lens=135, fill=0.80, fstop=6)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ keychains
def _ring(center, r=0.011, tube=0.0009, rot=(math.radians(70), 0, 0)):
    return L.tube([(r * math.cos(a), r * math.sin(a), 0) for a in [i * math.pi / 6 for i in range(12)]], tube, 'ring', L.metal((0.85, 0.86, 0.88), 0.18), closed=True, loc=center, rot=rot)


def keychain_obj():
    plate_m = L.principled('plate', (0.95, 0.95, 0.95), 0.2, **{'Coat_Weight': 0.4})
    w, d, t = 0.052, 0.036, 0.0028
    plate = L.box(w, d, t, 0.0035, 'plate', plate_m, loc=(0, 0, 0))
    print_m = L.textured('kc_print', 'keychain_ink.png', rough=0.12, clearcoat=0.6, alpha=True)
    dec = L.grid_plane(w * 0.86, d * 0.86, 4, 4, 'dec', print_m, z=t + 0.00015)
    hole = L.box(0.0055, 0.0055, 0.0032, 0.0025, 'hole', L.principled('holeshadow', (0.01, 0.01, 0.012), 0.5), loc=(-w / 2 + 0.006, 0, -0.0001))
    ring = _ring((-w / 2 - 0.004, 0, 0.002), r=0.0125, rot=(math.radians(75), 0, math.radians(8)))
    link = L.tube([(-w / 2 - 0.016, 0.0, 0.002), (-w / 2 - 0.026, 0.002, 0.0015), (-w / 2 - 0.038, 0.0, 0.001)], 0.0011, 'chain', L.metal((0.85, 0.86, 0.88), 0.2))
    root = L.group('kc')
    for o in (plate, dec, hole, ring, link):
        L.parent_to(o, root)
    return root


@register('keychain_sub')
def keychain_sub(job):
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=0.5, target=(0, 0, 0.0))
    root = keychain_obj()
    root.rotation_euler = (0, 0, math.radians(-12))
    tgt = (-0.012, 0, 0.003)
    if view == 'top':
        C.cam_fit(tgt, 0.095, az=0, el=84, lens=100, fill=0.82)
    elif view == 'angled':
        C.cam_fit(tgt, 0.095, az=10, el=32, lens=100, fill=0.82)
    elif view == 'detail':
        C.cam_fit((0.0, 0, 0.003), 0.052, az=-10, el=24, lens=100, fill=0.82, fstop=5)
    C.finish(job['out'], job.get('alt'))


@register('keychain_lan')
def keychain_lan(job):
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=0.8, target=(0, 0, 0.0))
    tex = L.textured('lan_mat', 'lanyard_devdha.png', rough=0.55, spec=0.3, bump=0.25)
    pts = [(-0.07 + 0.14 * i / 40, 0.014 * math.sin(i / 40 * math.pi * 1.6) - 0.004 * (i / 40), 0.0006) for i in range(41)]
    strap = L.ribbon(pts, 0.017, 0.0014, 'strap', tex)
    # second layer to read as a folded strap
    pts2 = [(x, y + 0.0185, 0.0006) for (x, y, z) in pts]
    strap2 = L.ribbon(pts2, 0.017, 0.0014, 'strap2', tex)
    x0, y0 = pts[0][0], (pts[0][1] + pts2[0][1]) / 2
    metal = L.metal((0.82, 0.83, 0.86), 0.2)
    joint = L.box(0.011, 0.031, 0.0025, 0.0008, 'joint', metal, loc=(x0 - 0.002, y0, 0.0005))
    hook = L.tube([(x0 - 0.010, y0, 0.0012), (x0 - 0.026, y0 + 0.007, 0.0014), (x0 - 0.036, y0, 0.0016), (x0 - 0.026, y0 - 0.007, 0.0014), (x0 - 0.0105, y0 - 0.002, 0.0012)], 0.0016, 'hook', metal)
    ring = _ring((x0 - 0.052, y0, 0.003), r=0.0135, rot=(math.radians(78), 0, math.radians(-14)))
    tgt = (-0.02, 0.008, 0.002)
    if view == 'top':
        C.cam_fit((-0.03, 0.008, 0.002), 0.20, az=0, el=82, lens=100, fill=0.86)
    elif view == 'angled':
        C.cam_fit((-0.03, 0.008, 0.002), 0.20, az=14, el=30, lens=100, fill=0.86)
    elif view == 'detail':
        C.cam_fit((0.01, 0.008, 0.002), 0.095, az=-8, el=26, lens=100, fill=0.80, fstop=5)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ mouse pad
@register('mousepad')
def mousepad(job):
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=0.9, target=(0, 0, 0.0))
    w, d, t = 0.24, 0.20, 0.003
    base = L.box(w, d, t, 0.0018, 'pad', L.rubber((0.03, 0.03, 0.035), 0.8), loc=(0, 0, 0))
    top = L.grid_plane(w - 0.0012, d - 0.0012, 4, 4, 'pad_top', L.textured('pad_print', 'ph_photo_land.jpg', rough=0.55, bump=0.2), z=t + 0.0002)
    mouse_m = L.principled('mouse', (0.035, 0.036, 0.042), 0.25, **{'Coat_Weight': 0.4})
    ms = L.ellipsoid(0.031, 0.056, 0.019, 'mouse', mouse_m, loc=(0.082, -0.05, t + 0.007), rot=(0, 0, math.radians(-10)))
    wheel = L.box(0.0045, 0.012, 0.004, 0.0015, 'wheel', L.principled('wheelm', (0.6, 0.62, 0.66), 0.3, 1.0), loc=(0.082 + 0.0016, -0.05 + 0.0, t + 0.0235), rot=(0, 0, math.radians(-10)))
    tgt = (0.0, 0.0, 0.008)
    if view == 'top':
        C.cam_fit(tgt, 0.26, az=0, el=80, lens=85, fill=0.82)
    elif view == 'angled':
        C.cam_fit(tgt, 0.26, az=-18, el=28, lens=85, fill=0.82)
    elif view == 'edge':
        C.cam_fit((0.0, -0.06, 0.004), 0.18, az=-30, el=14, lens=100, fill=0.78, fstop=6)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ bookmark
@register('bookmark')
def bookmark(job):
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=0.7, target=(0, 0, 0.015))
    cover = L.fabric((0.62, 0.46, 0.30), rough=0.75, bump=0.2, name='cover', weave=900)
    book = L.box(0.150, 0.215, 0.032, 0.002, 'book', cover, loc=(0, 0, 0))
    pages = L.box(0.143, 0.208, 0.026, 0.0006, 'pages', L.paper((0.96, 0.95, 0.91)), loc=(0.002, 0.0, 0.003))
    spine = L.box(0.012, 0.215, 0.034, 0.002, 'spine', L.principled('sp', (0.5, 0.36, 0.22), 0.6), loc=(-0.075, 0, -0.001))
    root = L.group('bm')
    bm_m = L.textured('bm_print', 'bookmark_branded.jpg', rough=0.45, clearcoat=0.2)
    card = L.box(0.050, 0.150, 0.0009, 0.0004, 'bmcard', bm_m, loc=(0.0, 0.0, 0.0))
    # tassel
    tass = L.principled('tassel', (0.55, 0.78, 0.98), 0.7)
    strands = []
    for i in range(9):
        x = -0.008 + i * 0.002
        strands.append(L.tube([(x, 0.075, 0.0006), (x + 0.001, 0.088, 0.003), (x + 0.0015, 0.102, 0.001 - 0.002 * (i % 3))], 0.0006, 'strand', tass))
    knot = L.box(0.011, 0.007, 0.004, 0.0015, 'knot', tass, loc=(0.0, 0.0775, 0.0))
    bmg = L.group('bm_g')
    for o in [card, knot] + strands:
        L.parent_to(o, bmg)
    bmg.location = (0.0, 0.0, 0.0345)
    bmg.rotation_euler = (0, 0, math.radians(-24))
    tgt = (0.0, 0.02, 0.02)
    if view == 'top':
        C.cam_fit(tgt, 0.30, az=0, el=80, lens=85, fill=0.78)
    elif view == 'angled':
        C.cam_fit(tgt, 0.30, az=-22, el=34, lens=85, fill=0.78)
    elif view == 'detail':
        C.cam_fit((0.0, 0.07, 0.035), 0.11, az=-16, el=28, lens=100, fill=0.78, fstop=5)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ desk calendar
@register('calendar')
def calendar(job):
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=0.9, target=(0, 0, 0.08))
    w, h = 0.21, 0.150
    root = L.group('cal')
    tilt = math.radians(-14)
    board = L.box(w + 0.006, 0.006, h + 0.012, 0.0015, 'board', L.principled('boardm', (0.96, 0.96, 0.95), 0.5), loc=(0, 0.002, 0.0))
    page = L.grid_plane(w, h, 6, 4, 'page', L.textured('cal_page', 'calendar_branded.png', rough=0.5, clearcoat=0.1), loc=(0, -0.0016, 0.006 + h / 2), rot=(math.radians(90), 0, 0), flip_v=False)
    # grid_plane lies in XY; rotated to face -Y; check UV orientation by flipping v if needed
    for o in (board, page):
        L.parent_to(o, root)
    for i in range(14):
        x = -w / 2 + 0.012 + i * (w - 0.024) / 13
        ring = L.tube([(0.0, 0.0, 0.0), (0.0035, -0.0035, 0.0), (0.0, -0.007, 0.0), (-0.0035, -0.0035, 0.0)], 0.0007, 'spiral', L.metal((0.8, 0.82, 0.86), 0.25), closed=True,
                      loc=(x, -0.003, h + 0.006), rot=(math.radians(90), 0, 0))
        L.parent_to(ring, root)
    strut = L.box(0.060, 0.090, 0.003, 0.0008, 'strut', L.principled('strutm', (0.9, 0.9, 0.9), 0.5), loc=(0, 0.045, 0.0), rot=(math.radians(-48), 0, 0))
    L.parent_to(strut, root)
    root.rotation_euler = (tilt, 0, 0)
    tgt = (0.0, 0.0, 0.085)
    if view == 'front':
        root.rotation_euler = (tilt, 0, 0)
        C.cam_fit(tgt, 0.27, az=0, el=8, lens=100, fill=0.80)
    elif view == 'angled':
        root.rotation_euler = (tilt, 0, math.radians(-22))
        C.cam_fit(tgt, 0.27, az=0, el=16, lens=100, fill=0.80)
    elif view == 'detail':
        root.rotation_euler = (tilt, 0, math.radians(-10))
        C.cam_fit((0.0, 0.0, 0.16), 0.12, az=-18, el=10, lens=100, fill=0.80, fstop=5)
    C.finish(job['out'], job.get('alt'))
