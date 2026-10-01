"use strict";

const DATA_PATHS = {
  cards: "./data/cards.json?v=04pwa2",
  words: "./data/words.json?v=04pwa2",
  cardWords: "./data/card_words.json?v=04pwa2",
  sentences: "./data/sentences.json?v=04pwa2"
};
const STORE_KEY = "cantoCards.progress.v1";
const SETTINGS_KEY = "cantoCards.settings.v1";
const DAY = 86400000;

let CARDS = [], CARD_MAP = new Map(), CHAR_MAP = new Map();
let WORDS = new Map(), CARD_WORDS = {}, SENTENCES = new Map();
let DECKS = {starter:[], core:[], practical:[], all:[]};
let progress = {}, settings = {};
let session = [], cursor = 0, current = null, revealed = false, noteEditingId = null;
let cantoneseVoice = null;
let swRegistration = null, deferredInstallPrompt = null, reloadingForUpdate = false;

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, m => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const shuffle = a => { a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };
const sample = (a,n) => shuffle(a).slice(0,n);
function loadJSON(key, fallback){try{return JSON.parse(localStorage.getItem(key)) ?? fallback}catch{return fallback}}
function saveJSON(key,val){localStorage.setItem(key,JSON.stringify(val))}
function toast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");clearTimeout(t._tm);t._tm=setTimeout(()=>t.classList.remove("show"),1900)}

async function fetchJSON(url){const r=await fetch(url,{cache:"no-cache"});if(!r.ok)throw new Error(`${url} · HTTP ${r.status}`);return r.json()}

async function init(){
  try{
    $("loadingText").textContent="載入字音、例詞與例句…";
    const [cardsObj, wordsObj, cardWordsObj, sentencesObj] = await Promise.all([
      fetchJSON(DATA_PATHS.cards), fetchJSON(DATA_PATHS.words), fetchJSON(DATA_PATHS.cardWords), fetchJSON(DATA_PATHS.sentences)
    ]);
    CARDS = cardsObj.cards;
    CARD_MAP = new Map(CARDS.map(c=>[c.card_id,c]));
    CHAR_MAP = new Map();
    for(const c of CARDS){if(!CHAR_MAP.has(c.char))CHAR_MAP.set(c.char,[]);CHAR_MAP.get(c.char).push(c)}
    WORDS = new Map(wordsObj.words.map(w=>[w.word_id,w]));
    CARD_WORDS = cardWordsObj.cards;
    SENTENCES = new Map(sentencesObj.sentences.map(s=>[s.word_id,s]));

    progress = loadJSON(STORE_KEY,{});
    settings = {...{size:10,deck:"auto",sentenceJyutpingDefault:false},...loadJSON(SETTINGS_KEY,{})};
    migrateProgressV03();
    buildDecks();
    bindUI();
    applySettings();
    updateDashboard();
    $("multiCount").textContent = new Set(CARDS.filter(c=>c.reading_count>1).map(c=>c.char)).size.toLocaleString();
    refreshVoices();
    if("speechSynthesis" in window) window.speechSynthesis.addEventListener?.("voiceschanged",refreshVoices);
    initPWA();
    $("loadingScreen").classList.add("is-hidden");
    $("appShell").classList.remove("is-hidden");
  }catch(err){
    console.error(err);
    $("loadingText").innerHTML=`資料載入失敗。<br><small>${esc(err.message)}</small><br><br>請透過網站或本機 HTTP 伺服器開啟，而不是直接雙擊 HTML。`;
  }
}

function migrateProgressV03(){
  let changed=false;
  for(const [oldId,val] of Object.entries({...progress})){
    if(CARD_MAP.has(oldId))continue;
    const m=oldId.match(/^(\d{4})-([a-z]+[1-6])-\d+$/i);
    if(!m)continue;
    const newId=`c${m[1]}-${m[2].toLowerCase()}`;
    if(!CARD_MAP.has(newId))continue;
    if(!progress[newId]) progress[newId]=val;
    else{
      const a=progress[newId], b=val;
      progress[newId]={...a,...((b.last||0)>(a.last||0)?b:{}),reps:Math.max(a.reps||0,b.reps||0),lapses:Math.max(a.lapses||0,b.lapses||0),level:Math.max(a.level||0,b.level||0),note:a.note||b.note||""};
    }
    delete progress[oldId]; changed=true;
  }
  if(changed){saveJSON(STORE_KEY,progress);settings.progressIdMigrated=true;saveJSON(SETTINGS_KEY,settings)}
}

