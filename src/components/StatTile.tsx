export interface StatDelta {
  text: string;
  good: boolean;
}

interface StatTileProps {
  label: string;
  value: string;
  delta?: StatDelta;
  hint?: string;
  tone?: number; // Colours the value green when positive and red when negative
  small?: boolean; // Smaller value, for text such as a tournament title
}

const StatTile = ({ label, value, delta, hint, tone, small }: StatTileProps) => (
  <div className="ck-kpi">
    <span className="ck-kpi-label">{label}</span>
    <span className={`ck-kpi-value${small ? ' small' : ''}${tone ? (tone > 0 ? ' ck-pos' : ' ck-neg') : ''}`}>{value}</span>
    {delta && <span className={`ck-kpi-delta ${delta.good ? 'ck-pos' : 'ck-neg'}`}>{delta.text}</span>}
    {hint && <span className="ck-kpi-hint">{hint}</span>}
  </div>
)

export default StatTile
