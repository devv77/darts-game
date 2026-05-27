import { useState } from 'react';
import { api } from '../lib/api';

export function AddPlayerInline({ onAdded }: { onAdded: () => void }) {
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');

  async function addPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.post('/api/players', { name: newName.trim(), avatar_color: newColor });
      setNewName('');
      onAdded();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <form className="inline-form" onSubmit={addPlayer}>
      <input
        type="text"
        placeholder="Add local player (guest)"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        required
      />
      <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
      <button type="submit" className="btn btn-primary">Add</button>
    </form>
  );
}