function cardMetrics(c){
  const ids=(CARD_WORDS[c.card_id]?.phrase_word_ids)||[];
  const ws=ids.map(id=>WORDS.get(id)).filter(Boolean);
  return {
    core:ws.some(w=>w.core),
    maxFreq:Math.max(0,...ws.map(w=>Number(w.frequency)||0)),
    maxRank:Math.max(0,...ws.map(w=>Number(w.rank_score)||0)),
    examples:ids.length
  };
}
function buildDecks(){
  const scored=CARDS.map(c=>({c,m:cardMetrics(c)}));
  const scoreSort=(a,b)=>(Number(b.m.core)-Number(a.m.core))||(b.m.maxFreq-a.m.maxFreq)||(b.m.maxRank-a.m.maxRank)||a.c.char.localeCompare(b.c.char,"zh-Hant");
  const starter=[...scored].sort(scoreSort).filter(x=>x.m.examples>0).slice(0,170).map(x=>x.c);
  const core=scored.filter(x=>x.m.core||x.m.maxFreq>=1000).sort(scoreSort).map(x=>x.c);
  const practical=scored.filter(x=>x.m.core||x.m.maxFreq>=45).sort(scoreSort).map(x=>x.c);
  DECKS={starter,core,practical,all:CARDS};
}

function pOf(id){return progress[id]||{level:0,reps:0,lapses:0,interval:0,due:0,last:0,note:""}}
function saveProgress(){saveJSON(STORE_KEY,progress);updateDashboard()}
function saveSettings(){saveJSON(SETTINGS_KEY,settings)}
function fmtLevel(p){if(!p.reps)return["未學",""];if(p.level===1)return["易錯","l1"];if(p.level===2)return["學習中",""];if(p.level===3)return["會",""];if(p.level>=4)return["很熟",""];return["未學",""]}
function mastery(cards){return cards.length?cards.filter(c=>pOf(c.card_id).level>=3).length/cards.length:0}
function autoDeck(){if(mastery(DECKS.starter)<.70)return"starter";if(mastery(DECKS.core)<.72)return"core";if(mastery(DECKS.practical)<.68)return"practical";return"all"}
function resolvedDeck(){return settings.deck==="auto"?autoDeck():settings.deck}
function deckCards(name=resolvedDeck()){return DECKS[name]||CARDS}
function deckName(name=resolvedDeck()){return ({starter:"起步高頻",core:"日常核心",practical:"實用常用",all:"完整字表"})[name]||"完整字表"}
function progressiveUnseen(cards){
  const unseen=cards.filter(c=>!pOf(c.card_id).reps);
  const order=new Map(cards.map((c,i)=>[c.card_id,i]));
  unseen.sort((a,b)=>(order.get(a.card_id)-order.get(b.card_id)));
  const learned=cards.length-unseen.length, stage=resolvedDeck();
  const base=stage==="starter"?55:stage==="core"?90:stage==="practical"?140:210;
  return shuffle(unseen.slice(0,Math.min(unseen.length,base+Math.floor(learned*.55))));
}

function updateDashboard(){
  const now=Date.now();let learned=0,known=0,mist=0,due=0;
  for(const c of CARDS){const p=pOf(c.card_id);if(p.reps){learned++;if(p.level>=3)known++;if(p.lapses>0)mist++;if(p.due<=now)due++}}
  $("learnedCount").textContent=learned.toLocaleString();$("knownCount").textContent=known.toLocaleString();$("mistakeCount").textContent=mist.toLocaleString();$("dueCount").textContent=due.toLocaleString();
  const deck=deckCards(), mastered=deck.filter(c=>pOf(c.card_id).level>=3).length, mode=resolvedDeck();
  $("progressText").textContent=`${mastered.toLocaleString()} / ${deck.length.toLocaleString()}`;
  $("progressBar").style.width=`${deck.length?mastered/deck.length*100:0}%`;
  $("deckTitle").textContent=`${deckName(mode)}掌握進度`;
  $("deckHint").textContent=settings.deck==="auto"?`自動漸進 · 當前 ${deckName(mode)}`:`手動字池 · ${deckName(mode)}`;
}

