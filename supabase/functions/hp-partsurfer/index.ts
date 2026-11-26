// Supabase Edge Function: hp-partsurfer
//
// Thin proxy for HP PartSurfer's internal BFF API. HP only answers that API
// when the request carries Origin/Referer = partsurfer.hp.com (a browser
// cannot set those headers) and it sends no CORS headers, so the static site
// can't call it directly. This function does the fetch server-side and returns
// the JSON to ectl.me with CORS enabled.
//
// Usage:
//   GET /functions/v1/hp-partsurfer?pn=1AB39US   -> parts list for a product number
//   GET /functions/v1/hp-partsurfer?sn=SERIAL     -> product model + serial parts
//   GET /functions/v1/hp-partsurfer?q=840%20G3   -> matching products
//
// Deploy:
//   supabase functions deploy hp-partsurfer --no-verify-jwt

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: any;

const corsHeaders: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const BFF = 'https://partsurfer.hpcloud.hp.com/bff/proxy/get';
const COUNTRY = 'US';
const USERTYPE = 'EXT'; // non-logged-in desktop user

function json(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
}

function buildInput(url: URL): string | null {
	const pn = (url.searchParams.get('pn') || '').trim();
	const sn = (url.searchParams.get('sn') || '').trim();
	const q = (url.searchParams.get('q') || '').trim();
	const path = (url.searchParams.get('path') || '').trim();

	if (sn && pn) {
		return `/SerialNumber/GetSerialNumber/${encodeURIComponent(sn)}/ProductNumber/${encodeURIComponent(pn)}/country/${COUNTRY}/usertype/${USERTYPE}`;
	}
	if (pn) {
		return `/Product/GetProduct/${encodeURIComponent(pn)}/country/${COUNTRY}/usertype/${USERTYPE}`;
	}
	if (sn) {
		return `/SerialNumber/GetSerialNumber/${encodeURIComponent(sn)}/country/${COUNTRY}/usertype/${USERTYPE}`;
	}
	if (q) {
		return `/Search/GenericSearch/${encodeURIComponent(q)}/country/${COUNTRY}/usertype/${USERTYPE}`;
	}
	// Optional whitelisted raw path for advanced use.
	if (/^\/(Product\/GetProduct|SerialNumber\/GetSerialNumber|Part\/GetPart|Part\/GetWhereUsedProductList|Search\/GenericSearch)\/[A-Za-z0-9%._~/-]+$/.test(path)) {
		return path;
	}
	return null;
}

Deno.serve(async (req: Request) => {
	if (req.method === 'OPTIONS') {
		return new Response(null, { headers: corsHeaders });
	}
	if (req.method !== 'GET') {
		return json({ error: 'Method not allowed' }, 405);
	}

	const url = new URL(req.url);
	const input = buildInput(url);
	if (!input) {
		return json({ error: 'Provide ?pn=<product number> or ?q=<search text>' }, 400);
	}

	try {
		const upstream = await fetch(`${BFF}?input=${input}`, {
			headers: {
				Origin: 'https://partsurfer.hp.com',
				Referer: 'https://partsurfer.hp.com/',
				'User-Agent': 'Mozilla/5.0',
				Accept: 'application/json, text/plain, */*',
			},
		});

		const text = await upstream.text();
		if (!upstream.ok) {
			return json({ error: `PartSurfer returned HTTP ${upstream.status}`, details: text.slice(0, 300) }, 502);
		}

		try {
			return json(JSON.parse(text));
		} catch {
			return json({ error: 'Unexpected non-JSON response from PartSurfer' }, 502);
		}
	} catch (e) {
		return json({ error: 'Upstream request failed', details: String((e as Error)?.message || e) }, 502);
	}
});
