import sharp from 'sharp';

export const config = { runtime: 'nodejs' };

const SIZE = 58;
const GAP  = 4;
const PAD  = 10;
const COLS = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // items format: "ITEM_ID:QTY,ITEM_ID:QTY,..."
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

      if (fetched[i]) {
        const resized = await sharp(fetched[i]).resize(SIZE, SIZE, { fit: 'cover' }).toBuffer();
        composites.push({ input: resized, left: x, top: y });
      }

      // Amber border
      composites.push({ input: Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}">
          <rect x="0.75" y="0.75" width="${SIZE-1.5}" height="${SIZE-1.5}" rx="6"
            fill="none" stroke="rgba(245,158,11,0.8)" stroke-width="1.5"/>
        </svg>`), left: x, top: y });

      // Badge: show qty if >1, otherwise show "!"
      // Position: bottom-right corner, always fully visible
      const badgeText  = qty > 1 ? `x${qty}` : '!';
      const badgeH     = 16;
      const badgeW     = qty > 1 ? Math.max(20, badgeText.length * 8 + 8) : 16;
      const badgeColor = qty > 1 ? '#3b82f6' : '#f59e0b';
      const textColor  = qty > 1 ? '#ffffff' : '#000000';
      const bx         = x + SIZE - badgeW + 4;  // slight overflow right is fine
      const by         = y + SIZE - badgeH + 4;  // slight overflow bottom
      composites.push({ input: Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${badgeW}" height="${badgeH}">
          <rect x="0" y="0" width="${badgeW}" height="${badgeH}" rx="8" fill="${badgeColor}"/>
          <text x="${badgeW/2}" y="${badgeH-4}" font-size="10" font-weight="bold" font-family="Arial,sans-serif"
            text-anchor="middle" fill="${textColor}">${badgeText}</text>
        </svg>`), left: Math.max(0, bx), top: Math.max(0, by) });
    }

    const png = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: 0x13, g: 0x16, b: 0x1e, alpha: 1 } }
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