function bindUI(){
  document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  document.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.go)));
  $("startToday").onclick=()=>startSession("today");$("startRandom").onclick=()=>startSession("random");$("quickRandom").onclick=()=>startSession("random",10);$("emptyStart").onclick=()=>startSession("random",10);$("startMistakes").onclick=()=>startSession("mistakes");$("studyMistakesPage").onclick=()=>startSession("mistakes");
  $("revealBtn").onclick=revealCurrent;document.querySelectorAll(".rate").forEach(b=>b.onclick=()=>rate(Number(b.dataset.rating)));
  $("knownFilter").oninput=renderKnown;$("mistakeFilter").oninput=renderMistakes;$("searchInput").oninput=doSearch;$("searchLimit").onchange=doSearch;
  $("openNote").onclick=()=>current&&openNote(current.card_id);$("closeNote").onclick=closeNote;$("cancelNote").onclick=closeNote;$("saveNote").onclick=saveNote;
  $("noteModal").onclick=e=>{if(e.target.id==="noteModal")closeNote()};
  $("groupSize").onchange=e=>{settings.size=Number(e.target.value);saveSettings();$("defaultSize").value=e.target.value};
  $("defaultSize").onchange=e=>{settings.size=Number(e.target.value);saveSettings();$("groupSize").value=e.target.value};
  $("deckMode").onchange=e=>setDeck(e.target.value);$("defaultDeck").onchange=e=>setDeck(e.target.value);
  $("sentenceJyutpingDefault").onchange=e=>{settings.sentenceJyutpingDefault=e.target.checked;saveSettings()};
  $("refreshVoices").onclick=()=>{refreshVoices();toast(cantoneseVoice?"已找到粵語語音":"未檢測到粵語語音")};
  $("exportBtn").onclick=exportProgress;$("importInput").onchange=importProgress;$("resetBtn").onclick=resetProgress;
  $("installAppBtn").onclick=installPWA;$("checkUpdateBtn").onclick=checkPWAUpdate;$("applyUpdateBtn").onclick=applyPWAUpdate;$("updateBannerBtn").onclick=applyPWAUpdate;
  $("speakBtn").onclick=()=>{const text=primarySpeechText();if(text)speakText(text)};
  document.addEventListener("keydown",e=>{if($("noteModal").classList.contains("show"))return;if(!$("study").classList.contains("active")||!current)return;if(e.code==="Space"&&!revealed){e.preventDefault();revealCurrent()}if(revealed&&["1","2","3","4"].includes(e.key))document.querySelector(`.rate[data-rating="${Number(e.key)-1}"]`)?.click()});
}
function showView(id){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===id));document.querySelectorAll(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===id));
  if(id==="home")updateDashboard();if(id==="known")renderKnown();if(id==="mistakes")renderMistakes();if(id==="search")setTimeout(()=>$("searchInput").focus(),60);window.scrollTo({top:0,behavior:"smooth"});
}
function applySettings(){
  settings.size=Number(settings.size)||10;settings.deck=settings.deck||"auto";
  $("groupSize").value=String(settings.size);$("defaultSize").value=String(settings.size);$("deckMode").value=settings.deck;$("defaultDeck").value=settings.deck;$("sentenceJyutpingDefault").checked=!!settings.sentenceJyutpingDefault;
}
function setDeck(v){settings.deck=v;saveSettings();$("deckMode").value=v;$("defaultDeck").value=v;updateDashboard()}
function getSize(){return Number($("groupSize").value||settings.size||10)}

function startSession(mode,size=getSize()){
  let pool=[];const now=Date.now(),eligible=deckCards();
  if(mode==="random"){
    const unseen=progressiveUnseen(eligible),seen=eligible.filter(c=>pOf(c.card_id).reps);const nNew=Math.min(unseen.length,Math.max(1,Math.ceil(size*.7)));
    pool=[...unseen.slice(0,nNew),...sample(seen,size-nNew)];if(pool.length<size){const ids=new Set(pool.map(c=>c.card_id));pool.push(...unseen.filter(c=>!ids.has(c.card_id)).slice(0,size-pool.length))}pool=shuffle(pool);
  }else if(mode==="mistakes"){
    pool=CARDS.filter(c=>pOf(c.card_id).lapses>0).sort((a,b)=>(pOf(b.card_id).lapses-pOf(a.card_id).lapses)||(pOf(a.card_id).due-pOf(b.card_id).due)).slice(0,size);
  }else{
    const due=CARDS.filter(c=>{const p=pOf(c.card_id);return p.reps&&p.due<=now}).sort((a,b)=>(pOf(b.card_id).lapses-pOf(a.card_id).lapses)||(pOf(a.card_id).due-pOf(b.card_id).due));
    pool=[...due.slice(0,size)];if(pool.length<size)pool.push(...progressiveUnseen(eligible).slice(0,size-pool.length));if(pool.length<size){const ids=new Set(pool.map(c=>c.card_id));pool.push(...sample(eligible.filter(c=>!ids.has(c.card_id)),size-pool.length))}
  }
  if(!pool.length){toast("目前沒有符合條件的卡片");return}
  session=pool;cursor=0;$("sessionLabel").textContent=mode==="random"?`${deckName()} · 當前窗口隨機`:mode==="mistakes"?"易錯複習":`${deckName()} · 今日學習`;showView("study");renderCard();
}

