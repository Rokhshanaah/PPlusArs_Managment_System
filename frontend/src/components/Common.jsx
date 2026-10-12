import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { X, Search, Plus, RefreshCw } from 'lucide-react';

export function LanguageSwitcher({compact=false}){const {i18n}=useTranslation();return <div className={`language-switcher ${compact?'compact':''}`}>{[['fa','دری'],['ps','پښتو'],['en','EN']].map(([code,label])=><button type="button" key={code} className={i18n.language===code?'active':''} onClick={()=>i18n.changeLanguage(code)}>{label}</button>)}</div>}
export function Loading(){const {t}=useTranslation();return <div className="state-box"><span className="spinner"/>{t('loading')}</div>}
export function ErrorBox({message}){return <div className="alert error">{message}</div>}
export function Empty(){const {t}=useTranslation();return <div className="state-box">{t('noData')}</div>}
export function PageHeader({ title, subtitle, actions }) {
  if (!title && !subtitle && !actions) return null;
  return (
    <div className={`page-heading ${!title && !subtitle ? 'page-heading--actions-only' : ''}`}>
      <div className="page-heading-meta">
        {title ? <h2>{title}</h2> : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
export function SearchBox({value,onChange,onRefresh,placeholder}){const {t}=useTranslation();return <div className="search-toolbar"><label className="search-box"><Search size={18}/><input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||t('search')}/></label>{onRefresh&&<button className="icon-btn" onClick={onRefresh} title={t('refresh')}><RefreshCw size={18}/></button>}</div>}
export function PrimaryButton({children,onClick,type='button',disabled=false,icon=true,className=''}){return <button type={type} onClick={onClick} disabled={disabled} className={`btn primary ${className}`}>{icon&&<Plus size={17}/>}<span>{children}</span></button>}
export function Modal({open,onClose,title,children,wide=false}){if(!open)return null;return createPortal(<div className="modal-backdrop" onMouseDown={e=>e.target===e.currentTarget&&onClose()}><div className={`modal-card ${wide?'wide':''}`}><div className="modal-head"><h3>{title}</h3><button type="button" className="icon-btn" onClick={onClose}><X size={20}/></button></div><div className="modal-body">{children}</div></div></div>,document.getElementById('modal-root'))}
export function Field({label,error,children,className=''}){return <label className={`field ${className}`}><span>{label}</span>{children}{error&&<small className="field-error">{error}</small>}</label>}
export function Table({columns,rows,keyField='id',empty}){return <div className="table-wrap"><table><thead><tr>{columns.map(c=><th key={c.key} className={c.className||undefined}>{c.label}</th>)}</tr></thead><tbody>{rows?.length?rows.map((row,index)=><tr key={row[keyField]??index}>{columns.map(c=><td key={c.key} className={c.className||undefined} data-label={c.label}>{c.render?c.render(row,index):row[c.key]}</td>)}</tr>):<tr><td colSpan={columns.length}>{empty||<Empty/>}</td></tr>}</tbody></table></div>}
export function StatusBadge({active=true,children}){return <span className={`badge ${active?'success':'muted'}`}>{children}</span>}
export function Pagination({pagination,onPage}){if(!pagination||pagination.pages<=1)return null;return <div className="pagination"><button disabled={pagination.page<=1} onClick={()=>onPage(pagination.page-1)}>‹</button><span>{pagination.page} / {pagination.pages}</span><button disabled={pagination.page>=pagination.pages} onClick={()=>onPage(pagination.page+1)}>›</button></div>}
