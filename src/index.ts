import type { D1Database, Fetcher, R2Bucket, KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  KV: KVNamespace; // Cloudflare KV for user preferences
  SEND_EMAIL: any; // Cloudflare Email Sending Beta
  AVATARS_BUCKET: R2Bucket;
  APP_URL?: string;
}

const RBAC_SCHEMA: Record<string, string[]> = {
  "public": [
    "feature.public.read",
    "user.profile.public.read"
  ],
  "user": [
    "feature.public.read",
    "feature.own.create",
    "feature.own.read",
    "feature.own.update",
    "feature.own.request_sensitive",
    "comment.own.create",
    "comment.own.read",
    "comment.own.update",
    "comment.own.delete",
    "report.create",
    "user.profile.public.read"
  ],
  "contributor": [
    "feature.public.read",
    "feature.sensitive.read",
    "feature.own.create",
    "feature.own.read",
    "feature.own.update",
    "feature.own.request_sensitive",
    "comment.own.create",
    "comment.own.read",
    "comment.own.update",
    "comment.own.delete",
    "report.create",
    "user.profile.public.read"
  ],
  "moderator": [
    "feature.public.read",
    "feature.sensitive.moderation_read",
    "feature.any.read_metadata",
    "feature.any.update_public_fields",
    "feature.any.update_geometry",
    "feature.any.hide",
    "feature.any.soft_delete",
    "feature.any.lock",
    "feature.sensitive.redact_public",
    "comment.any.read",
    "comment.any.hide",
    "comment.any.delete",
    "comment.thread.lock",
    "report.read",
    "report.resolve",
    "user.profile.public.read",
    "user.comment_mute.temporary"
  ],
  "admin": [
    "feature.public.read",
    "feature.sensitive.read",
    "feature.any.read",
    "feature.any.create",
    "feature.any.update",
    "feature.any.hide",
    "feature.any.soft_delete",
    "feature.any.hard_delete",
    "feature.sensitive.toggle",
    "feature.import_official",
    "comment.any.read",
    "comment.any.hide",
    "comment.any.delete",
    "comment.thread.lock",
    "report.read",
    "report.resolve",
    "user.profile.public.read",
    "user.reputation.adjust",
    "user.role.assign",
    "user.ban.permanent",
    "badge.assign",
    "system.settings.update",
    "moderation.audit.read"
  ]
};

function hasPermission(role: string, permission: string): boolean {
  const perms = RBAC_SCHEMA[role] || RBAC_SCHEMA["public"] || [];
  return perms.includes(permission);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Auth Routes
    if (url.pathname.startsWith("/auth/")) {
      return handleAuthRequest(request, env, url);
    }

    // API Routes (includes RBAC protected admin/moderation)
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin/")) {
      return handleApiRequest(request, env, url);
    }

    // Serve static assets with CSP
    const response = await env.ASSETS.fetch(request as any);
    const newHeaders = new Headers(response.headers as any);
    // Relaxed CSP to allow internal scripts, Leaflet, GSAP, and Cloudflare Analytics
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://unpkg.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://unpkg.com https://tiles.stadiamaps.com https://*.tile.opentopomap.org https://*.vis.earthdata.nasa.gov https://*.arcgisonline.com https://*.tile-cyclosm.openstreetmap.fr https://mt1.google.com https://*.tile.thunderforest.com https://*.tile.openstreetmap.fr https://tile.osm.ch https://tile.memomaps.de https://*.tiles.openrailwaymap.org https://tile.waymarkedtrails.org; connect-src 'self' https://overpass-api.de https://overpass.osm.ch https://nominatim.openstreetmap.org https://cloudflareinsights.com https://*.cloudflareinsights.com;";
    newHeaders.set("Content-Security-Policy", csp);
    
    return new Response(response.body as any, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  },
};

