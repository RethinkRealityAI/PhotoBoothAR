#!/usr/bin/env python3
"""
Animated Frames for the shared library — hand-drawn SVG, one file per LAYER.

Each layer is a full 1080x1920 transparent canvas (the booth draws every layer
full-frame and animates it: lib/studio/animation.ts layerMotion2D), so a frame
is split by what MOVES: the moon drops in and floats, the stars twinkle, the
bunting swings from its string. Keep the art out of the face zone (roughly the
centre 760x980 box) — guests stand there.

Run:   python3 scripts/motion-frames/art.py   (writes scripts/motion-frames/svg/)
Then:  node scripts/motion-frames/render.mjs  (rasterises to public/library/motion/)
"""
import math
import os
import random

W, H = 1080, 1920
OUT = os.path.join(os.path.dirname(__file__), 'svg')

FONTS = """
<style>
  @font-face { font-family: 'Pinyon Script'; src: url(/fonts/pinyon-script-400-latin.woff2) format('woff2'); }
  @font-face { font-family: 'Bricolage Grotesque'; src: url(/fonts/bricolage-grotesque-var-latin.woff2) format('woff2'); font-weight: 200 800; }
  @font-face { font-family: 'Jost'; src: url(/fonts/jost-500-latin.woff2) format('woff2'); font-weight: 500; }
  @font-face { font-family: 'Cormorant Garamond'; src: url(/fonts/cormorant-garamond-i500-latin.woff2) format('woff2'); font-style: italic; font-weight: 500; }
</style>
"""


def svg(body, defs=''):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
            f'{FONTS}<defs>{defs}</defs>{body}</svg>')


def write(frame, layer, content):
    d = os.path.join(OUT, frame)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, f'{layer}.svg'), 'w') as f:
        f.write(content)


def in_face_zone(x, y, pad=0):
    return 160 - pad < x < 920 + pad and 360 - pad < y < 1400 + pad


def scatter(rng, n, avoid_pad=0, top=60, bottom=1860, left=40, right=1040):
    pts = []
    tries = 0
    while len(pts) < n and tries < 20000:
        tries += 1
        x, y = rng.uniform(left, right), rng.uniform(top, bottom)
        if in_face_zone(x, y, avoid_pad):
            continue
        if any((x - px) ** 2 + (y - py) ** 2 < 70 ** 2 for px, py in pts):
            continue
        pts.append((x, y))
    return pts


GOLD_DEFS = """
<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#fff4cf"/><stop offset="0.28" stop-color="#e8c46a"/>
  <stop offset="0.52" stop-color="#fff1c2"/><stop offset="0.75" stop-color="#c8932e"/>
  <stop offset="1" stop-color="#f6dc93"/>
</linearGradient>
<linearGradient id="goldV" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#fff6d8"/><stop offset="0.45" stop-color="#e7bf5f"/>
  <stop offset="1" stop-color="#b07a22"/>
</linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
  <feGaussianBlur stdDeviation="6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>
<filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
  <feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.35"/>
</filter>
"""


def star4(x, y, r, fill='url(#gold)', thin=0.22):
    """Four-point twinkle star centred on (x, y)."""
    t = r * thin
    return (f'<path d="M{x},{y - r} Q{x + t},{y - t} {x + r},{y} Q{x + t},{y + t} {x},{y + r} '
            f'Q{x - t},{y + t} {x - r},{y} Q{x - t},{y - t} {x},{y - r}Z" fill="{fill}"/>')


