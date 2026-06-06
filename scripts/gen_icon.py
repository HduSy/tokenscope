#!/usr/bin/env python3
"""Generate the Tokenscope app icon: a black rounded tile with a green
bar-chart glyph, on a FULLY TRANSPARENT background (rounded corners are
transparent, not white). Renders at 4x and downsamples for clean anti-aliasing.

Output: src-tauri/icons/icon.png (1024x1024). Run `pnpm tauri icon` afterwards
to regenerate every platform size + icon.icns + icon.ico from this source.
"""
from PIL import Image, ImageDraw

S = 4                      # supersample factor
N = 1024 * S               # working canvas
GREEN = (39, 176, 110, 255)
TILE = (24, 27, 30, 255)   # near-black tile

img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# --- black rounded tile (transparent margin around it) ---
margin = int(0.085 * N)
t0, t1 = margin, N - margin
tile_r = int(0.225 * (t1 - t0))
d.rounded_rectangle([t0, t0, t1, t1], radius=tile_r, fill=TILE)

# --- green chart frame (rounded-square outline) ---
side = (t1 - t0)
bx = int((side) * 0.27)            # inset of frame from tile edge
fx0, fy0 = t0 + bx, t0 + bx
fx1, fy1 = t1 - bx, t1 - bx
stroke = int((fx1 - fx0) * 0.135)
frame_r = int((fx1 - fx0) * 0.26)
d.rounded_rectangle([fx0, fy0, fx1, fy1], radius=frame_r,
                    outline=GREEN, width=stroke)

# --- 3 ascending bars inside the frame ---
pad = int((fx1 - fx0) * 0.26)      # inner padding from frame
ix0, iy0 = fx0 + pad, fy0 + pad
ix1, iy1 = fx1 - pad, fy1 - pad
inner_w = ix1 - ix0
inner_h = iy1 - iy0
gap = inner_w * 0.16
bar_w = (inner_w - 2 * gap) / 3.0
heights = [0.42, 0.68, 1.0]        # short -> tall
bar_r = int(bar_w * 0.32)
for i, hf in enumerate(heights):
    x0 = ix0 + i * (bar_w + gap)
    x1 = x0 + bar_w
    y1 = iy1
    y0 = iy1 - inner_h * hf
    d.rounded_rectangle([x0, y0, x1, y1], radius=bar_r, fill=GREEN)

# downsample to 1024 with high-quality resampling
out = img.resize((1024, 1024), Image.LANCZOS)
out.save("/Users/rayonreal/DEV/AI/tokenscope/src-tauri/icons/icon.png")

# sanity: report corners + center
w, h = out.size
for name, (x, y) in {"TL": (0, 0), "TR": (w - 1, 0), "BL": (0, h - 1),
                     "BR": (w - 1, h - 1), "center": (w // 2, h // 2)}.items():
    print(name, out.getpixel((x, y)))
