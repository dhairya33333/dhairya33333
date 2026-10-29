import numpy as np, wave
SR=44100;N=int(25.5*SR);L=np.zeros(N);R=np.zeros(N)
rng=np.random.default_rng(3)
def add(sig,t,pan=0.0,g=1.0):
    i=int(t*SR);n=min(len(sig),N-i)
    if n<=0:return
    L[i:i+n]+=sig[:n]*g*(1-max(0,pan));R[i:i+n]+=sig[:n]*g*(1+min(0,pan))
def env(n,a=.005,d=.2):
    x=np.arange(n)/SR;return np.minimum(1,x/a)*np.exp(-x/d)
def tone(f,dur,a=.005,d=.2,h=(1,.4,.2)):
    x=np.arange(int(dur*SR))/SR;s=sum(c*np.sin(2*np.pi*f*(k+1)*x) for k,c in enumerate(h));return s*env(len(x),a,d)
def whoosh(dur=.55,lo=300,hi=3000):
    n=int(dur*SR);x=rng.standard_normal(n);f=np.linspace(lo,hi,n);ph=np.cumsum(f)/SR*2*np.pi
    s=x*np.sin(ph)*.5;e=np.sin(np.linspace(0,np.pi,n))**2;return s*e*.6
def click(f=1800):return tone(f,.06,.001,.02,(1,.5))*.7
# bed: soft pad
t=np.arange(N)/SR
for f,g in [(110,.06),(165,.05),(220,.04),(277.2,.025)]:
    p=np.sin(2*np.pi*f*t)*g*(1+.15*np.sin(2*np.pi*.2*t+f));add(p,0,0,1)
bedenv=np.minimum(1,t/1.5)*np.minimum(1,(25-t).clip(0)/1.2)
L*=bedenv;R*=bedenv
notes=[261.6,329.6,392,523.3]
for i,(t0) in enumerate([.3,.9,1.4,2.7,3.15,3.55,3.85]):add(tone(notes[i%4]*1.0,.5,.004,.18),t0,(-1)**i*.3,.35)
add(tone(784,1.2,.004,.5),3.85,0,.3)
for t0 in (6.4,8.8):add(whoosh(),t0,0,.7)
add(click(1200),4.7,0,.5)
for t0 in (4.9,7.3,9.7):add(tone(660,.3,.003,.12),t0,0,.3)
add(whoosh(.4,500,2500),11.5,0,.5)
for i in range(19):add(click(1600+30*(i%5)),12.1+i*.05,0,.25)
for i in range(4):add(tone(523+i*80,.25,.003,.1),12.5+i*.15,.3*(i-1.5)/1.5,.35)
add(click(900),13.3,0,.6);add(whoosh(.5,400,2800),13.9,0,.6)
for t0,n in [(14.6,19),(15.5,6),(15.9,16)]:
    for i in range(n):add(click(1500+40*(i%7)),t0+i*.04,0,.2)
add(tone(880,.3,.002,.1),16.5,0,.4);add(click(700),16.9,0,.8);add(whoosh(.4,300,2000),17.2,0,.4)
for i in range(6):add(tone(600+i*120,.35,.01,.25,(1,.3)),17.5+i*.25,0,.15)
add(tone(1047,.9,.004,.4),18.9,0,.35)
for t0 in (19.6,20.2):add(tone(523.3 if t0<20 else 659,.6,.004,.25),t0,0,.4)
for k,f in enumerate([523.3,659.3,784,1046.5]):add(tone(f,1.8,.01,.8,(1,.35,.1)),21.1+k*.12,(k-1.5)*.2,.35)
m=max(abs(L).max(),abs(R).max());L/=m;R/=m
fo=np.minimum(1,(25.3-t).clip(0)/.8);L*=fo*.7;R*=fo*.7
a=(np.stack([L,R],1)*32767).astype('<i2')
with wave.open('audio.wav','wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(SR);w.writeframes(a[:25*SR].tobytes())
print('audio ok')
