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

  const items = (req.query.items || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!items.length) return res.status(400).send('Missing ?items=');

  try {
    const cols = Math.min(COLS, items.length);
    const rows = Math.ceil(items.length / cols);
    const W    = PAD * 2 + cols * (SIZE + GAP) - GAP;
    const H    = PAD * 2 + rows * (SIZE + GAP) - GAP;

    // Fetch all item images in parallel
    const fetched = await Promise.all(items.map(id => fetchItem(id)));

    // Build composites list for sharp
    const composites = [];

    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = PAD + col * (SIZE + GAP);
      const y   = PAD + row * (SIZE + GAP);

      if (fetched[i]) {
        // Resize item icon to SIZE x SIZE
        const resized = await sharp(fetched[i])
          .resize(SIZE, SIZE, { fit: 'cover' })
          .toBuffer();

        composites.push({ input: resized, left: x, top: y });
      }

      // Amber border overlay (1px, rounded)
      const border = await sharp({
        create: {
          width:    SIZE,
          height:   SIZE,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
      .png()
      .toBuffer();

      // Draw border as SVG overlay
      const borderSvg = Buffer.from(
        `<svg width="${SIZE}" height="${SIZE}">
          <rect x="0.75" y="0.75" width="${SIZE-1.5}" height="${SIZE-1.5}" rx="6"
            fill="none" stroke="rgba(245,158,11,0.75)" stroke-width="1.5"/>
        </svg>`
      );
      composites.push({ input: borderSvg, left: x, top: y });

      // Badge circle with "!"
      const badgeSvg = Buffer.from(
        `<svg width="14" height="14">
          <circle cx="7" cy="7" r="6" fill="#f59e0b"/>
          <text x="7" y="11" font-size="9" font-weight="bold" text-anchor="middle" fill="#000">!</text>
        </svg>`
      );
      composites.push({ input: badgeSvg, left: x + SIZE - 12, top: y + SIZE - 12 });
    }

    // Compose final image on dark background
    const png = await sharp({
      create: {
        width:      W,
        height:     H,
        channels:   4,
        background: { r: 0x13, g: 0x16, b: 0x1e, alpha: 1 }
      }
    })
    .composite(composites)
    .png({ compressionLevel: 6 })
    .toBuffer();

    res.setHeader('Content-Type', 'image/png');
    res.status(200).send(png);

  } catch (e) {
    console.error(e);
    res.status(500).send('Error: ' + e.message);
  }
}

async function fetchItem(itemId) {
  try {
    const url  = `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?size=64&quality=2`;
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer':    'https://albiononline.com/',
      }
    });
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    return null;
  }
}
