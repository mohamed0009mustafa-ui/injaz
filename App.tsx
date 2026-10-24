import { useEffect, useState, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, egp } from './supabase'

type Apt = { id:string; code:string; governorate:string|null; area:string|null; landlord_name:string|null; landlord_rent:number; capacity:number }
type Task = { id:string; title:string; status:string; due_date:string|null }
const tabs = [['home','الرئيسية'],['apts','الشقق'],['tasks','المهام']] as const

function Login() {
  const [email,setEmail]=useState(''); const [pw,setPw]=useState(''); const [err,setErr]=useState(''); const [busy,setBusy]=useState(false)
  const go = async (e:React.FormEvent) => { e.preventDefault(); setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr('تعذر تسجيل الدخول. تأكد من البريد وكلمة المرور.'); setBusy(false) }
  return <div className="min-h-screen grid place-items-center p-6">
    <form onSubmit={go} className="w-full max-w-sm bg-white rounded-xl p-6 space-y-4 border">
      <h1 className="text-2xl font-bold text-brand-700">مدير الشقق</h1>
      <input className="w-full border rounded-lg p-3" type="email" placeholder="البريد الإلكتروني" value={email} onChange={e=>setEmail(e.target.value)} required/>
      <input className="w-full border rounded-lg p-3" type="password" placeholder="كلمة المرور" value={pw} onChange={e=>setPw(e.target.value)} required/>
      {err && <p className="text-red-700 text-sm">{err}</p>}
      <button disabled={busy} className="w-full bg-brand-600 text-white rounded-lg p-3 font-bold disabled:opacity-50">{busy?'جارٍ الدخول...':'تسجيل الدخول'}</button>
    </form></div>
}

function Home() {
  const [s,setS]=useState<{apts:number;cap:number;res:number;open:number;late:number;inc:number;exp:number}|null>(null)
  useEffect(()=>{ (async()=>{
    const m = new Date(); const from = new Date(m.getFullYear(),m.getMonth(),1).toISOString().slice(0,10)
    const [a,r,t,p] = await Promise.all([
      supabase.from('apartments').select('capacity').is('archived_at',null),
      supabase.from('residents').select('id',{count:'exact',head:true}).is('moved_out_at',null),
      supabase.from('tasks').select('status,due_date').is('archived_at',null).in('status',['new','in_progress']),
      supabase.from('payments').select('amount,transactions!inner(kind)').gte('paid_on',from)])
    const today = new Date().toISOString().slice(0,10)
    const pay = (p.data||[]) as any[]
    const sum = (k:string)=>pay.filter(x=>x.transactions.kind===k).reduce((n,x)=>n+Number(x.amount),0)
    setS({ apts:a.data?.length||0, cap:(a.data||[]).reduce((n,x)=>n+x.capacity,0), res:r.count||0,
      open:t.data?.length||0, late:(t.data||[]).filter(x=>x.due_date&&x.due_date<today).length, inc:sum('income'), exp:sum('expense') })
  })() },[])
  if(!s) return <p className="p-4">جارٍ التحميل...</p>
  const Card=({l,v}:{l:string;v:string|number})=><div className="bg-white border rounded-lg p-4"><div className="text-sm text-gray-500">{l}</div><div className="text-xl font-bold">{v}</div></div>
  return <div className="grid grid-cols-2 gap-3 p-4">
    <Card l="الشقق" v={s.apts}/><Card l="الأسرة الشاغرة" v={s.cap-s.res}/>
    <Card l="المقيمون حاليًا" v={s.res}/><Card l="مهام مفتوحة / متأخرة" v={`${s.open} / ${s.late}`}/>
    <Card l="المحصّل هذا الشهر" v={egp(s.inc)}/><Card l="المدفوع هذا الشهر" v={egp(s.exp)}/>
    <div className="col-span-2"><Card l="صافي التدفق النقدي" v={egp(s.inc-s.exp)}/></div></div>
}

