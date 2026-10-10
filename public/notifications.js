(() => {
 const toast=document.getElementById('toast');let timer;
 const show=(text,type)=>{
  clearTimeout(timer);toast.textContent=text;toast.className='toast '+type;toast.hidden=false;
  timer=setTimeout(()=>{toast.hidden=true;toast.textContent='';},type==='error'?6000:3500);
 };
 window.MasterNotify={success:text=>show(text,'success'),error:text=>show(text,'error'),clear:()=>{clearTimeout(timer);toast.hidden=true;toast.textContent='';}};
})();