function renderCard(){
  if(cursor>=session.length){
    $("sessionEmpty").classList.remove("is-hidden");$("cardContent").classList.add("is-hidden");$("sessionEmpty").innerHTML=`<div class="empty-orb">✓</div><h2>這一組完成了</h2><p>本組共完成 ${session.length} 張，複習日期已保存。</p><button class="primary-btn" id="againBtn">再來一組</button>`;$("againBtn").onclick=()=>startSession("today");$("sessionProgress").textContent=`${session.length} / ${session.length}`;updateDashboard();return;
  }
  $("sessionEmpty").classList.add("is-hidden");$("cardContent").classList.remove("is-hidden");current=session[cursor];revealed=false;
  const p=pOf(current.card_id),[lv]=fmtLevel(p);$("sessionProgress").textContent=`${cursor+1} / ${session.length}`;$("bigChar").textContent=current.char;$("variantText").textContent=current.variants?.length?`異體：${current.variants.join("、")}`:"";$("jyutping").textContent=current.jyutping;$("initialPart").textContent=`聲母 ${current.onset||"∅"}`;$("finalPart").textContent=`韻母 ${current.rime||"—"}`;$("tonePart").textContent=`聲調 ${current.tone}`;$("statusBadge").textContent=lv;
  $("multiBadge").classList.toggle("is-hidden",current.reading_count<=1);$("multiBadge").textContent=current.reading_count>1?`多音字 · ${current.reading_index}/${current.reading_count}`:"";
  $("contextBox").classList.toggle("is-hidden",!current.hint);$("contextText").textContent=current.hint||"";
  $("personalNoteBox").classList.toggle("is-hidden",!p.note);$("personalNoteText").textContent=p.note||"";
  const others=(CHAR_MAP.get(current.char)||[]).filter(x=>x.card_id!==current.card_id);$("otherReadings").classList.toggle("is-hidden",!others.length);$("otherReadings").open=false;$("otherList").innerHTML=others.map(x=>`<span class="other-chip">${esc(x.jyutping)}${x.hint?` · ${esc(x.hint)}`:""}</span>`).join("");
  $("answer").classList.remove("show");$("rating").classList.remove("show");$("revealBtn").classList.remove("is-hidden");$("prompt").classList.remove("is-hidden");$("wordCards").innerHTML="";updateSpeechVisibility();
}
function revealCurrent(){if(!current)return;revealed=true;$("answer").classList.add("show");$("rating").classList.add("show");$("revealBtn").classList.add("is-hidden");$("prompt").classList.add("is-hidden");renderExamples(current)}

