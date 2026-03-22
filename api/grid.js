import sharp from 'sharp';

export const config = { runtime: 'nodejs' };

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

    const fetched = await Promise.all(items.map(item => fetchItem(item.id)));
    const composites = [];

    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = PAD + col * (SIZE + GAP);
      const y   = PAD + row * (SIZE + GAP);
      const qty = items[i].qty;

      // Item image
      if (fetched[i]) {
        const resized = await sharp(fetched[i])
          .resize(SIZE, SIZE, { fit: 'cover' })
          .toBuffer();
        composites.push({ input: resized, left: x, top: y });
      } else {
        // Dark placeholder
        const placeholder = await sharp({
          create: { width: SIZE, height: SIZE, channels: 4,
                    background: { r: 30, g: 32, b: 40, alpha: 1 } }
        }).png().toBuffer();
        composites.push({ input: placeholder, left: x, top: y });
      }

      // Border overlay matching Albion style
      // Tier-colored border: use amber as default (pending items)
      composites.push({ input: Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="1" width="${SIZE-2}" height="${SIZE-2}" rx="5"
            fill="none" stroke="#f59e0b" stroke-width="2"/>
        </svg>`), left: x, top: y });

      // Quantity — bottom left corner, dark bg + white number
      // Using SVG with a dark semi-transparent box (no text rendering issues)
      // The number is rendered as simple paths so no font needed
      const qLabel = String(qty);
      const qW = 8 + qLabel.length * 7;
      composites.push({ input: Buffer.from(
        `<svg width="${qW}" height="16" xmlns="http://www.w3.org/2000/svg">
          <rect x="0" y="0" width="${qW}" height="16" rx="3"
            fill="rgba(0,0,0,0.75)"/>
          <text x="${qW/2}" y="12"
            font-family="Arial,Helvetica,sans-serif"
            font-size="11" font-weight="bold"
            text-anchor="middle" fill="white">${qLabel}</text>
        </svg>`),
        left: x + 2,
        top:  y + SIZE - 18
      });
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

async function fetchItem(itemId) {
  try {
    const resp = await fetch(
      `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?size=64&quality=2`,
      { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://albiononline.com/' } }
    );
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) { return null; }
}
