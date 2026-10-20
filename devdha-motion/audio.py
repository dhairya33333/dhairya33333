#!/usr/bin/env python3
"""Synthesised, royalty-free soundtrack + SFX for the Devdha videos (numpy only).

Usage: python3 audio.py vertical out.wav
       python3 audio.py wide     out.wav
Everything is generated from scratch (sine/saw/noise), so there is nothing to license.
"""
import sys
import wave
import numpy as np

SR = 44100
rng = np.random.default_rng(7)


# ------------------------------------------------------------------ helpers
def tt(d):
    return np.arange(int(d * SR)) / SR


def ex(t, k):
    return np.exp(-t * k)


def noise(n):
    return rng.standard_normal(n)


def fade(x, a=0.003, r=0.01):
    x = x.copy()
    na, nr = int(a * SR), int(r * SR)
    if na > 0:
        x[:na] *= np.linspace(0, 1, na)
    if nr > 0:
        x[-nr:] *= np.linspace(1, 0, nr)
    return x


def fft_filter(x, lo=None, hi=None):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if hi:
        g *= 1 / (1 + (f / hi) ** 6)
    if lo:
        g *= 1 - 1 / (1 + (f / lo) ** 6)
    return np.fft.irfft(X * g, len(x))


def lp_var(x, fc):
    a = 1 - np.exp(-2 * np.pi * fc / SR)
    y = np.empty_like(x)
    s = 0.0
    for i in range(len(x)):
        s += a[i] * (x[i] - s)
        y[i] = s
    return y


def pan(sig, p):
    ang = (p + 1) * np.pi / 4
    return np.stack([sig * np.cos(ang), sig * np.sin(ang)], 1)


def sweep(f0, f1, d, k):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t * k)
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


class Mix:
    def __init__(self, dur):
        self.n = int(dur * SR)
        self.dry = np.zeros((self.n, 2))
        self.wet = np.zeros((self.n, 2))
        self.tonal = np.zeros((self.n, 2))      # ducked by the kick
        self.kicks = []

    def _put(self, buf, sig, t0, gain, p):
        if sig.ndim == 1:
            sig = pan(sig, p)
        i = int(t0 * SR)
        if i >= self.n or i + len(sig) <= 0:
            return
        s0 = max(0, -i)
        e = min(len(sig), self.n - i)
        buf[i + s0:i + e] += sig[s0:e] * gain

    def add(self, sig, t0, gain=1.0, p=0.0, wet=0.0):
        self._put(self.dry, sig, t0, gain, p)
        if wet:
            self._put(self.wet, sig, t0, gain * wet, p)

    def add_tonal(self, sig, t0, gain=1.0, p=0.0, wet=0.0):
        self._put(self.tonal, sig, t0, gain, p)
        if wet:
            self._put(self.wet, sig, t0, gain * wet, p)


# ------------------------------------------------------------------ sounds
def kick():
    t = tt(0.5)
    body = sweep(160, 46, 0.5, 24) * ex(t, 6.5)
    click = noise(len(t)) * ex(t, 400) * 0.25
    return fade(body + click, 0.001, 0.02)


def clap():
    t = tt(0.32)
    env = sum(np.where(t >= o, ex(np.maximum(t - o, 0), 70), 0) for o in (0, 0.011, 0.024)) * 0.5 + ex(t, 16) * 0.55
    return fade(fft_filter(noise(len(t)), lo=900, hi=5500) * env * 0.9, 0.001, 0.02)


def hat(open_=False):
    d = 0.35 if open_ else 0.09
    t = tt(d)
    n = np.diff(np.diff(noise(len(t) + 2)))
    return n * ex(t, 12 if open_ else 55) * 0.28


def shaker():
    t = tt(0.1)
    return fft_filter(noise(len(t)), lo=5000, hi=11000) * ex(t, 40) * 0.5


