
const KEY="novelState", ALARM="novel-next";
let busy=false;

const DEFAULT={
  state:"idle",statusText:"Sẵn sàng",storyTitle:"",storyUrl:"",
  items:[],completed:0,currentTitle:"",startedAt:null,finishedAt:null,
  rangeStart:0,rangeEnd:0,waitUntil:null,errorText:"",delaySec:60, lastChapterAt:null, avgChapterSec:null
};

// Chapters are stored in IndexedDB, NOT chrome.storage.local.
// This avoids chrome.storage.local quota errors when a novel contains
// many chapters / large HTML documents.
const DB_NAME="NovelDownloaderDB";
const DB_VERSION=1;
const STORE="chapters";

function dbOpen(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(STORE)){
        db.createObjectStore(STORE,{keyPath:"key"});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Không mở được IndexedDB"));
  });
}
async function dbClear(){
  const db=await dbOpen();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||new Error("Không xóa được dữ liệu chương"));
  });
  db.close();
}
async function dbPut(chapter){
  const db=await dbOpen();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(chapter);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error||new Error("Không lưu được chương"));
  });
  db.close();
}
async function dbGetAll(){
  const db=await dbOpen();
  const rows=await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readonly");
    const req=tx.objectStore(STORE).getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error||new Error("Không đọc được chương đã lưu"));
  });
  db.close();
  rows.sort((a,b)=>a.index-b.index);
  return rows;
}

async function dbCount(){
  const db=await dbOpen();
  const n=await new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readonly");
    const req=tx.objectStore(STORE).count();
    req.onsuccess=()=>resolve(req.result||0);
    req.onerror=()=>reject(req.error||new Error("Không đếm được chương đã lưu"));
  });
  db.close();
  return n;
}

// V2.0 stored every chapter inside chrome.storage.local.
// If an old V2.0 session is still there, migrate it BEFORE removing
// the large `chapters` array. This preserves the user's downloaded work.
async function migrateLegacy(){
  const raw=(await chrome.storage.local.get(KEY))[KEY];
  if(!raw) return null;

  const existing=await dbCount();
  const legacy=Array.isArray(raw.chapters)?raw.chapters:[];
  if(!legacy.length) return raw;

  // If IndexedDB already has the same number, the migration was already done.
  if(existing>=legacy.length){
    const meta={...raw};
    delete meta.chapters;
    await chrome.storage.local.set({[KEY]:meta});
    return meta;
  }

  // Write chapters one-by-one. If something fails, leave the old storage intact.
  for(let i=existing;i<legacy.length;i++){
    const c=legacy[i];
    await dbPut({
      key:`chapter-${i}`,
      index:i,
      title:c.title||`Chương ${i+1}`,
      html:c.html||"",
      url:c.url||""
    });
  }

  const meta={...raw};
  delete meta.chapters;
  await chrome.storage.local.set({[KEY]:meta});
  return meta;
}

