# flat editorial vector style test (outline-free, earthy palette, textured hatch marks, faces)
OL='#6B7545';MU='#FDB022';MU2='#E59A18';CR='#F7F1DF';TC='#D9782B';SKD='#B8601E';SK2='#CC6B1F';BR='#3a2414';BK='#1a1a1a';NV='#0A2A5E';BL='#1D2FC4';LB='#BFD2FF';RD='#E2583E';WH='#FFFDF5'
def hatch(x,y,n,dx,dy,l,col,w=3,ang=-25):
    import math
    o=''
    for i in range(n):
        a=math.radians(ang)
        o+=f'<path d="M{x+i*dx} {y+i*dy} l{l*math.cos(a):.1f} {l*math.sin(a):.1f}" stroke="{col}" stroke-width="{w}" stroke-linecap="round"/>'
    return o
def face(cx,cy,skin,wink=True,smile=True,blush=True,s=1,beard=None):
    o=f'<g transform="translate({cx} {cy}) scale({s})">'
    o+=f'<ellipse cx="-50" cy="6" rx="11" ry="14" fill="{skin}"/><ellipse cx="50" cy="6" rx="11" ry="14" fill="{skin}"/>'
    o+=f'<ellipse cx="0" cy="0" rx="52" ry="62" fill="{skin}"/>'
    if blush:o+=f'<circle cx="-28" cy="22" r="9" fill="#E8744A" opacity=".45"/><circle cx="28" cy="22" r="9" fill="#E8744A" opacity=".45"/>'
    o+=f'<path d="M-30 -14 q12 -8 22 0" stroke="{BK}" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M10 -16 q12 -8 22 0" stroke="{BK}" stroke-width="4" fill="none" stroke-linecap="round"/>'
    if wink:o+=f'<path d="M-30 2 q10 -8 20 0" stroke="{BK}" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
    else:o+=f'<ellipse cx="-20" cy="3" rx="4.5" ry="6" fill="{BK}"/>'
    o+=f'<ellipse cx="20" cy="3" rx="4.5" ry="6" fill="{BK}"/>'
    o+=f'<path d="M2 8 q-8 14 2 18" stroke="{BK}" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".8"/>'
    if smile:o+=f'<path d="M-18 32 q18 16 36 0" stroke="{BK}" stroke-width="4" fill="none" stroke-linecap="round"/>'
    if beard:o+=f'<path d="M-44 20 q4 60 44 62 q40 -2 44 -62 q-10 40 -44 40 q-34 0 -44 -40Z" fill="{beard}"/><path d="M-18 32 q18 16 36 0" stroke="{skin}" stroke-width="5" fill="none" stroke-linecap="round"/>'
    return o+'</g>'
def hand(x,y,rot=0,skin=SK2,flip=1):
    return f'<g transform="translate({x} {y}) rotate({rot}) scale({flip} 1)"><path d="M-34 -8 q-4 -34 20 -38 q24 -2 34 20 q14 30 -6 50 q-22 20 -44 -10Z" fill="{skin}"/><path d="M-16 -30 q10 14 4 36 M0 -34 q12 14 10 38 M14 -24 q10 14 6 30" stroke="{BR}" stroke-width="3.5" fill="none" stroke-linecap="round"/></g>'
def mug(x,y,s=1,print_=None):
    o=f'<g transform="translate({x} {y}) scale({s})"><path d="M-60 -50 h110 v70 q0 52 -55 52 q-55 0 -55 -52Z" fill="{WH}"/><path d="M50 -30 q42 0 42 34 q0 34 -42 34" fill="none" stroke="{WH}" stroke-width="14"/><ellipse cx="-5" cy="-50" rx="55" ry="14" fill="{WH}"/><ellipse cx="-5" cy="-50" rx="46" ry="9" fill="#5a3320"/><path d="M-40 10 q-4 36 30 46" stroke="#E9E1CC" stroke-width="8" fill="none" stroke-linecap="round" opacity=".7"/>'
    if print_=='photo':o+=f'<rect x="-36" y="-26" width="62" height="52" rx="8" fill="{BL}"/><circle cx="-5" cy="-6" r="10" fill="{SK2}"/><path d="M-24 22 q19 -26 38 0Z" fill="{MU}"/>'
    return o+'</g>'
