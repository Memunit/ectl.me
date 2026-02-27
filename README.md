# ectl.me

Single-page static site (Vercel) with a **Notes** tab.

## Notes + Cloud accounts (Supabase)

The **Notes** tab uses **Supabase Auth (email + password)** and stores notes in Supabase Postgres.

This site supports:

- **Log in with email** (normal Supabase email/password)
- **Log in with username** (implemented by mapping usernames to a pseudo-email)

### Username logins

- When you **Create account**, enter **username + email + password**.
- When you **Log in**, you can type either your **username** or your **email**.

How it works:

- Accounts are created normally in Supabase using your real **email + password**.
- A Postgres table `public.usernames` stores a mapping from **username → email**.

Note:

- Username login is implemented by looking up `public.usernames.username -> email` and then doing a normal email+password sign-in.

Security note:

- Username login requires looking up the email for a username.
- With the simple SQL below, anyone who knows a username can also discover the email mapped to it.

### 1) Create the `notes` table + RLS

In Supabase SQL editor, run:

```sql
create table if not exists public.notes (
	user_id uuid primary key references auth.users(id) on delete cascade,
	content text not null default '',
	updated_at timestamptz not null default now()
);

alter table public.notes enable row level security;

drop policy if exists "Users can read own notes" on public.notes;
create policy "Users can read own notes"
on public.notes
for select
using (auth.uid() = user_id);

drop policy if exists "Users can insert own notes" on public.notes;
create policy "Users can insert own notes"
on public.notes
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own notes" on public.notes;
create policy "Users can update own notes"
on public.notes
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Username mapping used for username logins
create table if not exists public.usernames (
	username text primary key,
	user_id uuid not null references auth.users(id) on delete cascade,
	email text not null,
	created_at timestamptz not null default now()
);

alter table public.usernames enable row level security;

-- Needed so the login page can look up email by username before auth
drop policy if exists "Anyone can lookup usernames" on public.usernames;
create policy "Anyone can lookup usernames"
on public.usernames
for select
using (true);

drop policy if exists "Users can insert own username" on public.usernames;
create policy "Users can insert own username"
on public.usernames
for insert
with check (auth.uid() = user_id);

drop policy if exists "Users can update own username" on public.usernames;
create policy "Users can update own username"
on public.usernames
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

### 2) Enable Email provider

In Supabase: **Authentication → Providers → Email**

- Enable it
- If “Confirm email” is enabled, users must confirm via email before they can sign in.
	- For username accounts, it’s recommended to disable confirmations.

### 3) Configure allowed URLs

In Supabase: **Authentication → URL Configuration**

- Set **Site URL** to your production domain (Vercel/custom domain)
- Add **Additional Redirect URLs**:
	- `http://localhost:4173`
	- your Vercel preview + production URLs

### 4) Paste Supabase keys into `index.html`

Edit `index.html` and set:

- `SUPABASE_URL` (looks like `https://xxxx.supabase.co`)
- `SUPABASE_ANON_KEY` (public anon key)

## Local preview

```zsh
cd /Users/test/Projects/ectl.me
python3 -m http.server 8000
```

Open `http://localhost:8000`.

## Deploy

Deploy the folder as a static site on Vercel (no build step needed).

## Account deletion (required)

Deleting the **auth user** cannot be done from a browser-only app with the anon key (you may see `HTTP 405`).

This repo includes a Supabase Edge Function at `supabase/functions/delete-account`.

### Deploy the Edge Function

1) Install Supabase CLI

2) Link your project

```zsh
supabase link --project-ref oxgaltttggmxukslgjxn
```

3) Set function secret (service role key)

In Supabase Dashboard: **Project Settings → API → service_role key**.

```zsh
supabase secrets set DELETE_ACCOUNT_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

Note: Supabase CLI skips env var names starting with `SUPABASE_`. Also make sure to include the `NAME=VALUE` form (otherwise it will say “No arguments found”).

4) Deploy function

```zsh
supabase functions deploy delete-account --no-verify-jwt
```

`--no-verify-jwt` prevents the Functions gateway from rejecting the request before the function runs. The function still requires `Authorization: Bearer <access_token>` and verifies it server-side.

After this, the site can delete the auth user by calling `POST /functions/v1/delete-account`.