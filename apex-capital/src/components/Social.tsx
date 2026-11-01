import { useEffect, useRef, useState } from 'react';
import { useComms } from '../online/comms.ts';
import { social, useSocial, type PlayerCard } from '../online/social.ts';
import { divisionFor } from '../game/tiers.ts';
import { useGame } from '../game/store.ts';
import { ago, compactMoney, hhmm, pnlClass } from '../format.ts';
import { useT } from '../i18n.ts';
import { sfx } from '../sfx.ts';
import { Avatar } from './Avatar.tsx';
import { Badge } from './Badge.tsx';
import { Communities } from './Chat.tsx';
import { Icon } from './Icons.tsx';

type Notify = (title: string, body: string, tone?: 'good' | 'bad' | 'info') => void;
type Seg = 'communities' | 'direct' | 'friends';

const online = (c: PlayerCard | null) => !!c?.lastSeen && Date.now() / 1000 - c.lastSeen < 600;

export function ChatTab({ now, notify, onOpenSymbol }: { now: number; notify: Notify; onOpenSymbol: (sym: string) => void }) {
  const s = useSocial();
  const c = useComms();
  const t = useT();
  const [seg, setSeg] = useState<Seg>('communities');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlayerCard[] | null>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [dm, setDm] = useState<string | null>(null);
  const [room, setRoomState] = useState<{ id: string; n: number } | null>(null);
  const setRoom = (id: string) => setRoomState((r) => ({ id, n: (r?.n ?? 0) + 1 }));

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return setResults(null);
    let live = true;
    const id = window.setTimeout(() => void social.search(term).then((r) => live && setResults(r)), 250);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [q]);

  if (dm) return <DmRoom peer={dm} notify={notify} onBack={() => setDm(null)} onProfile={() => setProfile(dm)} profileOpen={profile} onCloseProfile={() => setProfile(null)} onOpenGroup={(g) => { setProfile(null); setDm(null); setSeg('communities'); setRoom(g); }} onMessage={(id) => { setProfile(null); setDm(id); }} />;

  const requests = s.friends.filter((f) => f.status === 'incoming');
  const threads = s.threads();
  const unreadDm = threads.reduce((a, x) => a + x.unread, 0);
  const commUnread = c.communities.reduce((a, x) => a + (c.membership(x.id) ? c.unread(x.id) : 0), 0);

  return (
    <div className="chattab">
      {(
        <>
          <div className="searchbar">
            <Icon.search />
            <input value={q} placeholder={t('c.search')} onChange={(e) => setQ(e.target.value.replace(/[^\w.-]/g, ''))} autoCapitalize="off" autoCorrect="off" />
            {q && <button className="ghost sm" onClick={() => setQ('')}>✕</button>}
          </div>
          {!results && (
            <div className="seg3">
              <button className={seg === 'communities' ? 'on' : ''} onClick={() => setSeg('communities')}>{t('c.communities')}{commUnread > 0 && <i className="cnt">{commUnread}</i>}</button>
              <button className={seg === 'direct' ? 'on' : ''} onClick={() => setSeg('direct')}>{t('c.direct')}{unreadDm > 0 && <i className="cnt">{unreadDm}</i>}</button>
              <button className={seg === 'friends' ? 'on' : ''} onClick={() => setSeg('friends')}>{t('c.friends')}{requests.length > 0 && <i className="cnt">{requests.length}</i>}</button>
            </div>
          )}
        </>
      )}

      {results ? (
        <div className="list">
          {!results.length && <div className="empty"><b>No traders found</b>Usernames are case-insensitive. Try at least 2 characters.</div>}
          {results.map((r) => <PlayerRow key={r.id} p={r} onOpen={() => setProfile(r.id)} action />)}
        </div>
      ) : seg === 'communities' ? (
        <Communities now={now} notify={notify} onOpenSymbol={onOpenSymbol} onProfile={(id) => setProfile(id)} openRoom={room?.id ?? null} key={room?.n ?? 0} />
      ) : seg === 'direct' ? (
        <div className="list chatlist">
          {!threads.length && <div className="empty"><b>No conversations yet</b>Add a friend, then message them from their profile.</div>}
          {threads.map(({ peer, last, unread }) => {
            const card = s.card(peer);
            const name = card?.name ?? 'Trader';
            return (
              <button key={peer} className="crow" onClick={() => { setDm(peer); sfx.tap(); }}>
                <Avatar name={name} src={card?.avatar} size={46} online={online(card)} />
                <span style={{ minWidth: 0 }}>
                  <span className="t">{name}{card && <small className="muted">{divisionFor(card.balance).label}</small>}</span>
                  <span className="p">{last.from === s.me?.id ? 'You: ' : ''}{last.body}</span>
                </span>
                <span className="meta">{hhmm(last.at)}{unread > 0 && <span className="unread">{unread}</span>}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="list">
          {requests.length > 0 && <div className="section"><span className="eyebrow">{t('c.requests')}</span><span className="eyebrow">{requests.length}</span></div>}
          {requests.map((f) => {
            const card = s.card(f.id);
            return (
              <div key={f.id} className="frow">
                <button className="frowmain" onClick={() => setProfile(f.id)}>
                  <Avatar name={card?.name ?? '?'} src={card?.avatar} size={42} />
                  <span className="qname"><b>{card?.name ?? 'Trader'}</b><small>wants to be friends · {ago(Date.now() / 1000 - f.since)} ago</small></span>
                </button>
                <button className="primary sm" onClick={() => void social.respond(f.id, true).then((e) => e ? notify('Error', e, 'bad') : notify('Friend added', card?.name ?? '', 'good'))}>Accept</button>
                <button className="ghost sm" onClick={() => void social.respond(f.id, false)}>✕</button>
              </div>
            );
          })}
          <div className="section"><span className="eyebrow">{t('c.friends')}</span><span className="eyebrow">{s.friends.filter((f) => f.status === 'friends').length}</span></div>
          {!s.friends.some((f) => f.status !== 'incoming') && <div className="empty"><b>No friends yet</b>Search a username above to add someone.</div>}
          {s.friends
            .filter((f) => f.status !== 'incoming')
            .map((f) => ({ f, card: s.card(f.id) }))
            .sort((a, b) => (b.card?.balance ?? 0) - (a.card?.balance ?? 0))
            .map(({ f, card }) => (card ? <PlayerRow key={f.id} p={card} onOpen={() => setProfile(f.id)} pending={f.status === 'outgoing'} /> : null))}
        </div>
      )}

      {profile && <ProfileSheet id={profile} notify={notify} onClose={() => setProfile(null)} onMessage={(id) => { setProfile(null); setQ(''); setDm(id); }} onOpenGroup={(g) => { setProfile(null); setQ(''); setSeg('communities'); setRoom(g); }} />}
    </div>
  );
}

function PlayerRow({ p, onOpen, action, pending }: { p: PlayerCard; onOpen: () => void; action?: boolean; pending?: boolean }) {
  const s = useSocial();
  const st = s.status(p.id);
  const d = divisionFor(p.balance);
  return (
    <div className="frow">
      <button className="frowmain" onClick={onOpen}>
        <Avatar name={p.name} src={p.avatar} size={42} online={online(p)} />
        <span className="qname">
          <b>{p.name}{p.npc && <span className="adm">DESK</span>}</b>
          <small>{d.label} · {compactMoney(p.balance)}{pending ? ' · request sent' : ''}</small>
        </span>
        <Badge d={d} size={28} />
      </button>
      {action && !st && <button className="iconbtn" aria-label="Add friend" onClick={() => void social.request(p.id)}><Icon.userPlus /></button>}
      {action && st && <span className="tag">{st === 'friends' ? 'Friend' : st === 'outgoing' ? 'Sent' : 'Wants you'}</span>}
    </div>
  );
}

export function ProfileSheet({ id, notify, onClose, onMessage, onOpenGroup }: { id: string; notify: Notify; onClose: () => void; onMessage: (id: string) => void; onOpenGroup: (communityId: string) => void }) {
  const s = useSocial();
  const c = useComms();
  const g = useGame();
  const t = useT();
  const mine = id === g.profile?.id;
  const card: PlayerCard | null = mine
    ? { id, name: g.profile!.name, avatar: g.profile!.avatar, balance: g.account.balance, totalProfit: g.account.totalProfit, bestTrade: g.account.bestTrade, wins: g.account.wins, losses: g.account.losses, blownCount: g.account.blownCount, npc: false }
    : s.card(id);
  const st = s.status(id);
  if (!card)
    return (
      <div className="modal" onClick={onClose}>
        <div className="sheet" onClick={(e) => e.stopPropagation()}><div className="grab" /><div className="empty">Loading profile…</div></div>
      </div>
    );
  const d = divisionFor(card.balance);
  const trades = card.wins + card.losses;
  const groups = s.groupsOf(id).map((cid) => c.communities.find((x) => x.id === cid)).filter(Boolean);
  const run = async (p: Promise<string | null>, ok: string) => {
    const e = await p;
    if (e) notify('Error', e, 'bad');
    else notify(ok, card.name, 'good');
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="sheet profile" onClick={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="phead">
          <Avatar name={card.name} src={card.avatar} size={86} online={mine ? true : online(card)} />
          <div>
            <h2>{card.name}{card.npc && <span className="adm">DESK</span>}</h2>
            <div className="prank"><Badge d={d} size={24} /> {d.label} <span className="muted">· {d.tier.name}</span></div>
            <div className="muted" style={{ fontSize: 12 }}>{mine ? 'This is you' : online(card) ? 'Online now' : card.lastSeen ? `Last seen ${ago(Date.now() / 1000 - card.lastSeen)} ago` : ''}</div>
          </div>
        </div>
        <div className="pstats">
          <div><span>Balance</span><b className="num">{compactMoney(card.balance)}</b></div>
          <div><span>Money made</span><b className={`num ${pnlClass(card.totalProfit)}`}>{card.totalProfit > 0 ? '+' : ''}{compactMoney(card.totalProfit)}</b></div>
          <div><span>Win rate</span><b className="num">{trades ? Math.round((card.wins / trades) * 100) : 0}%</b></div>
          <div><span>Best trade</span><b className="num up">{compactMoney(card.bestTrade)}</b></div>
          <div><span>Trades</span><b className="num">{trades}</b></div>
          <div><span>Credit reviews</span><b className="num">{card.blownCount}</b></div>
        </div>
        <div className="eyebrow">Group chats · {groups.length}</div>
        {!groups.length && <div className="muted" style={{ fontSize: 13 }}>Not in any community yet.</div>}
        {groups.map((x) => (
          <button key={x!.id} className="listbtn" onClick={() => onOpenGroup(x!.id)}>
            <Avatar name={x!.name} size={30} /> {x!.name} <small className="muted">{c.memberCount(x!.id)} members</small> <Icon.chevron />
          </button>
        ))}
        {!mine && (
          <div className="row2">
            {st === 'friends' ? (
              <>
                <button className="primary" onClick={() => onMessage(id)}>{t('c.message')}</button>
                <button className="ghost" onClick={() => void run(social.remove(id), 'Friend removed')}>Remove friend</button>
              </>
            ) : st === 'incoming' ? (
              <>
                <button className="primary" onClick={() => void run(social.respond(id, true), 'Friend added')}>Accept request</button>
                <button className="ghost" onClick={() => void run(social.respond(id, false), 'Request declined')}>Decline</button>
              </>
            ) : st === 'outgoing' ? (
              <>
                <button disabled>Request sent</button>
                <button className="ghost" onClick={() => void run(social.remove(id), 'Request cancelled')}>Cancel request</button>
              </>
            ) : (
              <>
                <button className="primary" onClick={() => void run(social.request(id), 'Friend request sent')}><Icon.userPlus /> {t('c.add')}</button>
                <button className="ghost" onClick={onClose}>{t('x.close')}</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DmRoom({ peer, notify, onBack, onProfile, profileOpen, onCloseProfile, onOpenGroup, onMessage }: { peer: string; notify: Notify; onBack: () => void; onProfile: () => void; profileOpen: string | null; onCloseProfile: () => void; onOpenGroup: (g: string) => void; onMessage: (id: string) => void }) {
  const s = useSocial();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const msgs = s.thread(peer);
  const card = s.card(peer);
  const name = card?.name ?? 'Trader';
  const friends = s.status(peer) === 'friends';
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    s.markRead(peer);
  }, [msgs.length, peer, s]);
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    const e = await social.send(peer, body);
    if (e) {
      notify('Not sent', e, 'bad');
      setText(body);
      sfx.bonk();
    } else sfx.tap();
  };
  return (
    <div className="room">
      <div className="roomhdr">
        <button className="iconbtn" aria-label="Back" onClick={onBack}><Icon.back /></button>
        <button className="dmhead" onClick={onProfile}>
          <Avatar name={name} src={card?.avatar} size={34} online={online(card)} />
          <span className="ttl"><b>{name}</b><small>{card ? `${divisionFor(card.balance).label} · ${compactMoney(card.balance)}` : ''}</small></span>
        </button>
      </div>
      <div className="msgs">
        <div className="sysmsg">Messages between friends are private.</div>
        {msgs.map((m) => (
          <div key={m.id} className={`bubble ${m.from === s.me?.id ? 'mine' : 'theirs'}`}>
            <span>{m.body}</span>
            <span className="time">{hhmm(m.at)}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      {friends ? (
        <div className="composer">
          <textarea rows={1} value={text} maxLength={1000} placeholder="Message" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="send" aria-label="Send" disabled={!text.trim()} onClick={send}><Icon.send /></button>
        </div>
      ) : (
        <div className="readonly"><Icon.lock /> Become friends to message {name}.</div>
      )}
      {profileOpen && <ProfileSheet id={profileOpen} notify={notify} onClose={onCloseProfile} onMessage={onMessage} onOpenGroup={onOpenGroup} />}
    </div>
  );
}
