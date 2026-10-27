# builds storyboard3.html  (python3 gen_sb3.py && node render_storyboard3.js)
import json
R=lambda n:f'img/real/{n}.jpg'
CUT=lambda n:f'img/cut/{n}.png'
# ---------- asset registry: key -> (file in Drive folder "devdha assets", what it is, treatment, status) ----------
A={
 'reel':('REEL.mp4','your edited reel (hero #1)','video clip, 6 s','needs ≤10 MB 720p export'),
 'about':('about.mp4','Devdha neon intro (18 s)','3 s bumper in text section','seen ✔ (have it)'),
 'diwali':('Celebrate Diwali (SH Gifting poster) · file_00000000e14…png','SH Gifting festive poster','full tile',  'have ✔ · client permission'),
 'minimen':('Mini & Men Grand Opening Poster.png','Mini & Men poster','full tile','have ✔ · client permission'),
 'prachitam':('Prachitam compliance flyer (PNG, 2358×3260)','Prachitam services flyer','full tile','have ✔ · client permission'),
 'culturist':('full size logo 1920 x 1080 px.jpg','Culturist logo','full tile / logo wall','have ✔ · client permission'),
 'desires':('deseires_Page 1_tes.png','Desires window-film flyer','full tile','have ✔ · client permission'),
 'atworkpost':('design 1.png','AtWork India design','full tile','have ✔ · client permission'),
 'posters':('IMG_20240404_192013.jpg','printed A5 posters on marble','crop + brighten','have ✔'),
 'card':('IMG_20240422_111535.jpg','Thakkar Gift visiting card','crop','have ✔'),
 'key':('IMG_20240112_181147_683.jpg','thakkargift keychain','background removed','have ✔ cutout ready'),
 'mug':('IMG_20240822_173523.jpg','BROTHER mug','background removed','have ✔ cutout ready'),
 'magic':('IMG_20240822_173534.jpg','dark Marathi mug','background removed','have ✔ (is it a magic mug?)'),
 'krishna':('20260607_204214.jpg','3D-printed Krishna','background removed','have ✔ cutout ready'),
 'honeycomb':('20260608_232704.jpg','3D-printed honeycomb organiser','background removed','have ✔ cutout ready'),
 'printer':('20260607_140524.jpg + 20260607_141331.jpg','Bambu Lab printing a Ganesha','crop, Ken Burns','have ✔'),
 'namekey':('20260917_213021.jpg','3D name keychain','background removed','have ✔ cutout ready'),
 'atwork':('IMG_20231219_205535.jpg','AtWork mouse pad','crop','have ✔ · client permission'),
 'nexa':('20260805_164545.jpg','Nexa Car Care flyers','crop','have ✔ · client permission'),
 'tee':('IMG_20240119_130008.jpg','LIFE IS PRECIOUS tee','crop (white-on-white: no cutout)','have ✔'),
}
IMG={'reel':R('print1'),'about':R('print1'),'diwali':R('diwali'),'minimen':R('minimen'),'prachitam':R('prachitam'),'culturist':R('culturist'),'desires':R('desires'),
 'atworkpost':R('atworkpost'),'posters':R('posters'),'card':R('card'),'key':CUT('key'),'mug':CUT('mug'),'magic':CUT('magic'),'krishna':CUT('krishna'),
 'honeycomb':CUT('honeycomb'),'printer':R('print1'),'namekey':CUT('namekey'),'atwork':R('atwork'),'nexa':R('nexa'),'tee':R('tee')}
POOL=['diwali','krishna','minimen','key','prachitam','mug','posters','honeycomb','culturist','atwork','desires','namekey','nexa','atworkpost','card','magic','printer','tee']
def tile(k,w,h,cut=False):
    src=IMG[k]; bg='#16336f' if src.endswith('png') and 'cut' in src else '#0d2552'
    fit='contain' if 'cut' in src else 'cover'
    return f'<div style="width:{w}px;height:{h}px;background:{bg};border-radius:3px;overflow:hidden;display:flex;align-items:center;justify-content:center"><img src="{src}" style="width:100%;height:100%;object-fit:{fit}"></div>'
