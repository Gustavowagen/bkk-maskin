import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { formatCompact } from '../utils/format'

/** Width of the element, kept up to date when it resizes */
const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}

/** Rounds the axis min/max out to a clean step and returns the tick values */
const niceTicks = (min: number, max: number, count = 4): number[] => {
  const span = max - min || 1
  const rawStep = span / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= rawStep) ?? rawStep
  const ticks: number[] = []
  for (let tick = Math.floor(min / step) * step; tick <= Math.ceil(max / step) * step + step / 2; tick += step) {
    ticks.push(Math.round(tick * 1000) / 1000)
  }
  return ticks
}

// Rough width of a caption-size label, enough to lay out axes without measuring the DOM
const textWidth = (text: string) => text.length * 6.6

export interface TooltipLine {
  label: string;
  value: string;
  color?: string;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  lines: TooltipLine[];
}

/** Tooltip kept inside the chart, placed next to the pointer */
const useTooltip = () => {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const show = (event: MouseEvent, container: HTMLElement | null, title: string, lines: TooltipLine[]) => {
    if (!container) return
    const box = container.getBoundingClientRect()
    setTooltip({ x: event.clientX - box.left, y: event.clientY - box.top, title, lines })
  }
  const hide = () => setTooltip(null)
  return { tooltip, show, hide }
}

const Tooltip = ({ tooltip, width }: { tooltip: TooltipState | null; width: number }) => {
  if (!tooltip) return null
  // Flip to the left of the pointer near the right edge
  const flip = tooltip.x > width - 200
  return (
    <div
      className="ck-tip"
      style={{
        left: flip ? undefined : tooltip.x + 12,
        right: flip ? width - tooltip.x + 12 : undefined,
        top: Math.max(0, tooltip.y - 12),
        transform: 'translateY(-100%)',
      }}
    >
      <div className="ck-tip-title">{tooltip.title}</div>
      {tooltip.lines.map(line => (
        <div key={line.label} className="ck-tip-row">
          {line.color && <i style={{ background: line.color }} />}
          <span>{line.label}</span>
          <em>{line.value}</em>
        </div>
      ))}
    </div>
  )
}

export const Legend = ({ items }: { items: { label: string; color: string }[] }) => (
  <div className="ck-legend">
    {items.map(item => (
      <span key={item.label}><i style={{ background: item.color }} />{item.label}</span>
    ))}
  </div>
)

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

export interface ColumnDatum {
  key: string;
  label: string; // Under the column
  title: string; // Tooltip title
  values: Record<string, number>; // Value per series key
  lines: TooltipLine[];
}

/** Columns, stacked when there is more than one series, with a hover tooltip per column */
export const ColumnChart = ({ data, series, height = 240 }: { data: ColumnDatum[]; series: ColumnSeries[]; height?: number }) => {
  const { ref, width } = useWidth()
  const { tooltip, show, hide } = useTooltip()
  const [hovered, setHovered] = useState<string | null>(null)

  const totals = data.map(d => series.reduce((sum, s) => sum + Math.max(0, d.values[s.key] ?? 0), 0))
  const ticks = niceTicks(0, Math.max(1, ...totals) * 1.05)
  const yMax = ticks[ticks.length - 1]
  const left = Math.max(...ticks.map(t => textWidth(formatCompact(t)))) + 12
  const top = 8
  const bottom = 26
  const plotHeight = height - top - bottom
  const y = (value: number) => top + plotHeight - (value / yMax) * plotHeight
  const slot = Math.max(0, width - left - 4) / Math.max(1, data.length)
  const barWidth = Math.max(2, Math.min(32, slot * 0.7))
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, (width - left) / 56)))

  return (
    <div className="ck-chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {ticks.map(tick => (
            <g key={tick}>
              <line className="ck-grid-line" x1={left} x2={width - 4} y1={y(tick)} y2={y(tick)} />
              <text x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatCompact(tick)}</text>
            </g>
          ))}
          <line className="ck-axis-line" x1={left} x2={width - 4} y1={y(0)} y2={y(0)} />
          {data.map((d, i) => {
            const x = left + slot * i + (slot - barWidth) / 2
            let base = 0
            return (
              <g
                key={d.key}
                className={hovered !== null && hovered !== d.key ? 'ck-dim' : undefined}
                onMouseMove={e => {
                  setHovered(d.key)
                  show(e, ref.current, d.title, d.lines)
                }}
                onMouseLeave={() => {
                  setHovered(null)
                  hide()
                }}
              >
                <rect x={left + slot * i} y={top} width={slot} height={plotHeight} fill="transparent" />
                {series.map(s => {
                  const value = Math.max(0, d.values[s.key] ?? 0)
                  if (value === 0) return null
                  const y0 = y(base)
                  base += value
                  const y1 = y(base)
                  return <rect key={s.key} x={x} width={barWidth} y={y1} height={Math.max(0, y0 - y1 - (series.length > 1 ? 1 : 0))} rx={3} fill={s.color} />
                })}
                {i % every === 0 && (
                  <text x={left + slot * (i + 0.5)} y={height - 8} textAnchor="middle">{d.label}</text>
                )}
              </g>
            )
          })}
        </svg>
      )}
      <Tooltip tooltip={tooltip} width={width} />
    </div>
  )
}