function Apts() {
  const [list,setList]=useState<Apt[]>([]); const [msg,setMsg]=useState('')
  const [f,setF]=useState({code:'',governorate:'',area:'',landlord_name:'',landlord_rent:'',capacity:'4'})
  const load=useCallback(async()=>{ const {data}=await supabase.from('apartments').select('*').is('archived_at',null).order('created_at',{ascending:false}); setList((data||[]) as Apt[]) },[])
  useEffect(()=>{load()},[load])
  const add=async(e:React.FormEvent)=>{ e.preventDefault(); setMsg('')
    const {error}=await supabase.from('apartments').insert({...f,landlord_rent:Number(f.landlord_rent)||0,capacity:Number(f.capacity)})
    if(error) setMsg('تعذر الحفظ: '+error.message); else { setMsg('تمت إضافة الشقة'); setF({...f,code:'',area:''}); load() } }
  const archive=async(id:string)=>{ if(!confirm('أرشفة هذه الشقة؟ لن تُحذف سجلاتها المالية.')) return
    await supabase.from('apartments').update({archived_at:new Date().toISOString()}).eq('id',id); load() }
  const inp="border rounded-lg p-3 w-full"
  return <div className="p-4 space-y-4">
    <form onSubmit={add} className="bg-white border rounded-lg p-4 grid grid-cols-2 gap-2">
      <input className={inp} placeholder="رمز الشقة" value={f.code} onChange={e=>setF({...f,code:e.target.value})} required/>
      <input className={inp} placeholder="المحافظة" value={f.governorate} onChange={e=>setF({...f,governorate:e.target.value})}/>
      <input className={inp} placeholder="المنطقة" value={f.area} onChange={e=>setF({...f,area:e.target.value})}/>
      <input className={inp} placeholder="اسم المالك" value={f.landlord_name} onChange={e=>setF({...f,landlord_name:e.target.value})}/>
      <input className={inp} type="number" placeholder="إيجار المالك" value={f.landlord_rent} onChange={e=>setF({...f,landlord_rent:e.target.value})}/>
      <input className={inp} type="number" min="1" placeholder="الطاقة" value={f.capacity} onChange={e=>setF({...f,capacity:e.target.value})}/>
      <button className="col-span-2 bg-brand-600 text-white rounded-lg p-3 font-bold">إضافة شقة</button>
      {msg && <p className="col-span-2 text-sm">{msg}</p>}
    </form>
    {list.length===0 && <p className="text-gray-500">لا توجد شقق بعد. أضف أول شقة من النموذج أعلاه.</p>}
    {list.map(a=><div key={a.id} className="bg-white border rounded-lg p-4 flex justify-between items-center">
      <div><div className="font-bold">{a.code}</div><div className="text-sm text-gray-500">{[a.governorate,a.area].filter(Boolean).join('، ')} — {a.landlord_name||'—'} — {egp(a.landlord_rent)}</div></div>
      <button onClick={()=>archive(a.id)} className="text-sm text-red-700">أرشفة</button></div>)}
  </div>
}

function Tasks() {
  const [list,setList]=useState<Task[]>([]); const [title,setTitle]=useState(''); const [due,setDue]=useState('')
  const load=useCallback(async()=>{ const {data}=await supabase.from('tasks').select('id,title,status,due_date').is('archived_at',null).order('due_date',{ascending:true,nullsFirst:false}); setList((data||[]) as Task[]) },[])
  useEffect(()=>{load()},[load])
  const add=async(e:React.FormEvent)=>{ e.preventDefault(); await supabase.from('tasks').insert({title,due_date:due||null}); setTitle(''); setDue(''); load() }
  const done=async(id:string)=>{ await supabase.from('tasks').update({status:'done'}).eq('id',id); load() }
  return <div className="p-4 space-y-3">
    <form onSubmit={add} className="flex gap-2"><input className="border rounded-lg p-3 flex-1" placeholder="مهمة جديدة" value={title} onChange={e=>setTitle(e.target.value)} required/>
      <input type="date" className="border rounded-lg p-3" value={due} onChange={e=>setDue(e.target.value)}/><button className="bg-brand-600 text-white rounded-lg px-4">إضافة</button></form>
    {list.length===0 && <p className="text-gray-500">لا توجد مهام.</p>}
    {list.map(t=><div key={t.id} className="bg-white border rounded-lg p-3 flex justify-between"><span className={t.status==='done'?'line-through text-gray-400':''}>{t.title} {t.due_date&&<small className="text-gray-500">({t.due_date})</small>}</span>
      {t.status!=='done'&&<button onClick={()=>done(t.id)} className="text-brand-700 text-sm">إكمال</button>}</div>)}
  </div>
}

export default function App() {
  const [session,setSession]=useState<Session|null>(null); const [ready,setReady]=useState(false); const [tab,setTab]=useState<'home'|'apts'|'tasks'>('home')
  useEffect(()=>{ supabase.auth.getSession().then(({data})=>{setSession(data.session);setReady(true)})
    const {data:l}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s)); return ()=>l.subscription.unsubscribe() },[])
  if(!ready) return <p className="p-6">جارٍ التحميل...</p>
  if(!session) return <Login/>
  return <div className="max-w-2xl mx-auto pb-20">
    <header className="p-4 flex justify-between items-center bg-brand-600 text-white"><b>مدير الشقق</b><button onClick={()=>supabase.auth.signOut()} className="text-sm">خروج</button></header>
    {tab==='home'&&<Home/>}{tab==='apts'&&<Apts/>}{tab==='tasks'&&<Tasks/>}
    <nav className="fixed bottom-0 inset-x-0 bg-white border-t flex max-w-2xl mx-auto">
      {tabs.map(([k,l])=><button key={k} onClick={()=>setTab(k)} className={`flex-1 p-4 font-bold ${tab===k?'text-brand-700 border-t-2 border-brand-600':'text-gray-500'}`}>{l}</button>)}</nav></div>
}
