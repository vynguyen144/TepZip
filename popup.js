
const $=id=>document.getElementById(id);
let scanData=null, pollTimer=null;

function esc(s){return String(s??"").replace(/[&<>"]/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[m]));}
function log(msg){const d=document.createElement("div");d.textContent=`[${new Date().toLocaleTimeString()}] ${msg}`;$("log").prepend(d);}
function setBadge(text,cls="idle"){$("badge").textContent=text;$("badge").className="badge "+cls;}
function fmtSec(sec){
  sec=Math.max(0,Math.floor(sec||0));
  const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;
  return h?`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function render(st){
  if(!st)return;
  const storyTotal=st.items?.length||0;
  const rangeStart=Math.max(0,Number(st.rangeStart)||0);
  const rangeEnd=Number(st.rangeEnd)>rangeStart?Math.min(storyTotal,Number(st.rangeEnd)):storyTotal;
  const total=Math.max(0,rangeEnd-rangeStart), done=Math.min(total,st.completed||0);
  const pct=total?Math.min(100,Math.round(done/total*100)):0;
  if(document.activeElement!==$("rangeStart")) $("rangeStart").value=storyTotal?rangeStart+1:1;
  if(document.activeElement!==$("rangeEnd")) $("rangeEnd").value=storyTotal?rangeEnd:1;
  $("rangeStart").max=storyTotal||1; $("rangeEnd").max=storyTotal||1;
  $("bar").style.width=pct+"%";
  $("percent").textContent=pct+"%";
  $("count").textContent=`${done} / ${total} chương trong khoảng ${total?rangeStart+1:0}–${rangeEnd} (toàn truyện: ${storyTotal})`;
  $("statusTitle").textContent=st.statusText||"Đang chờ";
  $("current").textContent=st.currentTitle?`📖 ${st.currentTitle}`:"—";
  const elapsed=((st.finishedAt||Date.now())-(st.startedAt||Date.now()))/1000;
  $("timer").textContent=`Đã chạy: ${fmtSec(elapsed)}`;
  const remaining=Math.max(0,total-done);
  const observed=Number(st.avgChapterSec)||0;
  const perChapter=Math.max(Number(st.delaySec)||60, observed);
  $("eta").textContent=total&&remaining?`Ước tính còn: ${fmtSec(remaining*perChapter)} (ước tính, chưa tính thời gian website chặn)`:(st.state==="done"?"Ước tính còn: Hoàn tất":"Ước tính còn: —");
  $("retryBlocked").hidden=st.state!=="blocked";
  $("exportPartial").disabled=false;
  $("wait").textContent=st.waitUntil
    ?`⏳ Đang chờ đến ${new Date(st.waitUntil).toLocaleTimeString()}`
    :(st.errorText||"");

  if(st.state==="running"){
    setBadge("Đang chạy","run");
    $("start").disabled=true;
    $("start").textContent="▶ Đang chạy";
    $("pause").disabled=false;
    $("cancel").disabled=false;
  }else if(st.state==="paused"){
    setBadge("Đã tạm dừng","idle");
    $("start").disabled=false;
    $("start").textContent="▶ Tiếp tục";
    $("pause").disabled=true;
    $("cancel").disabled=false;
  }else if(st.state==="done"){
    setBadge("Hoàn tất khoảng đã chọn","ok");
    $("start").disabled=!storyTotal;
    $("start").textContent="▶ Tải khoảng khác";
    $("pause").disabled=true;
    $("cancel").disabled=false;
  }else if(st.state==="blocked"){
    setBadge("Website đã chặn","stop");
    $("start").disabled=true;
    $("pause").disabled=true;
    $("cancel").disabled=false;
  }else if(st.state==="error"){
    setBadge("Có lỗi","stop");
    $("start").disabled=false;
    $("start").textContent="↻ Thử lại";
    $("pause").disabled=true;
    $("cancel").disabled=false;
  }else{
    setBadge("Sẵn sàng","idle");
    $("start").disabled=!scanData && !total;
    $("start").textContent=done?"▶ Tiếp tục":"▶ Bắt đầu tải";
    $("pause").disabled=true;
    $("cancel").disabled=true;
  }
}
async function getState(){
  const r=await chrome.runtime.sendMessage({type:"GET_STATE"});
  render(r);
}
async function currentTab(){
  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
  return tabs[0];
}

$("scan").onclick=async()=>{
  try{
    const tab=await currentTab();
    if(!tab?.url?.startsWith("https://bhttpo.top/")){
      log("Hãy mở trang truyện trên bhttpo.top.");
      return;
    }
    const r=await chrome.tabs.sendMessage(tab.id,{type:"SCAN_CHAPTERS"});
    const saved=await chrome.runtime.sendMessage({type:"SET_SCAN",data:r});
    if(saved?.scanRejected){
      log(saved.errorText||"Có dữ liệu cũ chưa xuất.");
      alert(saved.errorText||"Xuất EPUB phần đã tải trước khi đổi truyện.");
      return;
    }
    scanData=r;
    $("story").textContent=r.storyTitle;
    $("scanInfo").textContent=`Tìm thấy ${r.items.length} chương. ${saved?.completed?`Đã giữ ${saved.completed} chương trong khoảng đã chọn.`:""}`;
    if(!saved?.rangeEnd || saved.rangeEnd>r.items.length) $("rangeEnd").value=r.items.length;
    if(!saved?.rangeStart) $("rangeStart").value=1;
    $("rangeStart").max=r.items.length; $("rangeEnd").max=r.items.length;
    $("start").disabled=!r.items.length;
    render(saved);
    log(saved?.completed?`Đã quét lại và giữ tiến độ ${saved.completed} chương.`:`Đã quét ${r.items.length} chương.`);
  }catch(e){log("Không quét được: "+e.message);}
};

$("start").onclick=async()=>{
  const st=await chrome.runtime.sendMessage({
    type:"START",
    delaySec:Number($("delay").value),
    rangeStart:Number($("rangeStart").value),
    rangeEnd:Number($("rangeEnd").value)
  });
  render(st);
  log(st.statusText||"Đã bắt đầu.");
};

$("pause").onclick=async()=>{
  const st=await chrome.runtime.sendMessage({type:"PAUSE"});
  render(st);
  log("Đã tạm dừng. Các chương đã tải vẫn được giữ lại.");
};

$("cancel").onclick=async()=>{
  if(!confirm("XÓA VĨNH VIỄN tất cả chương đã lưu trong tiện ích? Hãy xuất EPUB dự phòng trước. Thao tác này không thể hoàn tác."))return;
  const st=await chrome.runtime.sendMessage({type:"CANCEL"});
  render(st);
  log("Đã xóa dữ liệu chương theo xác nhận của bạn.");
};

$("retryBlocked").onclick=async()=>{
  if(!confirm("Chỉ thử lại nếu bạn đã chờ đủ lâu và trang truyện mở đọc bình thường trở lại. Tiện ích không vượt qua giới hạn website. Tiếp tục?"))return;
  const st=await chrome.runtime.sendMessage({type:"RETRY_BLOCKED",delaySec:Number($("delay").value)});
  render(st); log(st.statusText||"Đã yêu cầu thử lại.");
};

$("exportPartial").onclick=async()=>{
  const btn=$("exportPartial"); btn.disabled=true;
  try{
    const result=await chrome.runtime.sendMessage({type:"EXPORT_PARTIAL"});
    if(result?.exportResult?.ok) log(`Đã tạo EPUB gồm ${result.exportResult.length} chương. Tiến trình tải vẫn được giữ nguyên.`);
    else log(result?.exportResult?.error||result?.error||"Xuất EPUB thất bại.");
  }catch(e){log("Không xuất được EPUB: "+e.message);}
  finally{btn.disabled=false; await getState();}
};

chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==="local"&&changes.novelState){
    render(changes.novelState.newValue);
  }
});

(async()=>{
  const r=await chrome.runtime.sendMessage({type:"GET_STATE"});
  if(r?.items?.length){
    scanData={storyTitle:r.storyTitle,storyUrl:r.storyUrl,items:r.items};
    $("story").textContent=r.storyTitle||"Truyện";
    $("scanInfo").textContent=`${r.items.length} chương trong tiến trình. Đã lưu ${r.completed||0} chương trong khoảng đã chọn.`;
    $("rangeStart").value=(Number(r.rangeStart)||0)+1;
    $("rangeEnd").value=Number(r.rangeEnd)||r.items.length;
    $("rangeStart").max=r.items.length; $("rangeEnd").max=r.items.length;
  }
  render(r);
  pollTimer=setInterval(getState,1000);
})();

// Keep the chosen chapter range visible and validate it before starting.
for (const id of ["rangeStart","rangeEnd"]) {
  $(id).addEventListener("change",()=>{
    const total=Number($(id).max)||0;
    let value=Math.floor(Number($(id).value)||1);
    value=Math.max(1,total?Math.min(total,value):value);
    $(id).value=value;
  });
}