def steam(x,y,col=WH):return f'<path d="M{x} {y} q-16 -26 0 -46 q16 -22 0 -44" stroke="{col}" stroke-width="7" fill="none" stroke-linecap="round" opacity=".9"/>'
def bg(col,r=250):return f'<circle cx="300" cy="320" r="{r}" fill="{col}"/>'
def wrap(inner):return f'<svg viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">{inner}</svg>'
# 1: photo-mug woman (reference-style)
def s1():
    o=bg(NV)
    o+=f'<path d="M30 600 C30 440 110 392 300 392 C490 392 570 440 570 600Z" fill="{MU}"/><path d="M30 600 C30 520 70 460 130 430 C100 500 110 560 130 600Z" fill="{MU2}"/><path d="M570 600 C570 520 530 460 470 430 C500 500 490 560 470 600Z" fill="{MU2}"/>'
    o+=hatch(80,470,5,18,16,22,'#FFE19A')+hatch(430,450,5,18,16,22,'#FFE19A')
    o+=f'<rect x="272" y="270" width="56" height="130" rx="24" fill="{SK2}"/><path d="M236 392 q64 44 128 0 q0 -36 -64 -36 q-64 0 -64 36Z" fill="{CR}"/>'
    o+=f'<path d="M210 260 C188 130 240 70 300 70 C360 70 412 130 390 260 C396 330 360 350 340 330 L260 330 C240 350 204 330 210 260Z" fill="{BK}"/>'
    o+=face(300,230,SK2,True,True,True,1)
    o+=f'<path d="M232 190 C245 120 355 120 368 190 C340 160 260 160 232 190Z" fill="{BK}"/>'
    o+=mug(300,462,.95,'photo')+steam(300,380)
    o+=hand(232,478,-15,SK2,1)+hand(368,478,15,SK2,-1)
    o+=f'<path d="M150 540 q-30 -24 -2 -60 q36 -14 62 4 q-4 44 -60 56Z" fill="{CR}"/><path d="M450 540 q30 -24 2 -60 q-36 -14 -62 4 q4 44 60 56Z" fill="{CR}"/>'
    return wrap(o)
# 2: 3D printer
def s2():
    o=bg(BL)
    o+=f'<rect x="130" y="150" width="340" height="290" rx="34" fill="{CR}"/><rect x="150" y="170" width="300" height="250" rx="22" fill="{NV}" opacity=".9"/>'
    o+=f'<rect x="108" y="130" width="30" height="330" rx="14" fill="{MU}"/><rect x="462" y="130" width="30" height="330" rx="14" fill="{MU}"/><rect x="108" y="130" width="384" height="34" rx="16" fill="{MU2}"/>'
    o+=f'<rect x="180" y="214" width="240" height="22" rx="10" fill="{OL}"/><rect x="262" y="236" width="76" height="34" rx="12" fill="{CR}"/><path d="M286 270 h28 l-8 26 h-12Z" fill="{BK}"/><circle cx="300" cy="298" r="9" fill="{RD}"/><circle cx="300" cy="298" r="18" fill="{RD}" opacity=".3"/>'
    for i,(w,c) in enumerate([(70,TC),(88,TC),(100,SKD),(92,TC),(76,SKD),(60,TC),(48,TC)]):
        o+=f'<rect x="{300-w/2}" y="{396-i*14}" width="{w}" height="13" rx="6" fill="{c}"/>'
    o+=f'<rect x="150" y="398" width="300" height="30" rx="10" fill="{OL}"/>'
    o+=f'<circle cx="540" cy="200" r="48" fill="{CR}"/><circle cx="540" cy="200" r="18" fill="{OL}"/><path d="M500 250 q-10 80 -80 120" stroke="{CR}" stroke-width="6" fill="none"/>'
    o+=hatch(540-30,170,3,22,0,14,TC,3)+hatch(160,470,6,22,6,16,'#FFE19A',3)
    o+=f'<path d="M80 120 l8 -18 l8 18 l18 8 l-18 8 l-8 18 l-8 -18 l-18 -8Z" fill="{MU}"/>'
    return wrap(o)