export interface HBarDatum {
  key: string;
  label: string;
  value: number;
  title: string;
  lines: TooltipLine[];
}

/**
 * Horizontal bars, one row each. With `signed`, bars go left of zero for negative values.
 * Rows are clickable when `onSelect` is given.
 */
export const HBarChart = ({ data, color, signed = false, format, onSelect, rowHeight = 22 }: {
  data: HBarDatum[];
  color: (value: number) => string;
  signed?: boolean;
  format: (value: number) => string;
  onSelect?: (key: string) => void;
  rowHeight?: number;
}) => {
  const { ref, width } = useWidth()
  const { tooltip, show, hide } = useTooltip()
  const height = data.length * rowHeight + 4
  const labels = data.map(d => (d.label.length > 18 ? `${d.label.slice(0, 17)}…` : d.label))
  const labelWidth = Math.min(width * 0.4, Math.max(0, ...labels.map(textWidth)) + 12)
  const valueWidth = Math.max(0, ...data.map(d => textWidth(format(d.value)))) + 8
  const lo = Math.min(0, ...data.map(d => d.value))
  const hi = Math.max(0, ...data.map(d => d.value))
  const x0 = labelWidth + (lo < 0 ? valueWidth : 0)
  const x1 = width - (hi > 0 || !signed ? valueWidth : 4)
  const x = (value: number) => x0 + ((value - lo) / (hi - lo || 1)) * Math.max(0, x1 - x0)

  return (
    <div className="ck-chart" ref={ref} style={{ height, minHeight: 0 }}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          <line className="ck-axis-line" x1={x(0)} x2={x(0)} y1={0} y2={height} />
          {data.map((d, i) => (
            <g
              key={d.key}
              transform={`translate(0,${i * rowHeight})`}
              style={onSelect ? { cursor: 'pointer' } : undefined}
              onMouseMove={e => show(e, ref.current, d.title, d.lines)}
              onMouseLeave={hide}
              onClick={() => {
                hide()
                onSelect?.(d.key)
              }}
            >
              <rect x={0} width={width} height={rowHeight} fill="transparent" />
              <text x={labelWidth - 10} y={rowHeight / 2 + 4} textAnchor="end">{labels[i]}</text>
              <rect
                x={Math.min(x(0), x(d.value))}
                width={Math.max(d.value === 0 ? 0 : 1, Math.abs(x(d.value) - x(0)))}
                y={4}
                height={rowHeight - 8}
                rx={4}
                fill={color(d.value)}
              />
              <text
                className="ck-value-text"
                x={d.value < 0 ? x(d.value) - 6 : x(d.value) + 6}
                y={rowHeight / 2 + 4}
                textAnchor={d.value < 0 ? 'end' : 'start'}
              >
                {format(d.value)}
              </text>
            </g>
          ))}
        </svg>
      )}
      <Tooltip tooltip={tooltip} width={width} />
    </div>
  )
}

export interface LinePoint {
  key: string;
  label: string; // Under the axis
  value: number;
  title: string;
  lines: TooltipLine[];
}

