#!/usr/bin/env python3
"""Soundtrack for reels.html videos, generated from reels.json (same timings as the engine).

Usage: python3 audio_reels.py <reel-name> out.wav
"""
import json
import os
import sys

import audio as A

HERE = os.path.dirname(os.path.abspath(__file__))
PENTA = ['C5', 'D5', 'E5', 'G5', 'A5', 'C6']


def build(name):
    spec = json.load(open(os.path.join(HERE, 'reels.json')))[name]
    scenes = spec['scenes']
    starts, t = [], 0.0
    for s in scenes:
        starts.append(t)
        t += s['dur']
    total = t
    m = A.Mix(total + 0.4)
    anchor = starts[1] if len(starts) > 1 else 0.0
    cta_start = starts[-1]
    full = dict(pad=0.6, kick=1.0, clap=0.75, hat16=0.55, bass=0.85, arp=0.55, shaker=0.45)
    lite = dict(pad=0.55, kick=0.9, clap=0.6, hat16=0.5, bass=0.8, arp=0.45)
    secs = [(0.0, anchor, dict(pad=0.55)), (anchor, cta_start, lite), (cta_start, total - 0.8, full)]
    A.music(m, 120, anchor, secs)
    m.add_tonal(A.pad([A.HZ['C4'], A.HZ['E4'], A.HZ['G4'], A.HZ['C5']], 2.6, att=0.1, rel=2.0), total - 2.4, 1.2, wet=0.5)

    # scene boundaries: riser -> whoosh -> impact
    for i in range(1, len(scenes)):
        B = starts[i]
        m.add(A.riser(1.15), B - 1.25, 0.7)
        m.add(A.whoosh(1.1, up=(i % 2 == 1)), B - 0.55, 0.85)
        m.add(A.impact(1.1 if i == len(scenes) - 1 else 0.9), B, 0.95, wet=0.45)

    for i, s in enumerate(scenes):
        S, ty = starts[i], s['type']
        if ty == 'hook':
            for k in range(len(s['lines'])):
                m.add(A.thock(125 + 12 * k), S + 0.4 + 0.22 * k, 0.8)
            m.add(A.riser(1.2), S + 0.4 + 0.22 * len(s['lines']), 0.0)  # placeholder (silent)
        elif ty == 'tip':
            m.add(A.thock(85), S + 0.4, 0.95)
            for k in range(len(s['title'])):
                m.add(A.thock(120), S + 1.0 + 0.18 * k, 0.75)
            for k in range(len(s['body'])):
                m.add(A.tick(3000), S + 1.7 + 0.2 * k, 0.7, p=0.2)
            m.add(A.pop(520), S + 2.5, 0.7, wet=0.2)
            m.add(A.ding(A.HZ['E5']), S + 2.7, 0.5, wet=0.4)
            m.add(A.swish(0.5, True), S + 2.8, 0.5)
        elif ty == 'list':
            for k in range(len(s['title'])):
                m.add(A.thock(120), S + 0.4 + 0.18 * k, 0.75)
            for k, _ in enumerate(s['items']):
                m.add(A.swish(0.35, False), S + 0.9 + 0.2 * k, 0.5, p=0.5 - 0.1 * k)
                m.add(A.ding(A.HZ[PENTA[k % 6]]), S + 2.6 + 1.1 * k, 0.55, p=-0.2 + 0.1 * k, wet=0.4)
                m.add(A.thock(110), S + 2.6 + 1.1 * k, 0.6)
        elif ty == 'steps':
            for k in range(len(s['title'])):
                m.add(A.thock(120), S + 0.4 + 0.18 * k, 0.75)
            for k, _ in enumerate(s['steps']):
                m.add(A.ding(A.HZ[PENTA[k % 6]]), S + 1.3 + 0.8 * k, 0.6, wet=0.4)
                m.add(A.pop(520 + 60 * k), S + 1.3 + 0.8 * k, 0.6)
        elif ty == 'mock':
            for k in range(len(s['caption'])):
                m.add(A.thock(120), S + 0.4 + 0.2 * k, 0.75)
            m.add(A.whoosh(0.9, True, 300, 6000), S + 0.9, 0.55)
            for k, tk in enumerate((2.0, 2.3, 2.7)):
                m.add(A.pop(520 + 70 * k), S + tk, 0.6, p=-0.3 + 0.3 * k)
            m.add(A.ding(A.HZ['G5']), S + 3.0, 0.5, wet=0.4)
            for k in range(3):
                m.add(A.tick(3400), S + 3.05 + 0.2 * k, 0.8, p=0.3)
            m.add(A.pop(700), S + 3.7, 0.7, wet=0.2)
        elif ty == 'cta':
            for k in range(len(s['lines'])):
                m.add(A.thock(115), S + 0.4 + 0.2 * k, 0.8)
            A.sfx_common_logo(m, S + 0.9, S + 1.8, S + 1.9, nl=len(s.get('url', 'devdha.in')))
            m.add(A.sparkle(), S + 3.0, 0.8, wet=0.3)
            m.add(A.pop(620), S + 3.5, 0.8, wet=0.2)
            m.add(A.ding(A.HZ['G5']), S + 3.55, 0.6, wet=0.4)
            m.add(A.ding(A.HZ['C5'], 2.0), total - 2.4, 0.4, wet=0.5)
    return A.finish(m, total + 0.4), total


if __name__ == '__main__':
    x, total = build(sys.argv[1])
    A.write_wav(sys.argv[2], x)
    print(sys.argv[1], 'audio ok', round(total, 1), 's')
