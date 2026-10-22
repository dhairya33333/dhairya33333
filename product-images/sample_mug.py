"""Sample shoot: 11oz Photo Mug (product 216) on pure white, catalogue style.
Usage (bpy python): sample_mug.py -- <view> <out.jpg>
views: front | threequarter | back | top | blue_front | blue_threequarter
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shoot_lib as L
import products as P

VIEW, OUT = sys.argv[sys.argv.index('--') + 1:][:2]
RES = int(os.environ.get('RES', 1200))
SAMPLES = int(os.environ.get('SAMPLES', 64))
L.reset()
L.setup_render(res=RES, samples=SAMPLES, transparent=True)
L.set_world((1, 1, 1), float(os.environ.get('WORLD', 0.14)))
L.shadow_catcher()

BLUE = (0.035, 0.20, 0.55)
two_tone = VIEW.startswith('blue')
m = P.mug(trim=BLUE if two_tone else None)

TARGET = (0.0, 0.0, 0.0475)
DIST, LENS = 0.95, 135


def cam(elev_deg, az_deg=0.0, dist=DIST, lens=LENS, fstop=18, target=TARGET):
    e, a = math.radians(elev_deg), math.radians(az_deg)
    loc = (target[0] + dist * math.sin(a) * math.cos(e), target[1] - dist * math.cos(a) * math.cos(e), target[2] + dist * math.sin(e))
    L.camera(loc, target, lens=lens, fstop=fstop)


# softbox rig: big key left/front, fill right, top, and a bounce card in front for the glaze highlight
L.studio_lights((0, 0, 0.05), key_power=float(os.environ.get('KEY', 32)))
_k = L.bpy.data.objects['key']
_k.location = (-1.2, -0.9, 2.5)
_k.data.size, _k.data.size_y = 2.4, 2.0
for _n in ('rim', 'fill'):
    L.bpy.data.objects[_n].data.use_shadow = False
_s = L.area_light('strip', (-0.9, -0.75, 0.12), (0, 0, 0.05), 0.22, float(os.environ.get('STRIP', 22)), (1, 1, 1), size_y=1.1)
_s.data.use_shadow = False
L.area_light('card', (0.0, -1.2, 0.35), (0, 0, 0.05), 1.0, float(os.environ.get('CARD', 8)), (1, 1, 1), size_y=0.7)

if VIEW in ('front', 'blue_front'):
    m.rotation_euler = (0, 0, 0)
    cam(11)
elif VIEW in ('threequarter', 'blue_threequarter'):
    m.rotation_euler = (0, 0, math.radians(-32))
    cam(13)
elif VIEW == 'back':
    m.rotation_euler = (0, 0, math.radians(180))
    cam(11)
elif VIEW == 'top':
    m.rotation_euler = (0, 0, math.radians(-30))
    cam(38, dist=0.9, lens=120)

png = OUT.replace('.jpg', '.png')
L.render(png)
L.white_composite(png, OUT)
os.remove(png)
