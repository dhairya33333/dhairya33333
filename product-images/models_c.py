"""Group C: print & stationery (cards, envelopes, letterheads/pamphlets, flex/vinyl/board) and gift bundles."""
import math

import bmesh
import bpy

import common as C
import products as P
import shoot_lib as L
import models_a as A
import models_b as B
from registry import register


# ------------------------------------------------------------------ visiting cards
CW, CH, CT = 0.090, 0.055, 0.0006


def _card(face, finish='standard', loc=(0, 0, 0), rot=(0, 0, 0), name='card', thick=CT):
    """One printed card. face: 'front' | 'back'."""
    tex = 'card_front_devdha.png' if face == 'front' else 'card_back_devdha.png'
    r = 0.0045 if finish == 'diecut' else 0.0006
    bump = 0.9 if (finish == 'texture' and face == 'front') else 0.0
    mat = L.textured(name + '_m', tex, rough=0.55 if finish != 'texture' else 0.75, bump=bump, spec=0.35)
    c = L.box(CW, CH, thick, r, name, mat, loc=(0, 0, 0))
    g = L.group(name + '_g')
    L.parent_to(c, g)
    if face == 'front' and finish in ('spot-uv', 'foil'):
        if finish == 'foil':
            m2 = L.principled('foilm', (0.95, 0.72, 0.30), 0.16, 1.0)
        else:
            m2 = L.principled('uvm', (1, 1, 1), 0.02, **{'Coat_Weight': 1.0, 'Coat_Roughness': 0.0})
        nt = m2.node_tree
        tx = nt.nodes.new('ShaderNodeTexImage')
        tx.image = L.load_img('card_uv_alpha.png')
        nt.links.new(tx.outputs['Alpha'], nt.nodes['Principled BSDF'].inputs['Alpha'])
        ov = L.grid_plane(CW, CH, 2, 2, name + '_ov', m2, z=thick + 0.00012)
        L.parent_to(ov, g)
    g.location = loc
    g.rotation_euler = rot
    return g


@register('cards')
def cards(job):
    finish = job['variant']               # standard | spot-uv | foil | texture | diecut
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=0.7, target=(0, 0, 0.01))
    root = L.group('cards')
    stack_h = 0.016
    body = L.box(CW, CH, stack_h, 0.0006, 'stack', L.principled('stk', (0.95, 0.95, 0.93), 0.6), loc=(0, 0, 0))
    L.parent_to(body, root)
    L.parent_to(_card('front', finish, (0, 0, stack_h), (0, 0, math.radians(2)), 'top'), root)
    if view in ('stack', 'flat', 'macro'):
        L.parent_to(_card('back', finish, (0.080, -0.035, 0.0), (0, 0, math.radians(-16)), 'loose1'), root)
        L.parent_to(_card('front', finish, (-0.095, 0.030, 0.0), (0, 0, math.radians(11)), 'loose2'), root)
    if view == 'fan':
        for i in range(6):
            face = 'back' if i % 2 else 'front'
            c = _card(face, finish, (0.0, 0.0, 0.020 + i * 0.0009), (0, 0, math.radians(-30 + i * 11)), 'fan%d' % i)
            c.location = (-0.02 + 0.005 * i, -0.01, 0.020 + i * 0.0009)
            L.parent_to(c, root)
    tgt = (0.0, 0.0, 0.012)
    if view == 'stack':
        root.rotation_euler = (0, 0, math.radians(-16))
        C.cam_fit(tgt, 0.21, az=0, el=32, lens=100, fill=0.84)
    elif view == 'flat':
        C.cam_fit(tgt, 0.21, az=0, el=80, lens=100, fill=0.84)
    elif view == 'fan':
        C.cam_fit((0.0, 0.0, 0.025), 0.20, az=0, el=38, lens=100, fill=0.84)
    elif view == 'macro':
        root.rotation_euler = (0, 0, math.radians(-8))
        C.cam_fit((-0.012, 0.004, stack_h + 0.001), 0.10, az=-14, el=34, lens=100, fill=0.84, fstop=9)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ envelopes
