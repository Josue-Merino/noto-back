-- ==============================================================================
-- Noto: Migración inicial de base de datos
-- Tabla de perfiles de usuario vinculada a Supabase Auth
-- ==============================================================================

-- 1. Crear tabla pública "user" referenciando auth.users
create table if not exists public."user" (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null,
  middle_name text null,
  last_name text not null,
  second_last_name text null,
  email text not null unique,
  nickname text null,
  avatar_url text null,
  credits integer not null default 0 check (credits >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. Función y Trigger para mantener updated_at automáticamente
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_user_updated_at on public."user";
create trigger set_user_updated_at
  before update on public."user"
  for each row
  execute function public.handle_updated_at();

-- 3. Habilitar Row Level Security (RLS) como defensa en profundidad
alter table public."user" enable row level security;

-- Políticas de acceso para usuarios autenticados:
-- Solo pueden ver y actualizar su propia información de perfil.
drop policy if exists "Los usuarios pueden consultar su propio perfil" on public."user";
create policy "Los usuarios pueden consultar su propio perfil"
  on public."user"
  for select
  using (auth.uid() = user_id);

drop policy if exists "Los usuarios pueden actualizar su propio perfil" on public."user";
create policy "Los usuarios pueden actualizar su propio perfil"
  on public."user"
  for update
  using (auth.uid() = user_id);

drop policy if exists "Los usuarios pueden insertar su propio perfil" on public."user";
create policy "Los usuarios pueden insertar su propio perfil"
  on public."user"
  for insert
  with check (auth.uid() = user_id);

-- 4. Otorgar permisos a los roles de Supabase (esencial para operaciones de la API)
grant all on table public."user" to postgres, service_role;
grant select, insert, update on table public."user" to authenticated;
grant select on table public."user" to anon;
