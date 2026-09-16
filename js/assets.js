// 从 Supabase 私有 Storage 桶（game-assets）拉取游戏素材（图片 / 音频等）。
// 和 loader.js 一样，只有登录且 profiles.is_authorized = true 的账号才能生成签名下载
// 链接，未授权账号在这一步会被 Supabase 直接拒绝（403），素材不会经由 GitHub Pages 明文分发。
//
// 关键点：本文件会在引擎脚本执行之前，给 <img>.src / <audio>.src / fetch / XMLHttpRequest
// 装一层"路径改写"拦截。引擎里原来怎么写 'assets/xxx.png' 就还怎么写，运行时会被自动
// 替换成签名 URL（或预下载后的 blob: URL），所以 textures.js / audio.js 等一般不用改。
(function(){
  'use strict';

  // ===== 可调参数 ==========================================================
  const ASSET_BUCKET   = 'game-assets'; // Supabase Storage 桶名
  const SIGN_SECONDS   = 60 * 60 * 8;   // 签名链接有效期（秒），默认 8 小时
  const PRELOAD        = true;          // true = 素材全部下载成 blob 后才算「加载完」，
                                        //   auth.js 里 enterGame() 会 await 这一步，
                                        //   所以整个游戏也要等这一步做完才会进去。
                                        // false = 只签名不下载，交给引擎自己按需请求（登录更快，但
                                        //   游戏中途第一次用到某张图时可能有个短暂加载瞬间）。
  const CONCURRENCY    = 6;             // 预下载并发数
  const SIGN_BATCH     = 100;           // 每批签名的文件数（Supabase 单次上限 100 左右）
  // =========================================================================

  const map = new Map();   // 归一化后的相对路径 -> 可用 URL
  let   installed = false;
  let   loaded = false;

  // 把各种写法归一成同一个 key：
  //   './assets/img/a.png'  'assets/img/a.png'  '/assets/img/a.png'  'img/a.png'  ->  'img/a.png'
  function norm(p){
    if(p === null || p === undefined) return '';
    let s = String(p);
    if(!s) return '';
    s = s.split('?')[0].split('#')[0];
    s = s.replace(/^[a-zA-Z]+:\/\/[^/]+/, ''); // 去掉协议和域名
    s = s.replace(/^\.\//, '').replace(/^\//, '');
    s = s.replace(/^assets\//i, '');
    return s;
  }

  // 命中素材表就返回新 URL，否则返回 null（调用方保持原值不动）
  function resolve(p){
    if(!p) return null;
    const s = String(p);
    if(s.indexOf('blob:') === 0 || s.indexOf('data:') === 0) return null;
    const hit = map.get(norm(s));
    return hit || null;
  }

  // ---------------------------------------------------------------- 拦截层
  function patchSrcProp(proto, prop){
    if(!proto) return;
    const d = Object.getOwnPropertyDescriptor(proto, prop);
    if(!d || !d.set || !d.get) return;
    Object.defineProperty(proto, prop, {
      configurable: true,
      enumerable: d.enumerable,
      get(){ return d.get.call(this); },
      set(v){ d.set.call(this, resolve(v) || v); }
    });
  }

  function installHooks(){
    if(installed) return;
    installed = true;

    // <img src> / <audio|video src> / <source src> / <img|video poster>
    if(window.HTMLImageElement)  patchSrcProp(HTMLImageElement.prototype,  'src');
    if(window.HTMLMediaElement)  patchSrcProp(HTMLMediaElement.prototype,  'src');
    if(window.HTMLSourceElement) patchSrcProp(HTMLSourceElement.prototype, 'src');
    if(window.HTMLVideoElement)  patchSrcProp(HTMLVideoElement.prototype,  'poster');

    // setAttribute('src', ...) 这种写法
    const origSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value){
      if(typeof name === 'string'){
        const n = name.toLowerCase();
        if(n === 'src' || n === 'poster' || n === 'href'){
          const r = resolve(value);
          if(r) value = r;
        }
      }
      return origSetAttr.call(this, name, value);
    };

    // fetch（比如用 fetch 读 json / 二进制素材）
    if(window.fetch){
      const origFetch = window.fetch;
      window.fetch = function(input, init){
        try{
          if(typeof input === 'string'){
            const r = resolve(input);
            if(r) input = r;
          }else if(input && typeof input.url === 'string'){
            const r = resolve(input.url);
            if(r) input = new Request(r, input);
          }
        }catch(e){}
        return origFetch.call(this, input, init);
      };
    }

    // XMLHttpRequest
    if(window.XMLHttpRequest){
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url){
        const r = resolve(url);
        const args = Array.prototype.slice.call(arguments);
        if(r) args[1] = r;
        return origOpen.apply(this, args);
      };
    }
  }

  // ---------------------------------------------------------------- 列目录
  async function listAll(sb, prefix){
    const out = [];
    let offset = 0;
    for(;;){
      const {data, error} = await sb.storage.from(ASSET_BUCKET).list(prefix, {
        limit: 100, offset, sortBy: {column: 'name', order: 'asc'}
      });
      if(error){
        throw new Error('没有权限列出素材目录（' + (prefix || '/') + '），请确认该账号已开通授权。\n' + error.message);
      }
      if(!data || !data.length) break;
      for(const item of data){
        if(!item || !item.name) continue;
        if(item.name === '.emptyFolderPlaceholder') continue;
        const path = prefix ? (prefix + '/' + item.name) : item.name;
        // 目录项的 id / metadata 为 null
        if(item.id === null || item.id === undefined || !item.metadata){
          const sub = await listAll(sb, path);
          for(const p of sub) out.push(p);
        }else{
          out.push(path);
        }
      }
      if(data.length < 100) break;
      offset += data.length;
    }
    return out;
  }

  // ---------------------------------------------------------------- 批量签名
  async function signAll(sb, paths){
    const result = [];
    for(let i = 0; i < paths.length; i += SIGN_BATCH){
      const chunk = paths.slice(i, i + SIGN_BATCH);
      const {data, error} = await sb.storage.from(ASSET_BUCKET).createSignedUrls(chunk, SIGN_SECONDS);
      if(error){
        throw new Error('获取素材下载链接失败，请确认该账号已开通授权。\n' + error.message);
      }
      for(const row of (data || [])){
        if(!row || !row.signedUrl) continue;
        // row.path 有时会带桶名前缀，统一用返回的 path
        result.push({path: row.path, url: row.signedUrl});
      }
    }
    return result;
  }

  // ---------------------------------------------------------------- 预下载
  async function preload(entries, onProgress){
    let done = 0;
    let idx = 0;
    const total = entries.length;

    async function worker(){
      for(;;){
        const my = idx++;
        if(my >= total) return;
        const e = entries[my];
        try{
          const res = await fetch(e.url, {cache: 'no-store'});
          if(!res.ok) throw new Error('HTTP ' + res.status);
          const blob = await res.blob();
          map.set(norm(e.path), URL.createObjectURL(blob));
        }catch(err){
          // 单个素材下载失败时退回签名 URL，不阻断整体加载
          map.set(norm(e.path), e.url);
          if(window.console) console.warn('[ASSETS] 预下载失败，改用在线链接：' + e.path, err);
        }
        done++;
        if(onProgress) onProgress(e.path, done, total);
      }
    }

    const workers = [];
    for(let i = 0; i < Math.min(CONCURRENCY, total); i++) workers.push(worker());
    await Promise.all(workers);
  }

  // ---------------------------------------------------------------- 入口
  async function loadAssets(sb, onProgress){
    installHooks(); // 先装拦截，保证引擎脚本一执行就能拿到正确地址

    const paths = await listAll(sb, '');
    if(!paths.length){
      loaded = true;
      return 0;
    }

    if(onProgress) onProgress('（正在获取下载链接）', 0, paths.length);
    const entries = await signAll(sb, paths);

    if(PRELOAD){
      await preload(entries, onProgress);
    }else{
      for(const e of entries) map.set(norm(e.path), e.url);
      if(onProgress) onProgress('', entries.length, entries.length);
    }

    loaded = true;
    return map.size;
  }

  // 给引擎代码用的手动接口：ASSETS.url('assets/img/a.png')
  // 命中则返回签名 / blob 地址，没命中就原样返回，直接写进 src 也安全。
  window.ASSETS = {
    url: function(p){ return resolve(p) || p; },
    has: function(p){ return map.has(norm(p)); },
    list: function(){ return Array.from(map.keys()); },
    isLoaded: function(){ return loaded; },
    bucket: ASSET_BUCKET
  };

  window.ASSET_LOADER = {loadAssets: loadAssets, installHooks: installHooks};
})();