# ───────────────────────────── 1. STARLIT ─────────────────────────────
def starlit():
    f = 'starlit'
    defs = GOLD_DEFS + """
<radialGradient id="vig" cx="0.5" cy="0.45" r="0.75">
  <stop offset="0.55" stop-color="#0b0a2a" stop-opacity="0"/>
  <stop offset="0.82" stop-color="#140f3d" stop-opacity="0.45"/>
  <stop offset="1" stop-color="#07061c" stop-opacity="0.82"/>
</radialGradient>
<radialGradient id="moonFill" cx="0.35" cy="0.35" r="0.8">
  <stop offset="0" stop-color="#fffbe9"/><stop offset="0.6" stop-color="#f6e2a4"/><stop offset="1" stop-color="#d9b25a"/>
</radialGradient>
<radialGradient id="moonGlow" cx="0.5" cy="0.5" r="0.5">
  <stop offset="0" stop-color="#ffe9a8" stop-opacity="0.55"/><stop offset="1" stop-color="#ffe9a8" stop-opacity="0"/>
</radialGradient>
<mask id="crescent"><rect width="1080" height="1920" fill="#fff"/><circle cx="880" cy="232" r="88" fill="#000"/></mask>
"""
    # Base: vignette + double gold rule + deco corner fans.
    corners = ''
    for (cx, cy, sx, sy) in [(44, 44, 1, 1), (1036, 44, -1, 1), (44, 1876, 1, -1), (1036, 1876, -1, -1)]:
        rays = ''
        for i in range(7):
            a = math.radians(8 + i * 12.3)
            x2 = cx + sx * math.cos(a) * 120
            y2 = cy + sy * math.sin(a) * 120
            rays += f'<line x1="{cx}" y1="{cy}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="url(#gold)" stroke-width="2.2" stroke-linecap="round" opacity="0.9"/>'
        arc_r = 132
        rays += (f'<path d="M{cx + sx * arc_r},{cy} A{arc_r},{arc_r} 0 0 {1 if sx * sy > 0 else 0} {cx},{cy + sy * arc_r}" '
                 f'fill="none" stroke="url(#gold)" stroke-width="3"/>')
        rays += f'<circle cx="{cx + sx * 20}" cy="{cy + sy * 20}" r="7" fill="url(#gold)"/>'
        corners += rays
    base = (f'<rect width="{W}" height="{H}" fill="url(#vig)"/>'
            f'<rect x="44" y="44" width="992" height="1832" rx="38" fill="none" stroke="url(#gold)" stroke-width="5" filter="url(#glow)"/>'
            f'<rect x="64" y="64" width="952" height="1792" rx="28" fill="none" stroke="url(#gold)" stroke-width="1.6" opacity="0.7"/>'
            + corners)
    write(f, 'base', svg(base, defs))

    rng = random.Random(7)
    pts = scatter(rng, 30, avoid_pad=10, top=90, bottom=1520, left=90, right=990)
    a, b = '', ''
    for i, (x, y) in enumerate(pts):
        r = rng.choice([12, 16, 20, 26, 34])
        s = star4(round(x), round(y), r)
        dot = f'<circle cx="{x + rng.uniform(-40, 40):.0f}" cy="{y + rng.uniform(-40, 40):.0f}" r="{rng.uniform(2, 4):.1f}" fill="#fff6d6" opacity="0.85"/>'
        if i % 2:
            a += s + dot
        else:
            b += s + dot
    write(f, 'starsA', svg(f'<g filter="url(#glow)">{a}</g>', defs))
    write(f, 'starsB', svg(f'<g filter="url(#glow)">{b}</g>', defs))

    moon = (f'<circle cx="840" cy="262" r="190" fill="url(#moonGlow)"/>'
            f'<g mask="url(#crescent)" filter="url(#glow)"><circle cx="840" cy="262" r="98" fill="url(#moonFill)"/></g>'
            + star4(744, 176, 18, '#fff6d6'))
    write(f, 'moon', svg(moon, defs))

    title = ('<g filter="url(#softShadow)">'
             '<text x="540" y="1712" text-anchor="middle" font-family="Pinyon Script" font-size="168" fill="url(#gold)">Starry Night</text>'
             '</g>'
             '<line x1="330" y1="1776" x2="470" y2="1776" stroke="url(#gold)" stroke-width="2"/>'
             '<line x1="610" y1="1776" x2="750" y2="1776" stroke="url(#gold)" stroke-width="2"/>'
             + star4(540, 1776, 16)
             + '<text x="540" y="1830" text-anchor="middle" font-family="Jost" font-weight="500" font-size="30" letter-spacing="12" fill="#f6e3a6">MAKE A WISH</text>')
    write(f, 'title', svg(title, defs))