def bass_note(f, d):
    t = tt(d)
    saw = sum(np.sin(2 * np.pi * f * k * t) / k for k in range(1, 9))
    s = fft_filter(saw, hi=650) * 0.9 + np.sin(2 * np.pi * f * t) * 0.8
    env = np.minimum(t / 0.008, 1) * ex(t, 3.2)
    return fade(s * env, 0.002, 0.02) * 0.55


def pluck(f, d=0.28):
    t = tt(d)
    s = np.sin(2 * np.pi * f * t) + 0.45 * np.sin(2 * np.pi * 2 * f * t * 1.002) + 0.2 * np.sin(2 * np.pi * 3 * f * t)
    return fade(s * ex(t, 9) * 0.5, 0.002, 0.02)


def pad(notes, d, att=0.5, rel=0.8):
    t = tt(d)
    s = np.zeros_like(t)
    for f in notes:
        for dt in (0.997, 1.0, 1.003):
            s += np.sin(2 * np.pi * f * dt * t + f)
    s = fft_filter(s, hi=2600)
    env = np.minimum(t / att, 1) * np.minimum((d - t) / rel, 1)
    trem = 0.9 + 0.1 * np.sin(2 * np.pi * 0.25 * t)
    return s * env * trem * 0.07


def whoosh(d, up=True, lo=250, hi=9000, p0=-0.7, p1=0.7):
    n = int(d * SR)
    t = np.arange(n) / SR
    a = np.linspace(0, 1, n)
    k = a if up else 1 - a
    fc = lo * (hi / lo) ** (k ** 1.3)
    x = noise(n)
    x = lp_var(lp_var(x, fc), fc)
    env = np.sin(np.pi * a) ** 1.6
    sig = x * env * 2.2
    pans = np.linspace(p0, p1, n)
    ang = (pans + 1) * np.pi / 4
    return np.stack([sig * np.cos(ang), sig * np.sin(ang)], 1)


def riser(d):
    n = int(d * SR)
    a = np.linspace(0, 1, n)
    fc = 300 * (9000 / 300) ** a
    x = lp_var(noise(n), fc) * 1.6
    f = 180 * (1700 / 180) ** a
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * 0.25
    env = a ** 2.2
    s = (x + tone) * env
    return fade(s, 0.01, 0.015)


def impact(big=1.0):
    t = tt(2.2)
    sub = sweep(78, 34, 2.2, 2.2) * ex(t, 1.5)
    burst = fft_filter(noise(len(t)), hi=2500) * ex(t, 7) * 0.7
    top = fft_filter(noise(len(t)), lo=3000, hi=9000) * ex(t, 22) * 0.25
    return fade((sub * 1.1 + burst + top) * big, 0.001, 0.2)


def lock():
    t = tt(0.4)
    c = (np.sin(2 * np.pi * 2400 * t) + 0.7 * np.sin(2 * np.pi * 3610 * t)) * ex(t, 55) * 0.35
    th = sweep(170, 62, 0.4, 22) * ex(t, 12) * 0.9
    return fade(c + th, 0.0005, 0.05)


def pop(f=500, d=0.16):
    t = tt(d)
    fr = f * (1 + 1.4 * (1 - np.exp(-t * 55)))
    return fade(np.sin(2 * np.pi * np.cumsum(fr) / SR) * ex(t, 28) * 0.55, 0.001, 0.02)


def thock(f=150, d=0.18):
    t = tt(d)
    return fade(sweep(f * 1.8, f, d, 40) * ex(t, 22) * 0.9, 0.001, 0.02)


def tick(f=3200):
    t = tt(0.03)
    return fade(fft_filter(noise(len(t)), lo=f, hi=9000) * ex(t, 160) * 0.6, 0.0005, 0.006)


def beep(f, d=0.14):
    t = tt(d)
    return fade(np.sin(2 * np.pi * f * t) * np.minimum(t / 0.004, 1) * ex(t, 12) * 0.5, 0.002, 0.02)


