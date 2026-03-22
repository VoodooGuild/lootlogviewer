import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SIZE = 60;
const GAP  = 4;
const PAD  = 10;
const COLS = 10;

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const rawItems = (searchParams.get('items') || '').split(',').map(s => s.trim()).filter(Boolean);
  const items = rawItems.map(s => {
    const [id, qty] = s.split(':');
    return { id: id.trim(), qty: parseInt(qty) || 1 };
  });

  if (!items.length) return new Response('Missing ?items=', { status: 400 });

  const cols  = Math.min(COLS, items.length);
  const rows  = Math.ceil(items.length / cols);
  const W     = PAD * 2 + cols * (SIZE + GAP) - GAP;
  const H     = PAD * 2 + rows * (SIZE + GAP) - GAP;

  // Build grid cells as HTML — @vercel/og renders HTML/CSS with real fonts
  const cells = items.map((item, i) => {
    const imgUrl    = `https://render.albiononline.com/v1/item/${encodeURIComponent(item.id)}.png?size=64&quality=2`;
    const badgeText = item.qty > 1 ? `x${item.qty}` : '!';
    const badgeBg   = item.qty > 1 ? '#3b82f6' : '#f59e0b';
    const badgeFg   = item.qty > 1 ? '#fff' : '#000';

    return {
      type: 'div',
      props: {
        style: {
          position: 'relative',
          width: SIZE,
          height: SIZE,
          borderRadius: 7,
          border: '2px solid rgba(245,158,11,0.8)',
          overflow: 'hidden',
          flexShrink: 0,
        },
        children: [
          {
            type: 'img',
            props: {
              src: imgUrl,
              width: SIZE,
              height: SIZE,
              style: { objectFit: 'cover' },
            }
          },
          {
            type: 'div',
            props: {
              style: {
                position: 'absolute',
                bottom: 2,
                right: 2,
                background: badgeBg,
                color: badgeFg,
                fontSize: 10,
                fontWeight: 900,
                borderRadius: 8,
                padding: '1px 4px',
                minWidth: 16,
                height: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                lineHeight: 1,
              },
              children: badgeText,
            }
          }
        ]
      }
    };
  });

  return new ImageResponse(
    {
      type: 'div',
      props: {
        style: {
          display: 'flex',
          flexWrap: 'wrap',
          gap: GAP,
          padding: PAD,
          background: '#13161e',
          width: W,
          height: H,
        },
        children: cells,
      }
    },
    {
      width: W,
      height: H,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    }
  );
}
