-- ============================================================
-- CardZ 授权 + 云存档 数据库结构
-- 在 Supabase 控制台 → SQL Editor 中，新建一个查询，把本文件全部内容
-- 粘贴进去执行一次即可（可以整段执行，无需分段）。
-- ============================================================

-- 1) 账号资料表：谁被授权玩游戏，全部记录在这里
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  is_authorized boolean not null default false,
  authorized_at timestamptz,
  note text,                          -- 备注，例如"2026-09-06 微信转账 xx元"
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- 用户只能读自己的那一行（能看到自己是否已被授权）
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

-- 注意：没有为普通用户开放 insert / update 权限。
-- 也就是说用户自己永远无法把 is_authorized 改成 true，
-- 只有你在 Supabase 控制台（以项目所有者身份）手动修改才有效。

-- 2) 新用户注册时，自动在 profiles 里创建一行（默认未授权）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 3) 云存档表：每个用户一行，保存 meta（最高分/解锁进度）和 run（当前冒险进度）
create table if not exists public.saves (
  user_id uuid primary key references auth.users(id) on delete cascade,
  meta jsonb,
  run jsonb,
  updated_at timestamptz not null default now()
);

alter table public.saves enable row level security;

-- 只有本人、且 profiles.is_authorized = true 时，才能读/写自己的存档。
-- 这样即使有人拿到了别人的登录态也无法越权，
-- 而未授权账号即便登录成功，也完全无法写入/读取云存档。
drop policy if exists "saves_owner_authorized_all" on public.saves;
create policy "saves_owner_authorized_all"
  on public.saves for all
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_authorized = true
    )
  )
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_authorized = true
    )
  );

-- ============================================================
-- 常用管理 SQL（开通/查询/撤销授权），平时可以直接在 SQL Editor 里跑：
--
-- 查某个邮箱是否已注册、是否已授权：
--   select id, email, is_authorized, authorized_at from public.profiles where email = 'user@example.com';
--
-- 开通授权（客户付款后执行）：
--   update public.profiles
--   set is_authorized = true, authorized_at = now(), note = '2026-09-06 已付款'
--   where email = 'user@example.com';
--
-- 撤销授权：
--   update public.profiles set is_authorized = false where email = 'user@example.com';
-- ============================================================
