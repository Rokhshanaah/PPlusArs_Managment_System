import { createContext, useContext, useMemo, useState } from 'react';
const ToastContext=createContext(null);
export function ToastProvider({children}){const [toasts,setToasts]=useState([]);const show=(message,type='success')=>{const id=Date.now()+Math.random();setToasts(v=>[...v,{id,message,type}]);setTimeout(()=>setToasts(v=>v.filter(t=>t.id!==id)),4200)};const value=useMemo(()=>({show}),[]);return <ToastContext.Provider value={value}>{children}<div className="toast-stack">{toasts.map(t=><div key={t.id} className={`toast ${t.type}`}>{t.message}</div>)}</div></ToastContext.Provider>}
export const useToast=()=>useContext(ToastContext);
