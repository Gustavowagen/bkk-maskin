import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatChips, formatCompact } from '../utils/format'

export interface ChartPoint {
  label: string; // Shown on the x axis and in the tooltip
  value: number;
}

const MARGIN = { top: 16, right: 16, bottom: 28, left: 52 }

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

/** Rounds the axis max/min out to a clean step and returns the tick values */
const niceTicks = (min: number, max: number, count = 4): number[] => {
  const span = max - min || 1
  const rawStep = span / count
  const magnitude = 10 ** Math.floor(Math.log10(rawStep))
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= rawStep) ?? rawStep
  const ticks: number[] = []
  for (let tick = Math.floor(min / step) * step; tick <= Math.ceil(max / step) * step + step / 2; tick += step) {
    ticks.push(Math.round(tick))
  }
  return ticks
}

/** Every nth x label so they never collide */
const labelEvery = (count: number, plotWidth: number) => Math.max(1, Math.ceil(count / Math.max(1, plotWidth / 56)))

interface TooltipState {
  x: number;
  y: number;
  content: ReactNode;
}

const Tooltip = ({ tooltip }: { tooltip: TooltipState | null }) =>
  tooltip && (
    <div className="chart-tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
      {tooltip.content}
    </div>
  )

interface ColumnChartProps {
  data: ChartPoint[];
  height?: number;
  valueLabel: string;
}

/** Single-series column chart with a per-column hover tooltip */
export const ColumnChart = ({ data, height = 220, valueLabel }: ColumnChartProps) => {
  const { ref, width } = useWidth()
  const [hovered, setHovered] = useState<number | null>(null)

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const plotHeight = height - MARGIN.top - MARGIN.bottom
  const ticks = niceTicks(0, Math.max(...data.map(d => d.value), 1))
  const yMax = ticks[ticks.length - 1]
  const y = (value: number) => MARGIN.top + plotHeight - (value / yMax) * plotHeight
  const slot = plotWidth / Math.max(1, data.length)
  const barWidth = Math.max(2, Math.min(24, slot - 6))
  const every = labelEvery(data.length, plotWidth)

  const tooltip: TooltipState | null = hovered === null ? null : {
    x: MARGIN.left + slot * (hovered + 0.5),
    y: y(data[hovered].value) - 8,
    content: (
      <>
        <span className="chart-tooltip-label">{data[hovered].label}</span>
        <span className="chart-tooltip-value">{formatChips(data[hovered].value)} <small>{valueLabel}</small></span>
      </>
    ),
  }

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${valueLabel} per week`}>
          {ticks.map(tick => (
            <g key={tick}>
              <line className="chart-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-axis-text" x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatCompact(tick)}</text>
            </g>
          ))}
          {data.map((point, i) => {
            const x = MARGIN.left + slot * i + (slot - barWidth) / 2
            const top = y(point.value)
            const barHeight = y(0) - top
            const r = Math.min(4, barHeight, barWidth / 2)
            return (
              <g key={point.label} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)}>
                <rect x={MARGIN.left + slot * i} y={MARGIN.top} width={slot} height={plotHeight} fill="transparent" />
                {barHeight > 0 && (
                  <path
                    className={`chart-bar${hovered !== null && hovered !== i ? ' chart-bar-dim' : ''}`}
                    d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + barWidth - r} Q${x + barWidth},${top} ${x + barWidth},${top + r} V${y(0)} Z`}
                  />
                )}
                {i % every === 0 && (
                  <text className="chart-axis-text" x={MARGIN.left + slot * (i + 0.5)} y={height - 8} textAnchor="middle">{point.label}</text>
                )}
              </g>
            )
          })}
          <line className="chart-baseline" x1={MARGIN.left} x2={width - MARGIN.right} y1={y(0)} y2={y(0)} />
        </svg>
      )}
      <Tooltip tooltip={tooltip} />
    </div>
  )
}

interface LineChartProps {
  data: ChartPoint[];
  height?: number;
  valueLabel: string;
}

/** Single-series line chart with a zero baseline, area wash and crosshair tooltip */
export const LineChart = ({ data, height = 220, valueLabel }: LineChartProps) => {
  const { ref, width } = useWidth()
  const [hovered, setHovered] = useState<number | null>(null)

  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const plotHeight = height - MARGIN.top - MARGIN.bottom
  const values = data.map(d => d.value)
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values))
  const yMin = ticks[0]
  const yMax = ticks[ticks.length - 1]
  const y = (value: number) => MARGIN.top + plotHeight - ((value - yMin) / (yMax - yMin || 1)) * plotHeight
  const x = (i: number) => MARGIN.left + (data.length > 1 ? (i / (data.length - 1)) * plotWidth : plotWidth / 2)
  const every = labelEvery(data.length, plotWidth)

  const line = data.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(d.value)}`).join(' ')
  const area = data.length > 0 ? `${line} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z` : ''
  const last = data.length - 1

  const handleMove = (event: React.MouseEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - box.left) / box.width
    setHovered(Math.max(0, Math.min(last, Math.round(ratio * last))))
  }

  const tooltip: TooltipState | null = hovered === null ? null : {
    x: x(hovered),
    y: y(data[hovered].value) - 12,
    content: (
      <>
        <span className="chart-tooltip-label">{data[hovered].label}</span>
        <span className="chart-tooltip-value">
          {data[hovered].value > 0 ? '+' : ''}{formatChips(data[hovered].value)} <small>{valueLabel}</small>
        </span>
      </>
    ),
  }

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && data.length > 0 && (
        <svg width={width} height={height} role="img" aria-label={valueLabel}>
          {ticks.map(tick => (
            <g key={tick}>
              <line className={tick === 0 ? 'chart-baseline' : 'chart-grid'} x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} />
              <text className="chart-axis-text" x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end">{formatCompact(tick)}</text>
            </g>
          ))}
          {data.map((point, i) => i % every === 0 && (
            <text key={point.label} className="chart-axis-text" x={x(i)} y={height - 8} textAnchor="middle">{point.label}</text>
          ))}
          <path className="chart-area" d={area} />
          <path className="chart-line" d={line} />
          {hovered !== null && (
            <line className="chart-crosshair" x1={x(hovered)} x2={x(hovered)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} />
          )}
          <circle className="chart-dot" cx={x(hovered ?? last)} cy={y(data[hovered ?? last].value)} r={4.5} />
          <rect
            x={MARGIN.left} y={MARGIN.top} width={plotWidth} height={plotHeight} fill="transparent"
            onMouseMove={handleMove} onMouseLeave={() => setHovered(null)}
          />
        </svg>
      )}
      <Tooltip tooltip={tooltip} />
    </div>
  )
}
