function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function xhtml(title,body){let clean=String(body||"").replace(/<script[\s\S]*?<\/script>/gi,"").replace(/<style[\s\S]*?<\/style>/gi,"").replace(/<iframe[\s\S]*?<\/iframe>/gi,"").replace(/\son\w+\s*=\s*(['"]).*?\1/gi,"").replace(/\son\w+\s*=\s*[^\s>]+/gi,"");return `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" lang="vi"><head><meta charset="utf-8"/><title>${esc(title)}</title><style>body{font-family:serif;line-height:1.8;margin:5%;font-size:1em}p{margin:0 0 1em;text-indent:2em}h1{text-align:center;font-size:1.35em}</style></head><body><h1>${esc(title)}</h1><div>${clean}</div></body></html>`;}
function crc32(data){let c=0xffffffff;for(let n=0;n<data.length;n++){c^=data[n];for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0)}return(c^0xffffffff)>>>0}
function u16(n){return new Uint8Array([n&255,n>>>8&255])}function u32(n){return new Uint8Array([n&255,n>>>8&255,n>>>16&255,n>>>24&255])}
function cat(...a){let l=a.reduce((s,x)=>s+x.length,0),o=new Uint8Array(l),p=0;for(const x of a){o.set(x,p);p+=x.length}return o}
async function deflateRaw(data){
  if(typeof CompressionStream!=="function") throw new Error("Trình duyệt chưa hỗ trợ nén EPUB.");
  const stream=new Blob([data]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function zip(files){
  const e=new TextEncoder(),ls=[],cs=[];let off=0;
  for(let i=0;i<files.length;i++){
    const f=files[i],n=e.encode(f.name),d=f.data instanceof Uint8Array?f.data:e.encode(f.data),c=crc32(d);
    // EPUB requires the mimetype entry to be first and stored without compression.
    let method=0,packed=d;
    if(!(i===0&&f.name==="mimetype")){
      const compressed=await deflateRaw(d);
      if(compressed.length<d.length){method=8;packed=compressed;}
    }
    const local=cat(new Uint8Array([80,75,3,4]),u16(20),u16(0),u16(method),u16(0),u16(0),u32(c),u32(packed.length),u32(d.length),u16(n.length),u16(0),n,packed);
    ls.push(local);
    cs.push(cat(new Uint8Array([80,75,1,2]),u16(20),u16(20),u16(0),u16(method),u16(0),u16(0),u32(c),u32(packed.length),u32(d.length),u16(n.length),u16(0),u16(0),u16(0),u16(0),u16(0),u32(0),u32(off),n));
    off+=local.length;
  }
  const central=cat(...cs),body=cat(...ls,central),end=cat(new Uint8Array([80,75,5,6]),u16(0),u16(0),u16(files.length),u16(files.length),u32(central.length),u32(off),u16(0));
  return cat(body,end);
}
function safeName(s){return String(s||"Novel").replace(/[\\/:*?"<>|]+/g," ").replace(/\s+/g," ").trim().slice(0,100)||"Novel";}
chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
 if(msg.type!=="BUILD_EPUB_OFFSCREEN")return;
 (async()=>{
  try{
   const title=msg.storyTitle||"Novel", ch=msg.chapters||[], files=[];
   files.push({name:"mimetype",data:"application/epub+zip"});
   files.push({name:"META-INF/container.xml",data:`<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`});
   const manifest=[],spine=[],nav=[];
   ch.forEach((c,i)=>{const id="c"+(i+1),fn=`OEBPS/${id}.xhtml`;files.push({name:fn,data:xhtml(c.title||`Chương ${i+1}`,c.html)});manifest.push(`<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`);spine.push(`<itemref idref="${id}"/>`);nav.push(`<li><a href="${id}.xhtml">${esc(c.title||`Chương ${i+1}`)}</a></li>`)});
   files.push({name:"OEBPS/nav.xhtml",data:`<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${esc(title)}</title></head><body><nav epub:type="toc"><h1>${esc(title)}</h1><ol>${nav.join("")}</ol></nav></body></html>`});
   manifest.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);
   files.push({name:"OEBPS/content.opf",data:`<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">novel-${Date.now()}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>vi</dc:language></metadata><manifest>${manifest.join("")}</manifest><spine>${spine.join("")}</spine></package>`});
   const bytes=await zip(files), blob=new Blob([bytes],{type:"application/epub+zip"}), url=URL.createObjectURL(blob);
   // The Chrome Downloads API is not exposed in offscreen documents. Trigger
   // the download from this document using a temporary anchor instead.
   const a=document.createElement("a");
   a.href=url;
   a.download=`${safeName(title)}.epub`;
   a.style.display="none";
   document.body.appendChild(a);
   a.click();
   a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),120000);
   sendResponse({ok:true,length:ch.length});
  }catch(e){sendResponse({ok:false,error:e.message||String(e)})}
 })();
 return true;
});