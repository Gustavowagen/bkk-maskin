export interface StatDelta {
  text: string;
  good: boolean;
}

interface StatTileProps {
  label: string;
  value: string;
  delta?: StatDelta;
  hint?: string;
}

const StatTile = ({ label, value, delta, hint }: StatTileProps) => (
  <div className="stat-tile">
    <span className="stat-tile-label">{label}</span>
    <span className="stat-tile-value">{value}</span>
    {delta && <span className={`stat-tile-delta ${delta.good ? 'stat-positive' : 'stat-negative'}`}>{delta.text}</span>}
    {hint && <span className="stat-tile-hint">{hint}</span>}
  </div>
)

export default StatTile