/** A line with a dot per point, a zero line and a tooltip per point */
export const LineChart = ({ data, color, height = 240 }: { data: LinePoint[]; color: string; height?: number }) => {
  const { ref, width } = useWidth()
  const { tooltip, show, hide } = useTooltip()
  const [hovered, setHovered] = useState<number | null>(null)

  const values = data.map(d => d.value)
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const left = Math.max(...ticks.map(t => textWidth(formatCompact(t)))) + 12
  const top = 10
  const bottom = 26
  const plotHeight = height - top - bottom
  const y = (value: number) => top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight
  const plotLeft = left + 8
  const plotRight = width - 10
  const x = (i: number) => (data.length > 1 ? plotLeft + (i / (data.length - 1)) * (plotRight - plotLeft) : (plotLeft + plotRight) / 2)
  const step = data.length > 1 ? x(1) - x(0) : width
  const every = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor((width - left) / 80))))
  const path = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ')
  const last = data.length - 1

  return (
    <div className="ck-chart" ref={ref} style={{ height }}>
      {width > 0 && data.length > 0 && (
        <svg width={width} height={height} role="img">
          {ticks.map(tick => (
            <g key={tick}>
              <line className="ck-grid-line" x1={left} x2={width - 4} y1={y(tick)} y2={y(tick)} />
              <text x={left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatCompact(tick)}</text>
            </g>
          ))}
          <line className="ck-reference-line" x1={left} x2={width - 4} y1={y(0)} y2={y(0)} />
          {data.map((d, i) => i % every === 0 && (
            <text key={d.key} x={x(i)} y={height - 8} textAnchor="middle">{d.label}</text>
          ))}
          <path d={path} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) => (
            <circle key={d.key} cx={x(i)} cy={y(d.value)} r={hovered === i || (hovered === null && i === last) ? 5 : 3} fill={color} />
          ))}
          {data.map((d, i) => (
            <rect
              key={d.key}
              x={x(i) - step / 2}
              width={step}
              y={0}
              height={height - 20}
              fill="transparent"
              onMouseMove={e => {
                setHovered(i)
                show(e, ref.current, d.title, d.lines)
              }}
              onMouseLeave={() => {
                setHovered(null)
                hide()
              }}
            />
          ))}
        </svg>
      )}
      <Tooltip tooltip={tooltip} width={width} />
    </div>
  )
}

export interface HeatmapCell {
  row: number;
  col: number;
  value: number;
  title: string;
  lines: TooltipLine[];
}

/** A grid of cells whose opacity follows their value */
export const Heatmap = ({ rows, columns, cells, color, columnEvery }: {
  rows: string[];
  columns: string[];
  cells: HeatmapCell[];
  color: string;
  columnEvery?: number;
}) => {
  const { ref, width } = useWidth()
  const { tooltip, show, hide } = useTooltip()
  const left = Math.max(...rows.map(textWidth)) + 10
  const cellWidth = Math.max(1, (width - left - 4) / Math.max(1, columns.length))
  const cellHeight = Math.min(28, Math.max(18, cellWidth))
  const height = rows.length * cellHeight + 26
  const max = Math.max(0, ...cells.map(c => c.value))
  const lookup = new Map(cells.map(c => [`${c.row}|${c.col}`, c]))
  const every = columnEvery ?? (cellWidth < 22 ? 3 : cellWidth < 34 ? 2 : 1)

  return (
    <div className="ck-chart" ref={ref} style={{ height, minHeight: 0 }}>
      {width > 0 && (
        <svg width={width} height={height} role="img">
          {rows.map((name, r) => (
            <text key={name} x={left - 8} y={r * cellHeight + cellHeight / 2 + 4} textAnchor="end">{name}</text>
          ))}
          {rows.map((rowName, r) => columns.map((colName, c) => {
            const cell = lookup.get(`${r}|${c}`)
            return (
              <rect
                key={`${rowName}|${colName}`}
                x={left + c * cellWidth + 1}
                y={r * cellHeight + 1}
                width={Math.max(1, cellWidth - 2)}
                height={cellHeight - 2}
                rx={3}
                fill={cell && cell.value > 0 ? color : 'var(--ck-grid)'}
                fillOpacity={cell && cell.value > 0 ? 0.08 + 0.92 * (cell.value / (max || 1)) : 0.6}
                onMouseMove={e => cell ? show(e, ref.current, cell.title, cell.lines) : hide()}
                onMouseLeave={hide}
              />
            )
          }))}
          {columns.map((name, c) => c % every === 0 && (
            <text key={name} x={left + c * cellWidth + cellWidth / 2} y={rows.length * cellHeight + 16} textAnchor="middle">{name}</text>
          ))}
        </svg>
      )}
      <Tooltip tooltip={tooltip} width={width} />
    </div>
  )
}