# ───────────────────────────── 2. BIRTHDAY BASH ─────────────────────────────
PARTY = ['#ff5d73', '#ffc93c', '#35d0a0', '#4cc9f0', '#a98bff', '#ff8fb1']


def balloon(cx, cy, rx, color, string_to):
    ry = rx * 1.22
    sid = f'b{abs(hash((cx, cy))) % 99999}'
    defs = (f'<radialGradient id="{sid}" cx="0.35" cy="0.3" r="0.85">'
            f'<stop offset="0" stop-color="#ffffff" stop-opacity="0.9"/>'
            f'<stop offset="0.18" stop-color="{color}"/>'
            f'<stop offset="1" stop-color="{color}" stop-opacity="1"/></radialGradient>'
            f'<radialGradient id="{sid}s" cx="0.5" cy="0.5" r="0.5"><stop offset="0.7" stop-color="#000" stop-opacity="0"/>'
            f'<stop offset="1" stop-color="#000" stop-opacity="0.25"/></radialGradient>')
    sx, sy = string_to
    tie_y = cy + ry
    body = (f'<path d="M{cx},{tie_y + 8} C{cx - 30},{tie_y + 120} {cx + 40},{tie_y + 220} {sx},{sy}" fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="3"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#{sid})"/>'
            f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="url(#{sid}s)"/>'
            f'<path d="M{cx - 10},{tie_y + 14} L{cx},{tie_y - 2} L{cx + 10},{tie_y + 14} Z" fill="{color}"/>'
            f'<ellipse cx="{cx - rx * 0.38}" cy="{cy - ry * 0.42}" rx="{rx * 0.16}" ry="{ry * 0.24}" fill="#fff" opacity="0.55" transform="rotate(-25 {cx - rx * 0.38} {cy - ry * 0.42})"/>')
    return defs, body


def birthday():
    f = 'birthday-bash'
    defs = GOLD_DEFS
    # Bunting: a sagging string with pennants hung along it.
    pts = []
    n = 13
    for i in range(n + 1):
        t = i / n
        x = 30 + t * 1020
        y = 96 + math.sin(t * math.pi) * 120
        pts.append((x, y))
    path = 'M' + ' L'.join(f'{x:.1f},{y:.1f}' for x, y in pts)
    flags = ''
    for i in range(n):
        (x1, y1), (x2, y2) = pts[i], pts[i + 1]
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2
        c = PARTY[i % len(PARTY)]
        tipx, tipy = mx, my + 118
        flags += (f'<path d="M{x1 + 6:.1f},{y1 + 2:.1f} L{x2 - 6:.1f},{y2 + 2:.1f} L{tipx:.1f},{tipy:.1f} Z" fill="{c}"/>'
                  f'<path d="M{x1 + 6:.1f},{y1 + 2:.1f} L{mx:.1f},{my + 2:.1f} L{tipx:.1f},{tipy:.1f} Z" fill="#fff" opacity="0.18"/>'
                  f'<circle cx="{mx:.1f}" cy="{my + 40:.1f}" r="9" fill="#fff" opacity="0.8"/>')
    bunting = (f'<g filter="url(#softShadow)">{flags}</g>'
               f'<path d="{path}" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>')
    write(f, 'bunting', svg(bunting, defs))

    def cluster(side):
        d, b = '', ''
        if side == 'L':
            spec = [(150, 1360, 92, PARTY[0]), (300, 1450, 82, PARTY[3]), (120, 1560, 76, PARTY[1]), (250, 1620, 64, PARTY[4])]
            anchor = (210, 1925)
        else:
            spec = [(930, 1370, 92, PARTY[2]), (780, 1460, 80, PARTY[5]), (960, 1575, 74, PARTY[4]), (830, 1625, 62, PARTY[1])]
            anchor = (870, 1925)
        for (cx, cy, rx, c) in spec:
            dd, bb = balloon(cx, cy, rx, c, anchor)
            d += dd
            b += bb
        return d, f'<g filter="url(#softShadow)">{b}</g>'

    dL, bL = cluster('L')
    dR, bR = cluster('R')
    write(f, 'balloonsL', svg(bL, defs + dL))
    write(f, 'balloonsR', svg(bR, defs + dR))

    rng = random.Random(11)
    conf = ''
    for (x, y) in scatter(rng, 46, avoid_pad=0, top=260, bottom=1330, left=50, right=1030):
        c = rng.choice(PARTY + ['#ffffff'])
        kind = rng.random()
        rot = rng.uniform(0, 180)
        if kind < 0.45:
            conf += f'<rect x="{x - 7:.0f}" y="{y - 16:.0f}" width="14" height="32" rx="3" fill="{c}" transform="rotate({rot:.0f} {x:.0f} {y:.0f})"/>'
        elif kind < 0.75:
            conf += f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{rng.uniform(6, 10):.1f}" fill="{c}"/>'
        else:
            conf += (f'<path d="M{x - 18:.0f},{y:.0f} q9,-14 18,0 t18,0" fill="none" stroke="{c}" stroke-width="6" stroke-linecap="round" '
                     f'transform="rotate({rot:.0f} {x:.0f} {y:.0f})"/>')
    write(f, 'confetti', svg(conf, defs))

    title = ('<g filter="url(#softShadow)">'
             '<text x="540" y="1786" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="132" '
             'fill="#ff5d73" stroke="#ff5d73" stroke-width="22" stroke-linejoin="round" transform="translate(0 8)">Happy Birthday</text>'
             '<text x="540" y="1786" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="132" '
             'fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round">Happy Birthday</text>'
             '<text x="540" y="1786" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="800" font-size="132" fill="#2b1b5a">Happy Birthday</text>'
             '</g>')
    write(f, 'title', svg(title, defs))


