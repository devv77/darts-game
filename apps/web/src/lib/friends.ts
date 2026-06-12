// Friends graph client contract (Phase 8b). Server: apps/server/src/routes/friends.ts.
import { api } from './api';
import type { Player } from '../types';

export interface FriendEntry {
  player: Player;
  online: boolean;
}

export interface FriendsView {
  friends: FriendEntry[];
  incoming: FriendEntry[]; // pending invites sent to me
  outgoing: FriendEntry[]; // my pending invites
}

export const getFriends = () => api.get<FriendsView>('/api/friends');
export const inviteFriend = (query: string) => api.post<{ status: string }>('/api/friends/invite', { query });
export const acceptFriend = (fromId: number) => api.post<{ status: string }>(`/api/friends/${fromId}/accept`, {});
export const removeFriend = (otherId: number) => api.del(`/api/friends/${otherId}`);
