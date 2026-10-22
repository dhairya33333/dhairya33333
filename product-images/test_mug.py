import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
import shoot_lib as L
import products as P

OUT = sys.argv[sys.argv.index('--') + 1]
L.reset()
L.setup_render(res=int(os.environ.get('RES', 900)), samples=int(os.environ.get('SAMPLES', 32)))
L.set_world((0.9, 0.92, 0.95), 0.25)
L.backdrop((0.55, 0.57, 0.60))
m = P.mug()
m.rotation_euler = (0, 0, math.radians(-18))
L.studio_lights((0, 0, 0.05), scale=1.0, key_power=float(os.environ.get('KEY', 60)))
L.camera((-0.20, -0.46, 0.15), (0.012, 0, 0.047), lens=85, fstop=14)
L.render(OUT)
