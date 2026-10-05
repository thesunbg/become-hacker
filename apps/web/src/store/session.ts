import { create } from 'zustand';
import type { MeResponse } from '@zero-root/types';
import { api } from '../lib/api';

interface SessionState {
  me: MeResponse | null;
  status: 'unknown' | 'signed-in' | 'signed-out';
  refresh: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, username: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/**
 * Who is signed in, as far as the server is concerned.
 *
 * The store never decides this: it asks. A 401 from /api/me is the only thing that makes the
 * app consider itself signed out, so a client-side flag cannot be flipped to fake a session.
 */
export const useSession = create<SessionState>((set) => ({
  me: null,
  status: 'unknown',

  async refresh() {
    try {
      set({ me: await api.me(), status: 'signed-in' });
    } catch {
      set({ me: null, status: 'signed-out' });
    }
  },

  async signIn(email, password) {
    await api.login(email, password);
    set({ me: await api.me(), status: 'signed-in' });
  },

  async signUp(email, username, password) {
    await api.register(email, username, password);
    set({ me: await api.me(), status: 'signed-in' });
  },

  async signOut() {
    await api.logout().catch(() => undefined);
    set({ me: null, status: 'signed-out' });
  },
}));
