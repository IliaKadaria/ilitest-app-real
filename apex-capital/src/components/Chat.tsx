import { useEffect, useMemo, useRef, useState } from 'react';
import { comms, useComms, type Community, type Msg, type PollPayload, type SignalPayload } from '../online/comms.ts';
import { quote } from '../market/engine.ts';
import { SYMBOLS, SYMBOL_MAP, fmtPrice } from '../market/symbols.ts';
import { hhmm } from '../format.ts';
import { sfx } from '../sfx.ts';
import { Icon } from './Icons.tsx';
import { Tape } from './Panels.tsx';
import { Avatar } from './Avatar.tsx';
import { social } from '../online/social.ts';
import { compactMoney } from '../format.ts';
import { Badge } from './Badge.tsx';
import { divisionFor } from '../game/tiers.ts';

type Notify = (title: string, body: string, tone?: 'good' | 'bad' | 'info') => void;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function dayLabel(t: number): string {
  const d = new Date(t * 1000);
  const today = new Date();
  const y = new Date(Date.now() - 86400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function preview(m: Msg | null): string {
  if (!m) return 'No messages yet';
  if (m.deleted) return 'Message deleted';
  if (m.kind === 'system') return m.body;
  const who = m.playerId === comms.me?.id ? 'You' : m.name;
  if (m.kind === 'poll') return `${who}: Poll · ${m.body}`;
  if (m.kind === 'signal') {
    const p = m.payload as SignalPayload;
    return `${who}: Signal · ${p.side === 1 ? 'BUY' : 'SELL'} ${SYMBOL_MAP[p.sym]?.name ?? p.sym}`;
  }
  return `${who}: ${m.body}`;
}

// ====================================================================== list

export function Communities({ now, notify, onOpenSymbol, onProfile, openRoom }: { now: number; notify: Notify; onOpenSymbol: (sym: string) => void; onProfile: (id: string) => void; openRoom?: string | null }) {
  const c = useComms();
  const [room, setRoom] = useState<string | null>(openRoom ?? null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (openRoom) setRoom(openRoom);
  }, [openRoom]);

  const sorted = useMemo(
    () => [...c.communities].sort((a, b) => (c.lastMessage(b.id)?.createdAt ?? b.createdAt) - (c.lastMessage(a.id)?.createdAt ?? a.createdAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.communities, c.messages],
  );

  if (room === 'tape') return <Shell title="Live Tape" subtitle="All desk & member executions" onBack={() => setRoom(null)} body={<div className="msgs" style={{ padding: 0 }}><Tape now={now} /></div>} />;
  const active = c.communities.find((x) => x.id === room);
  if (active) return <Room c={active} notify={notify} onBack={() => setRoom(null)} onOpenSymbol={onOpenSymbol} onProfile={onProfile} />;

  return (
    <div className="list chatlist">
      {c.mode === 'local' && (
        <div className="modebanner glass">
          <span>
            <b>Local demo</b> · {c.localReason} Messages stay on this device.
          </span>
          <label>
            Admin
            <button className={`switch ${c.isAdmin ? 'on' : ''}`} aria-label="Demo admin" onClick={() => c.setDemoAdmin(!c.isAdmin)} />
          </label>
        </div>
      )}
      {c.mode === 'connecting' && <div className="empty">Connecting to communities…</div>}

      <button className="crow" onClick={() => { setRoom('tape'); sfx.tap(); }}>
        <span className="avatar">TP</span>
        <span>
          <span className="t">Live Tape</span>
          <span className="p">Real-time executions across the desk</span>
        </span>
        <span className="meta">live</span>
      </button>

      {sorted.map((x) => {
        const last = c.lastMessage(x.id);
        const unread = c.membership(x.id) ? c.unread(x.id) : 0;
        return (
          <button key={x.id} className="crow" onClick={() => { setRoom(x.id); sfx.tap(); }}>
            <span className="avatar">{initials(x.name)}</span>
            <span style={{ minWidth: 0 }}>
              <span className="t">
                {x.name}
                {x.broadcast && <Icon.broadcast />}
              </span>
              <span className="p">{preview(last)}</span>
            </span>
            <span className="meta">
              {last ? hhmm(last.createdAt) : ''}
              {unread > 0 && <span className="unread">{unread}</span>}
            </span>
          </button>
        );
      })}

      {c.isAdmin && (
        <div className="pad">
          <button className="primary" style={{ width: '100%' }} onClick={() => setCreating(true)}>New community</button>
        </div>
      )}
      {!c.isAdmin && c.mode !== 'connecting' && <div className="empty" style={{ paddingTop: 16 }}>Communities are created and run by Liquidated admins.</div>}

      {creating && <CreateSheet notify={notify} onClose={() => setCreating(false)} />}
    </div>
  );
}

function Shell({ title, subtitle, onBack, body }: { title: string; subtitle: string; onBack: () => void; body: React.ReactNode }) {
  return (
    <div className="room">
      <div className="roomhdr">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon.back /></button>
        <span className="avatar sm">{initials(title)}</span>
        <span className="ttl"><b>{title}</b><small>{subtitle}</small></span>
      </div>
      {body}
    </div>
  );
}

// ====================================================================== room

function Room({ c, notify, onBack, onOpenSymbol, onProfile }: { c: Community; notify: Notify; onBack: () => void; onOpenSymbol: (sym: string) => void; onProfile: (id: string) => void }) {
  const store = useComms();
  const msgs = store.roomMessages(c.id);
  const member = store.membership(c.id);
  const admin = store.isRoomAdmin(c.id);
  const can = store.canPost(c.id);
  const [text, setText] = useState('');
  const [composer, setComposer] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);
  const [roster, setRoster] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    if (member) store.markRead(c.id);
  }, [msgs.length, member, c.id, store]);

  const act = async (p: Promise<string | null>, ok?: string) => {
    const err = await p;
    if (err) {
      notify('Not sent', err, 'bad');
      sfx.bonk();
    } else if (ok) notify(ok, c.name, 'good');
    return !err;
  };

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (await act(store.post(c.id, 'text', body))) sfx.tap();
    else setText(body);
  };

  let lastDay = '';
  return (
    <div className="room">
      <div className="roomhdr">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon.back /></button>
        <span className="avatar sm">{initials(c.name)}</span>
        <span className="ttl">
          <b>{c.name}</b>
          <small>{store.memberCount(c.id)} member{store.memberCount(c.id) === 1 ? '' : 's'} · {c.broadcast ? 'Broadcast only' : 'Open chat'}</small>
        </span>
        <button className="iconbtn" aria-label="Members" onClick={() => setRoster(true)}><Icon.users /></button>
        {member && !admin && <button className="ghost" onClick={() => act(store.leave(c.id), 'Left community')}>Leave</button>}
      </div>

      {admin && (
        <div className="adminbar">
          <Icon.broadcast />
          <span>
            <b style={{ color: 'var(--text)' }}>Broadcast mode</b> · {c.broadcast ? 'only admins can post' : 'everyone can chat'}
          </span>
          <button
            className={`switch ${c.broadcast ? 'on' : ''}`}
            aria-label="Toggle broadcast mode"
            onClick={() => act(store.setBroadcast(c.id, !c.broadcast), c.broadcast ? 'Chat reopened' : 'Broadcast mode on')}
          />
        </div>
      )}

      <div className="msgs">
        {c.description && <div className="sysmsg">{c.description}</div>}
        {msgs.map((m) => {
          const day = dayLabel(m.createdAt);
          const sep = day !== lastDay ? <div className="daysep">{day}</div> : null;
          lastDay = day;
          return (
            <div key={m.id} style={{ display: 'contents' }}>
              {sep}
              <Bubble m={m} c={c} focused={focus === m.id} onFocus={() => setFocus(focus === m.id ? null : m.id)} act={act} onOpenSymbol={onOpenSymbol} onProfile={onProfile} />
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {!member && !admin ? (
        <div className="readonly">
          <button className="primary" style={{ flex: 1 }} onClick={() => act(store.join(c.id), 'Joined')}>Join community</button>
        </div>
      ) : can.ok ? (
        <div className="composer">
          {admin && (
            <button className="plus" aria-label="Post announcement, signal or poll" onClick={() => setComposer(true)}><Icon.plus /></button>
          )}
          <textarea
            rows={1}
            value={text}
            maxLength={1000}
            placeholder="Message"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <button className="send" aria-label="Send" disabled={!text.trim()} onClick={send}><Icon.send /></button>
        </div>
      ) : (
        <div className="readonly"><Icon.lock /> {can.why}</div>
      )}

      {composer && <AdminComposer c={c} notify={notify} onClose={() => setComposer(false)} />}
      {roster && <Roster c={c} onClose={() => setRoster(false)} onProfile={(id) => { setRoster(false); onProfile(id); }} />}
    </div>
  );
}

function Roster({ c, onClose, onProfile }: { c: Community; onClose: () => void; onProfile: (id: string) => void }) {
  const store = useComms();
  const rows = store.members
    .filter((m) => m.communityId === c.id && !m.banned && m.playerId !== 'house')
    .map((m) => ({ m, card: m.playerId === store.me?.id ? null : social.card(m.playerId) }))
    .sort((a, b) => (b.card?.balance ?? 0) - (a.card?.balance ?? 0));
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>{c.name} · {rows.length} members</h3>
        <div className="addlist">
          {rows.map(({ m, card }) => {
            const mine = m.playerId === store.me?.id;
            const name = mine ? 'You' : card?.name ?? 'Member';
            const bal = card?.balance ?? 0;
            return (
              <button key={m.playerId} className="addrow" disabled={mine} onClick={() => onProfile(m.playerId)}>
                <Avatar name={name} src={card?.avatar} size={38} />
                <span className="qname"><b>{name}{m.role === 'admin' && <span className="adm">ADMIN</span>}</b><small>{card ? `${divisionFor(bal).label} · ${compactMoney(bal)}` : ''}</small></span>
                {card && <Badge d={divisionFor(bal)} size={26} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Bubble({ m, c, focused, onFocus, act, onOpenSymbol, onProfile }: { m: Msg; c: Community; focused: boolean; onFocus: () => void; act: (p: Promise<string | null>, ok?: string) => Promise<boolean>; onOpenSymbol: (sym: string) => void; onProfile: (id: string) => void }) {
  const store = comms;
  if (m.kind === 'system') return <div className="sysmsg">{m.body}</div>;
  const mine = m.playerId === store.me?.id;
  const roomAdmin = store.isRoomAdmin(c.id);
  const authorAdmin = m.playerId === 'house' || store.members.some((x) => x.communityId === c.id && x.playerId === m.playerId && x.role === 'admin');
  const cls = m.deleted ? 'deleted' : m.kind === 'announcement' ? 'ann' : '';
  const canDelete = !m.deleted && (mine || roomAdmin);
  const canBan = roomAdmin && !mine && m.playerId && m.playerId !== 'house';

  return (
    <div className={`bubble ${mine ? 'mine' : 'theirs'} ${cls}`} onClick={onFocus}>
      {!mine && (
        <span className="who" onClick={(e) => { if (m.playerId && m.playerId !== 'house') { e.stopPropagation(); onProfile(m.playerId); } }}>
          {m.name}
          {authorAdmin && <span className="adm">ADMIN</span>}
        </span>
      )}
      {m.kind === 'announcement' && !m.deleted && <span className="kicker">ANNOUNCEMENT</span>}
      {m.kind === 'signal' && !m.deleted && m.payload ? (
        <SignalCard p={m.payload as SignalPayload} note={m.body} onOpen={onOpenSymbol} />
      ) : m.kind === 'poll' && !m.deleted && m.payload ? (
        <PollCard m={m} p={m.payload as PollPayload} act={act} />
      ) : (
        <span>{m.body}</span>
      )}
      <span className="time">{hhmm(m.createdAt)}</span>
      {focused && (canDelete || canBan) && (
        <div className="msgactions" onClick={(e) => e.stopPropagation()}>
          {canDelete && <button onClick={() => act(store.remove(m.id), 'Message deleted')}>Delete</button>}
          {canBan && <button onClick={() => act(store.ban(c.id, m.playerId!), 'Member removed')}>Remove {m.name}</button>}
        </div>
      )}
    </div>
  );
}

function SignalCard({ p, note, onOpen }: { p: SignalPayload; note: string; onOpen: (sym: string) => void }) {
  const def = SYMBOL_MAP[p.sym];
  if (!def) return <span>{note}</span>;
  const rr = Math.abs(p.tp - p.entry) / Math.max(1e-9, Math.abs(p.entry - p.sl));
  return (
    <div>
      <span className="kicker">TRADE SIGNAL</span>
      <div className="sighead">
        {def.name}
        <span className={`dir ${p.side === 1 ? 'buyc' : 'sellc'}`}>{p.side === 1 ? 'BUY' : 'SELL'}</span>
        <span className="muted num" style={{ marginLeft: 'auto', fontSize: 11 }}>R:R 1:{rr.toFixed(1)}</span>
      </div>
      <div className="signal">
        <div><span>ENTRY</span><b>{fmtPrice(def, p.entry)}</b></div>
        <div><span>STOP</span><b className="down">{fmtPrice(def, p.sl)}</b></div>
        <div><span>TARGET</span><b className="up">{fmtPrice(def, p.tp)}</b></div>
      </div>
      {note && <div style={{ marginTop: 6 }}>{note}</div>}
      <button className="copybtn" onClick={(e) => { e.stopPropagation(); onOpen(p.sym); }}>Open {def.name} in terminal</button>
    </div>
  );
}

function PollCard({ m, p, act }: { m: Msg; p: PollPayload; act: (x: Promise<string | null>, ok?: string) => Promise<boolean> }) {
  const r = comms.pollResults(m.id, p.options.length);
  return (
    <div>
      <span className="kicker">POLL</span>
      <div style={{ fontWeight: 600 }}>{m.body}</div>
      <div className="poll">
        {p.options.map((o, i) => {
          const pct = r.total ? (r.counts[i] / r.total) * 100 : 0;
          return (
            <button key={i} className={`popt ${r.mine === i ? 'mine' : ''}`} onClick={(e) => { e.stopPropagation(); void act(comms.vote(m.id, i)); sfx.tap(); }}>
              <span className="fill" style={{ width: `${pct}%` }} />
              <span>{r.mine === i ? '● ' : ''}{o}</span>
              <b>{Math.round(pct)}%</b>
            </button>
          );
        })}
      </div>
      <div className="pollmeta" style={{ marginTop: 6 }}>{r.total} vote{r.total === 1 ? '' : 's'}{r.mine !== null ? ' · tap to change' : ''}</div>
    </div>
  );
}

// ====================================================================== admin sheets

function CreateSheet({ notify, onClose }: { notify: Notify; onClose: () => void }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [broadcast, setBroadcast] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const err = await comms.create(name, desc, broadcast);
    setBusy(false);
    if (err) notify('Could not create', err, 'bad');
    else {
      notify('Community created', name.trim(), 'good');
      onClose();
    }
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>New community</h3>
        <label>Name<input value={name} maxLength={40} placeholder="e.g. London Session Desk" onChange={(e) => setName(e.target.value)} /></label>
        <label>Description<textarea rows={2} value={desc} maxLength={200} placeholder="What this group is for" onChange={(e) => setDesc(e.target.value)} /></label>
        <div className="adminbar" style={{ borderRadius: 12, border: '1px solid var(--hair)' }}>
          <Icon.broadcast /> Start in broadcast mode
          <button className={`switch ${broadcast ? 'on' : ''}`} aria-label="Broadcast mode" onClick={() => setBroadcast(!broadcast)} />
        </div>
        <button className="primary" disabled={busy || name.trim().length < 2} onClick={submit}>{busy ? 'Creating…' : 'Create community'}</button>
      </div>
    </div>
  );
}

function AdminComposer({ c, notify, onClose }: { c: Community; notify: Notify; onClose: () => void }) {
  const [kind, setKind] = useState<'announcement' | 'signal' | 'poll'>('announcement');
  const [body, setBody] = useState('');
  const [sym, setSym] = useState('XAUUSD');
  const [side, setSide] = useState<1 | -1>(1);
  const q = quote(sym, Date.now() / 1000);
  const def = SYMBOL_MAP[sym];
  const dist = def.base * def.vol1m * 6;
  const [lv, setLv] = useState<{ entry: string; sl: string; tp: string } | null>(null);
  const levels = lv ?? {
    entry: fmtPrice(def, side === 1 ? q.ask : q.bid),
    sl: fmtPrice(def, (side === 1 ? q.ask : q.bid) - side * dist),
    tp: fmtPrice(def, (side === 1 ? q.ask : q.bid) + side * dist * 2),
  };
  const [options, setOptions] = useState(['', '']);

  const submit = async () => {
    let err: string | null;
    if (kind === 'signal') {
      const e = Number(levels.entry), s = Number(levels.sl), t = Number(levels.tp);
      if (![e, s, t].every(Number.isFinite)) return notify('Invalid levels', 'Entry, stop and target must be numbers.', 'bad');
      if (side === 1 ? !(s < e && t > e) : !(s > e && t < e)) return notify('Invalid levels', 'Stop must be beyond entry against the trade, target in its favour.', 'bad');
      err = await comms.post(c.id, 'signal', body || `${side === 1 ? 'Buy' : 'Sell'} ${def.name}`, { sym, side, entry: e, sl: s, tp: t });
    } else if (kind === 'poll') {
      const opts = options.map((o) => o.trim()).filter(Boolean);
      if (opts.length < 2) return notify('Poll needs options', 'Add at least two options.', 'bad');
      err = await comms.post(c.id, 'poll', body, { options: opts.slice(0, 6) });
    } else {
      err = await comms.post(c.id, 'announcement', body);
    }
    if (err) notify('Not sent', err, 'bad');
    else {
      sfx.tap();
      onClose();
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <h3>Post to {c.name}</h3>
        <div className="seg">
          {(['announcement', 'signal', 'poll'] as const).map((k) => (
            <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>{k[0].toUpperCase() + k.slice(1)}</button>
          ))}
        </div>

        {kind === 'signal' && (
          <>
            <label>Instrument
              <div className="seg" style={{ gridAutoFlow: 'row', gridTemplateColumns: 'repeat(3, 1fr)' }}>
                {SYMBOLS.map((s) => (
                  <button key={s.id} className={sym === s.id ? 'on' : ''} onClick={() => { setSym(s.id); setLv(null); }}>{s.name}</button>
                ))}
              </div>
            </label>
            <div className="row2">
              <button className={side === 1 ? 'on buyc' : ''} style={side === 1 ? { borderColor: 'var(--buy)' } : undefined} onClick={() => { setSide(1); setLv(null); }}>BUY</button>
              <button className={side === -1 ? 'on sellc' : ''} style={side === -1 ? { borderColor: 'var(--sell)' } : undefined} onClick={() => { setSide(-1); setLv(null); }}>SELL</button>
            </div>
            <div className="row2" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              {(['entry', 'sl', 'tp'] as const).map((k) => (
                <label key={k}>{k === 'sl' ? 'Stop' : k === 'tp' ? 'Target' : 'Entry'}
                  <input className="num" inputMode="decimal" value={levels[k]} onChange={(e) => setLv({ ...levels, [k]: e.target.value })} />
                </label>
              ))}
            </div>
          </>
        )}

        <label>{kind === 'poll' ? 'Question' : kind === 'signal' ? 'Note (optional)' : 'Message'}
          <textarea rows={3} value={body} maxLength={1000} onChange={(e) => setBody(e.target.value)} placeholder={kind === 'poll' ? 'e.g. Where does gold close Friday?' : kind === 'signal' ? 'Rationale, timeframe…' : 'Write an announcement for all members'} />
        </label>

        {kind === 'poll' && (
          <>
            {options.map((o, i) => (
              <input key={i} value={o} maxLength={60} placeholder={`Option ${i + 1}`} onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
            ))}
            {options.length < 6 && <button className="ghost" onClick={() => setOptions([...options, ''])}>Add option</button>}
          </>
        )}

        <button className="primary" disabled={kind !== 'signal' && !body.trim()} onClick={submit}>Post {kind}</button>
      </div>
    </div>
  );
}
