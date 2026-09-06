// 这个文件会随 GitHub Pages 一起公开发布。
// SUPABASE_URL 和 SUPABASE_ANON_KEY 本身设计上就是"可以公开"的值——
// 它们只能在 Supabase 的 RLS（行级安全策略）允许的范围内读写数据，
// 真正的门禁（能不能玩、能不能拉取游戏引擎文件）由数据库里的
// profiles.is_authorized 字段 + RLS / Storage 策略决定，而不是这两个值保密与否。
//
// 请在 Supabase 项目 Settings → API 页面复制以下两个值替换进来。
window.SUPABASE_URL = 'https://uqqjgqfgsowrmncioppg.supabase.co';
window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxcWpncWZnc293cm1uY2lvcHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2ODU4NDQsImV4cCI6MjEwNDI2MTg0NH0.4AyKXob1wK_wSfTbiiqMdrEA100Fg3589biFZAa_BbE';
