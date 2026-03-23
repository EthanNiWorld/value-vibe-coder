# ValueLens 价值投资分析工具

<p align="center">
  <strong>一站式价值投资分析平台，帮助投资者做出更明智的决策</strong>
</p>

<p align="center">
  React + TypeScript + FastAPI + AKShare + Qwen3.5-Plus
</p>

---

## 功能特性

- **三市场支持** — 同时支持 A 股、港股、美股数据查询与分析
- **仪表盘** — 市场指数实时概览、自选股管理（含删除）、价值指标排行
- **股票筛选** — 40+ 行业龙头实时数据，多维度筛选（PE/PB/ROE/增长率等），预设策略一键筛选
- **估值计算器** — DCF 折现、格雷厄姆公式、PEG 估值，内置 5 位投资大师策略（巴菲特/芒格/格雷厄姆/彼得·林奇/段永平）
- **股票对比** — 雷达图 + 柱状图多维度对比分析
- **AI 分析助手** — 接入 Qwen3.5-Plus 大模型，支持 Function Calling 自动获取实时行情 + DuckDuckGo 联网搜索最新资讯
- **智能文件导入** — 支持图片/PDF/视频导入，Qwen3.5-Plus VL 自动识别股票代码并去重添加到自选股
- **SWR 缓存** — 打开即显示上次数据，后台按需刷新
- **自选股持久化** — 自选分组自动保存到 localStorage，刷新不丢失

## 最近更新 (v1.2.0)

### 新功能
- **美股支持**: 新增 88 只热门美股（AAPL/NVDA/TSLA/GOOGL 等）查询，支持搜索、实时行情、基本面数据（PE/PB/股息率/市值），通过腾讯 QT 接口获取
- **智能文件导入**: 自选股概览新增文件导入功能，支持图片、PDF、视频三种格式，通过 Qwen3.5-Plus VL 模型自动识别股票代码，自动去重后批量加入自选
- **港股基本面**: 新增港股 PE/PB/股息率/市值等基本面数据展示，数据来源腾讯 QT 接口
- **自选股删除**: Dashboard 自选股表格新增删除按钮，一键从所有分组中移除

### Bug 修复
- **默认自选股**: 移除默认出现的 601318（中国平安），新用户自选列表为空
- **港股基本面**: 修复港股详情页财务数据不显示的问题

### 技术升级
- **模型升级**: AI 对话和 VL 识别统一使用 Qwen3.5-Plus 模型
- **多格式导入**: PDF 通过 PyMuPDF 转换为图片（最多 8 页，200dpi），视频通过 URL 直接上传（最大 50MB）
- **市场标识**: 前端搜索和详情页自动识别并标注市场类型（A 股/港股/美股）及对应货币符号（¥/HK$/＄）

## 历史更新 (v1.1.0)

### Bug 修复
- **ChatBot**: 修复快捷问题按钮点击无响应（stale closure）；修复流式消息 state 直接突变；新增 AbortController 支持取消请求
- **数据精度**: 全局将 `||` 替换为 `??`（nullish coalescing），覆盖初始构造和合并逻辑，防止合法 `0` 值（EPS、涨跌额、增长率等）被错误替换
- **自选股**: 空 watchlist 时点击"加入自选"不再静默失败，自动创建默认分组
- **估值页面**: 修复快速切换股票时异步数据竞态导致显示错误股票数据

### 性能优化
- **后端并发**: 阻塞型 API 端点从 `async def` 改为 `def`，FastAPI 自动用线程池执行，不再阻塞事件循环
- **缓存安全**: 仅在成功获取价格时写入缓存，防止错误结果（price=0）污染缓存 60 秒
- **港股优化**: 缓存 TTL 从 60s 提升至 300s，减少全量历史数据拉取频率
- **Context 优化**: Provider value 用 `useMemo` 包装，避免无关 state 变化引发全局 re-render

### 安全加固
- **路径注入防护**: 持久化缓存 key 增加正则校验 + `resolve()` 路径穿越检测
- **Chat 输入校验**: 消息角色白名单校验、单条消息 8000 字符限制、对话历史 40 条上限
- **Toast 清理**: 修复 `showToast` 连续调用时旧 timer 未清除导致新 toast 提前消失

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 · TypeScript · Tailwind CSS · Recharts · Lucide Icons |
| 后端 | FastAPI · AKShare (新浪/同花顺) · 腾讯 QT 接口 (港股/美股) · httpx · PyMuPDF |
| AI | 阿里云百炼 · Qwen3.5-Plus (对话 + VL 识别) · Function Calling · SSE 流式 · DuckDuckGo 搜索 |
| 缓存 | localStorage SWR 模式 · 后端内存缓存 |

## 快速开始

### 环境要求

- Node.js >= 18
- Python >= 3.9

### 1. 安装前端依赖

```bash
npm install
```

### 2. 安装后端依赖

```bash
pip install -r server/requirements.txt
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入你的阿里云百炼 API Key
```

### 4. 启动

```bash
# 终端 1: 启动后端
npm run server

# 终端 2: 启动前端
npm run dev
```

访问 http://localhost:5173 即可使用。

## 项目结构

```
ValueLens/
├── src/                    # 前端源码
│   ├── components/         # 通用组件 (Sidebar, Header, ChatBot, Toast)
│   ├── pages/              # 页面组件 (Dashboard, Screener, Valuation, Compare, StockDetail)
│   ├── context/            # React Context (全局状态管理)
│   ├── services/           # API 服务层 + 缓存工具
│   ├── data/               # 静态数据 (降级 fallback)
│   └── lib/                # 工具函数
├── server/                 # 后端源码
│   ├── main.py             # FastAPI 入口 (行情/财务/筛选/AI聊天)
│   └── requirements.txt    # Python 依赖
├── .env.example            # 环境变量模板
├── index.html              # 入口 HTML
├── package.json            # 前端依赖与脚本
├── vite.config.ts          # Vite 配置
├── tailwind.config.ts      # Tailwind 配置
└── tsconfig.json           # TypeScript 配置
```

## 数据来源

| 数据 | 来源 | 备注 |
|------|------|------|
| A 股行情 | 新浪财经 (via AKShare) | 实时日线数据，5491 只 |
| 港股行情 | 新浪财经 (via AKShare) | 66 只热门港股 |
| 美股行情 | 腾讯 QT 接口 (`qt.gtimg.cn`) | 88 只热门美股 |
| A 股财务指标 | 同花顺 (via AKShare) | PE/PB/ROE/增长率等 |
| 港股基本面 | 腾讯 QT 接口 | PE/PB/股息率/市值 |
| 美股基本面 | 腾讯 QT 接口 | PE/PB/股息率/市值 |
| AI 对话 | 阿里云百炼 DashScope | Qwen3.5-Plus + Function Calling |
| VL 文件识别 | 阿里云百炼 DashScope | Qwen3.5-Plus VL (图片/PDF/视频) |

## 投资大师策略

| 大师 | 偏好模型 | 核心理念 |
|------|---------|---------|
| 巴菲特 | DCF | Owner Earnings，安全边际 75% |
| 芒格 | DCF | 品质溢价，好公司合理价 |
| 格雷厄姆 | Graham 公式 | 极度保守，安全边际 66% |
| 彼得·林奇 | PEG | PEG=1 为合理估值 |
| 段永平 | DCF | 好生意 90% 现金转化，宁可错过 |

## 免责声明

本工具仅供学习和研究使用，所有数据和分析结果不构成投资建议。投资有风险，入市需谨慎。

## License

[MIT](LICENSE)
