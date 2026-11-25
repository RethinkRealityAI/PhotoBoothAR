"""Turn the raw QR-card scene paintings into the app's art + data file.

Usage:  python3 scripts/qr-card-art/process-art.py <raw-dir>
        (needs opencv-python + numpy; raw files are <scene>-p.png / <scene>-l.png,
        made on Meshy from scripts/qr-card-art/prompts.json)

For each picture it:
  1. finds the plain pale SPOT the QR code is printed on (a sign's board, a
     gift tag, a billboard, the moon...): seed = the brightest, flattest pixel
     near where the prompt asked for it (prompts.json `at`), grow a
     colour-similar region from it, and take that region's largest
     axis-aligned inscribed square (chessboard distance transform), so a
     ribbon or branch over the edge cannot drag the square off the clear face;
     the holder's own bounds are kept too, so words stay off it;
  2. reads the face colour (median inside the square) and the scene's mean colour;
  3. decides whether words read better in light or dark ink where they go
     (portrait: above and below the spot; landscape: the column beside it);
  4. writes public/qr-cards/art/<template>-<p|l>.webp (+ a small -thumb for the
     gallery) and src/lib/qrCards/sceneArt.ts.
"""
import json, os, sys
import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_IMG = os.path.join(ROOT, 'public', 'qr-cards', 'art')
OUT_TS = os.path.join(ROOT, 'src', 'lib', 'qrCards', 'sceneArt.ts')

# raw scene name -> template id (where they differ)
RENAME = {'little-one': 'balloon-release'}


