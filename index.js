const ADMIN_EMAIL = 'vunamanhnguyen@proton.me';
const PACKAGES = {
  STARTER: { maxPages: 1, features: ['responsive','navigation','basic_animations','social_links','contact_section','deployment','domain','revisions'] },
  ESSENTIAL: { maxPages: 5, features: ['responsive','navigation','basic_animations','social_links','contact_section','deployment','domain','revisions','custom_design','basic_seo'] },
  BUSINESS: { maxPages: 8, features: ['responsive','navigation','basic_animations','social_links','contact_section','deployment','domain','revisions','custom_design','basic_seo','contact_form','maps','opening_hours','gallery'] },
  CUSTOM: { maxPages: 999, features: ['responsive','navigation','basic_animations','social_links','contact_section','deployment','domain','revisions','custom_design','basic_seo','contact_form','maps','opening_hours','gallery','advanced_animations','custom_features','booking','api','multilingual'] }
};
const STATUSES = ['received','approved','in_progress','almost_done','delivered'];
const json = (data, status = 200, request) => {
  const origin = request?.headers.get('Origin');
  const allowedOrigin = origin && (!request || !request.env?.APP_ORIGIN || origin === request.env.APP_ORIGIN) ? origin : null;
  const headers = { 'content-type':'application/json;charset=UTF-8', 'cache-control':'no-store' };
  if (allowedOrigin) {
    headers['access-control-allow-origin'] = allowedOrigin;
    headers['access-control-allow-methods'] = 'GET,POST,PATCH,OPTIONS';
    headers['access-control-allow-headers'] = 'content-type,authorization';
    headers['vary'] = 'Origin';
  }
  return new Response(JSON.stringify(data), { status, headers });
};
const fail = (code, message, status = 400, request) => json({ error: { code, message } }, status, request);
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}-${crypto.randomUUID().replaceAll('-','').slice(0,12).toUpperCase()}`;
const cents = n => Number.isInteger(n) && n >= 0 ? n : null;
const mapOrder = row => ({ ...row, logo_addon: !!row.logo_addon, features: JSON.parse(row.features_json), website_information: JSON.parse(row.website_information_json), package_price_snapshot_cents: Number(row.package_price_snapshot_cents), addon_price_snapshot_cents: Number(row.addon_price_snapshot_cents), total_price_snapshot_cents: Number(row.total_price_snapshot_cents) });

async function body(request) { try { return await request.json(); } catch { return null; } }
function base64urlToBytes(value) { const s = value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='); const bin = atob(s); return Uint8Array.from(bin, c => c.charCodeAt(0)); }
function decodeJson(value) { return JSON.parse(new TextDecoder().decode(base64urlToBytes(value))); }

let certCache = { expires: 0, keys: null };
async function accessKeys(teamDomain) {
  const nowMs = Date.now();
  if (certCache.keys && certCache.expires > nowMs) return certCache.keys;
  const response = await fetch(`${teamDomain.replace(/\/$/,'')}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) throw new Error(`Access JWKS request failed: ${response.status}`);
  const data = await response.json();
  certCache = { keys: data.keys || [], expires: nowMs + 5 * 60 * 1000 };
  return certCache.keys;
}

