-- ==============================================================================
-- Noto: tablas del material de estudio (apuntes, flashcards, cuestionarios y repaso)
--
-- Esquema del proyecto de Noto (eluxfpkoastufmznbuzf), que ya tiene estas tablas: ahí solo
-- agrega índices, triggers de updated_at, RLS y permisos. En un proyecto nuevo crea todo.
-- Requiere la tabla public."user" (migración 001).
-- Es idempotente: se puede volver a ejecutar sin perder datos.
--
-- noto-back escribe con la service_role key (filtrando por usuario en el código); las políticas
-- RLS de abajo son defensa en profundidad para accesos con la llave pública.
-- ==============================================================================

-- 1. Tipos
do $$ begin
  create type public.block_type as enum (
    'heading1', 'heading2', 'heading3', 'heading4', 'paragraph', 'quote', 'callout',
    'bullet_list_item', 'numbered_list_item', 'table', 'code', 'todo_list_item'
  );
exception when duplicate_object then null; end $$;

-- 2. Carpetas y notas
create table if not exists public.folder (
  folder_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(user_id) on delete cascade,
  folder_parent uuid null references public.folder(folder_id) on delete cascade,
  folder_name varchar not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.note (
  note_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public."user"(user_id) on delete cascade,
  folder_id uuid null references public.folder(folder_id) on delete set null,
  title varchar null,
  transcript jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Bloques del apunte: lista enlazada (anterior / siguiente)
create table if not exists public.block (
  block_id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.note(note_id) on delete cascade,
  type public.block_type not null,
  content text null,
  previous_block_id uuid null references public.block(block_id) on delete set null,
  next_block_id uuid null references public.block(block_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. Flashcards y repaso espaciado (SM-2)
create table if not exists public.mazo (
  mazo_id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.note(note_id) on delete cascade,
  mazo_name varchar not null,
  created_at timestamptz not null default now()
);

create table if not exists public.flashcard (
  flashcard_id uuid primary key default gen_random_uuid(),
  mazo_id uuid not null references public.mazo(mazo_id) on delete cascade,
  orden integer not null,
  frente text not null,
  reverso text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.flashcard_review (
  flashcard_review_id uuid primary key default gen_random_uuid(),
  flashcard_id uuid not null references public.flashcard(flashcard_id) on delete cascade,
  ease_factor double precision not null default 2.5,
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  next_review_at timestamptz null,
  last_reviewed_at timestamptz null,
  created_at timestamptz not null default now()
);

-- 4. Cuestionarios e intentos
create table if not exists public.cuestionario (
  cuestionario_id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.note(note_id) on delete cascade,
  cuestionario_name varchar not null,
  created_at timestamptz not null default now()
);

create table if not exists public.pregunta (
  pregunta_id uuid primary key default gen_random_uuid(),
  cuestionario_id uuid not null references public.cuestionario(cuestionario_id) on delete cascade,
  orden integer not null,
  enunciado text not null,
  explicacion text null,
  created_at timestamptz not null default now()
);

create table if not exists public.opcion (
  opcion_id uuid primary key default gen_random_uuid(),
  pregunta_id uuid not null references public.pregunta(pregunta_id) on delete cascade,
  orden integer not null,
  texto text not null,
  es_correcta boolean not null default false
);

create table if not exists public.intento (
  intento_id uuid primary key default gen_random_uuid(),
  cuestionario_id uuid not null references public.cuestionario(cuestionario_id) on delete cascade,
  puntaje real null,
  total_preguntas integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz null
);

create table if not exists public.respuesta (
  respuesta_id uuid primary key default gen_random_uuid(),
  intento_id uuid not null references public.intento(intento_id) on delete cascade,
  pregunta_id uuid not null references public.pregunta(pregunta_id) on delete cascade,
  opcion_id uuid null references public.opcion(opcion_id) on delete set null,
  es_correcta boolean not null
);

-- 5. Índices de las llaves foráneas (listas por usuario y cargas de una nota)
create index if not exists folder_user_id_idx on public.folder(user_id);
create index if not exists note_user_id_created_at_idx on public.note(user_id, created_at desc);
create index if not exists block_note_id_idx on public.block(note_id);
create index if not exists mazo_note_id_idx on public.mazo(note_id);
create index if not exists flashcard_mazo_id_idx on public.flashcard(mazo_id);
create index if not exists flashcard_review_flashcard_id_idx on public.flashcard_review(flashcard_id);
create index if not exists cuestionario_note_id_idx on public.cuestionario(note_id);
create index if not exists pregunta_cuestionario_id_idx on public.pregunta(cuestionario_id);
create index if not exists opcion_pregunta_id_idx on public.opcion(pregunta_id);
create index if not exists intento_cuestionario_id_idx on public.intento(cuestionario_id);
create index if not exists respuesta_intento_id_idx on public.respuesta(intento_id);

-- 6. updated_at automático (la misma función de la migración 001; se crea aquí por si el
--    proyecto no la tiene)
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_folder_updated_at on public.folder;
create trigger set_folder_updated_at before update on public.folder
  for each row execute function public.handle_updated_at();

drop trigger if exists set_note_updated_at on public.note;
create trigger set_note_updated_at before update on public.note
  for each row execute function public.handle_updated_at();

drop trigger if exists set_block_updated_at on public.block;
create trigger set_block_updated_at before update on public.block
  for each row execute function public.handle_updated_at();

-- 7. Row Level Security: cada usuario solo ve y modifica lo suyo
alter table public.folder enable row level security;
alter table public.note enable row level security;
alter table public.block enable row level security;
alter table public.mazo enable row level security;
alter table public.flashcard enable row level security;
alter table public.flashcard_review enable row level security;
alter table public.cuestionario enable row level security;
alter table public.pregunta enable row level security;
alter table public.opcion enable row level security;
alter table public.intento enable row level security;
alter table public.respuesta enable row level security;

drop policy if exists "Dueño de la carpeta" on public.folder;
create policy "Dueño de la carpeta" on public.folder for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Dueño de la nota" on public.note;
create policy "Dueño de la nota" on public.note for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Dueño de la nota (bloques)" on public.block;
create policy "Dueño de la nota (bloques)" on public.block for all
  using (exists (select 1 from public.note n where n.note_id = block.note_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.note n where n.note_id = block.note_id and n.user_id = auth.uid()));

drop policy if exists "Dueño de la nota (mazos)" on public.mazo;
create policy "Dueño de la nota (mazos)" on public.mazo for all
  using (exists (select 1 from public.note n where n.note_id = mazo.note_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.note n where n.note_id = mazo.note_id and n.user_id = auth.uid()));

drop policy if exists "Dueño de la nota (flashcards)" on public.flashcard;
create policy "Dueño de la nota (flashcards)" on public.flashcard for all
  using (exists (select 1 from public.mazo m join public.note n on n.note_id = m.note_id
                 where m.mazo_id = flashcard.mazo_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.mazo m join public.note n on n.note_id = m.note_id
                      where m.mazo_id = flashcard.mazo_id and n.user_id = auth.uid()));

drop policy if exists "Dueño de la nota (repasos)" on public.flashcard_review;
create policy "Dueño de la nota (repasos)" on public.flashcard_review for all
  using (exists (select 1 from public.flashcard f join public.mazo m on m.mazo_id = f.mazo_id
                 join public.note n on n.note_id = m.note_id
                 where f.flashcard_id = flashcard_review.flashcard_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.flashcard f join public.mazo m on m.mazo_id = f.mazo_id
                      join public.note n on n.note_id = m.note_id
                      where f.flashcard_id = flashcard_review.flashcard_id and n.user_id = auth.uid()));

drop policy if exists "Dueño de la nota (cuestionarios)" on public.cuestionario;
create policy "Dueño de la nota (cuestionarios)" on public.cuestionario for all
  using (exists (select 1 from public.note n where n.note_id = cuestionario.note_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.note n where n.note_id = cuestionario.note_id and n.user_id = auth.uid()));

drop policy if exists "Dueño de la nota (preguntas)" on public.pregunta;
create policy "Dueño de la nota (preguntas)" on public.pregunta for all
  using (exists (select 1 from public.cuestionario c join public.note n on n.note_id = c.note_id
                 where c.cuestionario_id = pregunta.cuestionario_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.cuestionario c join public.note n on n.note_id = c.note_id
                      where c.cuestionario_id = pregunta.cuestionario_id and n.user_id = auth.uid()));

drop policy if exists "Dueño de la nota (opciones)" on public.opcion;
create policy "Dueño de la nota (opciones)" on public.opcion for all
  using (exists (select 1 from public.pregunta p join public.cuestionario c on c.cuestionario_id = p.cuestionario_id
                 join public.note n on n.note_id = c.note_id
                 where p.pregunta_id = opcion.pregunta_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.pregunta p join public.cuestionario c on c.cuestionario_id = p.cuestionario_id
                      join public.note n on n.note_id = c.note_id
                      where p.pregunta_id = opcion.pregunta_id and n.user_id = auth.uid()));

drop policy if exists "Dueño de la nota (intentos)" on public.intento;
create policy "Dueño de la nota (intentos)" on public.intento for all
  using (exists (select 1 from public.cuestionario c join public.note n on n.note_id = c.note_id
                 where c.cuestionario_id = intento.cuestionario_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.cuestionario c join public.note n on n.note_id = c.note_id
                      where c.cuestionario_id = intento.cuestionario_id and n.user_id = auth.uid()));

drop policy if exists "Dueño de la nota (respuestas)" on public.respuesta;
create policy "Dueño de la nota (respuestas)" on public.respuesta for all
  using (exists (select 1 from public.intento i join public.cuestionario c on c.cuestionario_id = i.cuestionario_id
                 join public.note n on n.note_id = c.note_id
                 where i.intento_id = respuesta.intento_id and n.user_id = auth.uid()))
  with check (exists (select 1 from public.intento i join public.cuestionario c on c.cuestionario_id = i.cuestionario_id
                      join public.note n on n.note_id = c.note_id
                      where i.intento_id = respuesta.intento_id and n.user_id = auth.uid()));

-- 8. Permisos para la API de Supabase (el backend usa service_role)
grant usage on type public.block_type to authenticated, service_role;
grant all on table
  public.folder, public.note, public.block, public.mazo, public.flashcard, public.flashcard_review,
  public.cuestionario, public.pregunta, public.opcion, public.intento, public.respuesta
  to postgres, service_role;
grant select, insert, update, delete on table
  public.folder, public.note, public.block, public.mazo, public.flashcard, public.flashcard_review,
  public.cuestionario, public.pregunta, public.opcion, public.intento, public.respuesta
  to authenticated;

-- 9. Que la API (PostgREST) vea las tablas nuevas de inmediato
notify pgrst, 'reload schema';
