from PIL import Image, ImageDraw, ImageFilter, ImageOps
import random
random.seed(7)
W,H=4961,3508
P='photos/'
g=Image.radial_gradient('L').resize((W,H)); g=ImageOps.invert(g)
canvas=Image.composite(Image.new('RGB',(W,H),(255,255,255)),Image.new('RGB',(W,H),(212,212,220)),g).convert('RGBA')
def fill(path,w,h,bias=0.3,crop=None):
    im=Image.open(P+path).convert('RGB')
    if crop: im=im.crop(crop)
    s=max(w/im.width,h/im.height); im=im.resize((round(im.width*s)+1,round(im.height*s)+1),Image.LANCZOS)
    x=(im.width-w)//2; y=int((im.height-h)*bias)
    return im.crop((x,y,x+w,y+h))
def card(path,cx,cy,w,h,ang,bias=0.3,crop=None,b=16,r=50):
    im=fill(path,w,h,bias,crop)
    f=Image.new('RGB',(w+2*b,h+2*b),'white'); f.paste(im,(b,b))
    m=Image.new('L',f.size,0); ImageDraw.Draw(m).rounded_rectangle((0,0,f.width-1,f.height-1),r,fill=255)
    c=f.convert('RGBA'); c.putalpha(m); c=c.rotate(ang,expand=True,resample=Image.BICUBIC)
    sh=Image.new('RGBA',(c.width+240,c.height+240),(0,0,0,0)); sh.paste((0,0,0,255),(120,120),c.getchannel('A').point(lambda v:int(v*.5)))
    sh=sh.filter(ImageFilter.GaussianBlur(32))
    x,y=int(cx-c.width/2),int(cy-c.height/2)
    canvas.paste(sh,(x-120+14,y-120+24),sh); canvas.paste(c,(x,y),c)
# hero
hp=Image.open(P+'5.45.40_PM.jpeg').convert('RGB'); hh=3300; hp=hp.resize((round(hp.width*hh/hp.height),hh),Image.LANCZOS)
m=Image.new('L',hp.size,0); ImageDraw.Draw(m).rectangle((170,110,hp.width-170,hp.height-110),fill=255); m=m.filter(ImageFilter.GaussianBlur(120))
h=hp.convert('RGBA'); h.putalpha(m); canvas.paste(h,(W//2-hp.width//2,H//2-hp.height//2),h)
L=['5.45.43_PM.jpeg','5.45.42_PM_2.jpeg','5.45.41_PM_1.jpeg','5.45.42_PM.jpeg','5.43.20_PM.jpeg','5.45.43_PM_1.jpeg','5.45.42_PM_1.jpeg','5.45.45_PM_1.jpeg']
rows=[440,1290,2140,2990]
for i,p in enumerate(L):
    col=i%2; row=i//2
    cx=[360,990][col]+random.randint(-20,20); cy=rows[row]+(0 if col==0 else 60)+random.randint(-15,15)
    crop=(0,160,720,1440) if p.startswith('5.43.20') else None
    card(p,cx,cy,570,760,random.uniform(-4,4),0.25,crop)
R=['5.45.41_PM.jpeg','5.45.40_PM_1.jpeg','5.45.43_PM_2.jpeg','5.45.44_PM.jpeg','5.45.44_PM_1.jpeg','5.45.44_PM_2.jpeg','5.45.45_PM.jpeg']
rr=[(3980,430),(3980,1290),(3980,2150),(3980,3010),(4590,640),(4590,1740),(4590,2840)]
for p,(cx,cy) in zip(R,rr):
    tall = cx==4590
    card(p,cx+random.randint(-20,20),cy+random.randint(-15,15),570,1000 if tall else 760,random.uniform(-4,4),0.25)
out=canvas.convert('RGB'); out.save('collage_A3_all16.png',dpi=(300,300)); out.save('collage_A3_all16.pdf',resolution=300)
out.resize((1240,877)).save('/tmp/claude-0/prev2.png')