# ───────────────────────────── 3. LOVE BLOOM ─────────────────────────────
def rose(cx, cy, r, c1, c2, rid):
    """A five-petal blossom: notched petals with a blush gradient and stamens."""
    defs = (f'<radialGradient id="{rid}" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" '
            f'gradientTransform="translate({cx} {cy}) scale({r})">'
            f'<stop offset="0" stop-color="{c1}"/><stop offset="0.35" stop-color="{c1}" stop-opacity="0.9"/>'
            f'<stop offset="1" stop-color="{c2}"/></radialGradient>')
    body = ''
    for k in range(5):
        a = k * 72 - 90
        # petal pointing up, then rotated: base at centre, notched tip at radius r
        petal = (f'M0,0 C{-r * 0.55:.1f},{-r * 0.25:.1f} {-r * 0.62:.1f},{-r * 0.85:.1f} {-r * 0.16:.1f},{-r:.1f} '
                 f'L0,{-r * 0.86:.1f} L{r * 0.16:.1f},{-r:.1f} '
                 f'C{r * 0.62:.1f},{-r * 0.85:.1f} {r * 0.55:.1f},{-r * 0.25:.1f} 0,0Z')
        body += (f'<path d="{petal}" fill="url(#{rid})" stroke="{c1}" stroke-opacity="0.35" stroke-width="1.2" '
                 f'transform="translate({cx} {cy}) rotate({a + 90})"/>')
        body += (f'<path d="M0,0 L0,{-r * 0.55:.1f}" stroke="#ffffff" stroke-opacity="0.45" stroke-width="{max(1.5, r * 0.025):.1f}" '
                 f'transform="translate({cx} {cy}) rotate({a + 90})"/>')
    for k in range(9):
        a = math.radians(k * 40 + 10)
        x2, y2 = cx + math.cos(a) * r * 0.32, cy + math.sin(a) * r * 0.32
        body += (f'<line x1="{cx}" y1="{cy}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#c9536f" stroke-width="{max(1.2, r * 0.02):.1f}"/>'
                 f'<circle cx="{x2:.1f}" cy="{y2:.1f}" r="{max(2.5, r * 0.045):.1f}" fill="#f4c24a"/>')
    body += f'<circle cx="{cx}" cy="{cy}" r="{r * 0.1:.1f}" fill="#e2708d"/>'
    return defs, body


