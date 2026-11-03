from PIL import Image, ImageDraw, ImageFilter, ImageOps, ImageChops
import random
random.seed(3)
W,H=4961,3508; P='photos/'
# smoky grey/white background
bg=Image.new('L',(W//8,H//8))
px=bg.load()
rnd=random.Random(5)
bgs=Image.effect_noise((W//16,H//16),90).resize((W,H),Image.BICUBIC).filter(ImageFilter.GaussianBlur(60))
base=Image.new('RGB',(W,H),(205,205,212)); light=Image.new('RGB',(W,H),(250,250,252))
canvas=Image.composite(light,base,bgs.point(lambda v:max(0,min(255,(v-70)*3)))).convert('RGBA')
def load(path,crop=None):
    im=Image.open(P+path).convert('RGB')
    return im.crop(crop) if crop else im
def fill(im,w,h,bx=0.5,by=0.25):
    s=max(w/im.width,h/im.height); im=im.resize((round(im.width*s)+1,round(im.height*s)+1),Image.LANCZOS)
    x=int((im.width-w)*bx); y=int((im.height-h)*by); return im.crop((x,y,x+w,y+h))
def shadow(c,x,y):
    sh=Image.new('RGBA',(c.width+200,c.height+200),(0,0,0,0)); sh.paste((0,0,0,255),(100,100),c.getchannel('A').point(lambda v:int(v*.45)))
    sh=sh.filter(ImageFilter.GaussianBlur(26)); canvas.paste(sh,(x-100+8,y-100+16),sh)
def tile(path,x,y,w,h,r=46,feather=0,crop=None,by=0.25,bx=.5):
    im=fill(load(path,crop),w,h,bx,by).convert('RGBA')
    m=Image.new('L',(w,h),0)
    if feather:
        ImageDraw.Draw(m).rectangle((feather,feather,w-feather,h-feather),fill=255); m=m.filter(ImageFilter.GaussianBlur(feather*0.75))
    else:
        ImageDraw.Draw(m).rounded_rectangle((0,0,w-1,h-1),r,fill=255)
    im.putalpha(m)
    if not feather: shadow(im,x,y)
    canvas.paste(im,(x,y),im)
G=14
# left 2 cols x 3 rows
Lc=[(40,800),(40+800+G,800)]; Lr=[(40,1130),(40+1130+G,1130),(40+2*(1130+G),1138)]
L=['5.45.43_PM.jpeg','5.45.42_PM_2.jpeg','5.45.41_PM_1.jpeg','5.45.42_PM.jpeg','5.43.20_PM.jpeg','5.45.42_PM_1.jpeg']
for i,p in enumerate(L):
    cx,cw=Lc[i%2]; ry,rh=Lr[i//2]
    crop=(0,160,720,1440) if p.startswith('5.43.20') else None
    tile(p,cx,ry,cw,rh,crop=crop)
# right 2 cols x 3 rows
Rc=[(3560,680),(3560+680+G,681)]
R=['5.45.40_PM_1.jpeg','5.45.43_PM_1.jpeg','5.45.43_PM_2.jpeg','5.45.45_PM_1.jpeg','5.45.44_PM.jpeg','5.45.45_PM.jpeg']
for i,p in enumerate(R):
    cx,cw=Rc[i%2]; ry,rh=Lr[i//2]
    tile(p,cx,ry,cw,rh)
# centre landscapes (top-left of centre)
tile('5.45.41_PM.jpeg',1670,40,900,620)
tile('5.45.44_PM_2.jpeg',1670,674,900,640,by=.3)
# hero B top-right (feathered), hero A bottom (feathered)
tile('5.45.40_PM.jpeg',1850,1250,1650,2200,feather=140,by=0)
tile('5.45.44_PM_1.jpeg',2590,30,950,1420,feather=120,by=0)
out=canvas.convert('RGB'); out.save('collage_A3_v3.png',dpi=(300,300)); out.save('collage_A3_v3.pdf',resolution=300)
out.resize((1240,877)).save('/tmp/claude-0/prev3.png')
