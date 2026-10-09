function cleanTitle(s){
  return (s||"").replace(/\s+/g," ").trim();
}
function scan(){
  const anchors=[...document.querySelectorAll("a[href]")];
  const seen=new Set(), items=[];
  for(const a of anchors){
    const href=new URL(a.href,location.href);
    if(href.origin!==location.origin) continue;
    const text=cleanTitle(a.innerText||a.textContent);
    const hay=(text+" "+href.pathname).toLowerCase();
    const looks=/(chương|chuong|chapter|chap[-_ ]?\d+)/i.test(hay);
    if(!looks) continue;
    if(seen.has(href.href)) continue;
    seen.add(href.href);
    items.push({url:href.href,title:text||href.pathname.split("/").pop()||"Chương"});
  }
  // Try to sort numerically by chapter number while preserving order for ties.
  items.forEach((x,i)=>x._i=i);
  items.sort((a,b)=>{
    const na=(a.title.match(/(?:chương|chuong|chapter|chap)[^\d]{0,10}(\d+)/i)||a.url.match(/(?:chapter|chap|chuong|chuong-)(\d+)/i)||[])[1];
    const nb=(b.title.match(/(?:chương|chuong|chapter|chap)[^\d]{0,10}(\d+)/i)||b.url.match(/(?:chapter|chap|chuong|chuong-)(\d+)/i)||[])[1];
    if(na!=null && nb!=null) return Number(na)-Number(nb);
    if(na!=null) return -1;
    if(nb!=null) return 1;
    return a._i-b._i;
  });
  return {
    storyTitle: cleanTitle(document.querySelector("h1")?.innerText || document.title || "Truyện"),
    storyUrl: location.href,
    items: items.map(({url,title})=>({url,title}))
  };
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  if(msg?.type==="SCAN_CHAPTERS"){
    sendResponse(scan());
  }
  if(msg?.type==="EXTRACT_CURRENT"){
    const title=cleanTitle(document.querySelector("h1")?.innerText || document.title || "Chương");
    const bodySelectors=[
      "article","main","[class*='chapter-content']","[class*='chapter_content']",
      "[class*='chapter-content']","[class*='reading-content']","[class*='story-content']",
      "[class*='content-chapter']","[id*='chapter-content']"
    ];
    let el=null, score=-1;
    for(const sel of bodySelectors){
      for(const n of document.querySelectorAll(sel)){
        const t=cleanTitle(n.innerText);
        if(t.length>score){score=t.length;el=n;}
      }
    }
    if(!el){
      const candidates=[...document.querySelectorAll("div,p,section")];
      for(const n of candidates){
        const t=cleanTitle(n.innerText);
        if(t.length>score){score=t.length;el=n;}
      }
    }
    const lockText=(document.body?.innerText||"").slice(0,12000);
    const locked=/tạm khóa quyền đọc|chuyển chương quá nhanh|bảo vệ nội dung khỏi hoạt động tải tự động|too many requests|rate limit|429/i.test(lockText);
    const paragraphs=el?[...el.querySelectorAll("p,div")].map(x=>cleanTitle(x.innerText)).filter(Boolean):[];
    const html=el?el.innerHTML:"";
    sendResponse({title,html,text:cleanTitle(el?.innerText||""),locked,url:location.href});
  }
  return true;
});