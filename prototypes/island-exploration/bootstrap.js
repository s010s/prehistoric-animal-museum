import('./main.js').catch(error=>{
 console.error(error)
 const overlay=document.querySelector('#loading');overlay.classList.remove('done');overlay.removeAttribute('aria-hidden')
 overlay.querySelector('strong').textContent='海岛暂时没有载入成功'
 document.querySelector('#load-detail').textContent='请检查连接后刷新；也可以换一个支持 WebGL 2 的浏览器。'
 const button=document.createElement('button');button.textContent='重新载入';button.onclick=()=>location.reload();overlay.append(button)
})