function getExamples(card){
  const ids=CARD_WORDS[card.card_id]?.word_ids||[];
  return ids.map(id=>WORDS.get(id)).filter(Boolean).map(w=>({word:w,sentence:SENTENCES.get(w.word_id)}));
}
function primarySpeechText(){
  if(!current)return "";
  const first=getExamples(current).find(x=>x?.word?.word)?.word?.word;
  if(first)return first;
  return current.reading_count===1?current.char:"";
}
function renderExamples(card){
  const items=getExamples(card);$("exampleCount").textContent=items.length?`${items.length} 個`:"";
  if(!items.length){$("wordCards").innerHTML='<div class="fallback-copy">這個讀音目前沒有安全例詞，可先記住字音與字表提示。</div>';return}
  $("wordCards").innerHTML=items.map(({word:w,sentence:s},i)=>{
    const fallback=w.entry_type==="single_char";const recognition=!!s?.needs_review||s?.mode==="recognition";const pill=fallback?"字音提示":recognition?"識別語境":"用法例句";
    const sentence=s?`<div class="sentence">${esc(s.sentence)}</div><div class="sentence-actions"><button class="jy-toggle" data-jy="jy-${i}">${settings.sentenceJyutpingDefault?"收起整句粵拼":"顯示整句粵拼"}</button><button class="mini-sound speech-action is-hidden" data-say-sentence="${i}">🔊 句子</button></div><div class="sentence-jy ${settings.sentenceJyutpingDefault?"":"is-hidden"}" id="jy-${i}">${esc(s.jyutping)}</div>`:`<div class="fallback-copy">${fallback?"先記住這個字音；暫無可靠多字語境。":"暫無句子。"}</div>`;
    return `<article class="word-card"><div class="word-top"><div><div class="word-main">${esc(w.word)}</div><div class="word-jy">${esc(w.jyutping)}</div></div><span class="quality-pill ${recognition?"recognition":""}">${pill}</span></div><button class="mini-sound speech-action is-hidden" data-say-word="${i}">🔊 詞語</button>${sentence}</article>`;
  }).join("");
  $("wordCards").querySelectorAll("[data-jy]").forEach(b=>b.onclick=()=>{const el=$(b.dataset.jy);el.classList.toggle("is-hidden");b.textContent=el.classList.contains("is-hidden")?"顯示整句粵拼":"收起整句粵拼"});
  $("wordCards").querySelectorAll("[data-say-word]").forEach(b=>b.onclick=()=>speakText(items[Number(b.dataset.sayWord)]?.word.word));
  $("wordCards").querySelectorAll("[data-say-sentence]").forEach(b=>b.onclick=()=>speakText(items[Number(b.dataset.saySentence)]?.sentence?.sentence));
  updateSpeechVisibility();
}

function rate(r){
  if(!current||!revealed)return;const old=pOf(current.card_id),now=Date.now(),p={...old};p.reps=(p.reps||0)+1;p.last=now;
  if(r===0){p.level=1;p.lapses=(p.lapses||0)+1;p.interval=.007;p.due=now+10*60*1000}
  if(r===1){p.level=2;p.interval=1;p.due=now+DAY}
  if(r===2){p.level=Math.max(3,old.level||0);p.interval=Math.min(old.interval?Math.max(3,old.interval*2):3,90);p.due=now+p.interval*DAY}
  if(r===3){p.level=4;p.interval=Math.min(old.interval?Math.max(14,old.interval*2.5):14,180);p.due=now+p.interval*DAY}
  progress[current.card_id]=p;saveProgress();if(r===0&&cursor+3<session.length&&!session.slice(cursor+1).some(c=>c.card_id===current.card_id))session.splice(Math.min(cursor+4,session.length),0,current);cursor++;renderCard();
}

function searchableText(c){const ex=(CARD_WORDS[c.card_id]?.word_ids||[]).map(id=>WORDS.get(id)?.word||"").join(" ");return `${c.char} ${(c.variants||[]).join(" ")} ${c.jyutping} ${c.hint||""} ${ex}`.toLowerCase()}
function listHTML(items,mode){if(!items.length)return'<div class="empty-list">這裡暫時還沒有卡片。</div>';return items.map(c=>{const p=pOf(c.card_id),[lab,cls]=fmtLevel(p),right=mode==="mistakes"?`${p.lapses||0} 次`:`<span class="level-tag ${cls}">${lab}</span>`;const first=(CARD_WORDS[c.card_id]?.phrase_word_ids||[]).map(id=>WORDS.get(id)?.word).filter(Boolean).slice(0,2).join(" · ");return `<div class="list-row" data-id="${esc(c.card_id)}"><span class="list-char">${esc(c.char)}</span><span class="list-jy">${esc(c.jyutping)}</span><span class="list-note">${esc(c.hint||first||"—")}</span><span>${right}</span></div>`}).join("")}
function bindRows(root){root.querySelectorAll(".list-row").forEach(row=>row.onclick=()=>{const c=CARD_MAP.get(row.dataset.id);if(!c)return;session=[c];cursor=0;$("sessionLabel").textContent="單卡複習";showView("study");renderCard()})}
function renderKnown(){const q=$("knownFilter").value.trim().toLowerCase();let a=CARDS.filter(c=>pOf(c.card_id).level>=3);if(q)a=a.filter(c=>searchableText(c).includes(q));a.sort((x,y)=>pOf(y.card_id).level-pOf(x.card_id).level||pOf(y.card_id).last-pOf(x.card_id).last);$("knownList").innerHTML=listHTML(a.slice(0,500),"known");bindRows($("knownList"))}
function renderMistakes(){const q=$("mistakeFilter").value.trim().toLowerCase();let a=CARDS.filter(c=>pOf(c.card_id).lapses>0);if(q)a=a.filter(c=>searchableText(c).includes(q));a.sort((x,y)=>pOf(y.card_id).lapses-pOf(x.card_id).lapses||pOf(y.card_id).last-pOf(x.card_id).last);$("mistakeList").innerHTML=listHTML(a.slice(0,500),"mistakes");bindRows($("mistakeList"))}
function doSearch(){const q=$("searchInput").value.trim().toLowerCase(),lim=Number($("searchLimit").value),el=$("searchList");if(!q){el.innerHTML='<div class="empty-list">輸入內容開始查字。</div>';return}const exact=[],other=[];for(const c of CARDS){const hay=searchableText(c);if(c.char===q||c.jyutping.toLowerCase()===q)exact.push(c);else if(hay.includes(q))other.push(c)}const a=[...exact,...other].slice(0,lim);el.innerHTML=listHTML(a,"search");bindRows(el)}

