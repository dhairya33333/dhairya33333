"""Procedural product models (metres). Every builder returns a root Empty with the product's base on z=0."""
import math
import random

import bpy
from mathutils import Vector

import shoot_lib as L

WHITE = (0.92, 0.92, 0.90)


def _arc(cx, cz, r, a0, a1, n=8):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cz + r * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


# ------------------------------------------------------------------ mugs
def mug(wrap='mug_wrap_devdha.png', body=WHITE, inner=None, trim=None, name='mug', handle_dir=1, wrap_mat=None, h=0.095, r=0.040, magic=False):
    root = L.group(name)
    t = 0.0038
    prof = [(0.0, 0.006), (r - t - 0.004, 0.006)]
    prof += _arc(r - t - 0.004, 0.010, 0.004, -math.pi / 2, 0, 5)[1:]
    prof += [(r - t, h - 0.003)]
    prof += _arc(r - t / 2, h - 0.003, t / 2, math.pi, 0, 8)[1:]
    prof += [(r, 0.009)]
    prof += _arc(r - 0.004, 0.009, 0.004, 0, -math.pi / 2, 6)[1:]
    prof += [(0.0, 0.0)]
    body_m = L.ceramic(body) if not magic else L.principled('magic', (0.015, 0.015, 0.018), 0.05, **{'Coat_Weight': 0.5})
    trim_m = L.ceramic(trim) if trim else body_m
    mugb = L.lathe(prof, name + '_body', body_m, seg=160, mats=[body_m, trim_m], split=11 if trim else None)
    L.parent_to(mugb, root)
    if inner is not None:
        pass
    cx, a_, b_, cz = r - 0.002, 0.029, 0.31 * h, 0.52 * h
    hp = []
    for th in range(90, -91, -18):
        c_, s_ = math.cos(math.radians(th)), math.sin(math.radians(th))
        hp.append((cx + a_ * (abs(c_) ** 0.55) * (1 if c_ >= 0 else -1), 0.0, cz + b_ * (abs(s_) ** 0.8) * (1 if s_ >= 0 else -1)))
    hd = L.tube(hp, 0.0052, name + '_handle', trim_m)
    L.parent_to(hd, root)
    if wrap:
        span = math.radians(200)
        wd = r * span
        asp = 2.4
        hh = wd / asp
        z0 = h * 0.5 - hh / 2
        nx, ny = 80, 12
        me = bpy.data.meshes.new(name + '_print')
        verts, faces = [], []
        rr = r + 0.00025
        for j in range(ny + 1):
            for i in range(nx + 1):
                phi = (i / nx - 0.5) * span
                verts.append((rr * math.sin(phi), -rr * math.cos(phi), z0 + hh * j / ny))
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
        mat = wrap_mat or L.textured(name + '_printmat', wrap, rough=0.1, clearcoat=0.5, spec=0.5)
        pr = L.to_obj(me, name + '_print', mat, True)
        L.parent_to(pr, root)
    root.rotation_euler = (0, 0, math.radians(90) if handle_dir == 1 else math.radians(-90))
    # handle at +x by default; rotate so handle ends up on chosen side
    root.rotation_euler = (0, 0, 0 if handle_dir == 1 else math.pi)
    return root
