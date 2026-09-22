# -*- coding: utf-8 -*-
"""Genera el arte del launcher con PIL: logo, fondo, icono del perfil e icono de la app (ico).
    python tools/make_art.py
Fuentes de Windows: Georgia Bold para el nombre, Yu Gothic Bold para los kanji.
"""
import os
import random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "assets")
BUILD = os.path.join(ROOT, "build")
FONTS = "C:/Windows/Fonts"
GOLD = (212, 169, 74)
GOLD_LIGHT = (240, 210, 130)
RED = (179, 38, 43)
RED_DEEP = (90, 12, 16)
INK = (11, 7, 9)


def font(name, size, index=0):
    return ImageFont.truetype(os.path.join(FONTS, name), size, index=index)


def glow_text(base, xy, text, fnt, fill, glow, radius, glow_alpha=200):
    """Texto con un halo difuminado detras."""
    layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.text(xy, text, font=fnt, fill=glow + (glow_alpha,))
    layer = layer.filter(ImageFilter.GaussianBlur(radius))
    base.alpha_composite(layer)
    ImageDraw.Draw(base).text(xy, text, font=fnt, fill=fill + (255,))


def make_logo():
    img = Image.new("RGBA", (1000, 300), (0, 0, 0, 0))
    title = font("georgiab.ttf", 132)
    kanji = font("YuGothB.ttc", 46)
    small = font("georgia.ttf", 26)
    d = ImageDraw.Draw(img)
    # kanji rojo arriba a la izquierda: 鬼殺隊 (Cuerpo de Cazadores de Demonios)
    glow_text(img, (26, 28), "鬼殺隊", kanji, RED, RED, 10, 160)
    # sombra dura y luego el nombre en dorado con halo
    d.text((36, 92), "DemonCraft", font=title, fill=(0, 0, 0, 170))
    glow_text(img, (30, 86), "DemonCraft", title, GOLD_LIGHT, RED, 18, 190)
    # capa de degradado sobre el texto: dorado claro arriba, dorado oscuro abajo
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).text((30, 86), "DemonCraft", font=title, fill=255)
    grad = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    top, bottom = GOLD_LIGHT, (170, 120, 40)
    y0, y1 = 86, 86 + 150
    for y in range(y0, y1):
        t = (y - y0) / float(y1 - y0)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        gd.line([(0, y), (img.width, y)], fill=c + (255,))
    img.paste(grad, (0, 0), mask)
    # filete y subtitulo
    d = ImageDraw.Draw(img)
    d.line([(36, 250), (600, 250)], fill=GOLD + (160,), width=2)
    d.text((38, 256), "KIMETSU NO YAIBA  ·  ROLEPLAY", font=small, fill=(200, 185, 160, 255))
    img.save(os.path.join(ASSETS, "logo.png"))


def make_icon(size, kanji_size, border):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = max(2, size // 32)
    d.ellipse([pad, pad, size - pad, size - pad], fill=INK + (255,), outline=RED + (255,), width=border)
    d.ellipse([pad + border + 2, pad + border + 2, size - pad - border - 2, size - pad - border - 2], outline=GOLD + (140,), width=max(1, border // 2))
    fnt = font("YuGothB.ttc", kanji_size)
    text = "鬼"
    box = d.textbbox((0, 0), text, font=fnt)
    w, h = box[2] - box[0], box[3] - box[1]
    xy = ((size - w) / 2 - box[0], (size - h) / 2 - box[1] - size * 0.02)
    glow_text(img, xy, text, fnt, GOLD_LIGHT, RED, max(2, size // 20), 200)
    return img


def make_bg():
    w, h = 1600, 1000
    img = Image.new("RGB", (w, h), INK)
    d = ImageDraw.Draw(img)
    # degradado vertical: negro rojizo arriba, rojo profundo abajo
    for y in range(h):
        t = y / float(h)
        c = tuple(int(INK[i] + (RED_DEEP[i] - INK[i]) * (t ** 2) * 0.9) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    # brasas: puntos calidos difuminados
    embers = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ed = ImageDraw.Draw(embers)
    random.seed(7)
    for _ in range(140):
        x, y = random.randint(0, w), random.randint(int(h * 0.35), h)
        r = random.randint(1, 4)
        a = random.randint(60, 200)
        ed.ellipse([x - r, y - r, x + r, y + r], fill=(230, 120, 60, a))
    embers = embers.filter(ImageFilter.GaussianBlur(1.2))
    img = img.convert("RGBA")
    img.alpha_composite(embers)
    # kanji enorme y tenue a la derecha
    big = font("YuGothB.ttc", 820)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(layer).text((w - 860, 40), "鬼", font=big, fill=RED + (34,))
    layer = layer.filter(ImageFilter.GaussianBlur(2))
    img.alpha_composite(layer)
    # grano
    noise = Image.effect_noise((w, h), 18).convert("RGBA")
    noise.putalpha(22)
    img.alpha_composite(noise)
    # viñeta
    vig = Image.new("L", (w, h), 0)
    vd = ImageDraw.Draw(vig)
    vd.ellipse([-w * 0.2, -h * 0.3, w * 1.2, h * 1.3], fill=255)
    vig = vig.filter(ImageFilter.GaussianBlur(220))
    dark = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    img = Image.composite(img, Image.alpha_composite(dark, img.copy().convert("RGBA")), vig)
    img.convert("RGB").save(os.path.join(ASSETS, "bg.png"), optimize=True)


def main():
    os.makedirs(ASSETS, exist_ok=True)
    os.makedirs(BUILD, exist_ok=True)
    make_logo()
    make_bg()
    make_icon(128, 84, 5).save(os.path.join(ASSETS, "profile-icon.png"))
    icon = make_icon(256, 168, 9)
    icon.save(os.path.join(ASSETS, "icon.png"))
    icon.save(os.path.join(BUILD, "icon.ico"), format="ICO", sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    for name in ("logo.png", "bg.png", "profile-icon.png", "icon.png"):
        p = os.path.join(ASSETS, name)
        print("%-18s %6d KB" % (name, os.path.getsize(p) // 1024))
    print("%-18s %6d KB" % ("build/icon.ico", os.path.getsize(os.path.join(BUILD, "icon.ico")) // 1024))


if __name__ == "__main__":
    main()
