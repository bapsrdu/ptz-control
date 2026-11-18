// The parts every page is built from, so the app reads as one: panel
// buttons like a switcher's keys, pill buttons, tags, cards, fields, dialogs
// and menus.
import { useEffect, useRef, useState } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { holdModal } from './lib.js';

const LIT = { program: 'bg-program shadow-[0_0_12px_#e5483b88]', preview: 'bg-preview shadow-[0_0_12px_#4cbb5a88]', warning: 'bg-warning shadow-[0_0_12px_#f0b42988]', accent: 'bg-accent' };

// A backlit button, like the keys on a switcher panel.
export function PanelButton({ title, subtitle, lit, blink, width = 76, height = 52, size = 14, onClick, testid, help, disabled }) {
    return (
        <button
            type="button"
            data-testid={testid}
            title={help}
            disabled={disabled}
            onClick={onClick}
            className={`flex shrink-0 flex-col items-center justify-center rounded-lg border px-1 transition active:brightness-125 disabled:opacity-40 ${
                lit ? `${LIT[lit]} border-white/25 text-zinc-950` : 'border-line bg-raised text-muted hover:text-ink'
            } ${lit && blink ? 'blink' : ''}`}
            style={{ width, height }}
            data-lit={lit ? 'true' : 'false'}
        >
            <span className="truncate font-bold leading-tight" style={{ fontSize: size, maxWidth: width - 8 }}>{title}</span>
            {subtitle && <span className="truncate text-[9px] font-medium opacity-80" style={{ maxWidth: width - 8 }}>{subtitle}</span>}
        </button>
    );
}

// A secondary button: a caps label in a bordered pill.
export function Pill({ children, active, onClick, icon: Icon, testid, help, disabled, className = '' }) {
    return (
        <button
            type="button"
            data-testid={testid}
            title={help}
            disabled={disabled}
            onClick={onClick}
            className={`caps flex h-7 items-center gap-1.5 rounded px-3 text-[11px] transition disabled:opacity-40 ${
                active ? 'bg-accent-soft text-accent' : 'border border-line-strong text-ink hover:bg-raised'
            } ${className}`}
        >
            {Icon && <Icon size={12} strokeWidth={2.5} />}
            {children}
        </button>
    );
}

export function Btn({ children, kind = 'secondary', onClick, testid, disabled, help, type = 'button', className = '' }) {
    const k = {
        primary: 'bg-accent text-zinc-950 hover:brightness-110',
        secondary: 'border border-line bg-raised text-ink hover:brightness-125',
        quiet: 'text-accent hover:underline px-1',
        danger: 'border border-line text-danger hover:bg-danger/10',
    }[kind];
    return (
        <button type={type} data-testid={testid} title={help} disabled={disabled} onClick={onClick}
            className={`h-7 shrink-0 rounded-md px-2.5 text-xs font-semibold transition disabled:opacity-40 ${k} ${className}`}>
            {children}
        </button>
    );
}

export function Tag({ children, tone = 'neutral', className = '' }) {
    const t = {
        neutral: 'bg-line-strong text-ink',
        program: 'bg-program text-white',
        preview: 'bg-preview text-zinc-950',
        accent: 'bg-accent text-zinc-950',
        warning: 'bg-warning text-zinc-950',
    }[tone];
    return <span className={`caps inline-flex h-4 shrink-0 items-center rounded-sm px-1.5 text-[9px] ${t} ${className}`}>{children}</span>;
}

export function Badge({ children, tone = 'neutral', dot }) {
    const t = {
        neutral: 'text-muted bg-raised border border-line',
        success: 'text-success bg-success/15',
        warning: 'text-warning bg-warning/15',
        danger: 'text-danger bg-danger/15',
    }[tone];
    return (
        <span className={`caps inline-flex h-5 items-center gap-1.5 rounded px-2 text-[10px] ${t}`}>
            {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
            {children}
        </span>
    );
}

export function Segments({ items, value, onChange, testid }) {
    return (
        <div className="inline-flex shrink-0 rounded-md border border-line bg-sunken p-0.5" data-testid={testid}>
            {items.map(([text, v]) => (
                <button key={String(v)} type="button" onClick={() => onChange(v)}
                    className={`h-6 rounded px-3 text-xs font-semibold ${v === value ? 'bg-accent text-zinc-950' : 'text-muted hover:text-ink'}`}>
                    {text}
                </button>
            ))}
        </div>
    );
}

export function PanelLabel({ children, className = '' }) {
    return <div className={`caps text-[11px] text-subtle ${className}`}>{children}</div>;
}

export function StepLabel({ n, children }) {
    return (
        <div className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-xs font-bold text-zinc-950">{n}</span>
            <PanelLabel>{children}</PanelLabel>
        </div>
    );
}

export function Card({ title, help, children, className = '', testid }) {
    return (
        <section data-testid={testid} className={`flex flex-col gap-3 rounded-xl border border-line bg-surface p-4 ${className}`}>
            {title && (
                <div className="flex items-center gap-2">
                    <PanelLabel>{title}</PanelLabel>
                    {help && <HelpButton text={help} />}
                </div>
            )}
            {children}
        </section>
    );
}

export function HelpButton({ text }) {
    const [open, setOpen] = useState(false);
    return (
        <span className="relative">
            <button type="button" title="What this is for" onClick={() => setOpen((o) => !o)} className="text-subtle hover:text-ink">
                <HelpCircle size={14} />
            </button>
            {open && (
                <Popover onClose={() => setOpen(false)} className="left-0 top-6 w-96">
                    <p className="text-sm leading-relaxed text-ink">{text}</p>
                </Popover>
            )}
        </span>
    );
}

export function Page({ children, wide = false }) {
    return (
        <div className="h-full overflow-auto">
            <div className={`flex flex-col gap-5 ${wide ? 'p-4' : 'max-w-[1240px] p-6'}`}>{children}</div>
        </div>
    );
}

export function PageHeader({ title, purpose, help, children }) {
    return (
        <div className="flex items-center gap-3">
            <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-bold">{title}</h1>
                    {help && <HelpButton text={help} />}
                </div>
                <p className="text-sm text-muted">{purpose}</p>
            </div>
            <div className="flex-1" />
            {children}
        </div>
    );
}

export function Field({ value, onChange, onCommit, placeholder, width, testid, type = 'text', className = '' }) {
    // Typing changes a local copy; it is saved on Enter or when focus leaves.
    const [text, setText] = useState(value ?? '');
    useEffect(() => setText(value ?? ''), [value]);
    const commit = () => {
        if (String(text) !== String(value ?? '')) (onCommit ?? onChange)?.(text);
    };
    return (
        <input
            type={type}
            data-testid={testid}
            value={text}
            placeholder={placeholder}
            onChange={(e) => {
                setText(e.target.value);
                if (onCommit && onChange) onChange(e.target.value);
            }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') { commit(); e.currentTarget.blur(); }
                e.stopPropagation();
            }}
            className={`h-7 rounded-md border border-line bg-sunken px-2 text-[13px] text-ink outline-none focus:border-accent ${className}`}
            style={{ width }}
        />
    );
}