def grid(cols,rows,w,h,gap,hero=None,heroidx=None):
    cw=(w-gap*(cols-1))/cols; ch=(h-gap*(rows-1))/rows
    out=f'<div style="position:absolute;inset:0;display:flex;flex-wrap:wrap;gap:{gap}px;align-content:flex-start">'
    for i in range(cols*rows):
        k=POOL[(i*7+3)%len(POOL)]
        st='outline:2px solid #6F9BFF;outline-offset:1px;z-index:3;position:relative' if i==heroidx else ''
        out+=f'<div style="{st}">{tile(k,cw,ch)}</div>'
    return out+'</div>'
def frame(inner,extra=''):
    return f'<div class="frame" style="{extra}">{inner}</div>'
def T(txt,st): return f'<div class="t" style="{st}">{txt}</div>'
W,H=560,315
# ---- text-section frames ----
f_intro=frame(T('Devdha · Dombivli','left:30px;top:30px;font-size:12px;color:#7FA6FF')+T('WEBSITES · PRINTING<br>GIFTS','left:30px;top:90px;font-size:36px')+T('+ 3D PRINTING','left:30px;top:215px;font-size:22px;color:#7FA6FF'))
f_what=frame(T('What we do','left:30px;top:24px;font-size:12px;color:#7FA6FF')+T('Websites &amp; Software<br>Business Printing<br>Personalised Gifts<br>3D Printing','left:30px;top:56px;font-size:30px;line-height:1.28')+T('Bulk orders also available','left:30px;top:262px;font-size:13px;color:#BFD2FF;font-weight:500'))
f_dig=frame(T('Websites · Software · Design','left:26px;top:22px;font-size:20px')+''.join(T(f'{a}<span style="float:right;color:#7FA6FF;margin-left:20px">{b}</span>',f'left:26px;top:{80+i*52}px;width:508px;font-size:15px;border-bottom:1px solid #ffffff33;padding-bottom:6px') for i,(a,b) in enumerate([('Website','from ₹1,999'),('Custom software','from ₹9,999'),('Logo design','from ₹499'),('Social media posts','from ₹99')])))
f_3d=frame(T('Custom 3D Printing','left:26px;top:22px;font-size:22px')+T('Send Your File. Get a Quote.','left:26px;top:70px;font-size:14px;color:#7FA6FF')+T('STL · OBJ · STEP · 3MF','left:26px;top:112px;font-size:13px;background:#ffffff22;padding:5px 10px;border-radius:12px')+T('Quick reply on WhatsApp · Quote by email within 12 hours','left:26px;top:190px;width:260px;font-size:11px;font-weight:500;line-height:1.5')+f'<img src="{CUT("ganesha_printer")}" style="position:absolute;left:330px;top:20px;height:275px;object-fit:contain">')
f_how=frame(T('From Idea to Reality','left:26px;top:22px;font-size:22px')+''.join(f'<div style="position:absolute;left:{40+i*175}px;top:110px;width:64px;height:64px;border-radius:50%;background:#2F6BFF;text-align:center;line-height:64px;font-size:28px;font-weight:800">{i+1}</div>'+T(t,f'left:{20+i*175}px;top:188px;width:110px;font-size:11px') for i,t in enumerate(['Share your idea','We design &amp; produce','Collect your order'])))
f_offer=frame(T('WEBSITE LAUNCH PACK','left:26px;top:28px;font-size:11px;color:#7FA6FF')+T('Launch Your Website','left:26px;top:60px;font-size:26px')+T('₹1,999','left:26px;top:140px;font-size:46px;color:#7FA6FF')+T('Website · Domain &amp; Hosting · Google Business Profile','left:26px;top:215px;width:300px;font-size:11px;font-weight:500;color:#BFD2FF')+T('Start at devdha.in','left:26px;top:262px;font-size:12px;background:#2F6BFF;padding:5px 14px;border-radius:14px'))
# ---- wall frames ----
def wallframe(cols,rows,gap,hero_scale=None,label=None,heroidx=None,extra=''):
    inner=grid(cols,rows,W,H,gap,heroidx=heroidx)
    if label: inner+=T(label,'left:0;right:0;bottom:10px;text-align:center;font-size:12px;color:#fff;background:#0B1B3Fcc;padding:4px')
    return frame(inner,'background:#0B1B3F;'+extra)