ENV = {'dl': (0.235, 0.108), 'c5': (0.206, 0.130), 'large': (0.235, 0.311)}


def _envelope(size, paper_col=(0.95, 0.94, 0.91), name='env', flap_open=False):
    w, h = ENV[size]
    t = 0.0012
    root = L.group(name)
    body = L.box(w, h, t, 0.0004, name + '_b', L.principled('envp', paper_col, 0.6), loc=(0, 0, 0))
    L.parent_to(body, root)
    front = L.grid_plane(w - 0.001, h - 0.001, 2, 2, name + '_f', L.textured(name + '_fm', 'envelope_devdha.png', rough=0.6), z=t + 0.0001, uv_scale=(1, 1))
    L.parent_to(front, root)
    # flap on the back (z = 0 side). Triangle hinged on the top edge.
    fl = bpy.data.meshes.new(name + '_flap')
    bm = bmesh.new()
    d = h * 0.52
    vs = [bm.verts.new(v) for v in ((-w / 2, 0, 0), (w / 2, 0, 0), (0, -d, 0))]
    bm.faces.new(vs)
    bm.to_mesh(fl)
    bm.free()
    flap = L.to_obj(fl, name + '_flap', L.principled('flapm', tuple(c * 0.985 for c in paper_col), 0.6), True)
    sol = flap.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.0006
    hinge = L.group(name + '_hinge')
    hinge.location = (0, h / 2, -0.0001)
    L.parent_to(flap, hinge)
    if flap_open:
        hinge.rotation_euler = (math.radians(-125), 0, 0)
    else:
        hinge.location = (0, h / 2, -0.0007)
    L.parent_to(hinge, root)
    return root, w, h


@register('envelope')
def envelope(job):
    size = job['variant']                 # dl | c5 | large
    view = job['view']
    w, h = ENV[size]
    C.begin(job.get('bg', 'blue'), k=max(0.7, w * 2.2), target=(0, 0, 0.01))
    e1, _, _ = _envelope(size, name='e1')
    e1.location = (0, 0, 0.0)
    big = max(w, h)
    if view == 'front':
        e1.rotation_euler = (0, 0, math.radians(-8))
        C.cam_fit((0, 0, 0), big * 1.22, az=0, el=70, lens=100, fill=0.82)
    elif view == 'back':
        e1.rotation_euler = (math.radians(180), 0, math.radians(7))
        e1.location = (0, 0, 0.0012)
        C.cam_fit((0, 0, 0), big * 1.22, az=0, el=70, lens=100, fill=0.82)
    elif view == 'stack':
        for i, (dx, dy, a) in enumerate(((0.01, 0.012, 7), (-0.012, 0.024, -6))):
            ei, _, _ = _envelope(size, name='eS%d' % i)
            ei.location = (dx, dy, 0.0)
            ei.rotation_euler = (0, 0, math.radians(a))
        e1.location = (0.0, 0.0, 0.0)
        for ob in list(bpy.data.objects):
            if ob.name.startswith('eS0'):
                ob.location.z = 0.0
        C.cam_fit((0, 0.01, 0.003), big * 1.30, az=0, el=34, lens=100, fill=0.84)
    elif view == 'open':
        bpy.data.objects.remove(e1)
        e2, _, _ = _envelope(size, name='eo', flap_open=True)
        e2.rotation_euler = (math.radians(180), 0, math.radians(-6))
        e2.location = (0, 0, 0.0012)
        C.cam_fit((0, 0, 0.0), big * 1.35, az=0, el=36, lens=100, fill=0.84)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ letterheads / pamphlets
SHEET = {'a4': (0.210, 0.297), 'a3': (0.297, 0.420)}


