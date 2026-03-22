import sharp from 'sharp';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const SIZE = 64; // Ajustado para 64 para manter a proporção original do Albion
const GAP  = 6;
const PAD  = 10;
const COLS = 10;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // Lê os itens tanto de POST (body) quanto de GET (query)
  let itemsStr = '';
  if (req.method === 'POST') {
    itemsStr = req.body?.items || '';
  } else {
    itemsStr = req.query.items || '';
  }

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

    // Baixa e redimensiona as imagens
    const fetched = await Promise.all(items.map(item => fetchItem(item.id)));
    const resized = await Promise.all(fetched.map(buf =>
      buf
        ? sharp(buf).resize(SIZE, SIZE, { fit: 'cover' }).png().toBuffer()
        : sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 43, g: 45, b: 49, alpha: 1 } } }).png().toBuffer()
    ));

    // Gera os badges em SVG (agora para TODOS os itens, incluindo qty 1)
    const badgeBufs = await Promise.all(items.map(item => makeBadge(item.qty)));

    const composites = [];
    for (let i = 0; i < items.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x   = PAD + col * (SIZE + GAP);
      const y   = PAD + row * (SIZE + GAP);

      composites.push({ input: resized[i], left: x, top: y });

      if (badgeBufs[i]) {
        // Posiciona no canto inferior direito
        composites.push({ input: badgeBufs[i], left: x + SIZE - 22, top: y + SIZE - 22 });
      }
    }

    // Fundo da imagem usando a cor escura do Discord
    const png = await sharp({
      create: { width: W, height: H, channels: 4, background: { r: 43, g: 45, b: 49, alpha: 1 } }
    }).composite(composites).png({ compressionLevel: 6 }).toBuffer();

    res.setHeader('Content-Type', 'image/png');
    return res.status(200).send(png);

  } catch (e) {
    console.error('Grid error:', e);
    return res.status(500).send('Error: ' + e.message);
  }
}

async function makeBadge(qty) {
  const text = String(qty);
  const isSingle = text.length === 1;
  // Se for mais de um dígito, o badge alarga levemente como uma pílula
  const w = isSingle ? 22 : 16 + (text.length * 7);
  const h = 22;

  // Estilo idêntico ao da print: Fundo quase preto, borda cinza, texto branco
  const svg = `<svg width="${w}" height="${h}">
    <rect x="1" y="1" width="${w-2}" height="${h-2}" rx="${h/2}" ry="${h/2}" fill="#1c1c1c" stroke="#888888" stroke-width="1.5"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" font-family="sans-serif" font-size="12px" font-weight="bold" fill="#ffffff">${text}</text>
  </svg>`;

  return Buffer.from(svg);
}

async function fetchItem(itemId) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 10000);
  try {
    const resp = await fetch(
      `https://render.albiononline.com/v1/item/${encodeURIComponent(itemId)}.png?size=64&quality=2`,
      { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://albiononline.com/' } }
    );
    clearTimeout(tid);
    if (!resp.ok) return null;
    return Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    clearTimeout(tid);
    return null;
  }
}