async function handleAuthRequest(request: Request, env: Env, url: URL): Promise<Response> {
  const method = request.method;
  const path = url.pathname.replace("/auth/", "");

  if (method === "POST" && path === "login") {
    const { email } = await request.json() as { email: string };
    if (!email) return jsonResponse({ error: "Email required" }, 400);

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins
    
    await env.DB.prepare("INSERT INTO auth_tokens (token, email, expires_at) VALUES (?, ?, ?)")
      .bind(token, email, expiresAt).run();

    const loginUrl = `${env.APP_URL || url.origin}/auth/verify?token=${token}`;
    
    try {
      if (env.SEND_EMAIL) {
        // Native Cloudflare Email Sending (requires domain onboarded)
        await env.SEND_EMAIL.send({
          from: "admin@jojomap.kcmo.xyz",
          to: [email],
          subject: "Your Magic Login Link",
          text: `Click here to login: ${loginUrl}`,
          html: `<p>Click here to login: <a href="${loginUrl}">${loginUrl}</a></p>`
        });
        console.log(`Magic Link sent to ${email} via Cloudflare Email Sending`);
        return jsonResponse({ success: true });
      } else {
        throw new Error("SEND_EMAIL binding missing");
      }
    } catch (err: any) {
      console.error("Email Sending failed:", err.message);
      // Fallback log for dev visibility
      console.log(`EMERGENCY ACCESS LINK: ${loginUrl}`);
      return jsonResponse({ error: "Failed to send email" }, 500);
    }
  }

  if (method === "GET" && path === "verify") {
    const token = url.searchParams.get("token");
    if (!token) {
        return new Response("Missing token", { status: 400 });
    }
    const record = await env.DB.prepare("SELECT * FROM auth_tokens WHERE token = ? AND expires_at > datetime('now')").bind(token).first();
    if (!record) {
        return new Response("Invalid or expired token", { status: 400 });
    }
    const email = record.email as string;

    await env.DB.prepare("DELETE FROM auth_tokens WHERE token = ?").bind(token).run();

    let user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (!user) {
        await env.DB.prepare("INSERT INTO users (email) VALUES (?)").bind(email).run();
        user = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    }

    const sessionId = crypto.randomUUID();
    const sessionToken = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
    await env.DB.prepare("INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)")
        .bind(sessionId, user!.id, sessionToken, expiresAt).run();

    return new Response(null, {
        status: 302,
        headers: {
            "Location": "/",
            "Set-Cookie": `session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${7 * 24 * 60 * 60}`
        }
    });
  }

  if (method === "POST" && path === "logout") {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"
      }
    });
  }

  return new Response("Not Found", { status: 404 });
}