def _sheet(size, art, loc, rot, name, thick=0.0002):
    w, h = SHEET[size]
    s = L.box(w, h, thick, 0.0002, name, L.textured(name + '_m', art, rough=0.62, spec=0.3), loc=(0, 0, 0))
    g = L.group(name + '_g')
    L.parent_to(s, g)
    g.location = loc
    g.rotation_euler = rot
    return g


@register('letterhead')
def letterhead(job):
    size = job['variant']                 # a4 | a3
    view = job['view']
    w, h = SHEET[size]
    C.begin(job.get('bg', 'blue'), k=max(0.8, h * 2.2), target=(0, 0, 0.01))
    stack_h = 0.018
    body = L.box(w, h, stack_h, 0.0003, 'ream', L.principled('reamm', (0.95, 0.95, 0.93), 0.65), loc=(0, 0, 0))
    root = L.group('lh')
    L.parent_to(body, root)
    L.parent_to(_sheet(size, 'letterhead_devdha.png', (0, 0, stack_h), (0, 0, math.radians(1.5)), 'top'), root)
    L.parent_to(_sheet(size, 'flyer_devdha.png', (0.30 * w, -0.30 * h * 0.5 - 0.02, 0.0004), (0, 0, math.radians(-14)), 'flyer'), root)
    L.parent_to(_sheet(size, 'letterhead_devdha.png', (-0.40 * w, -0.04, 0.0002), (0, 0, math.radians(10)), 'loose'), root)
    big = max(w, h)
    if view == 'stack':
        root.rotation_euler = (0, 0, math.radians(-12))
        C.cam_fit((0, 0, 0.01), big * 1.9, az=0, el=34, lens=85, fill=0.84)
    elif view == 'flat':
        C.cam_fit((0.02, -0.02, 0.01), big * 1.8, az=0, el=82, lens=85, fill=0.84)
    elif view == 'fan':
        for ob in list(root.children):
            pass
        root.rotation_euler = (0, 0, math.radians(-6))
        C.cam_fit((0.02, 0.0, 0.01), big * 1.9, az=-18, el=26, lens=85, fill=0.84)
    elif view == 'detail':
        root.rotation_euler = (0, 0, math.radians(-4))
        C.cam_fit((-w * 0.22, h * 0.34, stack_h + 0.001), big * 0.50, az=-12, el=34, lens=100, fill=0.84, fstop=4.0)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ flex / vinyl / board
