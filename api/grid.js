import sharp from 'sharp';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const SIZE = 64;
const GAP  = 6;
const PAD  = 10;
const COLS = 10;

// Desenhamos os números pixel a pixel via SVG para burlar a falta de fontes na Vercel
const DIGITS = {
  0:[1,1,1, 1,0,1, 1,0,1, 1,0,1, 1,1,1],
  1:[0,1,0, 0,1,0, 0,1,0, 0,1,0, 0,1,0],
  2:[1,1,1, 0,0,1, 1,1,1, 1,0,0, 1,1,1],
  3:[1,1,1, 0,0,1, 1,1,1, 0,0,1, 1,1,1],
  4:[1,0,1, 1,0,1, 1,1,1, 0,0,1, 0,0,1],
  5:[1,1,1, 1,0,0, 1,1,1, 0,0,1, 1,1,1],
  6:[1,1,1, 1,0,0, 1,1,1, 1,0,1, 1,1,1],
  7:[1,1,1, 0,0,1, 0,0,1, 0,0,1, 0,0,1],
  8:[1,1,1, 1,0,1, 1,1,1, 1,0,1, 1,1,1],
  9:[1,1,1, 1,0,1, 1,1,1, 0,0,1, 1,1,1],
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let itemsStr = req.method === 'POST' ? (req.body?.items || '') : (req.query.items || '');
  const rawItems = itemsStr.split(',').map(s => s.trim()).filter(Boolean);
  
  const items = rawItems.map(s => {
    const [id, qty] = s.split(':');
    return { id: id.trim(), qty: parseInt(qty) || 1 };
  });

  if (!items.length) return res.status(400).send('Missing items');

  try {
    const cols = Math.min(COLS, items.length);
    const rows = Math.ceil(items.length / cols);
    const W    = PAD * 2 + cols * (SIZE + GAP) - GAP;
    const H    = PAD * 2 + rows * (SIZE + GAP) - GAP;

    const fetched = await Promise.all(items.map(item => fetchItem(item.id)));
    const resized = await Promise.all(fetched.map(buf =>
      buf
        ? sharp(buf).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer()
        : sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 43, g: 45, b: 49, alpha: 1 } } }).png().toBuffer()
    ));

    // Gera as tags de quantidade em pixel art
    const badgeBufs = await Promise.all(items.map(item => makeBadgeSvg(item.qty)));

    const composites = [];
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = PAD + col * (SIZE + GAP);
      const y   = PAD + row * (SIZE + GAP);

      composites.push({ input: resized[i], left: x, top: y });

      if (badgeBufs[i]) {
        // Posiciona no canto inferior direito
        composites.push({ input: badgeBufs[i].buffer, left: x + SIZE - badgeBufs[i].w - 2, top: y + SIZE - badgeBufs[i].h - 2 });
      }
    }

    const png = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: 30, g: 31, b: 34, alpha: 1 } }
    }).composite(composites).png({ compressionLevel: 6 }).toBuffer();

    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(png);

  } catch (e) {
    console.error('Grid error:', e);
    return res.status(500).send('Error: ' + e.message);
  }
}

async function makeBadgeSvg(qty) {
  const text = String(qty);
  const scale = 2; // Tamanho de cada "pixel"
  const dw = 3;    // Largura do dígito
  const dh = 5;    // Altura do dígito
  const gap = 1;   // Espaço entre números
  
  const pxWidth = text.length * dw + (text.length - 1) * gap;
  const w = (pxWidth + 4) * scale; // +4 para padding lateral
  const h = (dh + 4) * scale;      // +4 para padding vertical
  
  let rects = '';
  for (let i = 0; i < text.length; i++) {
    const digit = parseInt(text[i], 10);
    const pixels = DIGITS[digit] || DIGITS[0];
    const offsetX = 2 + i * (dw + gap);
    const offsetY = 2;
    
    for (let r = 0; r < dh; r++) {
      for (let c = 0; c < dw; c++) {
        if (pixels[r * dw + c]) {
          const rx = (offsetX + c) * scale;
          const ry = (offsetY + r) * scale;
          rects += `<rect x="${rx}" y="${ry}" width="${scale}" height="${scale}" fill="#ffffff"/>`;
        }
      }
    }
  }
  
  const svg = `<svg width="${w}" height="${h}">
    <rect x="0" y="0" width="${w}" height="${h}" rx="4" ry="4" fill="#1c1c1c" stroke="#888888" stroke-width="1.5"/>
    ${rects}
  </svg>`;
  
  return { buffer: Buffer.from(svg), w, h };
}

async function fetchItem(itemId) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(
      `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?size=64&quality=2`,
      { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } }
    );
    clearTimeout(tid);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    clearTimeout(tid);
    return null;
  }
}
