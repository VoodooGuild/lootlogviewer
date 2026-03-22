import sharp from 'sharp';

export const config = { runtime: 'nodejs', maxDuration: 30 };

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

    // Fetch all images in parallel with individual 8s timeout
    const fetched = await Promise.all(items.map(item => fetchItem(item.id)));
    const composites = [];

    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = PAD + col * (SIZE + GAP);
      const y   = PAD + row * (SIZE + GAP);
      const qty = items[i].qty;

      // Dark tile background
      const tileBg = await sharp({
        create: { width: SIZE, height: SIZE, channels: 4,
                  background: { r: 26, g: 30, b: 40, alpha: 1 } }
      }).png().toBuffer();
      composites.push({ input: tileBg, left: x, top: y });

      // Item image
      if (fetched[i]) {
        const resized = await sharp(fetched[i])
          .resize(SIZE, SIZE, { fit: 'cover' })
          .toBuffer();
        composites.push({ input: resized, left: x, top: y });
      }

      // Amber border
      composites.push({ input: Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="${SIZE-2}" height="${SIZE-2}" rx="5"
            fill="none" stroke="#f59e0b" stroke-width="2"/>
        </svg>`), left: x, top: y });

      // Quantity badge — draw as colored pixels, no text needed
      // White number on dark bg using digit pixel art (3x5 pixels per digit)
      if (qty > 0) {
        const qtyBadge = drawQtyBadge(qty);
        composites.push({ input: qtyBadge, left: x + 3, top: y + SIZE - 10 });
      }
    }

    const png = await sharp({
      create: { width: W, height: H, channels: 4,
                background: { r: 0x13, g: 0x16, b: 0x1e, alpha: 1 } }
    }).composite(composites).png({ compressionLevel: 6 }).toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.status(200).send(png);
  } catch (e) {
    console.error(e);
    res.status(500).send('Error: ' + e.message);
  }
}

// Draw quantity as a tiny pixel-art number (no fonts needed)
// Each digit is 3px wide, 5px tall, 1px gap between digits
// Returns a sharp-compatible raw RGBA buffer
function drawQtyBadge(qty) {
  const digits = String(qty).split('').map(Number);
  const DWIDTH = 3, DHEIGHT = 5, DGAP = 1, PAD2 = 2;
  const W = PAD2 * 2 + digits.length * DWIDTH + (digits.length - 1) * DGAP;
  const H = PAD2 * 2 + DHEIGHT;
  const buf = Buffer.alloc(W * H * 4, 0);

  // Background: semi-transparent black
  for (let i = 0; i < W * H; i++) {
    buf[i*4]   = 0;
    buf[i*4+1] = 0;
    buf[i*4+2] = 0;
    buf[i*4+3] = 180;
  }

  // 3x5 pixel font for digits 0-9
  const FONT = {
    0: [1,1,1, 1,0,1, 1,0,1, 1,0,1, 1,1,1],
    1: [0,1,0, 1,1,0, 0,1,0, 0,1,0, 1,1,1],
    2: [1,1,1, 0,0,1, 1,1,1, 1,0,0, 1,1,1],
    3: [1,1,1, 0,0,1, 0,1,1, 0,0,1, 1,1,1],
    4: [1,0,1, 1,0,1, 1,1,1, 0,0,1, 0,0,1],
    5: [1,1,1, 1,0,0, 1,1,1, 0,0,1, 1,1,1],
    6: [1,1,1, 1,0,0, 1,1,1, 1,0,1, 1,1,1],
    7: [1,1,1, 0,0,1, 0,1,0, 0,1,0, 0,1,0],
    8: [1,1,1, 1,0,1, 1,1,1, 1,0,1, 1,1,1],
    9: [1,1,1, 1,0,1, 1,1,1, 0,0,1, 1,1,1],
  };

  digits.forEach((d, di) => {
    const pixels = FONT[d] || FONT[0];
    const offsetX = PAD2 + di * (DWIDTH + DGAP);
    for (let row = 0; row < DHEIGHT; row++) {
      for (let col = 0; col < DWIDTH; col++) {
        if (pixels[row * DWIDTH + col]) {
          const px = offsetX + col;
          const py = PAD2 + row;
          const idx = (py * W + px) * 4;
          buf[idx]   = 255;
          buf[idx+1] = 255;
          buf[idx+2] = 255;
          buf[idx+3] = 255;
        }
      }
    }
  });

  return sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
}

async function fetchItem(itemId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(
      `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?size=64&quality=2`,
      {
        signal: controller.signal,
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