async function handleMarcImport(env: Env): Promise<Response> {
  const MARC_URL = 'https://gis2.marc.org/arcgis/rest/services/Recreation/BikewaysAndTrails/MapServer/10/query?where=1%3D1&outFields=*&f=geojson';

  try {
    console.log("Fetching MARC data from:", MARC_URL);
    const resp = await fetch(MARC_URL, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://jojomap.kcmo.xyz/'
      }
    });
    
    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(`MARC API Error ${resp.status}: ${errText.slice(0, 100)}`, { status: 500 });
    }
    
    const data = await resp.json() as any;

    if (!data.features || !Array.isArray(data.features)) {
      return new Response("MARC Data missing features array", { status: 500 });
    }

    const limit = 200; // Total features to import
    const batchSize = 50; // Features per D1 transaction
    const featuresToProcess = data.features.slice(0, limit);
    let importedCount = 0;

    for (let i = 0; i < featuresToProcess.length; i += batchSize) {
      const chunk = featuresToProcess.slice(i, i + batchSize);
      const statements: any[] = [];

      for (const feature of chunk) {
        const props = feature.properties || {};
        const geom = feature.geometry;
        if (!geom) continue;

        const name = props.RouteName || props.Name || props.TrailName || 'Unnamed MARC Trail';
        const jurisdiction = props.Jurisdiction || props.City || 'Regional';
        const facility = props.FacilityType || props.Type || 'Trail';
        const surface = props.SurfaceType || props.Surface || 'Unknown';
        
        const slug = 'marc-' + crypto.randomUUID();
        const id = crypto.randomUUID();

        statements.push(env.DB.prepare(`
          INSERT OR IGNORE INTO features (id, slug, name, feature_type, category, status, visibility, officiality, public_description, surface_note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(id, slug, name, 'line', 'Official Regional Data', 'active', 'public', 'official',
          `Jurisdiction: ${jurisdiction}. Type: ${facility}.`,
          surface));

        statements.push(env.DB.prepare("INSERT OR IGNORE INTO feature_geometries (feature_id, public_geometry) VALUES (?, ?)")
          .bind(id, JSON.stringify(geom)));
      }

      if (statements.length > 0) {
        try {
          await env.DB.batch(statements);
          importedCount += chunk.length;
        } catch (batchErr: any) {
          console.error("Batch Import Error:", batchErr.message);
          throw new Error(`D1 Batch failed: ${batchErr.message}`);
        }
      }
    }

    return new Response(`Successfully imported ${importedCount} MARC features in chunks.`, { status: 200 });
  } catch (err: any) {
    console.error("Critical Import Error:", err.message);
    return new Response(`Server Error during MARC import. Check worker logs for details.`, { status: 500 });
  }
}

async function handleApiRequest(request: Request, env: Env, url: URL): Promise<Response> {
  try {
    const method = request.method;
    const fullPath = url.pathname;
    const path = fullPath.startsWith("/api/") ? fullPath.replace("/api/", "") : fullPath.replace("/", "");

    const cookieHeader = request.headers.get("Cookie") || "";
    const sessionToken = cookieHeader.split(";").find(c => c.trim().startsWith("session="))?.split("=")[1];
    
    let user: any = null;
    let role = "public";

    // 1. Resolve User and Role
    if (sessionToken) {
      const session = await env.DB.prepare(`
        SELECT s.*, u.email, u.role, u.reputation_score, u.username, u.bio, u.avatar_url, u.social_links
        FROM sessions s
        JOIN users u ON s.user_id = u.id
        WHERE s.token = ? AND s.expires_at > CURRENT_TIMESTAMP
      `).bind(sessionToken).first();
      
      if (session) {
        user = session;
        role = (session as any).role || "user";
      }
    }

    // 2. Admin: MARC Import
    if (method === "POST" && fullPath === "/admin/import-marc") {
      if (!hasPermission(role, "feature.import_official")) {
        return new Response("Unauthorized", { status: 401 });
      }
      return handleMarcImport(env);
    }

    // 3. Admin: Manage Roles
    if (method === "POST" && path === "admin/roles") {
      if (!hasPermission(role, "user.role.assign")) {
        return new Response("Unauthorized", { status: 401 });
      }
      const { email, newRole } = await request.json() as { email: string, newRole: string };
      if (!email || !newRole) return new Response("Email and newRole required", { status: 400 });
      
      await env.DB.prepare("UPDATE users SET role = ? WHERE email = ?")
        .bind(newRole, email).run();
      
      return jsonResponse({ success: true });
    }

    if (method === "POST" && path === "features/bulk") {
        if (!hasPermission(role, "feature.import_official")) {
            return new Response("Unauthorized", { status: 401 });
        }
        const body = await request.json() as any;
        const features = body.features;
        if (!features || !Array.isArray(features)) {
            return new Response("Invalid request body", { status: 400 });
        }
        let importedCount = 0;
        const batchSize = 50;
        for (let i = 0; i < features.length; i += batchSize) {
            const chunk = features.slice(i, i + batchSize);
            const statements: any[] = [];
            for (const feature of chunk) {
                const id = crypto.randomUUID();
                const slug = feature.slug || feature.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(36).slice(2, 5);
                statements.push(env.DB.prepare(`
                  INSERT INTO features (id, slug, name, feature_type, category, status, visibility, officiality, public_description, surface_note, risk_note, weather_sensitivity, source_confidence, longevity, owner_id)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).bind(id, slug, feature.name || 'Unnamed', feature.feature_type || 'point', feature.category || 'Local Knowledge', feature.status || 'active',
                  feature.visibility || 'public', feature.officiality || 'unofficial', feature.public_description || null, feature.surface_note || null,
                  feature.risk_note || null, feature.weather_sensitivity || 'none', feature.source_confidence || 'medium', feature.longevity || 'permanent',
                  user?.id || null));
                statements.push(env.DB.prepare("INSERT INTO feature_geometries (feature_id, public_geometry) VALUES (?, ?)")
                  .bind(id, JSON.stringify(feature.geometry || null)));
            }
            if (statements.length > 0) {
                await env.DB.batch(statements);
                importedCount += chunk.length;
            }
        }
        return jsonResponse({ success: true, count: importedCount });
    }

    // 4. Moderation: Hide Feature/Comment
    if (method === "POST" && path === "moderation/hide") {
      const { type, id } = await request.json() as { type: 'feature' | 'comment', id: string };
      if (!id) return new Response("ID required", { status: 400 });

      if (type === 'feature') {
        if (!hasPermission(role, "feature.any.hide")) return new Response("Unauthorized", { status: 401 });
        await env.DB.prepare("UPDATE features SET visibility = 'private' WHERE id = ?").bind(id).run();
      } else if (type === 'comment') {
        if (!hasPermission(role, "comment.any.hide")) return new Response("Unauthorized", { status: 401 });
        await env.DB.prepare("DELETE FROM comments WHERE id = ?").bind(id).run(); // Assuming soft-delete via visibility isn't in comments table yet
      }
      
      return jsonResponse({ success: true });
    }

    if (method === "GET" && path === "me") {
      if (!user) return jsonResponse({ authenticated: false });
      
      const badges = await env.DB.prepare(`
        SELECT b.* FROM badges b
        JOIN user_badges ub ON b.id = ub.badge_id
        WHERE ub.user_id = ?
      `).bind(user.id).all();

      const prefsRaw = await env.KV.get(`prefs:${user.id}`);
      const preferences = prefsRaw ? JSON.parse(prefsRaw) : {};

      return jsonResponse({
        authenticated: true,
        user: {
          email: user.email,
          role: user.role,
          reputation_score: user.reputation_score,
          permissions: RBAC_SCHEMA[role],
          username: user.username,
          bio: user.bio,
          avatar_url: user.avatar_url,
          social_links: user.social_links ? JSON.parse(user.social_links) : []
        },
        badges: badges.results,
        preferences
      });
    }

    if (method === "PUT" && path === "me/profile") {
      if (!user) return new Response("Unauthorized", { status: 401 });
      const { username, bio, social_links } = await request.json() as any;

      if (username) {
        // Validate uniqueness if changing username
        if (username !== user.username) {
          const existing = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first();
          if (existing) {
            return jsonResponse({ error: "Username already taken" }, 400);
          }
        }
      }

      await env.DB.prepare(`
        UPDATE users SET username = ?, bio = ?, social_links = ? WHERE id = ?
      `).bind(username || null, bio || null, social_links ? JSON.stringify(social_links) : null, user.id).run();

      return jsonResponse({ success: true });
    }

    if (method === "POST" && path === "me/avatar") {
      if (!user) return new Response("Unauthorized", { status: 401 });
      
      // Parse formData
      const formData = await request.formData();
      const file = formData.get("file") as File;
      if (!file) return new Response("No file uploaded", { status: 400 });

      const ext = file.name.split('.').pop() || 'png';
      const filename = `${user.id}-${Date.now()}.${ext}`;

      // Upload to R2
      await env.AVATARS_BUCKET.put(filename, file.stream() as any, {
        httpMetadata: { contentType: file.type }
      });

      const avatar_url = `/api/avatars/${filename}`; // Or custom domain

      await env.DB.prepare("UPDATE users SET avatar_url = ? WHERE id = ?").bind(avatar_url, user.id).run();

      return jsonResponse({ success: true, avatar_url });
    }

    if (method === "GET" && path.startsWith("avatars/")) {
      const filename = path.split("/")[1];
      const object = await env.AVATARS_BUCKET.get(filename as string);
      if (!object) return new Response("Not found", { status: 404 });
      
      const headers = new Headers() as any;
      object.writeHttpMetadata(headers as any);
      headers.set("etag", object.httpEtag as string);
      return new Response(object.body as any, { headers });
    }

    if (method === "GET" && path.startsWith("profiles/")) {
      const username = path.split("/")[1];
      if (!username) return new Response("Username required", { status: 400 });

      const profile = await env.DB.prepare(`
        SELECT id, username, bio, avatar_url, social_links, reputation_score, created_at 
        FROM users WHERE username = ?
      `).bind(username).first() as any;

      if (!profile) return new Response("Profile not found", { status: 404 });

      // Fetch user's public features
      const features = await env.DB.prepare(`
        SELECT id, name, category, feature_type, status, created_at 
        FROM features 
        WHERE owner_id = ? AND visibility = 'public'
        ORDER BY created_at DESC LIMIT 50
      `).bind(profile.id).all();

      // Fetch user's badges
      const badges = await env.DB.prepare(`
        SELECT b.* FROM badges b
        JOIN user_badges ub ON b.id = ub.badge_id
        WHERE ub.user_id = ?
      `).bind(profile.id).all();

      return jsonResponse({
        profile: {
          username: profile.username,
          bio: profile.bio,
          avatar_url: profile.avatar_url,
          social_links: profile.social_links ? JSON.parse(profile.social_links) : [],
          reputation_score: profile.reputation_score,
          created_at: profile.created_at
        },
        features: features.results,
        badges: badges.results
      });
    }

    if (method === "POST" && path === "me/preferences") {
      if (!user) return new Response("Unauthorized", { status: 401 });
      const body = await request.json();
      await env.KV.put(`prefs:${user.id}`, JSON.stringify(body));
      return jsonResponse({ success: true });
    }

    if (method === "GET" && path === "amenities") {
      const bbox = url.searchParams.get("bbox");
      if (!bbox) return new Response("Missing bbox", { status: 400 });
      
      const query = `[out:json][timeout:25];(node["amenity"~"drinking_water|bicycle_repair_station"](${bbox});node["shop"="bicycle"](${bbox}););out;`;
      
      let resp = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`, {
        headers: { 'User-Agent': 'JojoKCMap/1.0 (Cloudflare Worker; contact: admin@jojomap.kcmo.xyz)' }
      });

      if (!resp.ok) {
        console.warn(`Primary Overpass failed (${resp.status}), trying fallback...`);
        resp = await fetch(`https://overpass.osm.ch/api/interpreter?data=${encodeURIComponent(query)}`, {
          headers: { 'User-Agent': 'JojoKCMap/1.0 (Cloudflare Worker)' }
        });
      }
      
      if (!resp.ok) {
        const text = await resp.text();
        return new Response(`Amenities Error: ${text.slice(0, 100)}`, { status: resp.status });
      }
      
      return jsonResponse(await resp.json());
    }

    if (method === "GET" && path === "features") {
      const canReadSensitive = hasPermission(role, "feature.sensitive.read");
      const canReadModeration = hasPermission(role, "feature.sensitive.moderation_read");

      const { results } = await env.DB.prepare(`
        SELECT f.*, g.public_geometry, g.admin_geometry
        FROM features f
        LEFT JOIN feature_geometries g ON f.id = g.feature_id
        WHERE f.visibility != 'private' OR ? = 1
      `).bind(hasPermission(role, "feature.any.hide") ? 1 : 0).all();
      
      return jsonResponse(results.map(f => {
        const isSensitive = f.visibility === 'sensitive';
        const hasFullAccess = canReadSensitive;
        const hasModAccess = canReadModeration;
        
        let geometry = f.public_geometry;
        if (hasFullAccess && f.admin_geometry) {
          geometry = f.admin_geometry;
        }

        let parsedGeom = null;
        try {
          parsedGeom = geometry ? JSON.parse(geometry as string) : null;
        } catch (pe) {
          console.error(`Geom parse failed for ${f.id}:`, pe);
        }

        return {
          ...f,
          admin_geometry: hasFullAccess ? f.admin_geometry : undefined,
          geometry: parsedGeom,
          public_description: (isSensitive && !hasFullAccess && !hasModAccess) ? "Detailed knowledge restricted to established contributors." : f.public_description,
          admin_note: hasFullAccess ? f.admin_note : undefined,
          surface_note: (isSensitive && !hasFullAccess && !hasModAccess) ? null : f.surface_note
        };
      }));
    }

    if (method === "POST" && path === "features") {
      if (!user && !hasPermission(role, "feature.own.create")) return new Response("Unauthorized", { status: 401 });
      
      const body = await request.json() as any;
      if (!body.name) return new Response("Name is required", { status: 400 });
      
      const id = crypto.randomUUID();
      const slug = body.slug || body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + Math.random().toString(36).slice(2, 5);
      const deleteToken = user ? null : (body.poster_email ? crypto.randomUUID() : null);

      await env.DB.prepare(`
        INSERT INTO features (id, slug, name, feature_type, category, status, visibility, officiality, public_description, surface_note, risk_note, weather_sensitivity, source_confidence, longevity, poster_email, delete_token, owner_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(id, slug, body.name || 'Unnamed', body.feature_type || 'point', body.category || 'Local Knowledge', body.status || 'active', 
        body.visibility || 'public', body.officiality || 'unofficial', body.public_description || null, body.surface_note || null,
        body.risk_note || null, body.weather_sensitivity || 'none', body.source_confidence || 'medium', body.longevity || 'permanent', 
        body.poster_email || null, deleteToken, user?.id || null).run();

      await env.DB.prepare("INSERT INTO feature_geometries (feature_id, public_geometry) VALUES (?, ?)")
        .bind(id, JSON.stringify(body.geometry || null)).run();

      if (body.sources) {
        for (const s of body.sources) {
          await env.DB.prepare("INSERT INTO feature_sources (id, feature_id, source_url, source_note) VALUES (?, ?, ?, ?)")
            .bind(crypto.randomUUID(), id, s.url || null, s.note || null).run();
        }
      }

      return jsonResponse({ success: true, id, delete_token: deleteToken });
    }

    if (method === "PUT" && path.startsWith("features/")) {
      const id = path.split("/")[1];
      const body = await request.json() as any;
      
      const feature = await env.DB.prepare("SELECT owner_id, visibility FROM features WHERE id = ?").bind(id).first() as { owner_id: string, visibility: string } | null;
      
      const isOwner = user && feature?.owner_id === user.id;
      const canEditAny = hasPermission(role, "feature.any.update");
      const canEditPublic = hasPermission(role, "feature.any.update_public_fields");

      if (!canEditAny && !isOwner && !canEditPublic) {
        return new Response("Unauthorized", { status: 401 });
      }

      // If only canEditPublic, we must restrict what fields are updated
      // For now, simplicity: moderators can edit most things, but not visibility if it's toggle-restricted
      if (canEditPublic && !canEditAny && !isOwner) {
        if (body.visibility && body.visibility !== feature?.visibility) {
           return new Response("Moderators cannot change visibility", { status: 403 });
        }
      }

      await env.DB.prepare(`
        UPDATE features SET 
          name = ?, category = ?, status = ?, visibility = ?, officiality = ?, 
          public_description = ?, surface_note = ?, risk_note = ?, weather_sensitivity = ?, 
          source_confidence = ?, longevity = ?, poster_email = ?
        WHERE id = ?
      `).bind(body.name || 'Unnamed', body.category || 'Local Knowledge', body.status || 'active', body.visibility || 'public', body.officiality || 'unofficial', 
        body.public_description || null, body.surface_note || null, body.risk_note || null, body.weather_sensitivity || 'none', 
        body.source_confidence || 'medium', body.longevity || 'permanent', body.poster_email || null, id).run();

      if (body.geometry && (isOwner || canEditAny || hasPermission(role, "feature.any.update_geometry"))) {
        await env.DB.prepare("UPDATE feature_geometries SET public_geometry = ? WHERE feature_id = ?")
          .bind(JSON.stringify(body.geometry), id).run();
      }

      if (body.sources) {
        await env.DB.prepare("DELETE FROM feature_sources WHERE feature_id = ?").bind(id).run();
        for (const s of body.sources) {
          await env.DB.prepare("INSERT INTO feature_sources (id, feature_id, source_url, source_note) VALUES (?, ?, ?, ?)")
            .bind(crypto.randomUUID(), id, s.url || null, s.note || null).run();
        }
      }

      return jsonResponse({ success: true });
    }

    if (method === "GET" && path.endsWith("/details")) {
      const id = path.split("/")[1];
      const sources = await env.DB.prepare("SELECT * FROM feature_sources WHERE feature_id = ?").bind(id).all();
      const reports = await env.DB.prepare("SELECT * FROM reports WHERE feature_id = ? ORDER BY created_at DESC").bind(id).all();
      const comments = await env.DB.prepare("SELECT * FROM comments WHERE feature_id = ? ORDER BY created_at DESC").bind(id).all();
      return jsonResponse({ sources: sources.results || [], reports: reports.results || [], comments: comments.results || [] });
    }

    return new Response("Not Found", { status: 404 });
  } catch (err: any) {
    console.error("API Request Error:", err.message, err.stack);
    return new Response(`Server Error. Check worker logs for details.`, { status: 500 });
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      "Content-Type": "application/json", 
      "Access-Control-Allow-Origin": "https://jojomap.kcmo.xyz",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}