@register('flex')
def flex(job):
    kind = job['variant']                 # flex | sunboard | vinyl
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=1.6, target=(0, 0, 0.6))
    root = L.group('flex')
    if kind == 'flex':
        w, h = 1.50, 0.50
        wave = L.cloth_fn(2, 0.006, 2.2)
        wallp = L.box(6.0, 0.03, 3.4, 0.004, 'wall', L.principled('wallm', (0.78, 0.80, 0.85), 0.9), loc=(0, 0.12, -0.6))
        L.parent_to(wallp, root)
        ban = L.grid_plane(w, h, 60, 20, 'banner', L.textured('ban', 'banner_devdha.png', rough=0.4, spec=0.4), loc=(0, 0.095, 0.55), rot=(math.radians(90), 0, 0),
                           fn=lambda x, y: -wave(x, y) * 1.0)
        L.parent_to(ban, root)
        eye = L.metal((0.8, 0.82, 0.86), 0.25)
        for ex_ in (-w / 2 + 0.03, -w / 4, 0, w / 4, w / 2 - 0.03):
            for ez in (0.55 - h / 2 + 0.03, 0.55 + h / 2 - 0.03):
                L.parent_to(L.lathe([(0.011, 0.0), (0.011, 0.002), (0.0065, 0.002), (0.0065, 0.0)], 'eyelet', eye, seg=24, loc=(ex_, 0.088, ez), rot=(math.radians(90), 0, 0)), root)
        cam = (0, 0.1, 0.55)
        size = w * 1.15
    elif kind == 'sunboard':
        w, h = 0.90, 0.60
        board = L.box(w, 0.006, h, 0.002, 'board', L.principled('boardedge', (0.96, 0.96, 0.95), 0.6), loc=(0, 0, 0.30))
        face = L.grid_plane(w - 0.002, h - 0.002, 2, 2, 'boardface', L.textured('boardart', 'board_devdha.png', rough=0.35, clearcoat=0.2),
                            loc=(0, -0.0032, 0.30 + h / 2), rot=(math.radians(90), 0, 0))
        L.parent_to(board, root)
        L.parent_to(face, root)
        woodm = L.wood((0.5, 0.33, 0.18), (0.7, 0.5, 0.3), 0.5, 5)
        for sx in (-0.32, 0.32):
            leg_f = L.box(0.035, 0.02, 0.55, 0.002, 'legf', woodm, loc=(sx, -0.06, 0.0), rot=(math.radians(14), 0, 0))
            leg_b = L.box(0.035, 0.02, 0.55, 0.002, 'legb', woodm, loc=(sx, 0.10, 0.0), rot=(math.radians(-16), 0, 0))
            L.parent_to(leg_f, root)
            L.parent_to(leg_b, root)
        ledge = L.box(0.82, 0.05, 0.02, 0.002, 'ledge', woodm, loc=(0, -0.045, 0.29))
        L.parent_to(ledge, root)
        root.rotation_euler = (math.radians(-4), 0, math.radians(-14))
        size = w * 1.45
        cam = (0, 0, 0.62)
    else:  # vinyl roll with a printed section unrolled
        R = 0.055
        roll = L.lathe([(0.0, -0.26), (R, -0.26), (R, 0.26), (0.0, 0.26)], 'roll', L.principled('rollm', (0.015, 0.05, 0.1), 0.25, **{'Coat_Weight': 0.8}), seg=96,
                       loc=(-0.25, 0.0, R), rot=(0, math.radians(90), math.radians(90)))
        core = L.lathe([(0.012, -0.265), (0.026, -0.265), (0.026, 0.265), (0.012, 0.265)], 'core', L.principled('corem', (0.9, 0.9, 0.88), 0.6), seg=48,
                       loc=(-0.25, 0.0, R), rot=(0, math.radians(90), math.radians(90)))
        L.parent_to(roll, root)
        L.parent_to(core, root)
        sh_w, sh_l = 0.50, 0.95
        curl = lambda x, y: 0.0
        sheet = L.grid_plane(sh_l, sh_w, 40, 10, 'vsheet', L.textured('vsheetm', 'banner_devdha.png', rough=0.15, clearcoat=0.7),
                             loc=(-0.25 + 0.0 + sh_l / 2 + R * 0.4, 0.0, 0.0012), uv_scale=(1, 1), fn=lambda x, y: 0.0)
        L.parent_to(sheet, root)
        root.rotation_euler = (0, 0, math.radians(-12))
        size = 1.10
        cam = (0.12, 0, 0.02)
    if view == 'front':
        C.cam_fit(cam, size, az=0, el=6 if kind != 'vinyl' else 62, lens=85, fill=0.84)
    elif view == 'angled':
        C.cam_fit(cam, size, az=-24, el=14 if kind != 'vinyl' else 38, lens=85, fill=0.84)
    elif view == 'detail':
        C.cam_fit((cam[0] - size * 0.28, cam[1], cam[2] + (0.18 if kind != 'vinyl' else 0.0)), size * 0.34, az=-18, el=12 if kind != 'vinyl' else 30, lens=100, fill=0.84, fstop=4.5)
    elif view == 'side':
        C.cam_fit(cam, size, az=-52, el=10 if kind != 'vinyl' else 24, lens=85, fill=0.84)
    C.finish(job['out'], job.get('alt'))


