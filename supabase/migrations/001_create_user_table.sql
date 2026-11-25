-- ==============================================================================
-- Noto: Migración inicial de base de datos
-- Tabla de perfiles de usuario vinculada a Supabase Auth
-- (el proyecto eluxfpkoastufmznbuzf ya la tiene; esto sirve para crear un proyecto nuevo)
-- ==============================================================================

-- 1. Tabla pública "user" (mismo esquema del proyecto de Noto, eluxfpkoastufmznbuzf).
--    El correo y la fecha de alta viven en auth.users; el segundo nombre y el segundo
--    apellido, en auth.users.raw_user_meta_data (middle_name, second_last_name).
create table if not exists public."user" (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name varchar not null,
  last_name varchar not null,
  nickname varchar not null,
  credits real not null default '0'::real,
  image_url text null
);

-- 2. Función para mantener updated_at automáticamente (la usan las tablas de la migración 002)
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

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
