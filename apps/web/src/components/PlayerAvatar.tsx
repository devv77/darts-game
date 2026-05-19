import type { Player } from '../types';

interface Props {
  player: Pick<Player, 'name' | 'avatar_color' | 'avatar_url'>;
  className?: string;
}

export function PlayerAvatar({ player, className }: Props) {
  const cls = 'avatar' + (className ? ` ${className}` : '');
  if (player.avatar_url) {
    return <img className={cls} src={player.avatar_url} alt="" referrerPolicy="no-referrer" />;
  }
  return <span className={cls} style={{ background: player.avatar_color }} />;
}
