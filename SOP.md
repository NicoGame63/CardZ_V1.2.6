# CardZ 授权售卖 + 云存档 落地 SOP

本文档配合压缩包里的代码，一步步教你把游戏改造成"客户注册 → 你收款后开通 → 客户才能玩，且存档跨设备同步"的模式，并发布到 GitHub Pages。

## 0. 先搞清楚这套方案能做到什么、不能做到什么（很重要，请先读完）

**能做到：**
- GitHub 仓库和 GitHub Pages 上**不会出现**游戏真正的玩法代码（`cards.js`/`game.js`/`ui.js` 等）。这些文件只放在 Supabase 的私有 Storage 里。
- 没有登录、或登录了但你没有在后台把该账号标记为"已授权"，浏览器**拿不到**这些文件（Supabase 会直接拒绝，返回权限错误），自然也就跑不起来游戏。
- 客户自己在登录页注册账号；你在 Supabase 后台看到付款后，手动把这个账号标记为已授权，客户刷新页面即可开玩，不需要你重新发布代码。
- 存档（最高分、解锁进度、当前冒险）会自动同步到 Supabase 云端，换设备登录同一账号能继续玩。

**做不到 / 请如实告知客户和自己：**
- 一旦某个账号被你授权、客户能正常打开游戏，游戏代码就会被下载到**客户自己的浏览器**里执行。任何在浏览器里跑起来的 JS，技术上都可以被这个客户用开发者工具另存下来。这套方案挡的是"没付费的陌生人/搜索引擎/GitHub 访客"，挡不住"已经是付费客户、并且存心要拿源码的人"。如果你的诉求是防止**已付费客户**拷贝代码，这属于更难的 DRM/代码混淆问题，不在本方案范围内，也没有纯前端方案能做到 100% 防拷贝。
- `js/supabase-config.js` 里的 `SUPABASE_URL` 和匿名 Key（anon key）是**设计上就允许公开**的，不是"泄露了就完蛋"的秘密。真正的安全边界是数据库里的权限策略（RLS），不是这两个字符串。千万不要把 **service_role key**（在 Supabase 后台可以看到的另一把"超级密钥"）放进任何前端文件——本方案全程不需要用到它。

如果你能接受这个边界，就可以继续往下做。

---

## 1. 注册 Supabase 项目

1. 打开 https://supabase.com ，注册/登录。
2. 点 "New Project"，起个名字（比如 `cardz`），选一个离你用户近的区域，设置数据库密码（ B_J9NXA.58Ys4MS 记下来，一般用不到，但要留存）。
3. 等待项目创建完成（一两分钟）。

---

## 2. 建表 + 权限策略（RLS）

1. 项目左侧菜单进入 **SQL Editor**。
2. 新建一个 Query，把压缩包里 `supabase/schema.sql` 的**全部内容**粘贴进去，点 Run。
   - 这一步会创建 `profiles`（账号授权表）和 `saves`（云存档表），并设置好权限规则：
     - 用户只能看到自己的授权状态，**不能**自己把自己改成"已授权"。
     - 只有已授权账号才能读写自己的云存档。
   - 还会创建一个触发器：以后任何人在你的项目里注册账号，都会自动在 `profiles` 里生成一行、默认 `is_authorized = false`。
3. 确认没有报错（如果提示"already exists"之类可以忽略，脚本里做了 `if not exists`/`drop policy if exists` 处理，可以重复执行）。

---

## 3. 建 Storage 私有桶，上传游戏引擎文件

1. 左侧菜单进入 **Storage**。
2. 点 "New bucket"，名字填 **`game-engine`**（必须完全一致，代码里写死了这个名字），**不要**勾选 "Public bucket"（一定要是私有的）。
3. 进入刚建好的 `game-engine` 桶，把压缩包里 `engine-private/` 文件夹下的 7 个文件**直接上传到桶的根目录**（不要建子文件夹）：
   ```
   textures.js
   cards.js
   storage.js
   render.js
   audio.js
   game.js
   ui.js
   ```
   这些就是真正的游戏玩法代码，以后**不会**出现在你的 GitHub 仓库里。