async function verifyAccessJWT(request, env) {
  const token = request.headers.get('CF-Access-Jwt-Assertion');
  if (!token || !env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) return null;
  try {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature) return null;
    const header = decodeJson(encodedHeader);
    const payload = decodeJson(encodedPayload);
    if (header.alg !== 'RS256' || !header.kid) return null;
    const keys = await accessKeys(env.CF_ACCESS_TEAM_DOMAIN);
    const jwk = keys.find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name:'RSASSA-PKCS1-v1_5', hash:'SHA-256' }, false, ['verify']);
    const signingInput = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
    const valid = await crypto.subtle.verify({ name:'RSASSA-PKCS1-v1_5' }, key, base64urlToBytes(encodedSignature), signingInput);
    if (!valid) return null;
    const nowSec = Math.floor(Date.now()/1000);
    const audienceOk = Array.isArray(payload.aud) ? payload.aud.includes(env.CF_ACCESS_AUD) : payload.aud === env.CF_ACCESS_AUD;
    if (payload.iss !== env.CF_ACCESS_TEAM_DOMAIN || !audienceOk || payload.exp <= nowSec || (payload.nbf != null && payload.nbf > nowSec + 30)) return null;
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!email || payload.email_verified === false) return null;
    return { email, payload };
  } catch (error) {
    console.error('Admin auth verification failed', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function requireAdmin(request, env) {
  const identity = await verifyAccessJWT(request, env);
  if (!identity) return { ok:false, response:fail('authentication_required','Authentication is required.',401,request) };
  if (identity.email !== ADMIN_EMAIL) return { ok:false, response:fail('access_denied','You are not authorized to access the administration area.',403,request) };
  return { ok:true, email:identity.email };
}

function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= new Date().toISOString().slice(0,10); }
async function pricing(db) { const r = await db.prepare('SELECT code, amount_cents FROM pricing').all(); return Object.fromEntries(r.results.map(x => [x.code, Number(x.amount_cents)])); }
async function notify(order) {
  const fields = new FormData();
  fields.set('_subject', `Nam Anh Studio — ${order.id} — ${order.package_code}`); fields.set('Order ID', order.id); fields.set('Client', order.client_name); fields.set('Email', order.client_email); fields.set('Package', order.package_code); fields.set('Pages', String(order.pages)); fields.set('Features', order.features.join(', ')); fields.set('Logo', order.logo_addon ? 'Yes (+€2)' : 'No'); fields.set('Deadline', order.deadline); fields.set('Total', `€${(order.total_price_snapshot_cents/100).toFixed(2)}`);
  for (const [key, value] of Object.entries(order.website_information)) fields.set(key, Array.isArray(value) ? value.join(', ') : String(value || ''));
  const response = await fetch('https://formspree.io/f/mljereeb', { method:'POST', headers:{ Accept:'application/json' }, body:fields });
  return response.ok;
}
async function createOrder(request, env) {
  const payload = await body(request);
  if (!payload || typeof payload !== 'object') return fail('invalid_json','Le formulaire est invalide.',400,request);
  const { client, package_code, pages, features = [], website_information = {}, deadline, logo_addon = false } = payload;
  if (!client?.name?.trim() || !/^\S+@\S+\.\S+$/.test(client?.email || '')) return fail('invalid_client','Veuillez renseigner un nom et une adresse e-mail valide.',400,request);
  if (!PACKAGES[package_code]) return fail('invalid_package','Le pack choisi est invalide.',400,request);
  if (!Number.isInteger(pages) || pages < 1 || pages > PACKAGES[package_code].maxPages) return fail('invalid_pages','Le nombre de pages ne correspond pas au pack.',400,request);
  if (!Array.isArray(features) || features.some(f => !PACKAGES[package_code].features.includes(f))) return fail('invalid_features','Une fonctionnalité ne fait pas partie du pack choisi.',400,request);
  if (!validDate(deadline)) return fail('invalid_deadline','Choisissez une date valide qui n’est pas passée.',400,request);
  const required = ['project_name','activity','description','objective','target_audience','desired_content','desired_pages','style','colors','references','additional_information'];
  if (required.some(k => !String(website_information[k] || '').trim())) return fail('missing_information','Veuillez compléter les informations essentielles du site.',400,request);
  if (!env.DB) { console.error('Order creation failed: D1 binding DB is missing'); return fail('server_configuration','Le service de commande est temporairement indisponible.',503,request); }
  try {
    const prices = await pricing(env.DB), packagePrice = prices[package_code], addonPrice = logo_addon ? prices.LOGO : 0;
    if (packagePrice == null || prices.LOGO == null) return fail('pricing_unavailable','Les tarifs sont temporairement indisponibles.',503,request);
    const timestamp = now(), clientId = id('CLI'), orderId = id('NAS'), token = crypto.randomUUID().replaceAll('-','');
    const existing = await env.DB.prepare('SELECT id FROM clients WHERE email=?').bind(client.email.trim().toLowerCase()).first();
    const actualClientId = existing?.id || clientId;
    const order = { id:orderId, tracking_token:token, client_id:actualClientId, client_name:client.name.trim(), client_email:client.email.trim().toLowerCase(), package_code, pages, features, website_information, deadline, logo_addon:!!logo_addon, package_price_snapshot_cents:packagePrice, addon_price_snapshot_cents:addonPrice, total_price_snapshot_cents:packagePrice+addonPrice, status:'received', created_at:timestamp, updated_at:timestamp };
    const statements = [];
    if (!existing) statements.push(env.DB.prepare('INSERT INTO clients(id,name,email,created_at,updated_at) VALUES(?,?,?,?,?)').bind(actualClientId,order.client_name,order.client_email,timestamp,timestamp));
    else statements.push(env.DB.prepare('UPDATE clients SET name=?,updated_at=? WHERE id=?').bind(order.client_name,timestamp,actualClientId));
    statements.push(env.DB.prepare('INSERT INTO orders(id,tracking_token,client_id,package_code,pages,features_json,website_information_json,deadline,logo_addon,package_price_snapshot_cents,addon_price_snapshot_cents,total_price_snapshot_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(order.id,order.tracking_token,actualClientId,package_code,pages,JSON.stringify(features),JSON.stringify(website_information),deadline,Number(order.logo_addon),packagePrice,addonPrice,order.total_price_snapshot_cents,'received',timestamp,timestamp));
    statements.push(env.DB.prepare('INSERT INTO order_status_history(id,order_id,status,note,changed_by,created_at) VALUES(?,?,?,?,?,?)').bind(id('HIS'),order.id,'received','Commande reçue','Client',timestamp));
    await env.DB.batch(statements);
    let notified = false; try { notified = await notify(order); } catch (error) { console.error('Order notification failed', { order_id: order.id, message: error instanceof Error ? error.message : String(error) }); }
    await env.DB.prepare('UPDATE orders SET notification_state=? WHERE id=?').bind(notified ? 'sent' : 'failed',order.id).run();
    return json({ order_id:order.id, tracking_token:token, tracking_url:`/track/${token}`, notification_sent:notified },201,request);
  } catch (error) {
    console.error('Order creation failed', { message:error instanceof Error ? error.message : String(error), stack:error instanceof Error ? error.stack : undefined });
    return fail('order_creation_failed','La commande n’a pas pu être enregistrée. Veuillez réessayer.',500,request);
  }
}
async function track(token, env, request) {
  try { const row = await env.DB.prepare('SELECT o.*,c.name client_name FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.tracking_token=?').bind(token).first(); if (!row) return fail('not_found','Commande introuvable.',404,request); return json({ order: mapOrder(row) },200,request); }
  catch (error) { console.error('Tracking lookup failed', error instanceof Error ? error.message : String(error)); return fail('tracking_unavailable','Le suivi est temporairement indisponible.',503,request); }
}
async function adminOrders(env, request) { const r = await env.DB.prepare('SELECT o.*,c.name client_name,c.email client_email FROM orders o JOIN clients c ON c.id=o.client_id ORDER BY o.created_at DESC').all(); return json({ orders:r.results.map(mapOrder) },200,request); }
async function updateOrder(request, env, orderId, actor) {
  const p = await body(request); if (!p || typeof p !== 'object') return fail('invalid_json','Corps de requête invalide.',400,request);
  const current = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(orderId).first(); if (!current) return fail('not_found','Commande introuvable.',404,request);
  const status = p.status ?? current.status, deadline = p.deadline ?? current.deadline, notes = typeof p.admin_notes === 'string' ? p.admin_notes : current.admin_notes, packageCode = p.package_code ?? current.package_code;
  if (!STATUSES.includes(status) || !PACKAGES[packageCode] || !validDate(deadline)) return fail('invalid_update','Statut, pack ou date invalide.',400,request);
  const total = p.total_price_cents === undefined ? Number(current.total_price_snapshot_cents) : cents(p.total_price_cents); if (total === null) return fail('invalid_price','Prix invalide.',400,request);
  const time = now(); await env.DB.prepare('UPDATE orders SET status=?,deadline=?,admin_notes=?,package_code=?,total_price_snapshot_cents=?,updated_at=? WHERE id=?').bind(status,deadline,notes,packageCode,total,time,orderId).run();
  if (status !== current.status) await env.DB.prepare('INSERT INTO order_status_history(id,order_id,status,note,changed_by,created_at) VALUES(?,?,?,?,?,?)').bind(id('HIS'),orderId,status,notes,actor,time).run();
  return json({ ok:true },200,request);
}

export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{'access-control-allow-methods':'GET,POST,PATCH,OPTIONS','access-control-allow-headers':'content-type,authorization','cache-control':'no-store'}});
  if (url.pathname === '/api/pricing' && request.method === 'GET') return json({ pricing:await pricing(env.DB) },200,request);
  if (url.pathname === '/api/orders' && request.method === 'POST') return createOrder(request,env);
  const trackMatch = url.pathname.match(/^\/api\/track\/([a-f0-9]{32})$/); if (trackMatch && request.method === 'GET') return track(trackMatch[1],env,request);
  if (!url.pathname.startsWith('/api/admin/')) return fail('not_found','Route introuvable.',404,request);
  const auth = await requireAdmin(request,env); if (!auth.ok) return auth.response;
  if (url.pathname === '/api/admin/session' && request.method === 'GET') return json({ authenticated:true, email:auth.email },200,request);
  if (url.pathname === '/api/admin/orders' && request.method === 'GET') return adminOrders(env,request);
  const orderMatch = url.pathname.match(/^\/api\/admin\/orders\/(NAS-[A-Z0-9]+)$/); if (orderMatch && request.method === 'PATCH') return updateOrder(request,env,orderMatch[1],auth.email);
  if (url.pathname === '/api/admin/clients' && request.method === 'GET') { const r=await env.DB.prepare('SELECT c.*,COUNT(o.id) order_count,MAX(o.created_at) latest_order_at FROM clients c LEFT JOIN orders o ON o.client_id=c.id GROUP BY c.id ORDER BY latest_order_at DESC').all(); return json({ clients:r.results },200,request); }
  if (url.pathname === '/api/admin/pricing' && request.method === 'GET') return json({ pricing:await pricing(env.DB) },200,request);
  if (url.pathname === '/api/admin/pricing' && request.method === 'PATCH') { const p=await body(request); if(!p?.pricing||typeof p.pricing!=='object') return fail('invalid_pricing','Tarifs invalides.',400,request); const valid=['STARTER','ESSENTIAL','BUSINESS','CUSTOM','LOGO']; const q=[]; for(const code of valid){const n=cents(p.pricing[code]);if(n===null)return fail('invalid_pricing','Chaque tarif doit être positif.',400,request);q.push(env.DB.prepare('UPDATE pricing SET amount_cents=?,updated_at=? WHERE code=?').bind(n,now(),code))}await env.DB.batch(q);return json({ok:true},200,request); }
  return fail('not_found','Route introuvable.',404,request);
} };
