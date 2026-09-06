(function(){
  'use strict';

  if(!window.supabase || !window.SUPABASE_URL || window.SUPABASE_URL.indexOf('YOUR-PROJECT-REF')>=0){
    // 还没有配置 supabase-config.js，直接提示，不再往下走
    document.addEventListener('DOMContentLoaded',()=>{
      setStatus('尚未配置 Supabase（请编辑 js/supabase-config.js）','err');
    });
    return;
  }

  const sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  window.SB = sb; // 方便调试 / 供引擎内 storage.js 使用

  let mode='login'; // 'login' | 'signup'
  const $=id=>document.getElementById(id);

  function setStatus(msg,cls){
    const el=$('auth-status');
    if(!el) return;
    el.textContent=msg||'';
    el.className='auth-status'+(cls?(' '+cls):'');
  }

  function showAuthScreen(msg,cls){
    $('screen-auth').classList.add('active');
    if(msg!==undefined) setStatus(msg,cls);
  }

  function hideAuthScreen(){
    $('screen-auth').classList.remove('active');
  }

  async function checkAuthorized(user){
    const {data,error}=await sb.from('profiles').select('is_authorized').eq('id',user.id).maybeSingle();
    if(error){ return {ok:false,reason:'查询授权状态失败：'+error.message}; }
    if(!data){ return {ok:false,reason:'账号资料尚未初始化，请稍后重试或联系客服。'}; }
    return {ok:!!data.is_authorized,reason:data.is_authorized?'':'该账号尚未开通游玩权限，请联系客服提供付款凭证后开通。'};
  }

  async function enterGame(user){
    showAuthScreen('正在加载游戏资源，请稍候…');
    try{
      await window.ENGINE_LOADER.loadEngine(sb,(name,i,total)=>{
        setStatus('正在加载游戏资源 ('+i+'/'+total+')…');
      });
      hideAuthScreen();
      // 引擎加载完成后，STORE / GAME / UI 均已挂载到 window 上
      if(window.STORE && window.STORE.cloudInit){
        await window.STORE.cloudInit(sb,user.id);
        if(window.UI_REFRESH_AFTER_CLOUD_SYNC) window.UI_REFRESH_AFTER_CLOUD_SYNC();
      }
      const acc=$('menu-account');
      if(acc) acc.textContent='已登录：'+user.email;
    }catch(e){
      showAuthScreen('加载游戏失败：'+e.message,'err');
    }
  }

  async function boot(){
    setStatus('正在连接…');
    const {data:{session}}=await sb.auth.getSession();
    if(session && session.user){
      const {ok,reason}=await checkAuthorized(session.user);
      if(ok){ await enterGame(session.user); return; }
      showAuthScreen('已登录：'+session.user.email+'\n'+reason,'err');
      return;
    }
    showAuthScreen('请登录，或注册新账号后联系客服开通。');
  }

  function wireTabs(){
    document.querySelectorAll('.auth-tab').forEach(tab=>{
      tab.onclick=()=>{
        document.querySelectorAll('.auth-tab').forEach(t=>t.classList.remove('active'));
        tab.classList.add('active');
        mode=tab.dataset.mode;
        $('auth-submit').textContent=mode==='signup'?'注册':'登录';
        setStatus('');
      };
    });
  }

  function wireForm(){
    $('auth-form').addEventListener('submit',async(e)=>{
      e.preventDefault();
      const email=$('auth-email').value.trim();
      const password=$('auth-password').value;
      if(!email||!password) return;
      $('auth-submit').disabled=true;
      try{
        if(mode==='signup'){
          setStatus('正在注册…');
          const {data,error}=await sb.auth.signUp({email,password});
          if(error) throw error;
          if(data.session){
            // 项目关闭了邮箱确认，注册即登录
            setStatus('注册成功，请联系客服提供付款凭证以开通游玩权限。','ok');
          }else{
            setStatus('注册成功！请前往邮箱完成验证后再登录，然后联系客服开通游玩权限。','ok');
          }
        }else{
          setStatus('正在登录…');
          const {data,error}=await sb.auth.signInWithPassword({email,password});
          if(error) throw error;
          const {ok,reason}=await checkAuthorized(data.user);
          if(ok){ await enterGame(data.user); return; }
          setStatus(reason,'err');
        }
      }catch(err){
        setStatus(err.message||'操作失败，请重试','err');
      }finally{
        $('auth-submit').disabled=false;
      }
    });
  }

  window.AUTH={
    logout: async()=>{
      try{ await sb.auth.signOut(); }catch(e){}
      location.reload();
    }
  };

  document.addEventListener('DOMContentLoaded',()=>{
    wireTabs();
    wireForm();
    boot();
  });
})();
