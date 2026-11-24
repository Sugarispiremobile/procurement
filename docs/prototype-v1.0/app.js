const STATUSES=[
 {k:"new",t:"Новая",c:"#c9d3dc"},
 {k:"review",t:"На согласовании",c:"#f2b705"},
 {k:"buying",t:"В закупке",c:"#7fb7e6"},
 {k:"done",t:"Выполнена",c:"#7fd1a4"},
 {k:"rejected",t:"Отклонена",c:"#f09a92"},
 {k:"cancelled",t:"Отменена",c:"#aeb8c2"}
];
const ST=Object.fromEntries(STATUSES.map(s=>[s.k,s]));
const NEXT={new:["review","rejected"],review:["buying","rejected"],buying:["done","rejected"],done:[],rejected:[],cancelled:[]};
const CLOSED=["done","rejected","cancelled"];
const KEY="procurement-requests-v2",ME="procurement-me",THEME="procurement-theme";
let role="emp",filter="all",query="",editId=null,reqs=[];

function load(){try{const v=localStorage.getItem(KEY);if(v)return JSON.parse(v)}catch(e){}return null}
function save(){try{localStorage.setItem(KEY,JSON.stringify(reqs))}catch(e){}}
const today=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0")};
const nowIso=()=>new Date().toISOString();
reqs=load()||[
 {id:1042,author:"Анна Лебедева",dept:"Бухгалтерия",cat:"Канцелярия",prio:0,due:"2026-12-02",budget:6500,why:"Заканчиваются папки и бумага к закрытию квартала.",items:[{n:"Бумага А4, пачка 500 л.",q:20,u:"пач."},{n:"Папка-регистратор",q:15,u:"шт."}],status:"review",note:"",created:"2026-10-14",
  hist:[{t:"2026-10-14T09:10:00Z",from:null,to:"new",by:"Анна Лебедева"},{t:"2026-10-15T07:30:00Z",from:"new",to:"review",by:"Снабжение"}]},
 {id:1043,author:"Сергей Орлов",dept:"ИТ",cat:"Оборудование",prio:1,due:"2026-11-10",budget:48000,why:"Вышел из строя монитор у оператора склада.",items:[{n:"Монитор 24\"",q:2,u:"шт."}],status:"buying",note:"Поставщик выставил счёт, ждём оплаты.",created:"2026-10-16",
  hist:[{t:"2026-10-16T08:00:00Z",from:null,to:"new",by:"Сергей Орлов"},{t:"2026-10-16T10:20:00Z",from:"new",to:"review",by:"Снабжение"},{t:"2026-10-18T06:45:00Z",from:"review",to:"buying",by:"Снабжение"}]}
];
reqs.forEach(r=>{r.hist=r.hist||[];r.items=r.items||[]});

const $=id=>document.getElementById(id);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmtDate=d=>d?new Date(d+(d.length===10?"T00:00:00":"")).toLocaleDateString("ru-RU"):"—";
const fmtDT=t=>new Date(t).toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});
const money=n=>n?Number(n).toLocaleString("ru-RU")+" ₽":"—";
const me=()=>$("author").value.trim();
const overdue=r=>r.due&&r.due<today()&&!CLOSED.includes(r.status);

function toast(m){const t=$("toast");t.textContent=m;t.style.display="block";clearTimeout(toast.h);toast.h=setTimeout(()=>t.style.display="none",2600)}

/* theme */
function applyTheme(t){if(t)document.documentElement.setAttribute("data-theme",t);else document.documentElement.removeAttribute("data-theme")}
try{applyTheme(localStorage.getItem(THEME))}catch(e){}
$("theme").onclick=()=>{
  const dark=document.documentElement.getAttribute("data-theme")==="dark"||(!document.documentElement.getAttribute("data-theme")&&matchMedia("(prefers-color-scheme:dark)").matches);
  const n=dark?"light":"dark";applyTheme(n);try{localStorage.setItem(THEME,n)}catch(e){}
};

