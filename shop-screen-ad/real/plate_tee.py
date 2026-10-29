import sys;sys.path.insert(0,'/home/user/dhairya33333/product-images')
import os
from rlib import *
os.chdir('/home/user/dhairya33333/product-images')
sc=setup(32);studio()
import models_b as MB
root=MB.tee_build('tee','white',1.0,3)
root.location=(0,0,0.0);root.rotation_euler=(0,0,math.radians(-6))
for l in [o for o in bpy.data.objects if o.type=='LIGHT']:
    if l.name in('rim','fill','warm'):l.data.energy*=.25
light('rake','AREA',(-0.85,-0.45,0.22),9,(1.0,0.95,0.88),0.5,(0,0.06,0.0))
light('top','AREA',(0.2,-0.2,0.9),3,(0.8,0.88,1.0),0.8,(0,0.06,0.0))
camera((0.12,-0.62,0.52),(0.0,0.05,0.004),85,3.5,0.78)
os.chdir('/home/user/dhairya33333/shop-screen-ad/real')
render(OUT+'tee.png')
