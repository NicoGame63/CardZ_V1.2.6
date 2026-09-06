// 从 Supabase 私有 Storage 桶（game-engine）按顺序拉取并执行游戏引擎脚本。
// 只有登录且 profiles.is_authorized = true 的账号，Storage 的 RLS 策略才会允许
// 生成签名下载链接；未授权账号在这一步会直接被 Supabase 拒绝（403），
// 因此游戏真正的玩法代码不会经由 GitHub Pages 明文分发。
(function(){
  'use strict';

  // 引擎文件的加载顺序很重要：后面的文件会用到前面文件挂在 window 上的对象
  // （TEX / CARDS / STORE / RENDER / AUDIO / GAME），必须严格顺序执行。
  const ENGINE_BUCKET='game-engine';
  const ENGINE_FILES=['textures.js','cards.js','storage.js','render.js','audio.js','game.js','ui.js'];

  async function loadEngine(supabase,onProgress){
    for(let i=0;i<ENGINE_FILES.length;i++){
      const name=ENGINE_FILES[i];
      if(onProgress) onProgress(name,i+1,ENGINE_FILES.length);
      const {data,error}=await supabase.storage.from(ENGINE_BUCKET).createSignedUrl(name,120);
      if(error||!data||!data.signedUrl){
        throw new Error('没有权限获取游戏文件（'+name+'），请确认该账号已开通授权。'+(error?'\n'+error.message:''));
      }
      const res=await fetch(data.signedUrl,{cache:'no-store'});
      if(!res.ok) throw new Error('下载游戏文件失败：'+name+'（HTTP '+res.status+'）');
      const code=await res.text();
      await execAsScript(code,name);
    }
  }

  function execAsScript(code,name){
    return new Promise((resolve,reject)=>{
      const blob=new Blob([code],{type:'application/javascript'});
      const url=URL.createObjectURL(blob);
      const s=document.createElement('script');
      s.src=url;
      s.dataset.engineFile=name;
      s.onload=()=>{ URL.revokeObjectURL(url); resolve(); };
      s.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('执行游戏文件失败：'+name)); };
      document.body.appendChild(s);
    });
  }

  window.ENGINE_LOADER={loadEngine};
})();
