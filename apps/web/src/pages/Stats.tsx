import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Player, PlayerStats } from '../types';
import { AppHeader } from '../components/AppHeader';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { DRILLS, getPracticeHistory } from '../lib/practice';
import type { PracticeHistoryEntry } from '../lib/practice';

interface PlayerStatsRow {
  player: Player;
  stats: PlayerStats;
  practice: PracticeHistoryEntry[];
}

const DRILL_NAMES: Record<string, string> = Object.fromEntries(
  DRILLS.map((d) => [d.type, d.name])
);

export function Stats() {
  const [data, setData] = useState<PlayerStatsRow[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const players = await api.get<Player[]>('/api/players');
        const humans = players.filter((p) => !p.is_ai);
        // Stats are scoped to yourself, players you've shared a game with, and
        // admins — fetch each independently and drop the ones you can't view
        // (403) so a single forbidden player doesn't blank the whole page.
        const enriched = (await Promise.all(
          humans.map(async (p) => {
            try {
              const stats = await api.get<PlayerStats>(`/api/stats/players/${p.id}`);
              const practice = await getPracticeHistory(p.id).catch(() => [] as PracticeHistoryEntry[]);
              return { player: p, stats, practice } as PlayerStatsRow;
            } catch {
              return null;
            }
          })
        )).filter((row): row is PlayerStatsRow => row !== null);
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
                data.map(({ player, stats, practice }) => (
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
                    <PracticeHistory entries={practice} />
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

function PracticeHistory({ entries }: { entries: PracticeHistoryEntry[] }) {
  const recent = entries.slice(0, 8);
  return (
    <div className="stats-section practice-stats-section">
      <div className="stats-section-title">Practice</div>
      {recent.length === 0 ? (
        <p className="no-data">No practice sessions yet</p>
      ) : (
        recent.map((e) => {
          const name = DRILL_NAMES[e.drillType] ?? e.drillType;
          const diff = e.difficulty ? ` · ${e.difficulty}` : '';
          const date = new Date(e.sessionDate).toLocaleDateString();
          return (
            <div key={e.id} className="practice-history-row">
              <span className="practice-history-label">{name}{diff} · {date}</span>
              <span className="practice-history-metric">{e.metricName}: {e.metricValue}</span>
            </div>
          );
        })
      )}
    </div>
  );
}