function openNote(id){noteEditingId=id;const c=CARD_MAP.get(id),p=pOf(id);$("noteTitle").textContent=`${c.char} ${c.jyutping} · 我的語境`;$("noteText").value=p.note||"";$("noteModal").classList.add("show");$("noteModal").setAttribute("aria-hidden","false");setTimeout(()=>$("noteText").focus(),60)}
function closeNote(){$("noteModal").classList.remove("show");$("noteModal").setAttribute("aria-hidden","true");noteEditingId=null}
function saveNote(){if(!noteEditingId)return;const p={...pOf(noteEditingId),note:$("noteText").value.trim()};progress[noteEditingId]=p;saveProgress();closeNote();if(current&&current.card_id===noteEditingId){$("personalNoteBox").classList.toggle("is-hidden",!p.note);$("personalNoteText").textContent=p.note||"";}toast("已保存")}

function strictCantoneseVoice(){
  if(!("speechSynthesis" in window))return null;
  const vs=speechSynthesis.getVoices().filter(v=>!/Mandarin|普通話|國語|国语/i.test(v.name||""));
  return vs.find(v=>/^yue(?:[-_]|$)/i.test(v.lang||""))||
         vs.find(v=>/^zh[-_]HK$/i.test(v.lang||""))||
         vs.find(v=>/Cantonese|廣東|广东|粤語|粵語|粤语/i.test(v.name||""))||
         null;
}
function refreshVoices(){cantoneseVoice=strictCantoneseVoice();const dot=$("voiceDot");if(cantoneseVoice){dot.className="ok";$("voiceTitle").textContent="可使用粵語發音";$("voiceDetail").textContent=`${cantoneseVoice.name} · ${cantoneseVoice.lang}`;}else{dot.className="no";$("voiceTitle").textContent="未檢測到粵語語音";$("voiceDetail").textContent="發音按鈕會隱藏，不會改用普通話。";}updateSpeechVisibility()}
function updateSpeechVisibility(){
  document.querySelectorAll(".speech-action").forEach(el=>el.classList.toggle("is-hidden",!cantoneseVoice));
  const main=$("speakBtn");
  if(main)main.classList.toggle("is-hidden",!cantoneseVoice||!primarySpeechText());
}
function speakText(text){if(!text)return;if(!cantoneseVoice){toast("目前設備未提供粵語語音");return}speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.voice=cantoneseVoice;u.lang=cantoneseVoice.lang||"zh-HK";u.rate=.72;speechSynthesis.speak(u)}