# 3: couple cheers
def s3():
    o=bg(OL,260)
    o+=f'<path d="M-10 600 C-10 470 60 420 190 420 C320 420 370 470 370 600Z" fill="{MU}"/><path d="M230 600 C230 470 290 420 410 420 C540 420 610 470 610 600Z" fill="{TC}"/>'
    o+=hatch(40,500,4,18,14,22,'#FFE19A')+hatch(420,500,4,18,14,22,'#F6B77C')
    o+=f'<rect x="146" y="280" width="52" height="150" rx="22" fill="{SK2}"/><rect x="404" y="280" width="52" height="150" rx="22" fill="#E3A072"/>'
    o+='<g transform="translate(0 62)">'
    o+=f'<circle cx="130" cy="150" r="40" fill="{BK}"/><path d="M96 230 C80 110 150 70 190 70 C240 70 280 130 258 230 C258 280 240 300 220 300 L130 300 C110 290 98 280 96 230Z" fill="{BK}"/>'
    o+=face(172,235,SK2,False,True,True,.92)
    o+=f'<path d="M330 215 C320 110 380 78 430 78 C490 78 530 120 520 215 C500 170 360 170 330 215Z" fill="{BR}"/>'
    o+=face(428,235,'#E3A072',True,True,False,.92,beard=BR)
    o+='</g>'
    o+=mug(260,470,.7,'photo')+mug(340,470,.7)
    o+=hand(205,484,10,SK2,-1)+hand(395,484,-10,'#E3A072',1)
    o+=f'<path d="M300 380 q-26 -26 0 -44 q26 18 0 44Z" fill="{RD}"/>'
    return wrap(o)
# 4: tee
def s4():
    o=bg(MU,250)
    o+=f'<path d="M30 600 C30 450 110 400 300 400 C490 400 570 450 570 600Z" fill="{NV}"/>'
    o+=f'<rect x="274" y="280" width="52" height="140" rx="22" fill="#E3A072"/>'
    o+='<g transform="translate(0 58)">'
    o+=f'<path d="M212 250 C196 130 246 76 300 76 C354 76 404 130 388 250 C392 300 366 322 346 306 L254 306 C234 322 208 300 212 250Z" fill="{BK}"/>'
    o+=face(300,236,'#E3A072',False,True,True,1)
    o+=f'<path d="M236 196 C250 130 350 130 364 196 C336 166 264 166 236 196Z" fill="{BK}"/>'
    o+='</g>'
    o+=f'<path d="M200 430 l90 -26 q10 22 20 0 l90 26 l44 70 l-62 28 l-18 -34 v120 h-128 v-120 l-18 34 l-62 -28Z" fill="{CR}"/>'
    o+=f'<circle cx="300" cy="500" r="34" fill="{BL}"/><path d="M286 484 v26 q14 14 28 0 v-26" stroke="{CR}" stroke-width="7" fill="none" stroke-linecap="round"/>'
    o+=hand(184,508,-35,'#E3A072',1)+hand(416,508,35,'#E3A072',-1)
    return wrap(o)
sheet=''.join(f'<div class="c"><div class="im">{f()}</div><div class="lb">{t}</div></div>' for f,t in [(s1,'PHOTO MUGS · hot drink, wink, warm hands'),(s2,'3D PRINTING · layered print, glowing nozzle'),(s3,'COUPLE · cheers with photo mug'),(s4,'T-SHIRTS · holding up the print')])
sw=''.join(f'<i style="background:{c}" title="{n}"></i>' for c,n in [(NV,'navy'),(BL,'blue'),(OL,'olive'),(MU,'mustard'),(TC,'terracotta'),(CR,'cream'),(SK2,'skin'),(RD,'coral')])
html=f'<!doctype html><html><head><meta charset="utf-8"><style>@font-face{{font-family:P;src:url(../fonts/poppins-latin-700-normal.woff2);font-weight:700}}body{{margin:0;background:#FFFCEB;font-family:P}}.g{{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:18px}}.c{{background:#fff;border-radius:14px;padding:8px;box-shadow:0 3px 10px #0002}}.im svg{{width:100%;display:block}}.lb{{font-size:15px;font-weight:700;color:#0A2A5E;padding:4px 8px}}.sw{{display:flex;gap:6px;padding:0 18px 18px}}.sw i{{width:54px;height:30px;border-radius:6px}}h1{{margin:0;padding:18px 18px 0;color:#0A2A5E;font-size:22px}}</style></head><body><h1>Devdha vector style test: outline-free, earthy flat colour, texture strokes, friendly faces</h1><div class="g">{sheet}</div><div class="sw">{sw}</div></body></html>'
open('styletest.html','w').write(html)