/* form */
function addRow(n="",q=1,u="шт."){
  const d=document.createElement("div");d.className="row";
  d.innerHTML='<input placeholder="Наименование" aria-label="Наименование" maxlength="120" value="'+esc(n)+'"><input type="number" min="1" step="1" aria-label="Количество" value="'+q+'"><input aria-label="Единица" maxlength="12" value="'+esc(u)+'"><button class="x" type="button" aria-label="Удалить позицию">×</button>';
  d.querySelector(".x").onclick=()=>{if($("rows").children.length>1)d.remove()};
  $("rows").appendChild(d);
}
function resetForm(){
  editId=null;$("rows").innerHTML="";addRow();
  $("why").value="";$("budget").value="";$("due").value="";$("prio").value="0";$("err").textContent="";
  $("formTitle").textContent="Новая заявка";$("send").textContent="Отправить заявку";$("cancelEdit").hidden=true;
}
function startEdit(id){
  const r=reqs.find(x=>x.id===id);if(!r||r.status!=="new")return;
  editId=id;
  $("author").value=r.author;$("dept").value=r.dept;$("cat").value=r.cat;$("prio").value=r.prio;
  $("due").value=r.due||"";$("budget").value=r.budget||"";$("why").value=r.why;
  $("rows").innerHTML="";r.items.forEach(i=>addRow(i.n,i.q,i.u));
  $("formTitle").textContent="Редактирование заявки №"+id;$("send").textContent="Сохранить изменения";$("cancelEdit").hidden=false;$("err").textContent="";
  $("formPanel").scrollIntoView({behavior:"smooth",block:"start"});
}
$("addRow").onclick=()=>addRow();
$("cancelEdit").onclick=()=>{resetForm();render()};
$("send").onclick=()=>{
  const items=[...$("rows").children].map(r=>{const i=r.querySelectorAll("input");return{n:i[0].value.trim(),q:Math.floor(+i[1].value),u:i[2].value.trim()||"шт."}}).filter(i=>i.n);
  const author=me(),why=$("why").value.trim(),budget=$("budget").value===""?0:+$("budget").value,due=$("due").value;
  const fail=m=>{$("err").textContent=m};
  if(!author)return fail("Укажите ваше имя.");
  if(!items.length)return fail("Добавьте хотя бы одну позицию.");
  if(items.some(i=>!(i.q>0)))return fail("Количество должно быть целым числом больше 0.");
  if(!why)return fail("Напишите обоснование — оно ускоряет согласование.");
  if(budget<0||isNaN(budget))return fail("Сумма не может быть отрицательной.");
  if(due&&due<today()&&!(editId&&reqs.find(r=>r.id===editId).due===due))return fail("Дата «нужно к» не может быть в прошлом.");
  fail("");
  try{localStorage.setItem(ME,author)}catch(e){}
  const data={author,dept:$("dept").value,cat:$("cat").value,prio:+$("prio").value,due,budget,why,items};
  if(editId){
    Object.assign(reqs.find(r=>r.id===editId),data);
    toast("Заявка №"+editId+" обновлена");
  }else{
    const id=Math.max(1000,...reqs.map(r=>r.id))+1;
    reqs.unshift({id,...data,status:"new",note:"",created:today(),hist:[{t:nowIso(),from:null,to:"new",by:author}]});
    toast("Заявка №"+id+" отправлена");
  }
  save();resetForm();render();
};

/* role */
function setRole(r){
  role=r;filter="all";
  $("r-emp").setAttribute("aria-pressed",r==="emp");$("r-buy").setAttribute("aria-pressed",r==="buy");
  $("formPanel").style.display=r==="emp"?"block":"none";
  $("stats").hidden=r!=="buy";$("csv").hidden=r!=="buy";
  $("listTitle").textContent=r==="emp"?"Мои заявки":"Очередь снабжения";
  if(r==="buy")resetForm();
  render();
}
$("r-emp").onclick=()=>setRole("emp");$("r-buy").onclick=()=>setRole("buy");
$("author").addEventListener("input",()=>{if(role==="emp")render()});
$("q").addEventListener("input",e=>{query=e.target.value.trim().toLowerCase();render()});

