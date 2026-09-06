-- ============================================================
-- Storage 私有桶策略：game-engine
-- 请先在 Supabase 控制台 → Storage 里手动创建一个名为 game-engine 的
-- 私有(Private) 桶（不要勾选 Public），再执行本文件里的 SQL。
-- ============================================================

-- 只有已登录 且 profiles.is_authorized = true 的账号，
-- 才能对 game-engine 桶里的文件生成签名下载链接 / 读取内容。
-- 没有开放 insert/update/delete 策略给普通用户 —— 上传/替换引擎文件
-- 只能由你本人在 Supabase 控制台（Dashboard）手动操作。

drop policy if exists "engine_read_if_authorized" on storage.objects;
create policy "engine_read_if_authorized"
  on storage.objects for select
  using (
    bucket_id = 'game-engine'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_authorized = true
    )
  );