def ding(f, d=1.2):
    t = tt(d)
    s = np.sin(2 * np.pi * f * t) * ex(t, 3.2) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) * ex(t, 6.5) \
        + 0.18 * np.sin(2 * np.pi * f * 5.4 * t) * ex(t, 11)
    return fade(s * 0.5, 0.001, 0.1)


def sparkle(d=0.8):
    out = np.zeros(int(d * SR))
    for _ in range(9):
        t0 = rng.uniform(0, d * 0.6)
        f = rng.uniform(3200, 7800)
        t = tt(0.25)
        s = np.sin(2 * np.pi * f * t) * ex(t, 22) * 0.18
        i = int(t0 * SR)
        out[i:i + len(s)] += s[:len(out) - i]
    return out


def swish(d=0.25, up=True):
    return whoosh(d, up, lo=500, hi=11000, p0=-0.4, p1=0.4) * 0.6


def reverb_ir(tail=1.8):
    n = int(tail * SR)
    t = np.arange(n) / SR
    ir = np.stack([noise(n), noise(n)], 1) * ex(t, 3.0)[:, None]
    ir = np.stack([fft_filter(ir[:, 0], lo=200, hi=7000), fft_filter(ir[:, 1], lo=200, hi=7000)], 1)
    return ir * 0.08


def convolve(x, ir):
    n = len(x) + len(ir)
    N = 1 << (n - 1).bit_length()
    out = np.zeros((len(x), 2))
    for c in range(2):
        out[:, c] = np.fft.irfft(np.fft.rfft(x[:, c], N) * np.fft.rfft(ir[:, c], N), N)[:len(x)]
    return out


# ------------------------------------------------------------------ music engine
HZ = {'F1': 43.65, 'G1': 49.0, 'A1': 55.0, 'C2': 65.41, 'F2': 87.31, 'G2': 98.0, 'A2': 110.0, 'C3': 130.81,
      'F3': 174.61, 'G3': 196.0, 'A3': 220.0, 'B3': 246.94, 'C4': 261.63, 'D4': 293.66, 'E4': 329.63,
      'F4': 349.23, 'G4': 392.0, 'A4': 440.0, 'B4': 493.88, 'C5': 523.25, 'D5': 587.33, 'E5': 659.25,
      'G5': 783.99, 'A5': 880.0, 'C6': 1046.5}
CHORDS = [  # Am  F  C  G
    dict(bass=HZ['A2'], pad=[HZ['A3'], HZ['C4'], HZ['E4']], arp=[HZ['A4'], HZ['C5'], HZ['E5'], HZ['C5']]),
    dict(bass=HZ['F2'], pad=[HZ['F3'], HZ['A3'], HZ['C4']], arp=[HZ['F4'], HZ['A4'], HZ['C5'], HZ['A4']]),
    dict(bass=HZ['C3'], pad=[HZ['C4'], HZ['E4'], HZ['G4']], arp=[HZ['G4'], HZ['C5'], HZ['E5'], HZ['C5']]),
    dict(bass=HZ['G2'], pad=[HZ['G3'], HZ['B3'], HZ['D4']], arp=[HZ['G4'], HZ['B4'], HZ['D5'], HZ['B4']]),
]