def find_spot(im, at):
    """Centre (px) and half-side (px) of the largest plain square at the holder."""
    h, w = im.shape[:2]
    lab = cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32)
    L = lab[..., 0]
    blur = cv2.GaussianBlur(lab, (0, 0), 3)
    grad = np.abs(cv2.Laplacian(cv2.GaussianBlur(L, (0, 0), 2), cv2.CV_32F))
    flat = cv2.GaussianBlur(grad, (0, 0), 8)
    ex, ey = at['x'], at['y']
    yy, xx = np.mgrid[0:h, 0:w]
    score = L - 6 * flat - 120 * np.hypot(xx / w - ex, yy / h - ey)
    # Several seeds: the best-scoring pixel in each cell of a grid around the
    # asked-for spot (the painter does not always put the holder exactly there,
    # and open sky can outscore a tan signboard on brightness alone).
    win = (np.abs(xx / w - ex) < 0.25) & (np.abs(yy / h - ey) < 0.25)
    masked = np.where(win, score, -1e9)
    seeds = []
    cell = max(8, min(h, w) // 10)
    for y0 in range(0, h, cell):
        for x0 in range(0, w, cell):
            blk = masked[y0:y0 + cell, x0:x0 + cell]
            if blk.max() <= -1e8:
                continue
            by, bx = np.unravel_index(np.argmax(blk), blk.shape)
            seeds.append((float(blk[by, bx]), y0 + by, x0 + bx))
    seeds.sort(reverse=True)
    best = None
    for _, sy, sx in seeds[:8]:
        got = grow(blur, sy, sx)
        cx, cy, r = got
        far = np.hypot(cx / w - ex, cy / h - ey) > 0.3
        if not far and (best is None or r > best[2]):
            best = got
    return best


def grow(blur, sy, sx):
    """Largest axis-aligned square inside the colour-similar region around a seed."""
    h, w = blur.shape[:2]
    d = np.linalg.norm(blur - blur[sy, sx], axis=2)
    best = None
    for tol in (10, 14, 18, 24):
        comp = np.zeros((h, w), np.uint8)
        _, lbl = cv2.connectedComponents((d < tol).astype(np.uint8))
        comp[lbl == lbl[sy, sx]] = 1
        comp = cv2.morphologyEx(comp, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
        # Chessboard distance = half the side of the largest square centred there.
        dt = cv2.distanceTransform(comp, cv2.DIST_C, 3)
        cy, cx = np.unravel_index(np.argmax(dt), dt.shape)
        r = float(dt[cy, cx])
        if best is not None and r > best[2] * 1.35:
            break  # the region leaked past the spot's edge
        best = (int(cx), int(cy), r)
    return best


def find_holder(im, cx, cy, r):
    """Bounds of the whole painted holder around the spot (a card's top edge
    above the clear square, a gilt frame, the moon's disc): the colour-similar
    region the square was cut from, capped at 2.2 half-sides from the centre so a
    region that runs into a same-coloured background cannot swallow the page.
    Words are kept off it. Fractions of the picture: x0, y0, x1, y1."""
    h, w = im.shape[:2]
    lab = cv2.GaussianBlur(cv2.cvtColor(im, cv2.COLOR_BGR2LAB).astype(np.float32), (0, 0), 3)
    d = np.linalg.norm(lab - lab[cy, cx], axis=2)
    _, lbl = cv2.connectedComponents((d < 18).astype(np.uint8))
    m = cv2.morphologyEx((lbl == lbl[cy, cx]).astype(np.uint8), cv2.MORPH_OPEN, np.ones((15, 15), np.uint8))
    ys, xs = np.nonzero(m)
    cap = 2.2 * r
    x0, x1 = max(xs.min(), cx - cap), min(xs.max(), cx + cap)
    y0, y1 = max(ys.min(), cy - cap), min(ys.max(), cy + cap)
    return {'x0': round(min(x0, cx - r) / w, 4), 'y0': round(min(y0, cy - r) / h, 4),
            'x1': round(max(x1, cx + r) / w, 4), 'y1': round(max(y1, cy + r) / h, 4)}


def hexc(bgr):
    b, g, r = (int(round(v)) for v in bgr)
    return f'#{r:02X}{g:02X}{b:02X}'


def lum(bgr):
    def ch(v):
        c = v / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    b, g, r = bgr
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)


def tone(im, x0, y0, x1, y1):
    """'light' = use light words here (the area is dark), 'dark' = dark words."""
    h, w = im.shape[:2]
    reg = im[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)].reshape(-1, 3).astype(np.float32)
    lums = np.array([lum(p) for p in reg[:: max(1, len(reg) // 4000)]])
    # Pick the ink with more contrast against the typical (median) pixel. Near-white
    # and near-black ink tie at a luminance of about 0.2: (L+.05)/.06 = 1/(L+.05).
    # (A brighter percentile let a few bright lanterns turn a dark sky's words dark.)
    return 'light' if np.percentile(lums, 50) < 0.2 else 'dark'


def main(raw):
    os.makedirs(OUT_IMG, exist_ok=True)
    with open(os.path.join(os.path.dirname(__file__), 'prompts.json')) as fh:
        ats = {(e['id'], e['orient']): e['at'] for e in json.load(fh)}
    data = {}
    for f in sorted(os.listdir(raw)):
        if not f.endswith('.png'):
            continue
        name, orient = f[:-4].rsplit('-', 1)
        tid = RENAME.get(name, name)
        im = cv2.imread(os.path.join(raw, f))
        h, w = im.shape[:2]
        cx, cy, r = find_spot(im, ats[(name, orient)])
        hold = find_holder(im, cx, cy, r)
        cx0, cx1, cy0, cy1 = hold['x0'] * w, hold['x1'] * w, hold['y0'] * h, hold['y1'] * h
        face = np.median(im[int(cy - r * 0.8):int(cy + r * 0.8), int(cx - r * 0.8):int(cx + r * 0.8)].reshape(-1, 3), axis=0)
        base = im.reshape(-1, 3).mean(axis=0)
        if orient == 'p':
            tones = {'top': tone(im, 0.15, 0.04, 0.85, max(0.08, cy0 / h - 0.02)),
                     # The one line under the code is printed just below the holder (layout.ts).
                     'below': tone(im, 0.15, min(0.93, cy1 / h + 0.015), 0.85, min(0.99, cy1 / h + 0.085))}
        elif cx / w > 0.5:
            col = tone(im, 0.04, 0.12, max(0.2, cx0 / w - 0.03), 0.8)
            tones = {'top': col, 'below': col}
        else:
            col = tone(im, min(0.8, cx1 / w + 0.03), 0.12, 0.96, 0.8)
            tones = {'top': col, 'below': col}
        src = f'/qr-cards/art/{tid}-{orient}.webp'
        cv2.imwrite(os.path.join(OUT_IMG, f'{tid}-{orient}.webp'), im, [cv2.IMWRITE_WEBP_QUALITY, 86])
        tw = 360 if orient == 'p' else 480
        thumb = cv2.resize(im, (tw, round(h * tw / w)), interpolation=cv2.INTER_AREA)
        cv2.imwrite(os.path.join(OUT_IMG, f'{tid}-{orient}-thumb.webp'), thumb, [cv2.IMWRITE_WEBP_QUALITY, 78])
        data.setdefault(tid, {})['portrait' if orient == 'p' else 'landscape'] = {
            'src': src, 'thumb': src.replace('.webp', '-thumb.webp'), 'aspect': round(w / h, 4),
            'spot': {'x': round(cx / w, 4), 'y': round(cy / h, 4), 's': round(2 * r / w, 4)},
            'hold': hold,
            'face': hexc(face), 'base': hexc(base), 'text': tones,
        }
    lines = [
        '/**',
        ' * @license',
        ' * SPDX-License-Identifier: Apache-2.0',
        ' *',
        ' * GENERATED by scripts/qr-card-art/process-art.py — do not edit by hand;',
        ' * re-run the script on the raw paintings instead.',
        ' *',
        ' * Each QR card template\'s full-page scene, per orientation: the plain',
        ' * square spot the code is printed on (centre as fractions; s = side as a',
        ' * fraction of the picture\'s width), the painted holder round it (a',
        ' * card, frame or moon the words keep off), its face colour, the scene\'s mean',
        ' * colour (painted first, in case the picture is slow), and which ink the',
        ' * words need above / below the spot (landscape: in the word column).',
        ' */',
        "import type { SceneArtSet } from './model';",
        '',
        'export const SCENE_ART: Record<string, SceneArtSet> = ' + json.dumps(data, indent=2).replace('"', "'") + ';',
        '',
    ]
    with open(OUT_TS, 'w') as fh:
        fh.write('\n'.join(lines))
    print(f'{len(data)} templates -> {OUT_TS}')


if __name__ == '__main__':
    main(sys.argv[1])
