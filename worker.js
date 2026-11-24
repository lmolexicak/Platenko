// Cloudflare Worker backend for Platenko Gallery

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. CORS Headers helper
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 2. Images served directly from Cloudflare R2 bucket
    // Matches /images/paintings/* or /paintings/*
    if (pathname.startsWith('/images/paintings/') || pathname.startsWith('/paintings/')) {
      const key = pathname.startsWith('/images/') ? pathname.substring('/images/'.length) : pathname.substring(1);
      
      const object = await env.IMAGES.get(key);
      if (!object) {
        return new Response('Image not found in R2', { status: 404, headers: corsHeaders });
      }

      const headers = new Headers(corsHeaders);
      object.writeHttpMetadata(headers);
      headers.set('etag', object.httpEtag);
      headers.set('Cache-Control', 'public, max-age=31536000, immutable');

      return new Response(object.body, { headers });
    }

    // 3. API Endpoints
    // GET /api/artworks - Load all paintings with their images from D1
    if (pathname === '/api/artworks' && request.method === 'GET') {
      try {
        const { results: artworks } = await env.DB.prepare(
          `SELECT * FROM artworks ORDER BY date_created DESC, id DESC`
        ).all();

        const { results: images } = await env.DB.prepare(
          `SELECT artwork_id, image_url, is_cover, sort_order FROM artwork_images ORDER BY sort_order ASC`
        ).all();

        // Group images by artwork_id
        const imgMap = {};
        for (const img of images) {
          if (!imgMap[img.artwork_id]) imgMap[img.artwork_id] = [];
          imgMap[img.artwork_id].push(img.image_url);
        }

        // Format to match the client's expected artwork schema
        const data = artworks.map(art => {
          const detailImgs = imgMap[art.id] || (art.cover_image ? [art.cover_image] : []);
          return {
            id: art.id,
            folder: art.folder_name,
            title: art.title,
            date: art.date_created,
            year: art.year,
            technique: art.technique,
            medium: art.medium,
            dimensions: art.dimensions,
            status: art.status,
            photoCount: art.photo_count || detailImgs.length,
            coverImage: art.cover_image || (detailImgs.length > 0 ? detailImgs[0] : ''),
            detailImages: detailImgs,
            description: art.description || ''
          };
        });

        return new Response(JSON.stringify(data), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // PUT or POST /api/artworks/:id - Update artwork metadata
    if (pathname.startsWith('/api/artworks/') && (request.method === 'PUT' || request.method === 'POST')) {
      const id = decodeURIComponent(pathname.substring('/api/artworks/'.length));
      try {
        const body = await request.json();
        const { title, dimensions, status, technique, medium, description } = body;

        await env.DB.prepare(`
          UPDATE artworks 
          SET title = COALESCE(?, title),
              dimensions = COALESCE(?, dimensions),
              status = COALESCE(?, status),
              technique = COALESCE(?, technique),
              medium = COALESCE(?, medium),
              description = COALESCE(?, description)
          WHERE id = ?
        `).bind(title, dimensions, status, technique, medium, description, id).run();

        return new Response(JSON.stringify({ success: true, id }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
    }

    // 4. Static Assets fallback (handled by Cloudflare Pages/Workers assets)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response('Not found', { status: 404, headers: corsHeaders });
  }
};
