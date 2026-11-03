import sys, glob
from PIL import Image, ImageDraw, ImageFilter, ImageOps
D='/tmp/claude-0/-home-user-dhairya33333/660b1244-b204-57d2-b466-69a0b1952234/images/'
W,H=4961,3508  # A3 landscape @300dpi
bg=Image.new('RGB',(W,H),(236,236,238))
# soft radial vignette background
g=Image.radial_gradient('L').resize((W,H)); g=ImageOps.invert(g)
bg=Image.composite(Image.new('RGB',(W,H),(255,255,255)),Image.new('RGB',(W,H),(214,214,220)),g.point(lambda v:v))
def card(path,h=None,w=None,ang=0,border=18,r=60):
    im=Image.open(path).convert('RGB')
    if h: im=im.resize((int(im.width*h/im.height),h),Image.LANCZOS)
    else: im=im.resize((w,int(im.height*w/im.width)),Image.LANCZOS)
    f=Image.new('RGB',(im.width+2*border,im.height+2*border),'white'); f.paste(im,(border,border))
    m=Image.new('L',f.size,0); ImageDraw.Draw(m).rounded_rectangle((0,0,f.width-1,f.height-1),r,fill=255)
    c=f.convert('RGBA'); c.putalpha(m)
    return c.rotate(ang,expand=True,resample=Image.BICUBIC)
def put(base,c,cx,cy,shadow=True):
    x,y=int(cx-c.width/2),int(cy-c.height/2)
    if shadow:
        s=Image.new('RGBA',c.size,(0,0,0,0)); s.putalpha(c.getchannel('A').point(lambda v:v*0.45))
        sh=Image.new('RGBA',(c.width+200,c.height+200),(0,0,0,0)); sh.paste((0,0,0,255),(100,100),c.getchannel('A').point(lambda v:int(v*0.5)))
        sh=sh.filter(ImageFilter.GaussianBlur(30))
        base.paste(sh,(x-100+14,y-100+22),sh)
    base.paste(c,(x,y),c)
canvas=bg.convert('RGBA')
# hero with feathered edges
hp=Image.open(D+'24.jpg').convert('RGB'); hh=3300; hp=hp.resize((int(hp.width*hh/hp.height),hh),Image.LANCZOS)
m=Image.new('L',hp.size,0); ImageDraw.Draw(m).rectangle((150,100,hp.width-150,hp.height-100),fill=255); m=m.filter(ImageFilter.GaussianBlur(110))
h=hp.convert('RGBA'); h.putalpha(m); canvas.paste(h,(W//2-hp.width//2,H//2-hp.height//2),h)
put(canvas,card(D+'25.jpg',w=1650,ang=3),1020,560)
put(canvas,card(D+'26.jpg',h=1620,ang=-4),800,2420)
put(canvas,card(D+'28.jpg',h=1500,ang=4),4180,780)
put(canvas,card(D+'27.jpg',h=1620,ang=-3),4120,2480)
canvas.convert('RGB').save('collage_A3_batch1.png',dpi=(300,300))
canvas.convert('RGB').resize((1240,877)).save('preview.png')
