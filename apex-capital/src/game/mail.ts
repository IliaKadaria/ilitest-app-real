import { useSyncExternalStore } from 'react';
import { getItem, setItem } from '../storage.ts';

// MT5-style mailbox: broker messages about fills, reviews and promotions.

export interface Mail {
  id: string;
  at: number;
  from: string;
  subject: string;
  body: string;
  read: boolean;
  tone: 'good' | 'bad' | 'info';
}

const KEY = 'apex.mail.v1';
type Listener = () => void;

class Mailbox {
  items: Mail[] = (() => {
    try {
      return (JSON.parse(getItem(KEY) ?? '[]') as Mail[]) ?? [];
    } catch {
      return [];
    }
  })();
  private listeners = new Set<Listener>();
  private version = 0;
  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getVersion = () => this.version;
  private save() {
    setItem(KEY, JSON.stringify(this.items.slice(0, 200)));
    this.version++;
    this.listeners.forEach((l) => l());
  }
  add(subject: string, body: string, tone: Mail['tone'] = 'info', from = 'Apex Capital') {
    this.items = [{ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() / 1000, from, subject, body, read: false, tone }, ...this.items].slice(0, 200);
    this.save();
  }
  markRead(id: string) {
    this.items = this.items.map((m) => (m.id === id ? { ...m, read: true } : m));
    this.save();
  }
  markAll() {
    this.items = this.items.map((m) => ({ ...m, read: true }));
    this.save();
  }
  remove(id: string) {
    this.items = this.items.filter((m) => m.id !== id);
    this.save();
  }
  unread(): number {
    return this.items.filter((m) => !m.read).length;
  }
}

export const mail = new Mailbox();

export function useMail() {
  useSyncExternalStore(mail.subscribe, mail.getVersion);
  return mail;
}