def leaf(x, y, length, angle, color='#7fa68c'):
    return (f'<path d="M0,0 C{length * 0.3},{-length * 0.22} {length * 0.75},{-length * 0.2} {length},0 '
            f'C{length * 0.75},{length * 0.2} {length * 0.3},{length * 0.22} 0,0Z" fill="{color}" '
            f'transform="translate({x} {y}) rotate({angle})"/>'
            f'<path d="M0,0 L{length * 0.92},0" stroke="#5d846c" stroke-width="2" transform="translate({x} {y}) rotate({angle})"/>')


def love():
    f = 'love-bloom'
    defs = GOLD_DEFS + """
<linearGradient id="roseGold" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#fbe1d6"/><stop offset="0.4" stop-color="#e2a48f"/>
  <stop offset="0.7" stop-color="#fcd9c9"/><stop offset="1" stop-color="#c47d68"/>
</linearGradient>
<radialGradient id="blush" cx="0.5" cy="0.5" r="0.75">
  <stop offset="0.6" stop-color="#ffd9e3" stop-opacity="0"/><stop offset="1" stop-color="#ffc2d1" stop-opacity="0.42"/>
</radialGradient>
"""
    heart_top = 'M540,92 C540,70 512,58 498,76 C484,58 456,70 456,92 C456,116 498,134 498,146 C498,134 540,116 540,92Z'
    base = (f'<rect width="{W}" height="{H}" fill="url(#blush)"/>'
            f'<rect x="54" y="54" width="972" height="1812" rx="44" fill="none" stroke="url(#roseGold)" stroke-width="4"/>'
            f'<path d="{heart_top}" fill="url(#roseGold)" transform="translate(42 -8)"/>')
    write(f, 'base', svg(base, defs))

    def corner(flip):
        d, b = '', ''
        roses = [(160, 170, 96, '#fff6f8', '#f28aa5'), (318, 112, 66, '#ffffff', '#f7a8bc'), (104, 336, 64, '#fff8f2', '#f6b3a5'),
                 (262, 290, 50, '#ffffff', '#ee7d9b'), (420, 70, 34, '#ffffff', '#f4b6c6')]
        leaves = [(240, 80, 150, -18), (330, 170, 120, 22), (60, 260, 140, 80), (150, 400, 120, 70), (380, 90, 110, -5),
                  (60, 430, 100, 95), (420, 140, 90, 30)]
        for (x, y, ln, a) in leaves:
            b += leaf(x, y, ln, a)
        for i, (x, y, r, c1, c2) in enumerate(roses):
            rid = f'r{"b" if flip else "a"}{i}'
            dd, bb = rose(x, y, r, c1, c2, rid)
            d += dd
            b += bb
        g = f'<g filter="url(#softShadow)">{b}</g>'
        if flip:
            # Smaller at the bottom, tucked into the corner, so the lettering has room.
            g = f'<g transform="translate(1080 1920) scale(0.8) translate(-1080 -1920) rotate(180 540 960)">{g}</g>'
        return d, g

    dA, gA = corner(False)
    dB, gB = corner(True)
    write(f, 'floralTL', svg(gA, defs + dA))
    write(f, 'floralBR', svg(gB, defs + dB))

    rng = random.Random(5)
    hearts = ''
    for (x, y) in scatter(rng, 16, avoid_pad=0, top=520, bottom=1500, left=60, right=1020):
        s = rng.uniform(0.45, 1.0)
        c = rng.choice(['#ff8fab', '#ffb3c6', '#f7c6b8', 'url(#roseGold)'])
        hearts += (f'<path d="M0,-14 C0,-34 -30,-40 -36,-16 C-40,4 -12,20 0,34 C12,20 40,4 36,-16 C30,-40 0,-34 0,-14Z" '
                   f'fill="{c}" opacity="0.92" transform="translate({x:.0f} {y:.0f}) scale({s:.2f}) rotate({rng.uniform(-20, 20):.0f})"/>')
    write(f, 'hearts', svg(f'<g filter="url(#softShadow)">{hearts}</g>', defs))

    title = ('<g filter="url(#softShadow)">'
             '<text x="430" y="1712" text-anchor="middle" font-family="Pinyon Script" font-size="104" fill="url(#roseGold)">Forever &amp; Always</text>'
             '</g>')
    write(f, 'title', svg(title, defs))


