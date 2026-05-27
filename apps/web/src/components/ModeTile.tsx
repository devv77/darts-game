interface Props {
  icon: string;
  name: string;
  description: string;
  selected?: boolean;
  onClick: () => void;
}

export function ModeTile({ icon, name, description, selected, onClick }: Props) {
  return (
    <button className={'mode-tile' + (selected ? ' selected' : '')} onClick={onClick}>
      <span className="mode-tile-icon">{icon}</span>
      <span className="mode-tile-name">{name}</span>
      <span className="mode-tile-desc">{description}</span>
    </button>
  );
}