function scoped(){
  if(role==="buy")return reqs;
  const n=me().toLowerCase();
  return n?reqs.filter(r=>r.author.toLowerCase()===n):[];
}
function matches(r){
  if(!query)return true;
  const hay=("№"+r.id+" "+r.id+" "+r.author+" "+r.dept+" "+r.cat+" "+r.why+" "+r.items.map(i=>i.n).join(" ")).toLowerCase();
  return query.split(/\s+/).every(w=>hay.includes(w));
}

function renderStats(){
  const n=k=>reqs.filter(r=>r.status===k).length;
  const active=reqs.filter(r=>!CLOSED.includes(r.status));
  const items=[["Всего",reqs.length],["В работе",active.length],["Срочных в работе",active.filter(r=>r.prio).length],["Просрочено",active.filter(overdue).length]];
  $("stats").innerHTML=items.map(s=>'<div class="stat"><b>'+s[1]+'</b><span>'+s[0]+'</span></div>').join("");
}

function render(){
  const base=scoped();
  const dl=$("authors");dl.innerHTML=[...new Set(reqs.map(r=>r.author))].map(a=>'<option value="'+esc(a)+'">').join("");
  $("scopeHint").textContent=role==="emp"?(me()?"Показаны заявки: "+me()+".":"Введите своё имя в форме, чтобы увидеть свои заявки."):"Срочные заявки показываются первыми. Статус можно менять только по разрешённым переходам.";
  if(role==="buy")renderStats();
  const f=$("filters");f.innerHTML="";
  [{k:"all",t:"Все"},...STATUSES].forEach(s=>{
    const n=s.k==="all"?base.length:base.filter(r=>r.status===s.k).length;
    const b=document.createElement("button");b.className="chip";b.type="button";b.textContent=s.t+" "+n;
    b.setAttribute("aria-pressed",filter===s.k);b.onclick=()=>{filter=s.k;render()};f.appendChild(b);
  });
  let list=base.filter(r=>(filter==="all"||r.status===filter)&&matches(r));
  if(role==="buy")list=[...list].sort((a,b)=>(CLOSED.includes(a.status)-CLOSED.includes(b.status))||(b.prio-a.prio)||(b.id-a.id));
  const box=$("list");
  if(!list.length){
    box.innerHTML='<div class="empty">'+(query||filter!=="all"?"Ничего не найдено. Сбросьте фильтр или поиск.":(role==="emp"?(me()?"У вас пока нет заявок. Заполните форму выше, чтобы отправить первую.":"Введите своё имя, чтобы увидеть заявки."):"Новые заявки появятся здесь."))+'</div>';
    return;
  }
  box.innerHTML=list.map(r=>{
    const s=ST[r.status];
    let acts="";
    if(role==="buy"){
      acts='<div class="acts"><input data-note="'+r.id+'" maxlength="500" placeholder="Комментарий для сотрудника" value="'+esc(r.note)+'" aria-label="Комментарий к заявке '+r.id+'">'+
        '<button class="btn ghost sm" data-act="note" data-id="'+r.id+'">Сохранить комментарий</button>'+
        NEXT[r.status].map(k=>'<button class="btn'+(k==="rejected"?' danger':' ghost')+' sm" data-act="st" data-id="'+r.id+'" data-st="'+k+'">'+(k==="rejected"?"Отклонить":"→ "+ST[k].t)+'</button>').join("")+'</div>';
    }else if(r.status==="new"){
      acts='<div class="acts"><button class="btn ghost sm" data-act="edit" data-id="'+r.id+'">Редактировать</button><button class="btn danger sm" data-act="cancel" data-id="'+r.id+'">Отменить заявку</button></div>';
    }
    const hist=r.hist.length?'<details class="hist"><summary>История статусов ('+r.hist.length+')</summary><ul>'+r.hist.map(h=>'<li>'+fmtDT(h.t)+' — '+(h.from?esc(ST[h.from].t)+' → ':'создана: ')+esc(ST[h.to].t)+', '+esc(h.by)+'</li>').join("")+'</ul></details>':"";
    return '<article class="req" style="--st:'+s.c+'"><div class="top"><b>№'+r.id+' · '+esc(r.cat)+'</b><span class="badge" style="--st:'+s.c+'">'+s.t+'</span></div>'+
    '<div class="meta">'+esc(r.author)+', '+esc(r.dept)+' · создана '+fmtDate(r.created)+' · к '+fmtDate(r.due)+(overdue(r)?' <span class="urgent">(просрочено)</span>':'')+' · '+money(r.budget)+(r.prio?' · <span class="urgent">срочно</span>':'')+'</div>'+
    '<ul class="items">'+r.items.map(i=>'<li>'+esc(i.n)+' — '+i.q+' '+esc(i.u)+'</li>').join("")+'</ul>'+
    '<div class="meta">'+esc(r.why)+'</div>'+(r.note&&role==="emp"?'<div class="note"><b>Снабжение:</b> '+esc(r.note)+'</div>':'')+hist+acts+'</article>';
  }).join("");
}