let migrationPromise=null;
async function ensureMigration(){
  if(!migrationPromise){
    migrationPromise=migrateLegacy().catch(err=>{
      migrationPromise=null;
      throw err;
    });
  }
  return migrationPromise;
}
async function load(){
  await ensureMigration();
  return (await chrome.storage.local.get(KEY))[KEY]||structuredClone(DEFAULT);
}
async function save(st){
  // Never put chapter HTML into chrome.storage.local.
  const meta={...st};
  delete meta.chapters;
  await chrome.storage.local.set({[KEY]:meta});
}
async function patch(p){
  const st=await load();
  Object.assign(st,p);
  await save(st);
  return st;
}
async function alarm(delaySec){
  await chrome.alarms.clear(ALARM);
  const safe=Math.max(30,Number(delaySec)||120);
  await chrome.alarms.create(ALARM,{delayInMinutes:safe/60,persistAcrossSessions:true});
}
function looksBlocked(text,status){
  return status===429 || status===403 ||
    /tạm khóa quyền đọc|chuyển chương quá nhanh|bảo vệ nội dung khỏi hoạt động tải tự động|too many requests|rate limit/i.test(text||"");
}
function escapeXml(s){
  return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function ensureOffscreen(){
  const has=await chrome.offscreen.hasDocument?.();
  if(has)return;
  await chrome.offscreen.createDocument({
    url:"offscreen.html",
    reasons:["BLOBS"],
    justification:"Tạo Blob EPUB tạm thời và gửi cho Downloads API."
  });
}
async function makeEpub(st){
  await ensureOffscreen();
  const chapters=await dbGetAll();
  const r=await chrome.runtime.sendMessage({
    type:"BUILD_EPUB_OFFSCREEN",
    storyTitle:st.storyTitle,
    chapters
  });
  return r;
}

async function processNext(){
  if(busy)return;
  busy=true;
  try{
    let st=await load();
    if(st.state!=="running")return;
    const allItems=Array.isArray(st.items)?st.items:[];
    const start=Math.max(0,Math.min(allItems.length,Number(st.rangeStart)||0));
    const end=Math.max(start,Math.min(allItems.length,Number(st.rangeEnd)||allItems.length));
    if(end<=start) throw new Error("Khoảng chương không hợp lệ. Hãy chọn chương bắt đầu/kết thúc rồi bấm tải.");
    const saved=await dbGetAll();
    const savedByIndex=new Map(saved.map(c=>[Number(c.index),c]));
    const savedInRange=[];
    for(let i=start;i<end;i++){
      const c=savedByIndex.get(i);
      if(c && c.url===allItems[i]?.url) savedInRange.push(i);
    }
    st.completed=savedInRange.length;
    const nextIdx=(()=>{for(let i=start;i<end;i++){const c=savedByIndex.get(i);if(!c||c.url!==allItems[i]?.url)return i;}return -1;})();
    if(nextIdx===-1){
      // Completing a range must NOT force an EPUB export. The user may start
      // another range immediately; exporting is an explicit separate action.
      st.state="done";
      st.statusText=`✅ Đã hoàn tất khoảng chương ${start+1}–${end}. Bạn có thể chọn khoảng tiếp theo hoặc xuất EPUB khi muốn.`;
      st.finishedAt=Date.now(); st.waitUntil=null; st.errorText="";
      await save(st); return;
    }
    const idx=nextIdx, item=allItems[idx];
    st.currentTitle=item.title||`Chương ${idx+1}`;
    st.statusText=`📥 Đang tải chương ${idx+1}/${allItems.length} (khoảng ${start+1}–${end})`;
    st.waitUntil=null; st.errorText=""; await save(st);
    let res;
    try{res=await fetch(item.url,{credentials:"include",redirect:"follow",cache:"no-store"});}
    catch(e){st.state="error";st.statusText="❌ Lỗi mạng";st.errorText=e.message;await save(st);return;}
    const text=await res.text();
    if(looksBlocked(text,res.status)){
      st.state="blocked";st.statusText=`🛑 Website đã giới hạn truy cập (HTTP ${res.status})`;
      st.errorText="Đã dừng. Hãy chờ website cho phép đọc bình thường rồi mới thử lại thủ công.";await save(st);return;
    }
    if(!res.ok){st.state="error";st.statusText=`❌ HTTP ${res.status}`;st.errorText=`Không tải được ${item.title}`;await save(st);return;}
    const title=(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]||item.title).replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
    const bodyMatch=text.match(/<(article|main|div)[^>]*(?:class|id)=["'][^"']*(?:chapter|reading|content)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i);
    let body=bodyMatch?bodyMatch[2]:"";
    if(!body){const m=text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);body=m?m[1]:text;}
    const chapterFinishedAt=Date.now();
    const elapsedSec=st.lastChapterAt?(chapterFinishedAt-st.lastChapterAt)/1000:null;
    const priorAvg=Number(st.avgChapterSec)||0;
    const avgChapterSec=elapsedSec&&elapsedSec>0?(priorAvg?priorAvg*0.7+elapsedSec*0.3:elapsedSec):priorAvg;
    await dbPut({key:`chapter-${idx}`,index:idx,title,html:body,url:item.url,savedAt:chapterFinishedAt});
    st=await load();
    const savedNow=await dbGetAll();
    st.completed=savedNow.filter(c=>Number(c.index)>=start&&Number(c.index)<end&&c.url===allItems[Number(c.index)]?.url).length;
    st.lastChapterAt=chapterFinishedAt;st.avgChapterSec=avgChapterSec;
    st.statusText=`✓ Đã lưu chương ${idx+1}. ${st.completed}/${end-start} chương trong khoảng đã chọn`;
    await save(st);
    if(st.completed>=end-start){
      // Do not open a Save As/download flow automatically at range completion.
      // Keep progress visible and let the user choose the next range.
      st.state="done";
      st.statusText=`✅ Đã hoàn tất khoảng chương ${start+1}–${end}. Đã lưu ${savedNow.length} chương tổng cộng. Chọn khoảng tiếp theo hoặc xuất EPUB.`;
      st.finishedAt=Date.now();st.waitUntil=null;st.errorText="";await save(st);return;
    }
    st=await load(); const delay=Math.max(30,Number(st.delaySec)||60);
    st.waitUntil=Date.now()+delay*1000;st.statusText=`⏳ Đã lưu chương ${idx+1}. Chờ trước chương tiếp theo...`;
    await save(st);await alarm(delay);
  }catch(e){const st=await load();st.state="error";st.statusText="❌ Lỗi";st.errorText=e?.message||String(e);await save(st);}
  finally{busy=false;}
}
chrome.alarms.onAlarm.addListener(async a=>{
  if(a.name===ALARM)await processNext();
});

chrome.runtime.onInstalled.addListener(async()=>{
  const st=await load();
  if(!st.state)await save(DEFAULT);
});

chrome.runtime.onMessage.addListener((msg,sender,send)=>{
  (async()=>{
    try{
      if(msg.type==="GET_STATE"){
        send(await load());
        return;
      }

      if(msg.type==="SET_SCAN"){
        const d=msg.data, old=await load(), saved=await dbGetAll();
        const sameStory=!!old.storyUrl&&old.storyUrl===d.storyUrl;
        if(saved.length&&!sameStory){
          send({...old,scanRejected:true,statusText:"Có dữ liệu truyện trước chưa xuất EPUB",errorText:"Hãy xuất EPUB đã lưu trước khi đổi truyện. Quét lại không tự xóa dữ liệu."});return;
        }
        const items=Array.isArray(d.items)?d.items:[];
        const matched=saved.filter(c=>items[Number(c.index)]&&items[Number(c.index)].url===c.url);
        let rangeStart=0,rangeEnd=items.length;
        if(sameStory){rangeStart=Math.max(0,Number(old.rangeStart)||0);rangeEnd=Number(old.rangeEnd)>rangeStart?Math.min(items.length,Number(old.rangeEnd)):items.length;}
        const selectedSaved=matched.filter(c=>Number(c.index)>=rangeStart&&Number(c.index)<rangeEnd).length;
        const st={...old,storyTitle:d.storyTitle||old.storyTitle,storyUrl:d.storyUrl,items,rangeStart,rangeEnd,
          completed:selectedSaved,state:"paused",statusText:`Đã quét ${items.length} chương. Giữ lại ${matched.length} chương đã lưu.`,
          errorText:"",waitUntil:null,finishedAt:null};
        await save(st);send(st);return;
      }

      if(msg.type==="START"){
        let st=await load();
        if(!st.items?.length)throw new Error("Chưa quét chương.");
        if(st.state==="blocked")throw new Error("Website đã chặn tiến trình này. Hãy dùng nút Thử lại sau khi xác nhận website đã cho phép truy cập.");
        const startInput=Number.isFinite(Number(msg.rangeStart))?Number(msg.rangeStart)-1:(Number(st.rangeStart)||0);
        const endInput=Number.isFinite(Number(msg.rangeEnd))?Number(msg.rangeEnd):(Number(st.rangeEnd)||st.items.length);
        const rangeStart=Math.max(0,Math.min(st.items.length,startInput));
        const rangeEnd=Math.max(0,Math.min(st.items.length,endInput));
        if(rangeEnd<=rangeStart)throw new Error("Khoảng chương không hợp lệ. Chương kết thúc phải lớn hơn hoặc bằng chương bắt đầu.");
        st.rangeStart=rangeStart;st.rangeEnd=rangeEnd;
        const saved=await dbGetAll();
        st.completed=saved.filter(c=>Number(c.index)>=rangeStart&&Number(c.index)<rangeEnd&&c.url===st.items[Number(c.index)]?.url).length;
        st.delaySec=Math.max(30,Number(msg.delaySec)||60);st.state="running";
        st.statusText=`▶ Tải khoảng chương ${rangeStart+1}–${rangeEnd}`;st.startedAt=st.startedAt||Date.now();st.finishedAt=null;
        st.errorText="";st.waitUntil=null;await save(st);await chrome.alarms.clear(ALARM);await processNext();send(await load());return;
      }

      if(msg.type==="PAUSE"){
        await chrome.alarms.clear(ALARM);
        const st=await patch({
          state:"paused",
          statusText:"⏸ Đã tạm dừng — chương đã tải vẫn được giữ lại",
          waitUntil:null
        });
        send(st);
        return;
      }

      if(msg.type==="RETRY" || msg.type==="RETRY_BLOCKED"){
        let st=await load();
        if(msg.type==="RETRY" && st.state!=="error")throw new Error("Không có lỗi cần thử lại.");
        if(msg.type==="RETRY_BLOCKED" && st.state!=="blocked")throw new Error("Tiến trình không ở trạng thái bị chặn.");
        st.state="running";
        if(msg.delaySec) st.delaySec=Math.max(30,Number(msg.delaySec)||60);
        st.statusText=`↻ Thử lại trong khoảng chương ${Number(st.rangeStart||0)+1}–${Number(st.rangeEnd||st.items.length)}`;
        st.errorText="";
        await save(st);
        await processNext();
        send(await load());
        return;
      }

      if(msg.type==="EXPORT_PARTIAL") {
        const st=await load();
        const chapters=await dbGetAll();
        if(!chapters.length) throw new Error("Chưa có chương nào được lưu để xuất.");
        const result=await makeEpub({...st, storyTitle:st.storyTitle||"Truyện đã lưu"});
        // Export is independent of the download state and must not reset it.
        send({exportResult:result, savedCount:chapters.length, state:st.state});
        return;
      }

      if(msg.type==="CANCEL"){
        await chrome.alarms.clear(ALARM);
        await dbClear();
        const st={...DEFAULT};
        await save(st);
        send(st);
        return;
      }

      if(msg.type==="CLEAR_SAVED_CHAPTERS"){
        await dbClear();
        const st=await load();
        st.completed=0;
        st.currentTitle="";
        st.state="idle";
        st.statusText="Đã xóa các chương đã lưu";
        st.errorText="";
        await save(st);
        send(st);
        return;
      }
    }catch(e){
      send({
        state:"error",
        statusText:"❌ "+e.message,
        errorText:e.message
      });
    }
  })();
  return true;
});