4. 回到 **SQL Editor**，新建一个 Query，粘贴 `supabase/storage-policies.sql` 的内容并 Run。
   - 这一步给 `game-engine` 桶加上规则："只有已授权账号才能读取里面的文件"。

以后如果你要更新游戏逻辑（改数值、修 bug），流程是：**改好 `engine-private/*.js` → 回到 Storage 页面把改动的文件重新上传覆盖同名文件即可**，客户刷新网页就能用上新版本，不需要重新部署 GitHub Pages。

---

## 4. 配置登录方式（Authentication）

1. 左侧菜单进入 **Authentication → Providers**，确认 "Email" 是开启的（默认就是开的）。
2. 左侧菜单进入 **Authentication → Settings**（或 "Email Templates" 附近的 "Confirm email" 开关，具体位置随 Supabase 版本略有不同）：
   - 如果你想让客户注册后**立刻能登录**（不需要收验证邮件点确认链接），把 "Confirm email" 关闭。对小项目、熟人客户来说这样最省事，反正客户注册完也要联系你手动开通，账号真实性不是特别关键。
   - 如果你希望邮箱地址必须验证真实有效，就保持开启，客户注册后需要先去邮箱点确认链接才能登录。
3. 不需要额外配置 SMTP 也能用 Supabase 自带的邮件发送额度做验证邮件（免费额度有限，量大了建议自己接 SMTP，属于后续优化，非必须）。

---

## 5. 把项目地址和 anon key 填进代码

1. 左侧菜单进入 **Settings → API**。
2. 复制 **Project URL**（形如 `https://xxxxx.supabase.co`）和 **anon public** 这个 key（不是 `service_role`！）。

   https://uqqjgqfgsowrmncioppg.supabase.co

   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxcWpncWZnc293cm1uY2lvcHBnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2ODU4NDQsImV4cCI6MjEwNDI2MTg0NH0.4AyKXob1wK_wSfTbiiqMdrEA100Fg3589biFZAa_BbE

3. 打开压缩包里的 `js/supabase-config.js`，替换：
   ```js
   window.SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
   window.SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLIC-KEY';
   ```
   换成你自己项目的真实值。这两个值可以放心提交到公开的 GitHub 仓库。

---

## 6. 本地先测试一遍，再发布

1. 在解压后的项目根目录（能看到 `index.html` 的那一层）打开终端，执行：
   ```bash
   python -m http.server 8000
   ```
2. 浏览器打开 `http://localhost:8000/`，应该看到登录/注册界面。
3. 用一个测试邮箱注册一个账号（如果关闭了邮箱验证，注册后会提示"请联系客服开通"）。
4. 回到 Supabase 后台 → **Table Editor → profiles**，找到刚注册的那一行，把 `is_authorized` 改成 `true`（勾选/输入 true 都行），保存。
   - 或者用 SQL Editor 执行：
     ```sql
     update public.profiles set is_authorized = true, authorized_at = now()
     where email = '你刚才注册用的邮箱';
     ```
5. 回到网页刷新（或重新登录一次），应该会看到"正在加载游戏资源"，然后正常进入游戏主菜单。
6. 玩一小段（比如移动几步、捡个装备），然后换个浏览器/无痕窗口，用同一个账号登录，确认能看到刚才的最高分/存档同步过来了。
7. 都正常之后，再进行第 7 步的正式发布。

---

## 7. 发布到 GitHub Pages

1. 新建一个 GitHub 仓库（或用你现在的仓库）。
2. 把压缩包内容上传进去，**注意：不要把 `engine-private/` 这个文件夹提交到仓库**（它只是给你上传到 Supabase Storage 用的本地素材，不应该出现在公开仓库里）。建议在仓库根目录加一个 `.gitignore`：
   ```
   engine-private/
   ```