def music(mix, bpm, anchor, sections):
    beat = 60.0 / bpm
    bar = 4 * beat
    kick_s, clap_s, ohat = kick(), clap(), hat(True)
    chord_at = lambda t: CHORDS[int(max(0, np.floor((t - anchor) / bar))) % 4] if t >= anchor else CHORDS[0]

    for (t0, t1, f) in sections:
        # pad: one chord per bar (or one long Am before the beat starts)
        if f.get('pad'):
            if t0 < anchor:
                mix.add_tonal(pad(CHORDS[0]['pad'] + [HZ['A2']], t1 - t0, att=2.0, rel=0.6), t0, f['pad'], wet=0.3)
            else:
                t = t0
                while t < t1 - 0.01:
                    d = min(bar, t1 - t) + 0.5
                    mix.add_tonal(pad(chord_at(t)['pad'], d), t, f['pad'], wet=0.3)
                    t += bar
        # step grid (16ths)
        k = int(np.ceil((t0 - anchor) / (beat / 4)))
        while True:
            t = anchor + k * beat / 4
            k += 1
            if t >= t1 - 1e-6:
                break
            if t < t0 - 1e-6:
                continue
            step = (k - 1) % 16            # 16th within bar
            beat_i = step // 4
            on_beat = step % 4 == 0
            ch = chord_at(t)
            if f.get('kick') and on_beat:
                mix.add(kick_s, t, f['kick'])
                mix.kicks.append(t)
            if f.get('clap') and on_beat and beat_i in (1, 3):
                mix.add(clap_s, t, f['clap'], p=0.05, wet=0.2)
            if f.get('hat8') and step % 2 == 0 and not on_beat:
                mix.add(hat(), t, f['hat8'], p=0.25)
            if f.get('hat16') and step % 2 == 1:
                mix.add(hat(), t, f['hat16'] * (0.7 if step % 4 == 3 else 1.0), p=0.25)
            if f.get('hat16') and step in (14,):
                mix.add(ohat, t, f['hat16'] * 0.6, p=0.3)
            if f.get('shaker') and step % 4 == 2:
                mix.add(shaker(), t, f['shaker'], p=-0.3)
            if f.get('bass'):
                if step in (0, 3, 6, 8, 11, 14):
                    note = ch['bass'] * (2 if step in (6, 14) else 1)
                    mix.add_tonal(bass_note(note, beat * 0.9), t, f['bass'])
            if f.get('arp') and step % 2 == 0:
                mix.add_tonal(pluck(ch['arp'][(step // 2) % 4], 0.3), t, f['arp'], p=0.35 if (step // 2) % 2 else -0.35, wet=0.35)
            if f.get('roll'):
                # snare roll that speeds up
                pass
    return beat


def finish(mix, dur, music_gain=1.0):
    n = mix.n
    # kick sidechain on tonal bus
    duck = np.ones(n)
    for tk in mix.kicks:
        i = int(tk * SR)
        m = min(int(0.28 * SR), n - i)
        if m > 0:
            duck[i:i + m] -= 0.42 * np.exp(-np.arange(m) / SR / 0.09)
    tonal = mix.tonal * duck[:, None] * music_gain
    wet = convolve(mix.wet + tonal * 0.0, reverb_ir())
    out = mix.dry + tonal + wet
    print('pre-limit peak', round(float(np.max(np.abs(out))), 2))
    out = np.tanh(out * 0.45) / np.tanh(0.45)      # gentle soft clip
    out *= 0.89 / max(1e-9, np.max(np.abs(out)))
    nf = int(0.05 * SR)
    out[:nf] *= np.linspace(0, 1, nf)[:, None]
    nf = int(1.4 * SR)
    out[-nf:] *= np.linspace(1, 0, nf)[:, None]
    return out


def write_wav(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


# ------------------------------------------------------------------ cue sheets
def sfx_common_logo(m, t_conv, t_lock, t_letters, nl=6, base=330):
    m.add(whoosh(t_lock - t_conv + 0.1, True, 400, 9000), t_conv - 0.05, 0.9)
    m.add(lock(), t_lock, 1.0, wet=0.3)
    m.add(impact(0.55), t_lock, 0.55, wet=0.4)
    for i in range(nl):
        m.add(pop(base * (1 + 0.12 * i)), t_letters + i * 0.07 + 0.1, 0.55, p=-0.4 + i * 0.16)


def vertical():
    dur = 42.0
    m = Mix(dur)
    secs = [
        (0.0, 4.5, dict(pad=0.55)),
        (4.5, 9.0, dict(pad=0.35, kick=0.6, hat8=0.35, bass=0.55)),
        (9.5, 14.5, dict(pad=0.55, kick=1.0, clap=0.75, hat16=0.55, bass=0.8)),
        (14.5, 24.5, dict(pad=0.6, kick=1.0, clap=0.75, hat16=0.55, bass=0.8, arp=0.5, shaker=0.5)),
        (24.5, 30.0, dict(pad=0.6, kick=1.0, clap=0.75, hat16=0.55, bass=0.8, arp=0.55, shaker=0.5)),
        (30.0, 34.0, dict(pad=0.7, kick=0.35, hat8=0.3, arp=0.45)),
        (35.5, 40.0, dict(pad=0.65, kick=1.0, clap=0.8, hat16=0.6, bass=0.85, arp=0.6, shaker=0.5)),
    ]
    beat = music(m, 120, 4.5, secs)
    # final chord + tail
    m.add_tonal(pad([HZ['C4'], HZ['E4'], HZ['G4'], HZ['C5']], 2.6, att=0.1, rel=2.0), 40.0, 1.3, wet=0.5)
    # snare roll build 34.0 -> 35.5
    t = 34.0
    gap = 0.25
    while t < 35.45:
        m.add(clap(), t, 0.35 + 0.5 * (t - 34.0) / 1.5, wet=0.2)
        t += gap
        gap = max(0.06, gap * 0.8)
    # S1: countdown + hook
    for t, f in ((1.2, 700), (2.2, 800), (3.2, 1000)):
        m.add(beep(f), t, 0.8, wet=0.15)
    for t in (0.5, 0.75, 1.0, 1.25):
        m.add(thock(130 + (t - 0.5) * 60), t, 0.8)
    m.add(riser(2.1), 2.4, 0.9)
    m.add(whoosh(0.9, True), 3.65, 0.9)
    m.add(impact(1.0), 4.5, 1.0, wet=0.5)
    # S2: problem
    for t in (5.4, 6.2, 7.0):
        m.add(thock(95), t, 0.9, wet=0.1)
    m.add(whoosh(0.8, True, 300, 4000), 5.5, 0.35)
    for i in range(6):
        m.add(pop(900 - i * 90), 7.1 + i * 0.08 + 0.05, 0.4, p=-0.5 + i * 0.2)
    for i in range(3):
        m.add(swish(0.3, True), 8.15 + i * 0.16, 0.9, p=-0.2 + i * 0.2)
        m.add(tick(2500), 8.15 + i * 0.16 + 0.26, 0.7)
    m.add(riser(1.1), 8.4, 0.8)
    m.add(whoosh(1.1, True, 300, 9000), 8.95, 0.9)
    m.add(impact(1.0), 9.5, 1.0, wet=0.5)
    # S3: logo
    sfx_common_logo(m, 9.9, 10.8, 10.9)
    m.add(sparkle(), 11.8, 0.8, wet=0.3)
    for t in (12.4, 12.8):
        m.add(swish(0.3, True), t, 0.7)
    m.add(whoosh(1.2, True), 13.85, 0.85)
    m.add(impact(0.9), 14.5, 0.9, wet=0.4)
    # S4: cards
    for t in (15.2, 15.45):
        m.add(thock(120), t, 0.7)
    notes = ['C5', 'D5', 'E5', 'G5', 'A5']
    for i in range(5):
        m.add(swish(0.35, False), 15.7 + i * 0.2, 0.55, p=0.5 - i * 0.1)
        m.add(ding(HZ[notes[i]]), 17.0 + i * 1.3, 0.55, p=-0.2 + i * 0.1, wet=0.4)
        m.add(thock(110), 17.0 + i * 1.3, 0.6)
    m.add(whoosh(1.2, True), 23.9, 0.85)
    m.add(impact(0.9), 24.5, 0.9, wet=0.4)
    # S5: phone
    for t in (25.0, 25.3):
        m.add(thock(120), t, 0.7)
    m.add(whoosh(0.9, True, 300, 6000), 25.5, 0.6)
    m.add(pop(520), 26.2, 0.7)
    for t in (26.4, 26.6, 26.8, 27.0, 27.2):
        m.add(tick(3400), t, 0.9, p=-0.2)
    for i in range(4):
        m.add(pop(560 + i * 110), 26.85 + i * 0.45, 0.8, p=-0.6 + i * 0.4, wet=0.2)
    m.add(ding(HZ['E5']), 28.2, 0.5, wet=0.4)
    m.add(whoosh(1.2, False), 29.4, 0.85)
    m.add(impact(1.0), 30.0, 1.0, wet=0.5)
    # S6: process
    for t in (30.8, 31.05):
        m.add(thock(120), t, 0.7)
    for t, nn in ((31.9, 'E5'), (32.7, 'G5'), (33.5, 'C6')):
        m.add(ding(HZ[nn]), t, 0.6, wet=0.4)
        m.add(pop(520), t, 0.6)
    m.add(riser(2.0), 33.5, 0.9)
    m.add(whoosh(0.9, False), 34.8, 0.9)
    m.add(impact(1.2), 35.5, 1.1, wet=0.5)
    # S7: CTA
    for t in (36.1, 36.4):
        m.add(thock(115), t, 0.8)
    sfx_common_logo(m, 36.7, 37.6, 37.7)
    m.add(pop(620), 38.9, 0.8, wet=0.2)
    m.add(ding(HZ['G5']), 39.0, 0.6, wet=0.4)
    m.add(sparkle(), 39.1, 0.9, wet=0.3)
    m.add(impact(1.2), 40.0, 1.0, wet=0.7)
    m.add(ding(HZ['C5'], 2.0), 40.0, 0.5, wet=0.5)
    return finish(m, dur)


def wide():
    dur = 38.0
    m = Mix(dur)
    anchor, bpm = 4.2, 114.3
    secs = [
        (0.0, 4.2, dict(pad=0.55)),
        (4.2, 9.45, dict(pad=0.55, kick=0.9, clap=0.6, hat8=0.4, bass=0.7)),
        (9.45, 14.7, dict(pad=0.55, kick=1.0, clap=0.75, hat16=0.55, bass=0.8, arp=0.5)),
        (14.7, 22.05, dict(pad=0.6, kick=1.0, clap=0.75, hat16=0.55, bass=0.8, arp=0.55, shaker=0.5)),
        (22.05, 29.85, dict(pad=0.6, kick=1.0, clap=0.75, hat16=0.55, bass=0.85, arp=0.6, shaker=0.5)),
        (29.95, 35.8, dict(pad=0.65, kick=0.9, clap=0.6, hat8=0.4, bass=0.7, arp=0.45)),
    ]
    music(m, bpm, anchor, secs)
    m.add_tonal(pad([HZ['C4'], HZ['E4'], HZ['G4'], HZ['C5']], 2.6, att=0.1, rel=2.0), 35.8, 1.3, wet=0.5)
    # S1
    m.add(whoosh(0.9, True, 400, 7000), 0.15, 0.55)
    for t in (0.75, 0.9, 1.05, 1.85, 2.0):
        m.add(thock(125), t, 0.7)
    m.add(riser(1.8), 2.0, 0.85)
    m.add(whoosh(0.9, True), 3.45, 0.9)
    m.add(impact(1.0), 4.2, 1.0, wet=0.5)
    # S2
    for i in range(9):
        m.add(pop(600 + (i % 4) * 90), 4.9 + i * 0.1 + 0.2, 0.4, p=-0.7 + i * 0.17)
    sfx_common_logo(m, 4.7, 5.65, 5.8)
    m.add(sparkle(), 6.7, 0.8, wet=0.3)
    m.add(riser(1.1), 8.2, 0.8)
    m.add(whoosh(1.2, True), 8.8, 0.9)
    m.add(impact(1.0), 9.45, 1.0, wet=0.5)
    # S3
    for t in (9.65, 9.95):
        m.add(thock(120), t, 0.7)
    m.add(whoosh(0.9, True, 300, 6000), 10.1, 0.6)
    for i in range(4):
        m.add(swish(0.35, False), 11.0 + i * 0.18, 0.55, p=-0.6 + i * 0.1)
    for t in (11.2, 11.4, 11.6, 11.9, 12.1, 12.3, 12.7):
        m.add(tick(3400), t, 0.8, p=0.3)
    for t in (11.5, 11.7):
        m.add(pop(560), t, 0.6, p=0.4)
    m.add(swish(0.65, True), 12.9, 0.6, p=0.4)
    m.add(pop(480), 13.55, 0.9, wet=0.2)
    m.add(ding(HZ['G5']), 13.6, 0.5, wet=0.4)
    m.add(whoosh(1.3, True), 14.15, 0.85)
    m.add(impact(0.9), 14.75, 0.9, wet=0.4)
    # S4
    for t in (15.2, 15.5):
        m.add(thock(120), t, 0.7)
    m.add(whoosh(0.9, True, 300, 6000), 15.7, 0.6)
    m.add(swish(0.9, True), 17.2, 0.6)
    m.add(lock(), 18.4, 0.8, wet=0.2)
    for i in range(4):
        m.add(pop(520 + i * 80), 19.0 + i * 0.18 + 0.2, 0.7, p=-0.4 + i * 0.25)
    m.add(whoosh(1.0, True, 400, 7000), 19.6, 0.7)
    m.add(lock(), 20.6, 0.9, wet=0.3)
    m.add(whoosh(1.2, True), 21.4, 0.85)
    m.add(impact(0.9), 22.0, 0.9, wet=0.4)
    # S5
    m.add(thock(100), 22.3, 0.9)
    m.add(thock(110), 22.44, 0.8)
    for i in range(3):
        m.add(tick(3000), 22.6 + i * 0.25, 0.8)
    m.add(whoosh(0.9, True, 300, 6000), 24.1, 0.7)
    m.add(impact(0.7), 24.55, 0.7, wet=0.4)
    m.add(thock(100), 24.8, 0.9)
    m.add(whoosh(0.9, True, 300, 6000), 26.3, 0.7)
    m.add(impact(0.7), 26.75, 0.7, wet=0.4)
    for t in (27.0, 27.12, 28.1, 28.2):
        m.add(thock(100), t, 0.9)
    m.add(whoosh(1.2, True, 400, 7000), 27.5, 0.6)
    m.add(lock(), 28.8, 0.9, wet=0.3)
    m.add(ding(HZ['G5']), 28.8, 0.5, wet=0.4)
    m.add(whoosh(1.2, False), 29.4, 0.85)
    m.add(impact(1.1), 30.0, 1.0, wet=0.5)
    # S6
    m.add(whoosh(1.1, True, 300, 6000), 30.7, 0.6)
    sfx_common_logo(m, 31.4, 32.3, 32.4)
    m.add(ding(HZ['E5']), 33.2, 0.5, wet=0.4)
    m.add(sparkle(), 33.5, 0.9, wet=0.3)
    m.add(impact(1.2), 35.8, 1.0, wet=0.7)
    m.add(ding(HZ['C5'], 2.0), 35.8, 0.5, wet=0.5)
    return finish(m, dur)


if __name__ == '__main__':
    which, out = sys.argv[1], sys.argv[2]
    x = {'vertical': vertical, 'wide': wide}[which]()
    write_wav(out, x)
    print(which, 'ok', round(len(x) / SR, 2), 's, peak', round(float(np.max(np.abs(x))), 3),
          'rms', round(float(np.sqrt(np.mean(x ** 2))), 3))
