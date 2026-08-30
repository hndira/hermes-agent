// Fork: 使用统计页 — 经 registry 贡献挂载:
//   routes 区     → 全页面(/usage-stats,workspace 内渲染)
//   sidebar.nav 区 → 侧栏顶部导航行(内置项之下),label 带 i18n 覆盖能力
// 数据来自主进程 IPC(getUsageStats:解析 agent.log 的每次 API 调用)。
import { lazy } from 'react'
import { Suspense } from 'react'

import { registry } from '@/contrib/registry'

const UsageStatsPage = lazy(async () => ({ default: (await import('./index')).UsageStatsPage }))

const LABEL = '使用统计'

registry.registerMany([
  {
    area: 'routes',
    id: 'usage-stats',
    data: { path: '/usage-stats' },
    title: LABEL,
    render: () => (
      <Suspense fallback={null}>
        <UsageStatsPage />
      </Suspense>
    )
  },
  {
    area: 'sidebar.nav',
    id: 'usage-stats',
    data: { codicon: 'graph', label: LABEL, path: '/usage-stats' }
  }
])
