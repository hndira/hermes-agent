import { useCallback, useEffect, useMemo, useState } from 'react'

type ModelAgg = [number, number, number]

interface UsageData {
  days: Record<string, Record<string, ModelAgg>>
  sessions: number
  generated_at: string
}

const MODEL_LABEL: Record<string, string> = {
  'k3-256k': 'Kimi K3(主会话)',
  'kimi-k3': 'Kimi K3(回退)',
  'kimi-k2.7-code': 'Kimi K2.7',
  'gpt-5.6-luna-900k': 'Luna(子代理)',
  'gpt-5.6-luna': 'Luna(子代理)',
  'gpt-5.6-sol': 'Sol(重活)',
  'gpt-5.6-terra': 'Terra(开发)'
}
const MODEL_COLOR: Record<string, string> = {
  'k3-256k': '#e07b39',
  'kimi-k3': '#e07b39',
  'kimi-k2.7-code': '#e0a832',
  'gpt-5.6-luna-900k': '#3a56c5',
  'gpt-5.6-luna': '#3a56c5',
  'gpt-5.6-sol': '#4a7c59',
  'gpt-5.6-terra': '#8b5fbf'
}

function human(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(2)} 亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)} 万`
  return n.toLocaleString()
}

export function UsageStatsPage() {
  const [data, setData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(false)
  const [rangeDays, setRangeDays] = useState<7 | 30>(7)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData((await window.hermesDesktop?.getUsageStats?.()) ?? null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const days = useMemo(() => {
    const all = data ? Object.keys(data.days).sort() : []
    return all.slice(-rangeDays)
  }, [data, rangeDays])

  const modelAgg = useMemo(() => {
    const agg = new Map<string, { inTok: number; outTok: number; calls: number }>()
    for (const day of days) {
      for (const [model, [i, o, c]] of Object.entries(data?.days[day] ?? {})) {
        const t = agg.get(model) ?? { inTok: 0, outTok: 0, calls: 0 }
        t.inTok += i
        t.outTok += o
        t.calls += c
        agg.set(model, t)
      }
    }
    return [...agg.entries()].sort((a, b) => b[1].inTok + b[1].outTok - (a[1].inTok + a[1].outTok))
  }, [data, days])

  const perDay = useMemo(() => {
    const map = new Map<string, number>()
    for (const day of days) {
      let t = 0
      for (const [i, o] of Object.values(data?.days[day] ?? {}).map(v => [v[0], v[1]])) {
        t += i + o
      }
      map.set(day, t)
    }
    return map
  }, [data, days])

  const totalAll = [...perDay.values()].reduce((a, b) => a + b, 0)
  const peakDay = [...perDay.entries()].reduce<[string, number]>((acc, [d, v]) => (v > acc[1] ? [d, v] : acc), ['', 0])
  const totalCalls = modelAgg.reduce((a, [, t]) => a + t.calls, 0)
  const totalIn = modelAgg.reduce((a, [, t]) => a + t.inTok, 0)
  const totalOut = modelAgg.reduce((a, [, t]) => a + t.outTok, 0)

  // 供应商分组(Kimi 套餐 vs GPT/Codex 订阅)的每日堆叠数据
  const providerByDay = useMemo(() => {
    const rows: Array<{ day: string; kimi: number; gpt: number; parts: Array<{ model: string; tokens: number }> }> = []
    for (const day of days) {
      let kimi = 0
      let gpt = 0
      const parts: Array<{ model: string; tokens: number }> = []
      for (const [model, [i, o]] of Object.entries(data?.days[day] ?? {})) {
        const t = i + o
        parts.push({ model, tokens: t })
        if (model.startsWith('kimi') || model === 'k3-256k') {
          kimi += t
        } else {
          gpt += t
        }
      }
      parts.sort((a, b) => b.tokens - a.tokens)
      rows.push({ day, kimi, gpt, parts })
    }
    return rows
  }, [data, days])
  const maxProviderDay = Math.max(1, ...providerByDay.map(r => r.kimi + r.gpt))
  // 纵轴刻度文字(如 "9350.0 万")需要左侧留白,否则会被 SVG 边缘裁剪
  const P_LP = 64

  // 活跃/连续天数(基于所选范围)
  const activeDays = perDay.size
  const daySet = new Set(days)
  let streak = 0
  {
    const d = new Date()
    if (!daySet.has(d.toISOString().slice(0, 10))) {
      d.setDate(d.getDate() - 1)
    }
    while (daySet.has(d.toISOString().slice(0, 10))) {
      streak += 1
      d.setDate(d.getDate() - 1)
    }
  }

  const W = 860
  const H = 190
  const PAD = 24
  const maxDaily = Math.max(1, ...perDay.values())
  const topModels = modelAgg.slice(0, 4).map(([m]) => m)

  const linePts = (model: string): string => {
    const pts: string[] = []
    days.forEach((day, idx) => {
      let t = 0
      for (const [m, [i, o]] of Object.entries(data?.days[day] ?? {})) {
        if (m === model) t += i + o
      }
      const x = PAD + (idx * (W - 2 * PAD)) / Math.max(1, days.length - 1)
      const y = H - PAD - (t / maxDaily) * (H - 2 * PAD)
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
    })
    return pts.join(' ')
  }

  let acc = 0
  const donutSegs = modelAgg.map(([model, t]) => {
    const share = (t.inTok + t.outTok) / (totalAll || 1)
    const frac = share * 360
    const seg = (
      <circle
        key={model}
        cx="80"
        cy="80"
        r="66"
        fill="none"
        stroke={MODEL_COLOR[model] ?? '#888'}
        strokeWidth="24"
        strokeDasharray={`${frac.toFixed(2)} ${(360 - frac).toFixed(2)}`}
        transform={`rotate(${(acc - 90).toFixed(2)} 80 80)`}
      />
    )
    acc += frac
    return seg
  })

  return (
    <div className="min-h-full overflow-y-auto p-8" style={{ background: 'var(--ui-chat-surface-background, transparent)' }}>
      <div className="mx-auto flex max-w-[980px] flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">使用统计</h1>
            <p className="text-xs text-(--ui-text-tertiary)">
              数据来自本地会话日志(agent.log) · 生成于{' '}
              {data ? new Date(data.generated_at).toLocaleString() : '…'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`rounded-lg border px-3 py-1 text-sm ${rangeDays === 7 ? 'border-(--ui-stroke-secondary) font-semibold' : 'text-(--ui-text-tertiary)'}`}
              onClick={() => setRangeDays(7)}
            >
              近 7 天
            </button>
            <button
              className={`rounded-lg border px-3 py-1 text-sm ${rangeDays === 30 ? 'border-(--ui-stroke-secondary) font-semibold' : 'text-(--ui-text-tertiary)'}`}
              onClick={() => setRangeDays(30)}
            >
              近 30 天
            </button>
            <button
              className="rounded-lg border px-3 py-1 text-sm hover:bg-(--ui-control-hover-background)"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? '刷新中…' : '刷新'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          {[
            [human(totalAll), '累计 Token 数'],
            [human(maxDaily), `峰值单日 Token(${peakDay[0].slice(5) || '—'})`],
            [totalCalls.toLocaleString(), 'API 调用总数'],
            [String(activeDays), '活跃天数'],
            [String(streak), '当前连续天数'],
            [String(data?.sessions ?? 0), '会话总数']
          ].map(([value, label]) => (
            <div key={label} className="min-w-[140px] flex-1 rounded-xl border border-(--ui-stroke-tertiary) p-4 text-center">
              <b className="block text-[22px] text-(--ui-text-primary)">{value}</b>
              <span className="text-xs text-(--ui-text-tertiary)">{label}</span>
            </div>
          ))}
        </div>

        <section>
          <h2 className="mb-2 text-sm font-semibold">每日 Token 趋势(按模型)</h2>
          <div className="mb-2 flex gap-4 text-xs text-(--ui-text-secondary)">
            {topModels.map(m => (
              <span key={m} className="inline-flex items-center gap-1.5">
                <i className="inline-block size-2.5 rounded-full" style={{ background: MODEL_COLOR[m] ?? '#888' }} />
                {MODEL_LABEL[m] ?? m}
              </span>
            ))}
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl border border-(--ui-stroke-tertiary)">
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--ui-stroke-tertiary)" />
            {topModels.map(m => (
              <polyline
                key={m}
                fill="none"
                stroke={MODEL_COLOR[m] ?? '#888'}
                strokeWidth="2"
                points={linePts(m)}
              />
            ))}
            {days.map((day, idx) =>
              idx % 3 === 0 || idx === days.length - 1 ? (
                <text
                  key={day}
                  x={PAD + (idx * (W - 2 * PAD)) / Math.max(1, days.length - 1)}
                  y={H - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--ui-text-tertiary)"
                >
                  {day.slice(5).replace('-', '/')}
                </text>
              ) : null
            )}
          </svg>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">模型用量占比</h2>
          <div className="flex flex-wrap items-center gap-8 rounded-xl border border-(--ui-stroke-tertiary) p-5">
            <svg viewBox="0 0 160 160" className="size-[170px]">
              {donutSegs}
              <text x="80" y="76" textAnchor="middle" fontSize="17" fontWeight="600" fill="var(--ui-text-primary)">
                {human(totalAll)}
              </text>
              <text x="80" y="96" textAnchor="middle" fontSize="11" fill="var(--ui-text-tertiary)">
                tokens
              </text>
            </svg>
            <div className="flex min-w-[320px] flex-1 flex-col gap-2">
              {modelAgg.map(([model, t]) => (
                <div key={model} className="flex items-center gap-2.5">
                  <span className="size-2.5 rounded-full" style={{ background: MODEL_COLOR[model] ?? '#888' }} />
                  <span className="w-40 text-sm">{MODEL_LABEL[model] ?? model}</span>
                  <div className="h-3.5 flex-1 overflow-hidden rounded-full bg-(--ui-control-hover-background)">
                    <i
                      className="block h-full rounded-full"
                      style={{
                        width: `${((t.inTok + t.outTok) / (totalAll || 1)) * 100}%`,
                        background: MODEL_COLOR[model] ?? '#888'
                      }}
                    />
                  </div>
                  <span className="w-28 text-right text-xs tabular-nums text-(--ui-text-secondary)">
                    {Math.round(((t.inTok + t.outTok) / (totalAll || 1)) * 100)}% · {human(t.inTok + t.outTok)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">供应商每日用量对比(Kimi vs GPT/Codex,并排柱)</h2>
          <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full rounded-xl border border-(--ui-stroke-tertiary)">
            {[1, 0.5, 0].map(f => (
              <g key={f}>
                <line
                  x1={P_LP}
                  x2={W - PAD}
                  y1={H - PAD - f * (H - 2 * PAD)}
                  y2={H - PAD - f * (H - 2 * PAD)}
                  stroke="var(--ui-stroke-tertiary)"
                  strokeDasharray={f === 0 ? undefined : '3 4'}
                />
                <text x={P_LP - 8} y={H - PAD - f * (H - 2 * PAD) + 3} textAnchor="end" fontSize="9" fill="var(--ui-text-tertiary)">
                  {human(maxProviderDay * f)}
                </text>
              </g>
            ))}
            {providerByDay.map((row, idx) => {
              const slot = (W - P_LP - PAD) / providerByDay.length
              const barW = slot * 0.28
              const x0 = P_LP + idx * slot + slot * 0.16
              const total = row.kimi + row.gpt
              if (total <= 0) return null
              const kimiH = (row.kimi / maxProviderDay) * (H - 2 * PAD)
              const gptH = (row.gpt / maxProviderDay) * (H - 2 * PAD)
              const tip =
                `${row.day}\n` +
                row.parts.map(p => `${MODEL_LABEL[p.model] ?? p.model}: ${human(p.tokens)}`).join('\n')
              return (
                <g key={row.day}>
                  <title>{tip}</title>
                  {row.kimi > 0 && (
                    <rect x={x0} y={H - PAD - kimiH} width={barW} height={kimiH} fill="#e07b39" rx="2">
                      <title>{tip}</title>
                    </rect>
                  )}
                  {row.gpt > 0 && (
                    <rect x={x0 + barW + slot * 0.06} y={H - PAD - gptH} width={barW} height={gptH} fill="#3a56c5" rx="2">
                      <title>{tip}</title>
                    </rect>
                  )}
                  {(idx % 5 === 0 || idx === providerByDay.length - 1) && (
                    <text
                      x={x0 + barW + slot * 0.03}
                      y={H - PAD + 12}
                      textAnchor="middle"
                      fontSize="9"
                      fill="var(--ui-text-tertiary)"
                    >
                      {row.day.slice(5).replace('-', '/')}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
          <div className="mt-1.5 flex gap-4 text-xs text-(--ui-text-secondary)">
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-sm" style={{ background: '#e07b39' }} />
              Kimi(套餐额度)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <i className="size-2.5 rounded-sm" style={{ background: '#3a56c5' }} />
              GPT / Codex(订阅)
            </span>
            <span className="text-(--ui-text-quaternary)">悬停柱子可查看当日各模型明细</span>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">按模型明细(累计输入/输出)</h2>
          <table className="w-full overflow-hidden rounded-xl border border-(--ui-stroke-tertiary)">
            <thead>
              <tr className="bg-(--ui-control-hover-background)">
                <th className="p-2.5 text-left text-xs">模型</th>
                <th className="p-2.5 text-right text-xs">输入 tokens</th>
                <th className="p-2.5 text-right text-xs">输出 tokens</th>
                <th className="p-2.5 text-right text-xs">调用次数</th>
              </tr>
            </thead>
            <tbody>
              {modelAgg.map(([model, t]) => (
                <tr key={model} className="border-t border-(--ui-stroke-tertiary)">
                  <td className="p-2.5">{MODEL_LABEL[model] ?? model}</td>
                  <td className="p-2.5 text-right tabular-nums">{human(t.inTok)}</td>
                  <td className="p-2.5 text-right tabular-nums">{human(t.outTok)}</td>
                  <td className="p-2.5 text-right tabular-nums">{t.calls.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <p className="text-[11px] text-(--ui-text-quaternary)">
          明细日志: hermes-home/logs/agent.log · 主会话与子代理共用供应商池,额度百分比见状态栏 · Token In {human(totalIn)} / Out{' '}
          {human(totalOut)}
        </p>
      </div>
    </div>
  )
}