# ───────────────────────────── 4. CHEERS ─────────────────────────────
def flute(x, y, angle, gid):
    """A champagne flute, bowl up, pivoting about its foot at (x, y)."""
    defs = (f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="0">'
            f'<stop offset="0" stop-color="#ffffff" stop-opacity="0.55"/><stop offset="0.35" stop-color="#ffffff" stop-opacity="0.12"/>'
            f'<stop offset="0.8" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0.6"/></linearGradient>'
            f'<linearGradient id="{gid}w" x1="0" y1="0" x2="0" y2="1">'
            f'<stop offset="0" stop-color="#fff2b8"/><stop offset="1" stop-color="#e7b54a"/></linearGradient>')
    bowl = 'M-52,-520 C-56,-380 -40,-270 0,-238 C40,-270 56,-380 52,-520 Z'
    wine = 'M-46,-450 C-48,-360 -34,-282 0,-252 C34,-282 48,-360 46,-450 Z'
    bubbles = ''.join(f'<circle cx="{dx}" cy="{dy}" r="{r}" fill="#fff" opacity="0.8"/>' for dx, dy, r in
                      [(-12, -300, 4), (8, -340, 3), (-4, -380, 5), (14, -410, 3), (-18, -430, 3)])
    body = (f'<g transform="translate({x} {y}) rotate({angle})">'
            f'<path d="{wine}" fill="url(#{gid}w)" opacity="0.95"/>{bubbles}'
            f'<path d="{bowl}" fill="url(#{gid})" stroke="#ffffff" stroke-opacity="0.9" stroke-width="4"/>'
            f'<rect x="-5" y="-240" width="10" height="210" fill="#ffffff" opacity="0.85" rx="5"/>'
            f'<ellipse cx="0" cy="-22" rx="74" ry="16" fill="#ffffff" opacity="0.85"/>'
            f'<path d="M-46,-500 C-46,-420 -36,-340 -20,-300" stroke="#fff" stroke-width="5" fill="none" opacity="0.7" stroke-linecap="round"/>'
            f'</g>')
    return defs, body


def cheers():
    f = 'cheers'
    defs = GOLD_DEFS + """
<linearGradient id="silver" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#ffffff"/><stop offset="0.5" stop-color="#c9d2e3"/><stop offset="1" stop-color="#f2f5fb"/>
</linearGradient>
<radialGradient id="cheersVig" cx="0.5" cy="0.45" r="0.8">
  <stop offset="0.6" stop-color="#1a1206" stop-opacity="0"/><stop offset="1" stop-color="#140c02" stop-opacity="0.6"/>
</radialGradient>
"""
    # Streamers: curly ribbons hanging from the top edge.
    rng = random.Random(3)
    streamers = ''
    for i, x0 in enumerate([60, 190, 330, 470, 610, 750, 890, 1020]):
        length = rng.uniform(220, 340) if 250 < x0 < 830 else rng.uniform(360, 520)
        fill = 'url(#gold)' if i % 2 == 0 else 'url(#silver)'
        segs = int(length / 46)
        dpath = f'M{x0},-10'
        y = -10
        for s in range(segs):
            dx = 34 if s % 2 == 0 else -34
            dpath += f' q{dx},23 0,46'
            y += 46
        streamers += f'<path d="{dpath}" fill="none" stroke="{fill}" stroke-width="12" stroke-linecap="round"/>'
        streamers += star4(x0, y + 26, 16, fill)
    write(f, 'streamers', svg(f'<rect width="{W}" height="{H}" fill="url(#cheersVig)"/><g filter="url(#softShadow)">{streamers}</g>', defs))

    dL, gL = flute(452, 1905, -14, 'fl')
    dR, gR = flute(628, 1905, 14, 'fr')
    write(f, 'glassL', svg(f'<g filter="url(#softShadow)">{gL}</g>', defs + dL))
    write(f, 'glassR', svg(f'<g filter="url(#softShadow)">{gR}</g>', defs + dR))

    bub = ''
    for (x, y) in scatter(rng, 34, top=300, bottom=1700, left=50, right=1030):
        r = rng.uniform(5, 16)
        bub += (f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{r:.1f}" fill="none" stroke="#fff3cf" stroke-width="2.4" opacity="0.85"/>'
                f'<circle cx="{x - r * 0.35:.0f}" cy="{y - r * 0.35:.0f}" r="{r * 0.25:.1f}" fill="#fff" opacity="0.8"/>')
    write(f, 'bubbles', svg(bub, defs))

    title = ('<g filter="url(#softShadow)">'
             '<text x="540" y="1440" text-anchor="middle" font-family="Pinyon Script" font-size="190" fill="url(#gold)">Cheers!</text></g>'
             + star4(800, 1316, 22) + star4(272, 1392, 14))
    write(f, 'title', svg(f'<g filter="url(#glow)">{title}</g>', defs))


