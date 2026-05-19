import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Player, PlayerStats } from '../types';
import { AppHeader } from '../components/AppHeader';
import { PlayerAvatar } from '../components/PlayerAvatar';

export function Stats() {
  const [data, setData] = useState<{ player: Player; stats: PlayerStats }[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const players = await api.get<Player[]>('/api/players');
        const humans = players.filter((p) => !p.is_ai);
        const enriched = await Promise.all(
          humans.map(async (p) => ({
            player: p,
            stats: await api.get<PlayerStats>(`/api/stats/players/${p.id}`),
          }))
        );
        setData(enriched);
      } catch {
        setData([]);
      }
    })();
  }, []);

  useEffect(() => {
    document.body.classList.add('lobby-page');
    return () => document.body.classList.remove('lobby-page');
  }, []);

  return (
    <>
      <AppHeader />
      <main className="lobby-main">
        <section className="card">
          <div className="card-header"><h2>Player Statistics</h2></div>
          <div className="card-body">
            <div>
              {!data ? (
                <p className="no-data">Loading…</p>
              ) : data.length === 0 ? (
                <p className="no-data">No players yet. Create some in the lobby!</p>
              ) : (
                data.map(({ player, stats }) => (
                  <div key={player.id} className="stats-card">
                    <h3>
                      <PlayerAvatar player={player} />
                      {player.name}
                    </h3>
                    <Section title="Overall">
                      <Stat value={stats.games_played} label="Played" />
                      <Stat value={stats.games_won} label="Won" />
                      <Stat value={`${stats.win_rate}%`} label="Win Rate" />
                    </Section>
                    <Section title="X01 Averages">
                      <Stat value={stats.x01_average} label="3-Dart Avg" />
                      <Stat value={stats.first_9_average} label="First 9 Avg" />
                      <Stat value={stats.best_leg_darts ?? '-'} label="Best Leg" />
                    </Section>
                    <Section title="X01 Scores">
                      <Stat value={stats.count_180} label="180s" highlight="red" />
                      <Stat value={stats.count_140_plus} label="140+" highlight="gold" />
                      <Stat value={stats.count_100_plus} label="100+" />
                      <Stat value={stats.highest_turn} label="Highest" />
                      <Stat value={`${stats.checkout_pct}%`} label="Checkout %" />
                      <Stat value={`${stats.bust_rate}%`} label="Bust Rate" />
                    </Section>
                    {stats.cricket_games_played > 0 && (
                      <Section title="Cricket">
                        <Stat value={stats.cricket_games_played} label="Played" />
                        <Stat value={stats.cricket_games_won} label="Won" />
                        <Stat value={`${stats.cricket_win_rate}%`} label="Win Rate" />
                      </Section>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="stats-section">
      <div className="stats-section-title">{title}</div>
      <div className="stat-grid">{children}</div>
    </div>
  );
}

function Stat({ value, label, highlight }: { value: React.ReactNode; label: string; highlight?: 'red' | 'gold' }) {
  const cls = 'stat-item' + (highlight ? ' highlight-' + highlight : '');
  return (
    <div className={cls}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}