export interface GanttBar {
  key: string;
  row: string; // The row (night) the bar is drawn in
  start: number; // Hours from the start of the row
  end: number;
  color: string;
  title: string;
  lines: TooltipLine[];
}

/** One row per night, bars from open to close; overlapping bars stack into lanes */
export const GanttChart = ({ rows, bars, hourLabel }: {
  rows: { key: string; label: string }[];
  bars: GanttBar[];
  hourLabel: (hour: number) => string;
}) => {
  const { ref, width } = useWidth()
  const { tooltip, show, hide } = useTooltip()
  const [hovered, setHovered] = useState<string | null>(null)

  // Lanes per row: each bar takes the first lane that is free when it opens
  const lanes = new Map<string, number>()
  const laneOf = new Map<string, number>()
  rows.forEach(row => {
    const ends: number[] = []
    bars.filter(b => b.row === row.key).sort((a, b) => a.start - b.start).forEach(bar => {
      let lane = ends.findIndex(end => end <= bar.start)
      if (lane < 0) {
        lane = ends.length
        ends.push(0)
      }
      ends[lane] = bar.end
      laneOf.set(bar.key, lane)
    })
    lanes.set(row.key, Math.max(1, ends.length))
  })

  const left = Math.max(0, ...rows.map(r => textWidth(r.label))) + 14
  const laneHeight = 9
  const gap = 14
  const rowTop = new Map<string, number>()
  let yy = 4
  rows.forEach(row => {
    rowTop.set(row.key, yy)
    yy += lanes.get(row.key)! * laneHeight + gap
  })
  const height = yy + 18
  const minHour = Math.floor(Math.min(...bars.map(b => b.start)))
  const maxHour = Math.ceil(Math.max(...bars.map(b => b.end)))
  const x = (hour: number) => left + ((hour - minHour) / (maxHour - minHour || 1)) * Math.max(0, width - left - 6)
  const tickStep = width < 500 ? 3 : 2
  const ticks: number[] = []
  for (let h = minHour; h <= maxHour; h += tickStep) ticks.push(h)

  return (
    <div className="ck-chart" ref={ref} style={{ height }}>
      {width > 0 && bars.length > 0 && (
        <svg width={width} height={height} role="img">
          {ticks.map(t => (
            <g key={t}>
              <line className="ck-grid-line" x1={x(t)} x2={x(t)} y1={0} y2={height - 18} />
              <text x={x(t)} y={height - 4} textAnchor="middle">{hourLabel(t)}</text>
            </g>
          ))}
          {rows.map(row => (
            <text key={row.key} x={left - 10} y={rowTop.get(row.key)! + (lanes.get(row.key)! * laneHeight) / 2 + 4} textAnchor="end">{row.label}</text>
          ))}
          {bars.map(bar => (
            <rect
              key={bar.key}
              x={x(bar.start)}
              width={Math.max(2, x(bar.end) - x(bar.start))}
              y={rowTop.get(bar.row)! + laneOf.get(bar.key)! * laneHeight}
              height={laneHeight - 2}
              rx={3}
              fill={bar.color}
              stroke={hovered === bar.key ? 'var(--ck-fg)' : undefined}
              onMouseMove={e => {
                setHovered(bar.key)
                show(e, ref.current, bar.title, bar.lines)
              }}
              onMouseLeave={() => {
                setHovered(null)
                hide()
              }}
            />
          ))}
        </svg>
      )}
      <Tooltip tooltip={tooltip} width={width} />
    </div>
  )
}

/** A short explanation shown instead of a chart that has nothing to draw */
export const ChartEmpty = ({ children }: { children: ReactNode }) => <p className="ck-empty">{children}</p>
