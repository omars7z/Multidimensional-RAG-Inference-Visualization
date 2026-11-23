// Labels drawn once into a canvas texture and shown as a camera-facing sprite: no DOM work per frame,
// correctly hidden behind geometry, and they glow with the bloom like everything else.
import { useEffect, useMemo } from "react";
import { CanvasTexture, LinearFilter, SRGBColorSpace } from "three";

const SCALE = 2; // canvas pixels per CSS-ish pixel, for crisp text

function makeTexture({ title, sub, color, mono, pill }) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const tFont = mono ? `700 ${30 * SCALE}px Consolas, monospace` : `700 ${34 * SCALE}px Segoe UI, Noto Sans Arabic, sans-serif`;
  const sFont = `${21 * SCALE}px Consolas, Noto Sans Arabic, monospace`;
  ctx.font = tFont;
  const tw = title ? ctx.measureText(title).width : 0;
  ctx.font = sFont;
  const sw = sub ? ctx.measureText(sub).width : 0;
  const pad = 18 * SCALE;
  const w = Math.ceil(Math.max(tw, sw) + pad * 2);
  const h = Math.ceil((title ? 44 : 0) * SCALE + (sub ? 30 : 0) * SCALE + pad);
  c.width = Math.min(2048, w); c.height = h;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  if (pill) {
    ctx.fillStyle = "rgba(6,10,22,.72)"; ctx.strokeStyle = color; ctx.lineWidth = 2 * SCALE;
    ctx.beginPath(); ctx.roundRect(SCALE, SCALE, c.width - 2 * SCALE, c.height - 2 * SCALE, 14 * SCALE); ctx.fill(); ctx.stroke();
  }
  let y = pad / 2;
  if (title) {
    ctx.font = tFont; ctx.shadowColor = color; ctx.shadowBlur = 16 * SCALE; ctx.fillStyle = "#ffffff";
    ctx.fillText(title, c.width / 2, y); y += 44 * SCALE;
  }
  if (sub) {
    ctx.font = sFont; ctx.shadowBlur = 6 * SCALE; ctx.shadowColor = "#000"; ctx.fillStyle = color;
    ctx.fillText(sub, c.width / 2, y);
  }
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  return { tex, aspect: c.width / c.height, lines: (title ? 1 : 0) + (sub ? 0.7 : 0) };
}

/** `height` is the world height of one title line; the sprite keeps the text's aspect ratio. */
export function TextSprite({ position, title, sub, color = "#9fb6ff", height = 2.2, mono = false, pill = false, opacity = 1 }) {
  const { tex, aspect, lines } = useMemo(() => makeTexture({ title, sub, color, mono, pill }), [title, sub, color, mono, pill]);
  useEffect(() => () => tex.dispose(), [tex]);
  const h = height * Math.max(1, lines);
  return (
    <sprite position={position} scale={[h * aspect, h, 1]} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} toneMapped={false} opacity={opacity} />
    </sprite>
  );
}