# ───────────────────────────── 5. NEON GLOW ─────────────────────────────
def neon_stroke(shape, color, width=8):
    return (f'<g fill="none" stroke-linecap="round" stroke-linejoin="round">'
            f'<g stroke="{color}" stroke-width="{width * 3.4}" opacity="0.28" filter="url(#neonBlur)">{shape}</g>'
            f'<g stroke="{color}" stroke-width="{width * 1.6}" opacity="0.65" filter="url(#neonBlurS)">{shape}</g>'
            f'<g stroke="{color}" stroke-width="{width}">{shape}</g>'
            f'<g stroke="#ffffff" stroke-width="{width * 0.38}" opacity="0.9">{shape}</g></g>')


def neon():
    f = 'neon-glow'
    defs = """
<filter id="neonBlur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="16"/></filter>
<filter id="neonBlurS" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
<radialGradient id="neonVig" cx="0.5" cy="0.45" r="0.78">
  <stop offset="0.6" stop-color="#12002b" stop-opacity="0"/><stop offset="1" stop-color="#0d0024" stop-opacity="0.7"/>
</radialGradient>
"""
    border = neon_stroke('<rect x="58" y="58" width="964" height="1804" rx="60"/>', '#ff3fd2', 9)
    border2 = neon_stroke('<rect x="86" y="86" width="908" height="1748" rx="44"/>', '#2fe6ff', 4)
    write(f, 'border', svg(f'<rect width="{W}" height="{H}" fill="url(#neonVig)"/>{border}{border2}', defs))

    sign = ('<text x="540" y="290" text-anchor="middle" font-family="Bricolage Grotesque" font-weight="700" font-size="150" '
            'letter-spacing="6">GOOD VIBES</text>')
    write(f, 'sign', svg(neon_stroke(sign, '#2fe6ff', 5), defs))

    bolt = 'M190,1500 L140,1620 L196,1620 L150,1760 L262,1590 L204,1590 L246,1500 Z'
    star5 = ''
    cx, cy, R, r = 880, 1610, 86, 36
    pts = []
    for k in range(10):
        rad = R if k % 2 == 0 else r
        a = math.radians(-90 + k * 36)
        pts.append(f'{cx + math.cos(a) * rad:.1f},{cy + math.sin(a) * rad:.1f}')
    star5 = f'<polygon points="{" ".join(pts)}"/>'
    heart = '<path d="M540,1790 C540,1760 500,1745 482,1772 C470,1792 488,1818 540,1850 C592,1818 610,1792 598,1772 C580,1745 540,1760 540,1790Z"/>'
    icons = neon_stroke(f'<path d="{bolt}"/>', '#ffe14a', 6) + neon_stroke(star5, '#ff3fd2', 6) + neon_stroke(heart, '#ff5b8a', 6)
    write(f, 'icons', svg(icons, defs))

    rng = random.Random(9)
    sparks = ''
    for (x, y) in scatter(rng, 18, top=380, bottom=1440, left=70, right=1010):
        col = rng.choice(['#2fe6ff', '#ff3fd2', '#ffe14a'])
        sparks += neon_stroke(f'<path d="M{x - 14:.0f},{y:.0f} L{x + 14:.0f},{y:.0f} M{x:.0f},{y - 14:.0f} L{x:.0f},{y + 14:.0f}"/>', col, 3)
    write(f, 'sparks', svg(sparks, defs))


if __name__ == '__main__':
    starlit()
    birthday()
    love()
    cheers()
    neon()
    print('wrote', OUT)