function isStandalone(){return window.matchMedia?.("(display-mode: standalone)").matches||window.navigator.standalone===true}
function isLocalhost(){return ["localhost","127.0.0.1","::1"].includes(location.hostname)}
function updatePWAStatus(){
  const dot=$("pwaDot"),title=$("pwaTitle"),detail=$("pwaDetail"),install=$("installAppBtn");
  if(!dot||!title||!detail||!install)return;
  install.classList.toggle("is-hidden",!deferredInstallPrompt||isStandalone());
  if(isStandalone()){dot.className="ok";title.textContent="已作為 App 開啟";detail.textContent="學習資料仍儲存在目前瀏覽器／App 的本機空間。";return}
  if(!("serviceWorker" in navigator)){dot.className="no";title.textContent="此瀏覽器不支援離線安裝";detail.textContent="仍可使用網站版。";return}
  if(!window.isSecureContext&&!isLocalhost()){dot.className="no";title.textContent="目前為一般網站模式";detail.textContent="安裝與離線功能需要 HTTPS；部署到 GitHub Pages 後即可使用。";return}
  if(swRegistration){dot.className="ok";title.textContent="離線功能已啟用";detail.textContent=/iPhone|iPad|iPod/i.test(navigator.userAgent)&&!deferredInstallPrompt?"iPhone Safari：分享 → 加入主畫面。":"可安裝到裝置；資料載入後可離線使用。";return}
  dot.className="";title.textContent="正在準備離線功能…";detail.textContent="首次啟用會快取字音、例詞與例句資料。";
}
function showPWAUpdate(){
  $("updateBanner")?.classList.remove("is-hidden");$("applyUpdateBtn")?.classList.remove("is-hidden");
  if($("pwaTitle"))$("pwaTitle").textContent="有更新可用";
  if($("pwaDetail"))$("pwaDetail").textContent="重新載入後使用最新檔案；學習進度不會被清除。";
}
async function initPWA(){
  updatePWAStatus();
  if(!("serviceWorker" in navigator)||(!window.isSecureContext&&!isLocalhost()))return;
  try{
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(reloadingForUpdate)return;reloadingForUpdate=true;location.reload()});
    swRegistration=await navigator.serviceWorker.register("./sw.js",{scope:"./",updateViaCache:"none"});
    await navigator.serviceWorker.ready;
    updatePWAStatus();
    if(swRegistration.waiting)showPWAUpdate();
    swRegistration.addEventListener("updatefound",()=>{
      const worker=swRegistration.installing;if(!worker)return;
      worker.addEventListener("statechange",()=>{if(worker.state==="installed"&&navigator.serviceWorker.controller)showPWAUpdate();else if(worker.state==="installed")updatePWAStatus()});
    });
    setTimeout(()=>swRegistration?.update().catch(()=>{}),2500);
  }catch(err){console.warn("Service worker registration failed",err);if($("pwaDot"))$("pwaDot").className="no";if($("pwaTitle"))$("pwaTitle").textContent="離線功能未啟用";if($("pwaDetail"))$("pwaDetail").textContent="目前仍可使用網站版。";}
}
async function installPWA(){
  if(!deferredInstallPrompt){toast(/iPhone|iPad|iPod/i.test(navigator.userAgent)?"Safari：分享 → 加入主畫面":"目前瀏覽器未提供安裝提示");return}
  deferredInstallPrompt.prompt();await deferredInstallPrompt.userChoice;deferredInstallPrompt=null;updatePWAStatus();
}
async function checkPWAUpdate(){
  if(!swRegistration){toast("目前未啟用離線更新功能");return}
  try{await swRegistration.update();toast(swRegistration.waiting?"有更新可用":"已檢查更新");if(swRegistration.waiting)showPWAUpdate()}catch{toast("暫時無法檢查更新")}
}
function applyPWAUpdate(){
  if(swRegistration?.waiting){swRegistration.waiting.postMessage({type:"SKIP_WAITING"});return}
  location.reload();
}
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e;updatePWAStatus()});
window.addEventListener("appinstalled",()=>{deferredInstallPrompt=null;updatePWAStatus();toast("已安裝 CantoCards")});

function exportProgress(){const payload={app:"CantoCards",version:4,exportedAt:new Date().toISOString(),progress,settings};const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`CantoCards-progress-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function importProgress(e){const f=e.target.files[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(!obj.progress)throw new Error("invalid");progress=obj.progress;settings={...settings,...(obj.settings||{})};migrateProgressV03();saveProgress();saveSettings();applySettings();toast("進度已匯入")}catch{toast("無法讀取這個進度檔案")}e.target.value=""}
function resetProgress(){if(confirm("確定清空全部學習記錄嗎？這個操作無法撤銷。")){progress={};saveProgress();toast("已清空學習記錄")}}

init();