f_w1=frame(f'<img src="{R("print1")}" style="position:absolute;left:150px;top:0;height:315px;object-fit:cover">'+T('hero clip fills the screen (REEL.mp4)','left:10px;bottom:8px;font-size:10px;background:#0B1B3Fcc;padding:3px 6px'))
f_w2=wallframe(3,3,5,heroidx=4,label='zoom-out 1: hero + 8 neighbours')
f_w3=wallframe(9,6,3,heroidx=22,label='zoom-out 2: the wall')
f_w4=wallframe(15,9,2,heroidx=67,label='zoom-out 3: massive grid; Devdha logo forms in the middle')
f_w5=frame(f'<img src="{CUT("krishna")}" style="position:absolute;left:210px;top:10px;height:295px;object-fit:contain">'+T('hero #2: cutout on brand blue','left:10px;bottom:8px;font-size:10px;background:#0B1B3Fcc;padding:3px 6px'))
f_visit=frame(T('Visit Us · Scan to Order','left:26px;top:22px;font-size:20px')+T('+91 81047 17735','left:26px;top:90px;font-size:15px;color:#7FA6FF')+T('Vastu B-001, Lodha Heritage, Near Hanuman Mandir, Dombivli, Maharashtra 421201','left:26px;top:125px;width:280px;font-size:10px;font-weight:500')+T('Mon–Sat · 10 AM – 7 PM<br>devdha.in','left:26px;top:200px;font-size:13px')+'<div style="position:absolute;left:350px;top:50px;width:170px;height:170px;background:#fff;border-radius:8px"></div>'+T('QR → https://devdha.in','left:350px;top:230px;width:170px;text-align:center;font-size:10px;color:#BFD2FF'))
# ---------- html ----
def page(title,sub,body): return f'<div class="pg"><div class="top"><h2>{title}</h2><small>{sub}</small></div>{body}</div>'
def card(fr,cap,rows): return f'<div class="card">{fr}<div class="cap">{cap}</div><table>{"".join(f"<tr><th>{a}</th><td>{b}</td></tr>" for a,b in rows)}</table></div>'
def tbl(head,rows): return '<table class="wide"><tr>'+''.join(f'<th>{h}</th>' for h in head)+'</tr>'+''.join('<tr>'+''.join(f'<td>{c}</td>' for c in r)+'</tr>' for r in rows)+'</table>'
def asset(k): a=A[k]; return f'<b>{a[0]}</b>'
pages=[]
pages.append(f'''<div class="pg cover"><div style="margin-top:36mm"><div class="chip">STORYBOARD v3 · RESCRIPT FOR APPROVAL</div><h1>Devdha shop-front screen video</h1>
<div style="font-size:17px;color:#BFD2FF;margin-top:6px">Text section → <b>Our Work wall</b> → contact, in English · हिन्दी · मराठी</div>
<ul style="margin-top:22px;font-size:13.5px;line-height:1.75;max-width:230mm">
<li><b>No product photos or prices.</b> Gifts and printing appear as <b>text only</b> (the shop products aren't live yet). Digital-service prices stay.</li>
<li><b>New "Our Work" section</b> after each language's text: one hero reel/photo fills the screen, then the camera <b>zooms out</b> to show it is one tile in a massive grid of our work.</li>
<li><b>Your real work only:</b> designs, printed pieces, 3D prints and videos from the Drive folder <i>devdha assets</i>. Backgrounds removed on the products (cutouts).</li>
<li>1920×1080 · 16:9 · silent · seamless loop · about 83 s per language, about 4 min 10 s for all three.</li></ul></div></div>''')
pages.append(page('Structure and timing','per language, repeated three times',f'''
<div class="lang">One language block ≈ <b>83 s</b>: <b>Text section (0–36 s)</b> → <b>Our Work wall (36–72 s)</b> → <b>Visit us + QR (72–80 s)</b> → <b>Loop-back (80–83 s)</b>. English, then Hindi, then Marathi. Text and captions change; the wall footage stays the same, but each language opens the wall on a different hero so the loop never repeats exactly.</div>
<div class="tl"><div style="width:5%;background:#2F6BFF">Intro</div><div style="width:8%;background:#1E4FCC">What we do</div><div style="width:8%;background:#2F6BFF">Digital</div><div style="width:7%;background:#1E4FCC">3D</div><div style="width:7%;background:#2F6BFF">How</div><div style="width:6%;background:#E7A800">Offer</div><div style="width:44%;background:#0f7a55">OUR WORK WALL (zoom-out)</div><div style="width:10%;background:#16336f">Visit + QR</div><div style="width:5%;background:#2F6BFF">Loop</div></div>
{tbl(['Time','Scene','Message'],[['0–5','A1 Intro','Websites · Printing · Gifts + 3D Printing'],['5–12','A2 What we do','4 big words, text only; "Bulk orders also available"'],['12–19','A3 Websites · Software · Design','prices from ₹1,999 · ₹9,999 · ₹499 · ₹99'],['19–25','A4 3D printing','Send your file, get a quote; WhatsApp + email within 12 h'],['25–31','A5 How it works','Share idea → we design &amp; produce → collect'],['31–36','A6 Offer (editable)','Website Launch Pack ₹1,999 (needs your approval)'],['36–72','W1–W5 Our Work wall','hero → zoom-out → massive grid → hero #2 → zoom-out'],['72–80','V Visit us','phone, address, hours, devdha.in, QR'],['80–83','L Loop-back','Devdha · tagline · devdha.in']])}
<div class="warn"><b>Assumption:</b> the wall repeats after each language. If you want it <u>once</u> (after English only, or at the very end), say so and I'll cut the other two walls.</div>'''))
tx=lambda en,hi,mr:f'<div class="l3"><div><span class="chip">EN</span><br>{en}</div><div><span class="chip">हिन्दी</span><br>{hi}</div><div><span class="chip">मराठी</span><br>{mr}</div></div>'
pages.append(page('Text section · A1–A3','no product photos',
 f'''<div class="grid2">{card(f_intro,'A1 · 0–5 s · Intro',[('Visual','Logo mark assembles; words slam in; "+ 3D PRINTING" pill'),('Assets','Logo; optional 3 s of '+asset('about')+' (neon Devdha intro) as a bumper'),('Text','WEBSITES · PRINTING · GIFTS + 3D PRINTING / वेबसाइट · प्रिंटिंग · गिफ्ट्स / वेबसाइट · प्रिंटिंग · गिफ्ट्स')])}
{card(f_what,'A2 · 5–12 s · What we do (new, text only)',[('Visual','Four large lines reveal one by one with a blue underline sweep; no photos'),('Assets','None'),('Text',tx('Websites &amp; Software · Business Printing · Personalised Gifts · 3D Printing — Bulk orders also available','वेबसाइट और सॉफ़्टवेयर · बिज़नेस प्रिंटिंग · पर्सनलाइज़्ड गिफ्ट्स · 3D प्रिंटिंग — बल्क ऑर्डर भी उपलब्ध','वेबसाइट आणि सॉफ्टवेअर · बिझनेस प्रिंटिंग · पर्सनलाइज्ड गिफ्ट्स · 3D प्रिंटिंग — बल्क ऑर्डरही उपलब्ध'))])}
{card(f_dig,'A3 · 12–19 s · Websites · Software · Design',[('Visual','Price rows slide in; text only (work is shown on the wall)'),('Assets','None'),('Text','Website from ₹1,999 · Custom software from ₹9,999 · Logo from ₹499 · Social posts from ₹99 (वेबसाइट ₹1,999 से … / ₹1,999 पासून …)')])}</div>'''))
pages.append(page('Text section · A4–A6','',
 f'''<div class="grid2">{card(f_3d,'A4 · 19–25 s · Custom 3D printing',[('Visual','Cutout of the Bambu Lab printing a Ganesha slides in on the right, chips STL · OBJ · STEP · 3MF pop'),('Assets',asset('printer')+' (background removed)'),('Text','Send Your File. Get a Quote. · Quick reply on WhatsApp · Quote by email within 12 hours')])}
{card(f_how,'A5 · 25–31 s · How it works',[('Visual','Three numbered circles joined by a drawing line'),('Assets','None'),('Text','Share your idea · We design &amp; produce · Collect your order')])}
{card(f_offer,'A6 · 31–36 s · Offer (editable)',[('Visual','Headline wipe, price counts up'),('Assets','None (or the website mock-up)'),('Text','Website Launch Pack · ₹1,999 · Website · Domain &amp; Hosting · Google Business Profile. <b>Waiting on your approval.</b>')])}</div>'''))
pages.append(page('Our Work wall · the idea','grid zoom-out, the signature moment',f'''
<div class="grid4"><div>{f_w1}<div class="cap">1 · Hero fills the screen (6 s)</div></div><div>{f_w2}<div class="cap">2 · Pull back: 3×3, hero in the middle</div></div><div>{f_w3}<div class="cap">3 · Wall of work, slow diagonal drift</div></div><div>{f_w4}<div class="cap">4 · Massive grid; logo forms</div></div></div>
<ul class="lang" style="margin-top:8px;padding-left:16px"><li><b>One continuous camera move:</b> a real scale animation from the hero tile (1×) out to the whole wall (about 0.08×); tiles keep their true layout, so the viewer sees the hero was always one tile of many.</li>
<li><b>Mixed tiles:</b> posters and designs, product photos with the background removed on soft blue panels, 3D prints, and short looping video tiles that keep playing as the camera pulls back.</li>
<li><b>Motion rules:</b> ease-in-out, no shake; after each zoom-out the wall drifts slowly for a beat so tiles can be read; a thin blue outline marks the hero before the next push-in.</li>
<li><b>Caption:</b> only at the end of the zoom: "Our Work / हमारा काम / आमचे काम" and "Designed. Printed. Made in Dombivli." (हिन्दी: डिज़ाइन। प्रिंट। डोंबिवली में तैयार। · मराठी: डिझाइन. प्रिंट. डोंबिवलीत तयार.)</li>
<li><b>Removing backgrounds:</b> done on products (keychains, mugs, 3D prints). Not possible on the white T-shirt: it stays a rectangular photo tile.</li></ul>'''))
pages.append(page('Wall shot list · W1–W5','36–72 s, with the Drive file used in each shot',tbl(['Time','Shot','Camera','Hero / tiles (Drive file in "devdha assets")'],[
 ['36–42','W1 Hero #1','static, slight push-in','<b>EN:</b> '+asset('reel')+' (6 s of your edited reel)<br><b>HI:</b> '+asset('diwali')+' → full-frame poster<br><b>MR:</b> '+asset('minimen')],
 ['42–48','W2 Pull back to 3×3','scale 1 → 0.33','8 neighbours: '+asset('krishna')+', '+asset('key')+', '+asset('prachitam')+', '+asset('mug')+', '+asset('culturist')+', '+asset('posters')+', '+asset('atwork')+', '+asset('nexa')],
 ['48–56','W3 The wall','scale → 0.11, drift','9×6 mix: all designs, cutouts and photos in the asset map; 6–8 tiles are live video (see Video map)'],
 ['56–62','W4 Push into hero #2','scale up to a 3D-print tile','3D tile: '+asset('printer')+' cutout, then '+asset('krishna')+' on blue panel; 2 s hold'],
 ['62–68','W5 Pull back to massive','scale → 0.07','15×9 grid (about 135 tiles; images repeat in different crops); Devdha logo forms from tile colours'],
 ['68–72','W6 Settle','slow drift','"Our Work" caption in the current language'],
])+'<div class="warn">Client work (AtWork, SH Gifting, Nexa, Mini &amp; Men, Prachitam, Culturist, Desires) is on the wall as <b>sample</b>. Each tile has a flag in the build so one can be switched off without re-doing the video.</div>'))
reg=[[asset(k),A[k][1],A[k][2],A[k][3]] for k in ['posters','card','key','mug','magic','tee','krishna','honeycomb','printer','namekey','atwork','nexa','diwali','minimen','prachitam','culturist','desires','atworkpost']]
pages.append(page('Asset map: images from Drive','Drive folder: portfolio / devdha assets',tbl(['Drive file','What it is','Treatment','Status'],reg)+'<div class="lang" style="margin-top:6px">Not used (privacy or rights): photos showing customers\' faces (couple mug, child in the kids tee, polaroids, puzzles, the memorial bust, the calendar portrait), the Virat Kohli poster, the Shinchan mug, the anime mouse pad.</div>'))
vid=[
 [asset('reel')+' / reel1.mp4 / reel2.mp4','your reels (Sep 2026)','W1 hero #1 (EN) and live tiles','Please confirm which is the best; export 6–10 s, 720p, ≤10 MB'],
 ['Salicylic acid facewash.mp4, Coffe bodywash.mp4, Silky shine shampoo.mp4, Activated charcoal shower gel.mp4, Vitamin c and hyaluronic acid facewash.mp4','product ads (AI or real?)','live tiles on the wall (3–4 s each)','Please tell me which are AI-generated, and whether the client allows showing them'],
 ['brand intro .mov, facewash intro.mov, shammpoo.mov, conditonrs.mov, bodywash.mov, AMINO ALEVERA GEL.mov','brand/product intros','live tiles','Large files (136–298 MB): export short clips'],
 [asset('about'),'Devdha neon intro, 18 s','3 s bumper in A1, or a wall tile','seen ✔'],
 ['d1.mp4','3D T-shirt spin (another brand\'s logo)','wall tile only with permission','seen ✔'],
 ['test 5.mp4 · Timeline tracker.mp4 · 20260314_*.mp4 · 20260404_*.mp4 · 20260424_*.mp4 · VAAP5414–5925.MP4','raw / test footage','Possible 3D-printer or shop B-roll, W4 close-ups','Need your pick: name 5 clips you want'],
 ['Your YouTube edit (z7TnVtcscqI)','edited video','hero candidate','I can\'t open YouTube from here: please add an MP4 export (≤10 MB) to the Drive folder']]
