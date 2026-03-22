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

    // Fetch and resize all images in parallel
    const fetched = await Promise.all(items.map(item => fetchItem(item.id)));
    const resized = await Promise.all(fetched.map(buf =>
      buf
        ? sharp(buf).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer()
        : sharp({ create: { width: SIZE, height: SIZE, channels: 4,
                            background: { r: 26, g: 30, b: 40, alpha: 1 } } })
            .png().toBuffer()
    ));

    // Build qty number buffers for items with qty > 1
    const qtyBufs = await Promise.all(items.map(item =>
      item.qty > 1 ? makeNumber(item.qty) : Promise.resolve(null)
    ));

    // Build composites — all resolved, no Promises
    const composites = [];
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = PAD + col * (SIZE + GAP);
      const y   = PAD + row * (SIZE + GAP);

      composites.push({ input: resized[i], left: x, top: y });

      if (qtyBufs[i]) {
        composites.push({ input: qtyBufs[i], left: x + 2, top: y + SIZE - 10 });
      }
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

// Pixel-art numbers — 3x5 bitmap, white on dark bg
const DIGITS = {
  0:[1,1,1,1,0,1,1,0,1,1,0,1,1,1,1],
  1:[0,1,0,1,1,0,0,1,0,0,1,0,1,1,1],
  2:[1,1,1,0,0,1,1,1,1,1,0,0,1,1,1],
  3:[1,1,1,0,0,1,0,1,1,0,0,1,1,1,1],
  4:[1,0,1,1,0,1,1,1,1,0,0,1,0,0,1],
  5:[1,1,1,1,0,0,1,1,1,0,0,1,1,1,1],
  6:[1,1,1,1,0,0,1,1,1,1,0,1,1,1,1],
  7:[1,1,1,0,0,1,0,1,0,0,1,0,0,1,0],
  8:[1,1,1,1,0,1,1,1,1,1,0,1,1,1,1],
  9:[1,1,1,1,0,1,1,1,1,0,0,1,1,1,1],
};

async function makeNumber(qty) {
  const digits = String(qty).split('').map(Number);
  const DW = 3, DH = 5, DGAP = 1, P = 1;
  const W  = P * 2 + digits.length * DW + (digits.length - 1) * DGAP;
  const H  = P * 2 + DH;

  const buf = Buffer.alloc(W * H * 4);
  // Semi-transparent black background
  for (let i = 0; i < W * H; i++) {
    buf[i*4]=0; buf[i*4+1]=0; buf[i*4+2]=0; buf[i*4+3]=160;
  }
  // White pixels for each digit
  for (let di = 0; di < digits.length; di++) {
    const pix = DIGITS[digits[di]] || DIGITS[0];
    const ox  = P + di * (DW + DGAP);
    for (let r = 0; r < DH; r++) {
      for (let c = 0; c < DW; c++) {
        if (pix[r * DW + c]) {
          const idx = ((P + r) * W + ox + c) * 4;
          buf[idx]=255; buf[idx+1]=255; buf[idx+2]=255; buf[idx+3]=255;
        }
      }
    }
  }
  return sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

async function fetchItem(itemId) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(
      `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?size=64&quality=2`,
      { signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://albiononline.com/' } }
    );
    clearTimeout(tid);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    clearTimeout(tid);
    return null;
  }
}