/* actions via delegation */
$("list").addEventListener("click",e=>{
  const b=e.target.closest("[data-act]");if(!b)return;
  const id=+b.dataset.id,r=reqs.find(x=>x.id===id);if(!r)return;
  const act=b.dataset.act;
  if(act==="edit")return startEdit(id);
  if(act==="cancel"){
    if(r.status!=="new")return toast("Отменить можно только новую заявку");
    if(!confirm("Отменить заявку №"+id+"?"))return;
    r.hist.push({t:nowIso(),from:r.status,to:"cancelled",by:r.author});r.status="cancelled";
    if(editId===id)resetForm();
    save();render();return toast("Заявка №"+id+" отменена");
  }
  const inp=$("list").querySelector('[data-note="'+id+'"]');
  const note=inp?inp.value.trim():r.note;
  if(act==="note"){r.note=note;save();render();return toast("Комментарий сохранён")}
  if(act==="st"){
    const to=b.dataset.st;
    if(!NEXT[r.status].includes(to))return toast("Такой переход недопустим");
    if(to==="rejected"&&!note){if(inp)inp.focus();return toast("Укажите причину отклонения в комментарии")}
    r.note=note;r.hist.push({t:nowIso(),from:r.status,to,by:"Снабжение"});r.status=to;
    save();render();toast("Заявка №"+id+": "+ST[to].t);
  }
});

/* CSV */
$("csv").onclick=()=>{
  const q=v=>'"'+String(v==null?"":v).replace(/"/g,'""')+'"';
  const list=reqs.filter(r=>(filter==="all"||r.status===filter)&&matches(r));
  const head=["№","Статус","Срочность","Автор","Подразделение","Категория","Создана","Нужно к","Сумма","Позиции","Обоснование","Комментарий"];
  const rows=list.map(r=>[r.id,ST[r.status].t,r.prio?"срочная":"обычная",r.author,r.dept,r.cat,r.created,r.due||"",r.budget||"",r.items.map(i=>i.n+" — "+i.q+" "+i.u).join("; "),r.why,r.note]);
  const csv="\uFEFF"+[head,...rows].map(r=>r.map(q).join(";")).join("\r\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  a.download="zayavki-"+today()+".csv";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast("Выгружено заявок: "+list.length);
};

/* tabs */
function setTab(t){
  for(const k of ["app","spec","comp"]){$(k).hidden=k!==t;$("t-"+k).setAttribute("aria-pressed",k===t)}
  $("roleSeg").style.visibility=t==="app"?"visible":"hidden";
  window.scrollTo(0,0);
}
["app","spec","comp"].forEach(k=>$("t-"+k).onclick=()=>setTab(k));

try{const n=localStorage.getItem(ME);if(n)$("author").value=n}catch(e){}
addRow();setRole("emp");
