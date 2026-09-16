-- 在 Supabase → SQL Editor 里执行一次即可。
-- 作用：建一个私有桶 game-assets，并且只允许「已登录 + profiles.is_authorized = true」
-- 的账号读取（也就是生成签名下载链接）。规则和 game-engine 桶保持一致。

-- 1) 建桶（私有）
insert into storage.buckets (id, name, public)
values ('game-assets', 'game-assets', false)
on conflict (id) do nothing;

-- 2) 读取策略
drop policy if exists "authorized users can read game assets" on storage.objects;

create policy "authorized users can read game assets"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'game-assets'
  and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_authorized = true
  )
);

-- 说明：
-- * 没有写 insert / update / delete 策略，所以普通账号无法上传或删除素材；
--   你自己上传时用 service_role key（绕过 RLS）或在后台面板里手动传。
-- * 若要验证策略是否生效，可以用一个 is_authorized = false 的账号登录，
--   加载时应当在「正在加载素材」这一步报「没有权限」。