# ------------------------------------------------------------------ bundles
def _folded_tee(colour='white', scale=1.0, name='ftee'):
    base, ink = B.APP[colour]
    root = L.group(name)
    w, d, h = 0.30 * scale, 0.24 * scale, 0.034
    body = L.box(w, d, h, 0.008, 'body', L.fabric(base, 0.95, 0.15, 'ff', 1800), loc=(0, 0, 0))
    L.parent_to(body, root)
    pr = 0.12 * scale
    dec = L.grid_plane(pr, pr, 2, 2, 'p', L.textured('ftp', 'tee_ink_%s.png' % ink, rough=0.7, alpha=True), z=h + 0.0004, loc=(0, 0.0, 0))
    L.parent_to(dec, root)
    return root


def _greeting():
    root = L.group('greet')
    w, h = 0.100, 0.140
    panel = L.box(w, 0.003, h, 0.0006, 'gp', L.textured('gpm', 'greeting_card.png', rough=0.55), loc=(0, 0, 0))
    L.parent_to(panel, root)
    back = L.box(w * 0.99, 0.060, 0.002, 0.0005, 'gb', L.principled('gbm', (0.95, 0.94, 0.9), 0.6), loc=(0, 0.03, 0.0), rot=(math.radians(-62), 0, 0))
    L.parent_to(back, root)
    root.rotation_euler = (math.radians(-6), 0, 0)
    return root


@register('bundle')
def bundle(job):
    kind = job['variant']                 # birthday-mini | birthday-memory | couple | kids
    view = job['view']
    C.begin(job.get('bg', 'blue'), k=0.9, target=(0, 0, 0.03))
    kraft = L.paper((0.30, 0.20, 0.11), 0.85, 0.25)
    L.grid_plane(0.60, 0.44, 2, 2, 'kraft', kraft, z=0.0006, loc=(0, 0.01, 0), rot=(0, 0, math.radians(-3)))

    def put(obj, x, y, a=0.0, s=1.0):
        obj.location = (x, y, obj.location.z)
        obj.rotation_euler = (obj.rotation_euler.x, obj.rotation_euler.y, math.radians(a))
        obj.scale = (s, s, s)
        return obj

    if kind == 'birthday-mini':
        put(P.mug(), -0.14, 0.03, 8)
        r, _, _ = B.polaroid_obj(20)
        put(r, 0.06, -0.01, -10, 0.82)
        put(A.keychain_obj(), 0.13, -0.15, 14)
    elif kind == 'birthday-memory':
        put(P.mug(), -0.20, 0.02, 10)
        r, _, _ = B.polaroid_obj(20)
        put(r, -0.01, -0.04, -8, 0.72)
        put(_greeting(), 0.19, 0.07, -10)
        put(A.keychain_obj(), 0.14, -0.15, 12)
        fr, fw, fh = B.frame_obj('a5', 'black')
        put(fr, 0.0, 0.17, 0, 0.9)
    elif kind == 'couple':
        put(_folded_tee('white', 1.0, 'ft1'), -0.20, 0.0, 6)
        t2 = _folded_tee('navy', 1.0, 'ft2')
        put(t2, -0.20, 0.0, 6)
        t2.location.z = 0.035
        put(P.mug(), 0.02, 0.07, 12)
        put(P.mug(), 0.10, -0.06, -16)
        r, _, _ = B.polaroid_obj(20)
        put(r, 0.20, -0.14, -12, 0.60)
    elif kind == 'kids':
        put(_folded_tee('yellow', 0.78, 'ft1'), -0.12, 0.02, 8)
        r, _, _ = B.polaroid_obj(20)
        put(r, 0.09, -0.01, -10, 0.78)
        put(A.keychain_obj(), 0.12, -0.15, 12)
    tgt = (0, 0, 0.02)
    if view == 'top':
        C.cam_fit(tgt, 0.54, az=0, el=80, lens=85, fill=0.88)
    elif view == 'angled':
        C.cam_fit(tgt, 0.52, az=-16, el=34, lens=85, fill=0.90)
    elif view == 'detail':
        C.cam_fit((0.0, -0.02, 0.03), 0.34, az=14, el=26, lens=100, fill=0.88, fstop=6)
    C.finish(job['out'], job.get('alt'))