pages.append(page('Video map','what I found in the Drive folder and how it would be used',tbl(['File(s)','What it is','Use in this video','What I need'],vid)+'<div class="warn"><b>Limit:</b> the Drive connector gives me only files up to 10 MB, so I could view just <code>about.mp4</code> and <code>d1.mp4</code>. Everything else here is judged by its name: please confirm before I plan around it.</div>'))
pages.append(page('Visit us, loop-back and open decisions','',f'''<div class="grid2">{card(f_visit,'V · 72–80 s · Visit us · Scan to order',[('Visual','Clean navy; large white QR tile'),('Assets','Generated QR for https://devdha.in'),('Text','Phone, address, hours: exactly as in the brief (EN / हिन्दी / मराठी)')])}
<div class="card"><div class="frame" style="display:flex;align-items:center;justify-content:center;flex-direction:column"><div class="t" style="position:static;font-size:40px">Devdha</div><div class="t" style="position:static;font-size:13px;color:#7FA6FF;margin-top:10px">TECH · PRINT · MANUFACTURE</div><div class="t" style="position:static;font-size:15px;margin-top:10px">devdha.in</div></div><div class="cap">L · 80–83 s · Loop-back → wipe to the next language</div></div></div>
<h2 style="font-size:14px;margin:12px 0 4px">I need these decisions to build version 3</h2>{tbl(['#','Question','My default if you don\'t answer'],[['1','Wall after every language, or once?','after every language'],['2','Product prices removed everywhere (text-only gifts)?','yes'],['3','Hero #1 reel: which of REEL / reel1 / reel2?','REEL.mp4'],['4','OK to show client work as sample?','yes, flagged; to be switched off per tile'],['5','Offer on A6: Website Launch Pack?','yes, ₹1,999'],['6','Video clips: export 6–10 s, 720p, ≤10 MB into the Drive folder','needed for live tiles']])}'''))
css=open('sb3.css').read()
html='<!doctype html><html><head><meta charset="utf-8"><title>Devdha storyboard v3</title><style>'+css+'</style></head><body>'+''.join(pages)+'</body></html>'
open('storyboard3.html','w').write(html);print('pages',len(pages))
