import sharp from 'sharp';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const SIZE = 60;
const GAP  = 4;
const PAD  = 10;
const COLS = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const rawItems = (req.query.items || '').split(',').map(s => s.trim()).filter(Boolean);
  const items = rawItems.map(s => {
    const [id, qty] = s.split(':');
    return { id: id.trim(), qty: parseInt(qty) || 1 };
  });

  if (!items.length) return res.status(400).send('Missing ?items=');

  try {
    const cols = Math.min(COLS, items.length);
    const rows = Math.ceil(items.length / cols);
    const W    = PAD * 2 + cols * (SIZE + GAP) - GAP;
    const H    = PAD * 2 + rows * (SIZE + GAP) - GAP;

    // Pre-resolve ALL async buffers before building composites
    const fetched  = await Promise.all(items.map(item => fetchItem(item.id)));
    const resized  = await Promise.all(fetched.map((buf, i) =>
      buf ? sharp(buf).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer() : null
    ));
    const badges   = await Promise.all(items.map(item => makeQtyBadge(item.qty)));
    const tileBg   = await sharp({
      create: { width: SIZE, height: SIZE, channels: 4,
                background: { r: 26, g: 30, b: 40, alpha: 1 } }
    }).png().toBuffer();

    const borderSvg = Buffer.from(
      `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
        <rect x="1" y="1" width="${SIZE-2}" height="${SIZE-2}" rx="5"
          fill="none" stroke="#f59e0b" stroke-width="2"/>
      </svg>`);

    // Now build composites synchronously — no Promises in array
    const composites = [];
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = PAD + col * (SIZE + GAP);
      const y   = PAD + row * (SIZE + GAP);

      composites.push({ input: tileBg,    left: x, top: y });
      if (resized[i]) composites.push({ input: resized[i], left: x, top: y });
      composites.push({ input: borderSvg, left: x, top: y });
      composites.push({ input: badges[i], left: x + 3, top: y + SIZE - 11 });
    }

    const png = await sharp({
      create: { width: W, height: H, channels: 4,
                background: { r: 0x13, g: 0x16, b: 0x1e, alpha: 1 } }
    }).composite(composites).png({ compressionLevel: 6 }).toBuffer();

    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(png);

  } catch (e) {
    console.error('Grid error:', e);
    return res.status(500).send('Error: ' + e.message);
  }
}

// ── PIXEL ART DIGIT BADGES ────────────────────────────────────────────────────
// 3×5 bitmap font for 0–9, no external fonts required
const DIGITS = {
  0:[1,1,1, 1,0,1, 1,0,1, 1,0,1, 1,1,1],
  1:[0,1,0, 1,1,0, 0,1,0, 0,1,0, 1,1,1],
  2:[1,1,1, 0,0,1, 1,1,1, 1,0,0, 1,1,1],
  3:[1,1,1, 0,0,1, 0,1,1, 0,0,1, 1,1,1],
  4:[1,0,1, 1,0,1, 1,1,1, 0,0,1, 0,0,1],
  5:[1,1,1, 1,0,0, 1,1,1, 0,0,1, 1,1,1],
  6:[1,1,1, 1,0,0, 1,1,1, 1,0,1, 1,1,1],
  7:[1,1,1, 0,0,1, 0,1,0, 0,1,0, 0,1,0],
  8:[1,1,1, 1,0,1, 1,1,1, 1,0,1, 1,1,1],
  9:[1,1,1, 1,0,1, 1,1,1, 0,0,1, 1,1,1],
};

async function makeQtyBadge(qty) {
  const digits = String(qty).split('').map(Number);
  const DW = 3, DH = 5, GAP2 = 1, PAD2 = 2;
  const W = PAD2 * 2 + digits.length * DW + (digits.length - 1) * GAP2;
  const H = PAD2 * 2 + DH;

  const buf = Buffer.alloc(W * H * 4);
  // Dark semi-transparent background
  for (let i = 0; i < W * H; i++) {
    buf[i*4]=0; buf[i*4+1]=0; buf[i*4+2]=0; buf[i*4+3]=180;
  }
  // Draw each digit
  for (let di = 0; di < digits.length; di++) {
    const pix = DIGITS[digits[di]] || DIGITS[0];
    const ox  = PAD2 + di * (DW + GAP2);
    for (let r = 0; r < DH; r++) {
      for (let c = 0; c < DW; c++) {
        if (pix[r * DW + c]) {
          const idx = ((PAD2 + r) * W + (ox + c)) * 4;
          buf[idx]=255; buf[idx+1]=255; buf[idx+2]=255; buf[idx+3]=255;
        }
      }
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

// ── FETCH ITEM IMAGE ──────────────────────────────────────────────────────────
async function fetchItem(itemId) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(
      `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?size=64&quality=2`,
      {
        signal:  controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://albiononline.com/' }
      }
    );
    clearTimeout(timeout);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    clearTimeout(timeout);
    return null;
  }
}