export function Select({ value, onChange, options, width, testid, placeholder }) {
    return (
        <select
            data-testid={testid}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            className="h-7 rounded-md border border-line bg-raised px-2 text-xs font-semibold text-ink outline-none focus:border-accent"
            style={{ width }}
        >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map(([text, v]) => <option key={String(v)} value={v}>{text}</option>)}
        </select>
    );
}

export function Col({ children, width }) {
    return <div className="caps shrink-0 truncate text-[10px] text-subtle" style={{ width }}>{children}</div>;
}

// A box that floats next to its button and closes on a click outside or Escape.
export function Popover({ children, onClose, className = '' }) {
    const ref = useRef(null);
    useEffect(() => {
        const release = holdModal();
        const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
        const key = (e) => { if (e.key === 'Escape') onClose(); };
        setTimeout(() => window.addEventListener('mousedown', down), 0);
        window.addEventListener('keydown', key);
        return () => {
            release();
            window.removeEventListener('mousedown', down);
            window.removeEventListener('keydown', key);
        };
    }, [onClose]);
    return (
        <div ref={ref} className={`absolute z-40 rounded-lg border border-line-strong bg-surface p-4 shadow-2xl ${className}`}>
            {children}
        </div>
    );
}

// A question in the middle of the window.
export function Dialog({ title, children, actions, onClose, testid }) {
    useEffect(() => {
        const release = holdModal();
        const key = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', key);
        return () => { release(); window.removeEventListener('keydown', key); };
    }, [onClose]);
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onMouseDown={onClose}>
            <div data-testid={testid} className="w-[420px] rounded-xl border border-line-strong bg-surface p-5 shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
                <div className="mb-2 flex items-start gap-2">
                    <h2 className="flex-1 text-base font-bold">{title}</h2>
                    <button type="button" onClick={onClose} className="text-subtle hover:text-ink"><X size={16} /></button>
                </div>
                <div className="text-sm text-muted">{children}</div>
                <div className="mt-4 flex justify-end gap-2">{actions}</div>
            </div>
        </div>
    );
}

// Asks for a name: for a new shot, or renaming one.
export function NameDialog({ title, note, initial = '', placeholder, onSave, onClose }) {
    const [name, setName] = useState(initial);
    const save = () => { onSave(name.trim()); onClose(); };
    return (
        <Dialog title={title} onClose={onClose} testid="name-dialog" actions={<>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn kind="primary" testid="name-save" onClick={save}>Save</Btn>
        </>}>
            {note && <p className="mb-3">{note}</p>}
            <input
                autoFocus
                data-testid="name-input"
                value={name}
                placeholder={placeholder}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') save(); }}
                className="h-8 w-full rounded-md border border-line bg-sunken px-2 text-sm text-ink outline-none focus:border-accent"
            />
        </Dialog>
    );
}

// A right-click menu.
// eslint-disable-next-line react-refresh/only-export-components
export function useContextMenu() {
    const [menu, setMenu] = useState(null);
    const open = (e, items) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY, items });
    };
    const element = menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
    );
    return [open, element];
}

function ContextMenu({ x, y, items, onClose }) {
    const ref = useRef(null);
    useEffect(() => {
        const release = holdModal();
        const down = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
        const key = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('mousedown', down);
        window.addEventListener('keydown', key);
        return () => { release(); window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
    }, [onClose]);
    return (
        <div ref={ref} data-testid="context-menu" className="fixed z-50 min-w-48 rounded-lg border border-line-strong bg-surface py-1 shadow-2xl" style={{ left: x, top: y }}>
            {items.map((it, i) => (it === '-' ? <div key={i} className="my-1 h-px bg-line" /> : (
                <button key={it.label} type="button" onClick={() => { onClose(); it.run(); }}
                    className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-raised ${it.danger ? 'text-danger' : 'text-ink'}`}>
                    {it.label}
                </button>
            )))}
        </div>
    );
}
