// Supabase Edge Function: delete-account
// Deletes the currently authenticated user (self-delete) using the Admin API.
// Requires env var DELETE_ACCOUNT_SERVICE_ROLE_KEY set in function secrets.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

declare const Deno: any;

const corsHeaders: Record<string, string> = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
	'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
	if (req.method === 'OPTIONS') {
		return new Response(null, { headers: corsHeaders });
	}
	if (req.method !== 'POST') {
		return new Response(JSON.stringify({ error: 'Method not allowed' }), {
			status: 405,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
	const serviceRoleKey = Deno.env.get('DELETE_ACCOUNT_SERVICE_ROLE_KEY') ?? '';

	if (!supabaseUrl || !serviceRoleKey) {
		return new Response(JSON.stringify({ error: 'Missing SUPABASE_URL or DELETE_ACCOUNT_SERVICE_ROLE_KEY' }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	const authHeader = req.headers.get('Authorization') || '';
	const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
	if (!jwt) {
		return new Response(JSON.stringify({ error: 'Missing Authorization bearer token' }), {
			status: 401,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	// Verify the caller and obtain their user id
	const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
		method: 'GET',
		headers: {
			Authorization: `Bearer ${jwt}`,
			apikey: serviceRoleKey,
			Accept: 'application/json',
		},
	});

	if (!userRes.ok) {
		const t = await userRes.text().catch(() => '');
		return new Response(JSON.stringify({ error: 'Unauthorized', details: t }), {
			status: 401,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	const user = (await userRes.json().catch(() => null)) as { id?: string } | null;
	const userId = user?.id;
	if (!userId) {
		return new Response(JSON.stringify({ error: 'Could not determine user id' }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	// Delete user via Admin API
	const delRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
		method: 'DELETE',
		headers: {
			apikey: serviceRoleKey,
			Authorization: `Bearer ${serviceRoleKey}`,
			Accept: 'application/json',
		},
	});

	if (!delRes.ok) {
		const t = await delRes.text().catch(() => '');
		return new Response(JSON.stringify({ error: 'Failed to delete user', details: t }), {
			status: 500,
			headers: { ...corsHeaders, 'Content-Type': 'application/json' },
		});
	}

	return new Response(JSON.stringify({ ok: true }), {
		status: 200,
		headers: { ...corsHeaders, 'Content-Type': 'application/json' },
	});
});