3. 提交并推送后，进入仓库 **Settings → Pages**，Source 选你推送的分支（一般是 `main`）和根目录 `/`，保存。
4. 等待几分钟，GitHub 会给你一个形如 `https://你的用户名.github.io/仓库名/` 的地址，这就是最终发给客户的链接。
5. 用这个正式地址重新走一遍第 6 步的测试流程，确认线上环境也正常。

---

## 8. 日常运营 SOP：客户付款后怎么开通

1. 客户在你的正式网址上自己完成"注册"（邮箱+密码）。
2. 客户联系你（微信/邮件都行）并提供付款凭证。
3. 你打开 Supabase 后台 → **Table Editor → profiles**：
   - 用客户提供的邮箱搜索，找到对应那一行。
   - 把 `is_authorized` 改成 `true`（也可以顺便在 `note` 字段备注一下付款信息/日期，方便以后对账）。
4. 告诉客户"已开通，刷新页面重新登录即可"。
5. 如果客户要求退款/到期，把 `is_authorized` 改回 `false` 即可立即收回权限（客户当前已经加载到浏览器里的那一局还能继续玩到关闭页面，但刷新后就再也进不去了）。

批量操作也可以直接用 SQL（比如一次性给一批邮箱开通）：
```sql
update public.profiles set is_authorized = true, authorized_at = now()
where email in ('a@x.com','b@x.com','c@x.com');
```

查看所有已授权账号：
```sql
select email, authorized_at, note from public.profiles where is_authorized = true order by authorized_at desc;
```

---

## 9. 后续可选优化（不做也不影响现在能用）

- **更方便的管理后台**：现在开通授权要手动去 Supabase 后台改一行数据，够用但不够"傻瓜"。以后可以用 Supabase Edge Functions 做一个只有你能访问的小型管理页面（输入邮箱、点一下按钮就开通），但这需要额外写一个带 `service_role` 权限的服务端函数，涉及更多安全配置，建议客户量大了、手动操作觉得麻烦时再做。
- **接入真实支付**（微信支付/支付宝/Stripe 等）自动开通，替代人工核对付款凭证，属于更大的工程量，目前 SOP 里先用最简单可靠的人工审核方式。
- **限制同一账号多设备同时在线**：目前没有做，同一账号可以在多台设备同时登录，云存档采用"最后保存覆盖"的简单策略，两台设备同时游玩会互相覆盖存档，正常单人使用没有问题。
- **邮箱验证/找回密码页面美化**：目前用的是 Supabase 默认邮件模板和默认的 `signInWithPassword`/`signUp` 流程，找回密码功能未接入（可以后续用 `supabase.auth.resetPasswordForEmail` 补上一个"忘记密码"按钮）。

---

## 10. 压缩包内容说明

```
CardZ-Supabase/
├─ index.html              改造后的入口页面：新增登录/注册界面，底部不再直接引入游戏脚本
├─ css/
│  ├─ style.css             原样保留的游戏样式
│  └─ auth.css              新增：登录界面样式
├─ js/
│  ├─ supabase-config.js    公开配置：Supabase 项目地址 + anon key（需要你自己填）
│  ├─ loader.js              新增：登录+授权通过后，从 Supabase 私有 Storage 拉取并执行游戏引擎脚本
│  └─ auth.js                 新增：注册/登录/退出登录、授权状态检查、串联加载流程
├─ engine-private/          真正的游戏玩法代码，只上传到 Supabase Storage，不要提交到 GitHub 仓库
│  ├─ textures.js
│  ├─ cards.js
│  ├─ storage.js             已修改：新增 Supabase 云存档同步（cloudInit/自动上传/自动拉取）
│  ├─ render.js
│  ├─ audio.js
│  ├─ game.js
│  └─ ui.js                   已修改：暂停菜单新增"退出登录"按钮，新增云同步后刷新主菜单的钩子
├─ supabase/
│  ├─ schema.sql             建表 + RLS 权限策略（profiles、saves）
│  └─ storage-policies.sql   game-engine 私有桶的读取策略
└─ SOP.md                    就是你正在看的这份文档
```

代码层面的具体改动明细见压缩包里的 `CHANGES.md`。
