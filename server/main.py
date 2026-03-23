"""
ValueLens 后端 v4 - AKShare 数据服务（A股 + 港股）
使用稳定的 Sina / THS 数据源（避开东方财富 _em 接口）

已验证可用接口:
  ✅ stock_info_a_code_name()          → 全量A股代码和名称
  ✅ stock_zh_a_daily(symbol)          → A股个股历史日线(新浪)
  ✅ stock_hk_daily(symbol)            → 港股个股历史日线(新浪)
  ✅ stock_zh_index_daily(symbol)      → 指数历史日线(新浪)
  ✅ stock_financial_abstract_ths()    → 财务摘要(同花顺, 仅A股)
  ✅ stock_financial_analysis_indicator() → 财务分析指标(仅A股)
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import akshare as ak
import pandas as pd
from typing import Optional
import time
from datetime import datetime, timedelta
import asyncio
import warnings
import threading
import traceback
import json
import httpx
import os
from pathlib import Path

# 加载 .env 文件
_env_path = Path(__file__).resolve().parent.parent / ".env"
if _env_path.exists():
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith("#") and "=" in _line:
                _k, _v = _line.split("=", 1)
                _v = _v.strip()
                # 移除包裹的引号 ("value" 或 'value')
                if len(_v) >= 2 and _v[0] == _v[-1] and _v[0] in ('"', "'"):
                    _v = _v[1:-1]
                os.environ.setdefault(_k.strip(), _v)

warnings.filterwarnings("ignore")

# ── 汇率常量 (用于市值折算为人民币) ──────────────────────────
_USD_TO_CNY = 7.2    # 美元→人民币
_HKD_TO_CNY = 0.92   # 港元→人民币

app = FastAPI(title="ValueLens API", version="4.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── 缓存系统 ─────────────────────────────────────────────────
_cache: dict = {}
_cache_ts: dict = {}
_lock = threading.Lock()

# 持久化缓存目录（历年财务数据等不会变的数据）
_PERSIST_DIR = Path(__file__).resolve().parent / "cache"
_PERSIST_DIR.mkdir(exist_ok=True)


import re as _re

# 安全的缓存 key 校验：仅允许字母、数字、下划线、连字符
_SAFE_KEY_RE = _re.compile(r'^[\w\-]+$')

def _safe_persist_path(key: str) -> Path:
    """校验 key 并返回安全的持久化文件路径，防止路径注入"""
    if not _SAFE_KEY_RE.match(key):
        raise ValueError(f"Unsafe cache key: {key}")
    fp = (_PERSIST_DIR / f"{key}.json").resolve()
    # 确保解析后的路径仍在 _PERSIST_DIR 下
    if not str(fp).startswith(str(_PERSIST_DIR.resolve())):
        raise ValueError(f"Path traversal detected: {key}")
    return fp


def _persist_read(key: str):
    """从磁盘读取持久化缓存"""
    try:
        fp = _safe_persist_path(key)
    except ValueError:
        return None
    if fp.exists():
        try:
            with open(fp, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return None


def _persist_write(key: str, data):
    """写入持久化缓存到磁盘"""
    try:
        fp = _safe_persist_path(key)
    except ValueError as e:
        print(f"[WARN] persist_write rejected: {e}")
        return
    try:
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[WARN] persist_write {key}: {e}")


def cached(key: str, ttl: int = 300):
    with _lock:
        if key in _cache and time.time() - _cache_ts.get(key, 0) < ttl:
            return _cache[key]
    return None


def cache_set(key: str, val):
    with _lock:
        _cache[key] = val
        _cache_ts[key] = time.time()


# ── 工具函数 ──────────────────────────────────────────────────
def sf(val, default=0.0):
    """安全转 float"""
    try:
        if pd.isna(val):
            return default
        v = float(val)
        return round(v, 4)
    except Exception:
        try:
            s = str(val).replace("%", "").replace(",", "").strip()
            if s and s != "False" and s != "nan":
                return round(float(s), 4)
        except Exception:
            pass
        return default


def ss(val, default=""):
    """安全转 str"""
    try:
        if pd.isna(val):
            return default
        return str(val).strip()
    except Exception:
        return default


def _code_to_sina_symbol(code: str) -> str:
    """将A股代码转换为新浪格式 (sh600519 / sz000858)"""
    code = code.strip()
    if code.startswith("6") or code.startswith("9"):
        return f"sh{code}"
    else:
        return f"sz{code}"


def _parse_money(val) -> float:
    """解析金额字段: 数字 / '1234.56亿' / '1234.56万亿'"""
    if val is None:
        return 0
    try:
        if pd.isna(val):
            return 0
    except Exception:
        pass
    s = str(val).strip()
    if not s or s in ("False", "nan", "None"):
        return 0
    try:
        if "万亿" in s:
            return float(s.replace("万亿", "")) * 10000
        elif "亿" in s:
            return float(s.replace("亿", ""))
        elif "万" in s:
            return float(s.replace("万", "")) / 10000
        else:
            v = float(s.replace(",", ""))
            if abs(v) > 1e6:
                return v / 1e8
            return v
    except Exception:
        return 0


# ── 港股名称映射（热门港股，启动时直接内置）────────────────────
_hk_stock_name_map: dict = {
    "00700": "腾讯控股",
    "09988": "阿里巴巴-W",
    "03690": "美团-W",
    "09618": "京东集团-SW",
    "01024": "快手-W",
    "09999": "网易-S",
    "09888": "百度集团-SW",
    "00981": "中芯国际",
    "01810": "小米集团-W",
    "02015": "理想汽车-W",
    "09866": "蔚来-SW",
    "09868": "小鹏汽车-W",
    "02269": "药明生物",
    "06618": "京东健康",
    "00388": "香港交易所",
    "00005": "汇丰控股",
    "01299": "友邦保险",
    "02318": "中国平安",
    "00941": "中国移动",
    "00883": "中国海洋石油",
    "01211": "比亚迪股份",
    "02382": "舜宇光学科技",
    "00175": "吉利汽车",
    "01797": "新东方在线",
    "09626": "哔哩哔哩-SW",
    "06160": "百济神州",
    "01658": "邮储银行",
    "00939": "建设银行",
    "01398": "工商银行",
    "03988": "中国银行",
    "00001": "长和",
    "00027": "银河娱乐",
    "00016": "新鸿基地产",
    "01109": "华润置地",
    "00002": "中电控股",
    "00003": "香港中华煤气",
    "00006": "电能实业",
    "00011": "恒生银行",
    "00012": "恒基兆业地产",
    "00017": "新世界发展",
    "00066": "港铁公司",
    "00101": "恒隆地产",
    "00267": "中信股份",
    "00288": "万洲国际",
    "00386": "中国石油化工股份",
    "00688": "中国海外发展",
    "00762": "中国联通",
    "00857": "中国石油股份",
    "00960": "龙湖集团",
    "01038": "长江基建集团",
    "01044": "恒安国际",
    "01093": "石药集团",
    "01113": "长实集团",
    "01177": "中国生物制药",
    "01928": "金沙中国有限公司",
    "01997": "九龙仓置业",
    "02007": "碧桂园",
    "02020": "安踏体育",
    "02313": "申洲国际",
    "02319": "蒙牛乳业",
    "02388": "中银香港",
    "02628": "中国人寿",
    "03328": "交通银行",
    "03968": "招商银行",
    "06098": "碧桂园服务",
    "06862": "海底捞",
}

# ── 美股名称映射（常见热门股票）────────────────────────────────
_us_stock_name_map: dict = {
    "AAPL": "苹果", "MSFT": "微软", "GOOGL": "谷歌A", "GOOG": "谷歌C",
    "AMZN": "亚马逊", "NVDA": "英伟达", "META": "Meta", "TSLA": "特斯拉",
    "BRK.B": "伯克希尔B", "BRK.A": "伯克希尔A",
    "TSM": "台积电", "AVGO": "博通", "JPM": "摩根大通", "V": "Visa",
    "UNH": "联合健康", "MA": "万事达", "XOM": "埃克森美孚", "HD": "家得宝",
    "PG": "宝洁", "COST": "好市多", "JNJ": "强生", "ABBV": "艾伯维",
    "MRK": "默沙东", "CRM": "Salesforce", "NFLX": "奈飞",
    "AMD": "AMD", "INTC": "英特尔", "ORCL": "甲骨文",
    "ADBE": "Adobe", "CSCO": "思科", "PEP": "百事", "KO": "可口可乐",
    "TMO": "赛默飞", "ABT": "雅培", "DIS": "迪士尼", "WMT": "沃尔玛",
    "NKE": "耐克", "MCD": "麦当劳", "QCOM": "高通", "TXN": "德州仪器",
    "PYPL": "PayPal", "BABA": "阿里巴巴", "JD": "京东", "PDD": "拼多多",
    "BIDU": "百度", "NIO": "蔚来", "XPEV": "小鹏汽车", "LI": "理想汽车",
    "BILI": "哔哩哔哩", "ZH": "知乎", "TME": "腾讯音乐", "COIN": "Coinbase",
    "SQ": "Block", "UBER": "Uber", "ABNB": "爱彼迎", "SNOW": "Snowflake",
    "PLTR": "Palantir", "RIVN": "Rivian", "LCID": "Lucid",
    "BA": "波音", "GE": "通用电气", "CAT": "卡特彼勒", "GS": "高盛",
    "MS": "摩根士丹利", "C": "花旗", "BAC": "美国银行", "WFC": "富国银行",
    "T": "AT&T", "VZ": "威瑞森", "TMUS": "T-Mobile",
    "SBUX": "星巴克", "LMT": "洛克希德马丁", "RTX": "雷神",
    "NOW": "ServiceNow", "SHOP": "Shopify", "SE": "Sea Limited",
    "GRAB": "Grab", "MELI": "MercadoLibre", "ARM": "ARM",
    "SMCI": "超微电脑", "MU": "美光科技", "MRVL": "Marvell",
    "PANW": "Palo Alto", "CRWD": "CrowdStrike", "ZS": "Zscaler",
    "DDOG": "Datadog", "NET": "Cloudflare", "MNDY": "Monday.com",
}

# 英文别名映射 → 股票代码（支持搜索时用英文名找股票）
_us_stock_alias_map: dict = {
    "apple": "AAPL", "microsoft": "MSFT", "google": "GOOGL", "alphabet": "GOOGL",
    "amazon": "AMZN", "nvidia": "NVDA", "meta": "META", "facebook": "META",
    "tesla": "TSLA", "berkshire": "BRK.B", "tsmc": "TSM", "broadcom": "AVGO",
    "jpmorgan": "JPM", "visa": "V", "mastercard": "MA",
    "exxon": "XOM", "procter": "PG", "costco": "COST", "johnson": "JNJ",
    "merck": "MRK", "salesforce": "CRM", "netflix": "NFLX",
    "amd": "AMD", "intel": "INTC", "oracle": "ORCL", "adobe": "ADBE",
    "cisco": "CSCO", "pepsi": "PEP", "coca-cola": "KO", "cocacola": "KO",
    "disney": "DIS", "walmart": "WMT", "nike": "NKE", "mcdonalds": "MCD",
    "qualcomm": "QCOM", "paypal": "PYPL", "alibaba": "BABA",
    "jd": "JD", "pinduoduo": "PDD", "baidu": "BIDU", "nio": "NIO",
    "xpeng": "XPEV", "lixiang": "LI", "bilibili": "BILI",
    "coinbase": "COIN", "block": "SQ", "uber": "UBER", "airbnb": "ABNB",
    "snowflake": "SNOW", "palantir": "PLTR", "boeing": "BA",
    "goldman": "GS", "morgan stanley": "MS", "citigroup": "C", "citi": "C",
    "starbucks": "SBUX", "lockheed": "LMT",
    "servicenow": "NOW", "shopify": "SHOP", "arm": "ARM",
    "crowdstrike": "CRWD", "cloudflare": "NET", "datadog": "DDOG",
    "palo alto": "PANW", "micron": "MU",
}
_hk_stock_alias_map: dict = {
    "tencent": "00700", "meituan": "03690", "xiaomi": "01810",
    "alibaba hk": "09988", "jd hk": "09618", "baidu hk": "09888",
    "netease": "09999", "byd": "01211", "hsbc": "00005",
    "aia": "01299", "lenovo": "00992", "ping an": "02318",
    "cnooc": "00883", "china mobile": "00941", "geely": "00175",
    "kuaishou": "01024", "li ning": "02331", "nongfu": "09633",
    "semiconductor": "00981", "sunny optical": "02382",
}


# ── 代码与市场映射（启动时从AKShare加载）────────────────────────
_stock_name_map: dict = {}  # code -> name (A股 6位 + 港股 5位 + 美股字母)


def _is_hk_code(code: str) -> bool:
    """判断是否为港股代码（5位数字）"""
    code = code.strip()
    return len(code) == 5 and code.isdigit()


def _is_us_code(code: str) -> bool:
    """判断是否为美股代码（1-5位字母，可含点号如 BRK.B）"""
    code = code.strip().upper()
    clean = code.replace(".", "")
    return 1 <= len(clean) <= 5 and clean.isalpha()


def _load_stock_names():
    global _stock_name_map
    c = cached("_name_map", 86400)
    if c:
        _stock_name_map = c
        return

    name_map = {}

    # 1. 加载A股
    try:
        df = ak.stock_info_a_code_name()
        for _, row in df.iterrows():
            code = ss(row.get("code"))
            name = ss(row.get("name"))
            if code and name:
                name_map[code] = name
        print(f"[OK] 已加载 {len(name_map)} 只 A 股名称")
    except Exception as e:
        print(f"[WARN] 加载A股名称失败: {e}")

    # 2. 合并港股
    name_map.update(_hk_stock_name_map)
    print(f"[OK] 已加载 {len(_hk_stock_name_map)} 只港股名称")

    # 3. 合并美股
    name_map.update(_us_stock_name_map)
    print(f"[OK] 已加载 {len(_us_stock_name_map)} 只美股名称")

    _stock_name_map = name_map
    cache_set("_name_map", name_map)
    print(f"[OK] 总计 {len(name_map)} 只股票（A股+港股+美股）")


@app.on_event("startup")
async def startup():
    _load_stock_names()


# ── A股行情（Sina 日线接口）───────────────────────────────────
def _get_a_stock_quote(code: str) -> dict:
    """使用 stock_zh_a_daily (新浪) 获取A股最新行情"""
    c = cached(f"rt_{code}", 60)
    if c:
        return c

    result = {
        "code": code,
        "name": _stock_name_map.get(code, code),
        "market": "A",
        "price": 0, "change": 0, "changePercent": 0,
        "open": 0, "high": 0, "low": 0,
        "volume": 0, "amount": 0, "marketCap": 0,
        "pe": 0, "pb": 0, "turnoverRate": 0,
    }

    try:
        symbol = _code_to_sina_symbol(code)
        end_date = datetime.now().strftime("%Y%m%d")
        start_date = (datetime.now() - timedelta(days=10)).strftime("%Y%m%d")

        df = ak.stock_zh_a_daily(
            symbol=symbol,
            start_date=start_date,
            end_date=end_date,
            adjust="qfq"
        )

        if df is not None and not df.empty:
            latest = df.iloc[-1]
            result["price"] = sf(latest.get("close"))
            result["open"] = sf(latest.get("open"))
            result["high"] = sf(latest.get("high"))
            result["low"] = sf(latest.get("low"))
            result["volume"] = sf(latest.get("volume"))
            result["amount"] = sf(latest.get("amount"))
            result["turnoverRate"] = sf(latest.get("turnover", 0)) * 100

            if len(df) >= 2:
                prev_close = sf(df.iloc[-2].get("close"))
                if prev_close > 0:
                    result["change"] = round(result["price"] - prev_close, 2)
                    result["changePercent"] = round(
                        (result["price"] - prev_close) / prev_close * 100, 2
                    )

            outstanding = sf(latest.get("outstanding_share", 0))
            if outstanding > 0 and result["price"] > 0:
                result["marketCap"] = round(outstanding * result["price"] / 1e8, 2)

    except Exception as e:
        print(f"[WARN] stock_zh_a_daily for {code}: {e}")

    # 仅在成功获取到价格时才缓存，避免错误结果污染缓存
    if result["price"] > 0:
        cache_set(f"rt_{code}", result)
    return result


# ── 港股行情（Sina 日线接口）──────────────────────────────────
def _get_hk_stock_quote(code: str) -> dict:
    """使用 stock_hk_daily (新浪) 获取港股最新行情
    
    注意: stock_hk_daily 不支持 start_date 参数，会拉取全量历史。
    因此港股缓存 TTL 设置为 300s（5分钟），减少全量拉取频率。
    """
    c = cached(f"rt_{code}", 300)  # 港股缓存 5 分钟（全量拉取成本高）
    if c:
        return c

    result = {
        "code": code,
        "name": _stock_name_map.get(code, code),
        "market": "HK",
        "price": 0, "change": 0, "changePercent": 0,
        "open": 0, "high": 0, "low": 0,
        "volume": 0, "amount": 0, "marketCap": 0,
        "pe": 0, "pb": 0, "turnoverRate": 0,
    }

    try:
        df = ak.stock_hk_daily(symbol=code, adjust="qfq")

        if df is not None and not df.empty:
            # 只取最后几行，避免对全量数据做大量操作
            tail = df.tail(2)
            latest = tail.iloc[-1]
            result["price"] = sf(latest.get("close"))
            result["open"] = sf(latest.get("open"))
            result["high"] = sf(latest.get("high"))
            result["low"] = sf(latest.get("low"))
            result["volume"] = sf(latest.get("volume"))
            result["amount"] = sf(latest.get("amount"))

            if len(tail) >= 2:
                prev_close = sf(tail.iloc[0].get("close"))
                if prev_close > 0:
                    result["change"] = round(result["price"] - prev_close, 2)
                    result["changePercent"] = round(
                        (result["price"] - prev_close) / prev_close * 100, 2
                    )

    except Exception as e:
        print(f"[WARN] stock_hk_daily for {code}: {e}")

    # 仅在成功获取到价格时才缓存，避免错误结果污染缓存
    if result["price"] > 0:
        cache_set(f"rt_{code}", result)
    return result


# ── 美股行情（腾讯 QT 接口）──────────────────────────────────
def _get_us_stock_quote(code: str) -> dict:
    """使用腾讯 QT 接口获取美股最新行情
    
    接口: https://qt.gtimg.cn/q=us{TICKER}
    需用 GBK 解码。美股缓存 5 分钟。
    
    字段映射 (已验证):
      [1] = 中文名, [2] = Ticker.Exchange, [3] = 现价,
      [4] = 昨收, [5] = 开盘, [6] = 成交量,
      [30] = 时间, [31] = 涨跌额, [32] = 涨跌幅%,
      [33] = 最高, [34] = 最低, [35] = 币种(USD),
      [39] = PE, [44] = 市值(亿美元), [46] = 英文名
    """
    upper_code = code.strip().upper()
    c = cached(f"rt_{upper_code}", 300)  # 美股缓存 5 分钟
    if c:
        return c

    result = {
        "code": upper_code,
        "name": _stock_name_map.get(upper_code, upper_code),
        "market": "US",
        "price": 0, "change": 0, "changePercent": 0,
        "open": 0, "high": 0, "low": 0,
        "volume": 0, "amount": 0, "marketCap": 0,
        "pe": 0, "pb": 0, "turnoverRate": 0,
    }

    try:
        resp = httpx.get(
            f"https://qt.gtimg.cn/q=us{upper_code}",
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        text = resp.content.decode("gbk", errors="replace")
        start = text.find('"')
        end = text.rfind('"')
        if start >= 0 and end > start:
            fields = text[start + 1 : end].split("~")
            if len(fields) > 50:
                result["price"] = sf(fields[3])
                result["open"] = sf(fields[5])
                result["volume"] = sf(fields[6])
                result["change"] = sf(fields[31])
                result["changePercent"] = sf(fields[32])
                result["high"] = sf(fields[33])
                result["low"] = sf(fields[34])

                # 中文名称（如果映射表没有，用 API 返回的）
                if fields[1] and result["name"] == upper_code:
                    result["name"] = fields[1]

                # 市值（亿美元 → 亿人民币）
                mkt_usd = sf(fields[44]) if len(fields) > 44 else 0
                if mkt_usd > 0:
                    result["marketCap"] = round(mkt_usd * _USD_TO_CNY, 2)

                # PE
                pe = sf(fields[39]) if len(fields) > 39 else 0
                if pe > 0:
                    result["pe"] = round(pe, 2)

                print(f"[INFO] US quote {upper_code}: price={result['price']}, PE={result['pe']}")

    except Exception as e:
        print(f"[WARN] US quote for {upper_code}: {e}")

    if result["price"] > 0:
        cache_set(f"rt_{upper_code}", result)
    return result


# ── 统一行情获取入口 ──────────────────────────────────────────
def _get_stock_quote(code: str) -> dict:
    """根据代码自动判断A股/港股/美股并获取行情"""
    if _is_us_code(code):
        return _get_us_stock_quote(code)
    elif _is_hk_code(code):
        return _get_hk_stock_quote(code)
    else:
        return _get_a_stock_quote(code)


# ── 获取财务指标（仅A股）──────────────────────────────────────
def _get_financial_indicators(code: str) -> dict:
    """使用 stock_financial_analysis_indicator 获取详细财务指标（仅A股）
    
    关键修复：正确处理季度累计 vs 年度数据
    - AKShare 返回的 EPS/ROE 等指标是季度累计值（Q1仅含1个季度）
    - 必须找到最近的年报（12-31）或用TTM算法年化
    - TTM EPS = 最新季度累计 + (上年全年 - 上年同期累计)
    """
    if _is_hk_code(code):
        return {}

    c = cached(f"indicators_{code}", 3600)
    if c:
        return c

    indicators = {}
    try:
        current_year = datetime.now().year
        # 往前多取一年，确保能拿到完整年报 + 同期数据做TTM
        df = ak.stock_financial_analysis_indicator(
            symbol=code, start_year=str(current_year - 2)
        )
        if df is not None and not df.empty:
            # 规范化日期列为 YYYY-MM-DD 字符串
            df["日期"] = df["日期"].astype(str).str[:10]
            # 按日期排序（最新在前）
            df = df.sort_values("日期", ascending=False).reset_index(drop=True)

            # 1) 找最新的年报（12-31）作为基准
            annual_row = None
            for i in range(len(df)):
                d = df.iloc[i]["日期"]  # 已规范化为 YYYY-MM-DD
                if d.endswith("12-31"):
                    annual_row = df.iloc[i]
                    break

            # 2) 最新一行（最新季报）
            latest = df.iloc[0]
            latest_date = latest["日期"]

            # 3) 确定用哪个EPS做PE计算
            ttm_eps = 0
            annual_eps = sf(annual_row.get("摊薄每股收益(元)")) if annual_row is not None else 0
            latest_eps = sf(latest.get("摊薄每股收益(元)"))

            if latest_date.endswith("12-31"):
                # 最新就是年报，直接用
                ttm_eps = latest_eps
            elif annual_row is not None:
                # 计算TTM: 最新季度累计 + (上年全年 - 上年同期累计)
                annual_year = annual_row["日期"][:4]
                latest_mmdd = latest_date[4:]  # e.g. "-03-31"
                same_quarter_last_year_date = annual_year + latest_mmdd
                same_q_row = None
                for i in range(len(df)):
                    if df.iloc[i]["日期"] == same_quarter_last_year_date:
                        same_q_row = df.iloc[i]
                        break

                if same_q_row is not None:
                    same_q_eps = sf(same_q_row.get("摊薄每股收益(元)"))
                    ttm_eps = latest_eps + (annual_eps - same_q_eps)
                else:
                    # 没有同期数据，用年报EPS
                    ttm_eps = annual_eps
            else:
                # 没有年报，只能用最新数据年化
                if latest_date.endswith("09-30"):
                    ttm_eps = latest_eps * 4 / 3
                elif latest_date.endswith("06-30"):
                    ttm_eps = latest_eps * 2
                elif latest_date.endswith("03-31"):
                    ttm_eps = latest_eps * 4
                else:
                    ttm_eps = latest_eps

            # 4) 选择年报指标（非累计指标用年报值更准确）
            base_row = annual_row if annual_row is not None else latest
            indicators = {
                "eps": round(ttm_eps, 4) if ttm_eps else 0,
                "bvps": sf(latest.get("每股净资产_调整后(元)")),  # 净资产用最新
                "roe": sf(base_row.get("净资产收益率(%)")),  # 年报ROE
                "grossMargin": sf(base_row.get("销售毛利率(%)")),
                "netMargin": sf(base_row.get("销售净利率(%)")),
                "debtRatio": sf(latest.get("资产负债率(%)")),  # 负债率用最新
                "currentRatio": sf(latest.get("流动比率")),  # 流动比率用最新
                "quickRatio": sf(latest.get("速动比率")),
                "cashFlowPerShare": sf(latest.get("每股经营性现金流(元)")),
                "revenueGrowth": sf(base_row.get("主营业务收入增长率(%)")),
                "profitGrowth": sf(base_row.get("净利润增长率(%)")),
                "totalAssets": sf(latest.get("总资产(元)")) / 1e8,
                "reportDate": latest["日期"],
            }

            # 5) 用TTM EPS和最新BVPS算PE/PB
            # 先尝试缓存的行情，没有则主动获取
            rt = cached(f"rt_{code}", 300)
            if not rt or rt.get("price", 0) == 0:
                try:
                    rt = _get_stock_quote(code)
                except Exception:
                    rt = {}
            if rt and rt.get("price", 0) > 0:
                price = rt["price"]
                if ttm_eps and ttm_eps > 0:
                    indicators["pe"] = round(price / ttm_eps, 2)
                if indicators["bvps"] and indicators["bvps"] > 0:
                    indicators["pb"] = round(price / indicators["bvps"], 2)

    except Exception as e:
        print(f"[WARN] financial_analysis_indicator for {code}: {e}")

    cache_set(f"indicators_{code}", indicators)
    return indicators


# ── 市场指数（Sina 日线）──────────────────────────────────────
@app.get("/api/indices")
def get_market_indices():
    c = cached("indices", 120)
    if c:
        return c

    index_map = {
        "000001": ("上证指数", "sh000001"),
        "399001": ("深证成指", "sz399001"),
        "399006": ("创业板指", "sz399006"),
        "000300": ("沪深300", "sh000300"),
    }

    indices = []
    for code, (name, sina_sym) in index_map.items():
        try:
            df = ak.stock_zh_index_daily(symbol=sina_sym)
            if df is not None and not df.empty:
                recent = df.tail(2)
                latest = recent.iloc[-1]
                val = sf(latest.get("close"))
                change = 0.0
                change_pct = 0.0

                if len(recent) >= 2:
                    prev = sf(recent.iloc[0].get("close"))
                    if prev > 0:
                        change = round(val - prev, 2)
                        change_pct = round((val - prev) / prev * 100, 2)

                indices.append({
                    "code": code,
                    "name": name,
                    "value": val,
                    "change": change,
                    "changePercent": change_pct,
                })
            else:
                indices.append({"code": code, "name": name, "value": 0, "change": 0, "changePercent": 0})
        except Exception as e:
            print(f"[WARN] index {code}: {e}")
            indices.append({"code": code, "name": name, "value": 0, "change": 0, "changePercent": 0})

    result = {"data": indices}
    cache_set("indices", result)
    return result


# ── 股票搜索（A股 + 港股 + 美股，支持英文名）────────────────────
@app.get("/api/stock/search")
async def search_stocks(q: str):
    if not q or len(q) < 1:
        return {"data": []}

    q_lower = q.lower().strip()
    results = []
    matched_codes = set()

    # 1. 先匹配英文别名（精确前缀匹配）
    for alias, code in {**_us_stock_alias_map, **_hk_stock_alias_map}.items():
        if q_lower in alias and code not in matched_codes:
            name = _stock_name_map.get(code, code)
            market = "US" if _is_us_code(code) else ("HK" if _is_hk_code(code) else "A")
            results.append({
                "code": code, "name": name, "market": market,
                "price": 0, "change": 0, "changePercent": 0,
            })
            matched_codes.add(code)
            if len(results) >= 20:
                break

    # 2. 再搜索全部股票（代码 + 中文名）
    if len(results) < 20:
        for code, name in _stock_name_map.items():
            if code in matched_codes:
                continue
            if q_lower in code.lower() or q_lower in name.lower():
                market = "US" if _is_us_code(code) else ("HK" if _is_hk_code(code) else "A")
                results.append({
                    "code": code, "name": name, "market": market,
                    "price": 0, "change": 0, "changePercent": 0,
                })
                matched_codes.add(code)
                if len(results) >= 20:
                    break

    return {"data": results}


# ── 单只股票行情 ──────────────────────────────────────────────
@app.get("/api/stock/{code}/quote")
def get_stock_quote_endpoint(code: str):
    try:
        rt = _get_stock_quote(code)
        if rt["price"] == 0:
            raise HTTPException(404, f"未找到股票 {code} 的行情数据")
        return {"data": rt}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] quote {code}: {traceback.format_exc()}")
        raise HTTPException(500, str(e))


# ── 批量行情 ──────────────────────────────────────────────────
@app.get("/api/stock/batch")
def get_batch_quotes(codes: str):
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if not code_list:
        return {"data": []}

    results = []
    for code in code_list[:20]:
        try:
            rt = _get_stock_quote(code)
            results.append(rt)
        except Exception:
            results.append({
                "code": code,
                "name": _stock_name_map.get(code, code),
                "price": 0, "change": 0, "changePercent": 0,
            })

    return {"data": results}


# ── 港股财务指标（东方财富 via akshare + 腾讯 QT fallback）────
def _get_hk_fundamentals(code: str) -> dict:
    """获取港股完整财务指标
    
    优先使用 akshare stock_financial_hk_analysis_indicator_em (东方财富)
    获取 ROE/EPS/毛利率/净利率/营收增长/利润增长/负债率/流动比率。
    PE/PB/股息率/市值仍从腾讯 QT 接口补充。
    """
    c = cached(f"hk_fund_{code}", 600)
    if c:
        return c

    result = {}

    # ─── 主数据源: 东方财富 via akshare ───
    try:
        df = ak.stock_financial_hk_analysis_indicator_em(symbol=code, indicator="年度")
        if df is not None and not df.empty:
            row = df.iloc[0]  # 最新年度
            roe = sf(row.get("ROE_AVG"))
            eps = sf(row.get("BASIC_EPS"))
            gross_margin = sf(row.get("GROSS_PROFIT_RATIO"))
            net_margin = sf(row.get("NET_PROFIT_RATIO"))
            rev_growth = sf(row.get("OPERATE_INCOME_YOY"))
            profit_growth = sf(row.get("HOLDER_PROFIT_YOY"))
            debt_ratio = sf(row.get("DEBT_ASSET_RATIO"))
            current_ratio = sf(row.get("CURRENT_RATIO"))
            cash_per_share = sf(row.get("PER_NETCASH_OPERATE"))

            if roe:
                result["roe"] = round(roe, 2)
            if eps:
                result["eps"] = round(eps, 2)
            if gross_margin:
                result["grossMargin"] = round(gross_margin, 2)
            if net_margin:
                result["netMargin"] = round(net_margin, 2)
            if rev_growth:
                result["revenueGrowth"] = round(rev_growth, 2)
            if profit_growth:
                result["profitGrowth"] = round(profit_growth, 2)
            if debt_ratio:
                result["debtRatio"] = round(debt_ratio, 2)
            if current_ratio:
                result["currentRatio"] = round(current_ratio, 2)
            if cash_per_share:
                result["freeCashFlow"] = round(cash_per_share, 2)

            print(f"[OK] HK em fundamentals for {code}: ROE={roe}, EPS={eps}, GrossM={gross_margin}, RevG={rev_growth}")
    except Exception as e:
        print(f"[WARN] HK em fundamentals for {code}: {e}")

    # ─── 补充: 腾讯 QT (PE/PB/股息率/市值) ───
    try:
        resp = httpx.get(
            f"https://qt.gtimg.cn/q=hk{code}",
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        text = resp.text
        start = text.find('"')
        end = text.rfind('"')
        if start >= 0 and end > start:
            fields = text[start + 1 : end].split("~")
            if len(fields) > 72:
                pe = sf(fields[39])
                pb = sf(fields[72])
                div_yield = sf(fields[43])
                mkt_cap = sf(fields[44])

                if pe > 0 and "pe" not in result:
                    result["pe"] = round(pe, 2)
                if pb > 0 and "pb" not in result:
                    result["pb"] = round(pb, 2)
                if div_yield > 0:
                    result["dividendYield"] = round(div_yield, 2)
                if mkt_cap > 0:
                    result["marketCap"] = round(mkt_cap * _HKD_TO_CNY, 2)
    except Exception as e:
        print(f"[WARN] HK QT fundamentals for {code}: {e}")

    if result:
        cache_set(f"hk_fund_{code}", result)
    return result


# ── 美股财务指标（东方财富 via akshare + 腾讯 QT fallback）────
def _get_us_fundamentals(code: str) -> dict:
    """获取美股完整财务指标
    
    优先使用 akshare stock_financial_us_analysis_indicator_em (东方财富)
    获取 ROE/EPS/毛利率/净利率/营收增长/利润增长/负债率/流动比率。
    PE/PB/股息率/市值仍从腾讯 QT 接口补充。
    """
    upper_code = code.strip().upper()
    c = cached(f"us_fund_{upper_code}", 600)
    if c:
        return c

    result = {}

    # ─── 主数据源: 东方财富 via akshare ───
    try:
        df = ak.stock_financial_us_analysis_indicator_em(symbol=upper_code, indicator="年报")
        if df is not None and not df.empty:
            row = df.iloc[0]  # 最新年报
            roe = sf(row.get("ROE_AVG"))
            eps = sf(row.get("BASIC_EPS"))
            gross_margin = sf(row.get("GROSS_PROFIT_RATIO"))
            net_margin = sf(row.get("NET_PROFIT_RATIO"))
            rev_growth = sf(row.get("OPERATE_INCOME_YOY"))
            profit_growth = sf(row.get("PARENT_HOLDER_NETPROFIT_YOY"))
            debt_ratio = sf(row.get("DEBT_ASSET_RATIO"))
            current_ratio = sf(row.get("CURRENT_RATIO"))

            if roe:
                result["roe"] = round(roe, 2)
            if eps:
                result["eps"] = round(eps, 2)
            if gross_margin:
                result["grossMargin"] = round(gross_margin, 2)
            if net_margin:
                result["netMargin"] = round(net_margin, 2)
            if rev_growth:
                result["revenueGrowth"] = round(rev_growth, 2)
            if profit_growth:
                result["profitGrowth"] = round(profit_growth, 2)
            if debt_ratio:
                result["debtRatio"] = round(debt_ratio, 2)
            if current_ratio:
                result["currentRatio"] = round(current_ratio, 2)

            print(f"[OK] US em fundamentals for {upper_code}: ROE={roe}, EPS={eps}, GrossM={gross_margin}, RevG={rev_growth}")
    except Exception as e:
        print(f"[WARN] US em fundamentals for {upper_code}: {e}")

    # ─── 补充: 腾讯 QT (PE/PB/股息率/市值) ───
    try:
        resp = httpx.get(
            f"https://qt.gtimg.cn/q=us{upper_code}",
            timeout=8,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        text = resp.content.decode("gbk", errors="replace")
        start = text.find('"')
        end = text.rfind('"')
        if start >= 0 and end > start:
            fields = text[start + 1 : end].split("~")
            if len(fields) > 52:
                pe = sf(fields[39])
                pb = sf(fields[51])
                div_yield = sf(fields[52])
                mkt_cap = sf(fields[44])

                if pe > 0 and "pe" not in result:
                    result["pe"] = round(pe, 2)
                if pb > 0 and "pb" not in result:
                    result["pb"] = round(pb, 2)
                if div_yield > 0:
                    result["dividendYield"] = round(div_yield, 2)
                if mkt_cap > 0:
                    result["marketCap"] = round(mkt_cap * _USD_TO_CNY, 2)
    except Exception as e:
        print(f"[WARN] US QT fundamentals for {upper_code}: {e}")

    if result:
        cache_set(f"us_fund_{upper_code}", result)
    return result


# ── 财务指标 ──────────────────────────────────────────────────
def _get_complete_fundamentals(code: str) -> dict:
    """获取完整的财务基本面数据（共享逻辑，供 fundamentals 端点和 screener 使用）
    
    包含完整的回退链：
    1. Sina 财务分析指标 (_get_financial_indicators)
    2. 同花顺年度数据回退 (stock_financial_abstract_ths)
    3. 用实时价格计算 PE/PB
    """
    c = cached(f"complete_fund_{code}", 3600)
    if c:
        return c

    result = {
        "code": code,
        "roe": 0, "eps": 0, "dividendYield": 0,
        "debtRatio": 0, "grossMargin": 0, "netMargin": 0,
        "revenueGrowth": 0, "profitGrowth": 0,
        "freeCashFlow": 0, "currentRatio": 0,
        "pe": 0, "pb": 0,
    }

    # 港股：从腾讯 QT 接口获取 PE / PB / 股息率等
    if _is_hk_code(code):
        hk_fund = _get_hk_fundamentals(code)
        if hk_fund:
            for k, v in hk_fund.items():
                if v:
                    result[k] = v
        cache_set(f"complete_fund_{code}", result)
        return result

    # 美股：从腾讯 QT 接口获取 PE / PB / 股息率等
    if _is_us_code(code):
        us_fund = _get_us_fundamentals(code)
        if us_fund:
            for k, v in us_fund.items():
                if v:
                    result[k] = v
        cache_set(f"complete_fund_{code}", result)
        return result

    # A股：从财务分析指标获取
    indicators = _get_financial_indicators(code)
    if indicators:
        for k in ["roe", "eps", "grossMargin", "netMargin", "debtRatio",
                   "currentRatio", "revenueGrowth", "profitGrowth", "pe", "pb"]:
            if indicators.get(k):
                result[k] = indicators[k]
        if indicators.get("cashFlowPerShare"):
            result["freeCashFlow"] = indicators["cashFlowPerShare"]

    # 补充同花顺年度数据（主数据源不可用或数据不全时）
    _needs_ths = (result["roe"] == 0 or result["eps"] == 0
                  or result["pb"] == 0 or result["grossMargin"] == 0)
    bvps_from_ths = 0
    if _needs_ths:
        try:
            df_abs = ak.stock_financial_abstract_ths(symbol=code, indicator="按年度")
            if df_abs is not None and not df_abs.empty:
                for i in range(min(5, len(df_abs))):
                    row = df_abs.iloc[-(i+1)]
                    year_str = ss(row.get("报告期", ""))
                    if len(year_str) >= 4:
                        try:
                            year = int(year_str[:4])
                        except ValueError:
                            continue
                        if year >= 2022:
                            if result["roe"] == 0:
                                result["roe"] = sf(row.get("净资产收益率"))
                            if result["eps"] == 0:
                                result["eps"] = sf(row.get("基本每股收益"))
                            if result["grossMargin"] == 0:
                                result["grossMargin"] = sf(row.get("销售毛利率"))
                            if result["netMargin"] == 0:
                                result["netMargin"] = sf(row.get("销售净利率"))
                            if result["revenueGrowth"] == 0:
                                result["revenueGrowth"] = sf(row.get("营业总收入同比增长率"))
                            if result["profitGrowth"] == 0:
                                result["profitGrowth"] = sf(row.get("净利润同比增长率"))
                            if result["debtRatio"] == 0:
                                result["debtRatio"] = sf(row.get("资产负债率"))
                            if result["currentRatio"] == 0:
                                result["currentRatio"] = sf(row.get("流动比率"))
                            # 提取每股净资产用于PB计算
                            _bv = sf(row.get("每股净资产"))
                            if _bv and _bv > 0:
                                bvps_from_ths = _bv
                            break
        except Exception as e:
            print(f"[INFO] financial_abstract for {code}: {e}")

    # 用最新价格计算 PE/PB
    if result["pe"] == 0 or result["pb"] == 0:
        try:
            rt = _get_stock_quote(code)
            price = rt.get("price", 0)
            if price > 0:
                if result["pe"] == 0 and result["eps"] and result["eps"] > 0:
                    result["pe"] = round(price / result["eps"], 2)
                if result["pb"] == 0:
                    bvps = indicators.get("bvps", 0) or bvps_from_ths
                    if bvps and bvps > 0:
                        result["pb"] = round(price / bvps, 2)
        except Exception:
            pass

    cache_set(f"complete_fund_{code}", result)
    return result


@app.get("/api/stock/{code}/fundamentals")
def get_fundamentals(code: str):
    c = cached(f"fund_{code}", 3600)
    if c:
        return c

    result = _get_complete_fundamentals(code)
    out = {"data": result}
    cache_set(f"fund_{code}", out)
    return out


def _parse_financial_row(row) -> dict:
    """把 THS 年报 DataFrame 的一行解析为标准 dict"""
    revenue = _parse_money(row.get("营业总收入", 0))
    net_profit = _parse_money(row.get("净利润", 0))
    return {
        "year": ss(row.get("报告期", ""))[:4],
        "revenue": round(revenue, 2),
        "netProfit": round(net_profit, 2),
        "eps": sf(row.get("基本每股收益")),
        "roe": sf(row.get("净资产收益率")),
        "grossMargin": sf(row.get("销售毛利率")),
        "netMargin": sf(row.get("销售净利率")),
        "revenueGrowth": sf(row.get("营业总收入同比增长率")),
        "profitGrowth": sf(row.get("净利润同比增长率")),
        "debtRatio": sf(row.get("资产负债率")),
        "currentRatio": sf(row.get("流动比率")),
    }


# ── 历年财务数据（仅A股）──────────────────────────────────────
@app.get("/api/stock/{code}/financials")
def get_financial_history(code: str, years: int = 6, since_year: Optional[str] = None):
    """获取历年财务数据（带持久化缓存 + 增量拉取）

    增量策略:
    1. 先读磁盘持久化缓存（历史数据不会变）
    2. 检查是否缺少最新年份的数据
    3. 只向 THS 请求缺失年份，合并后持久化
    4. since_year 参数: 前端告知已有数据截止年份，后端只返回更新的部分
    """
    current_year = str(datetime.now().year)

    # 内存热缓存（10分钟内直接返回，避免频繁磁盘IO）
    mem_key = f"fin_{code}"
    c = cached(mem_key, 600)
    if c:
        if since_year:
            filtered = [r for r in c.get("data", []) if r["year"] > since_year]
            return {"data": filtered, "incremental": True, "since": since_year}
        return c

    # 港股/美股暂不支持历年财务数据
    if _is_hk_code(code) or _is_us_code(code):
        out = {"data": []}
        cache_set(mem_key, out)
        return out

    # 读取磁盘持久化缓存
    persist_key = f"financials_{code}"
    cached_records = _persist_read(persist_key) or []
    cached_years = {r["year"] for r in cached_records}

    # 判断是否需要增量拉取
    # 如果缓存中已有当前年或上一年的数据，且缓存条目>=5，认为足够新
    latest_cached_year = max(cached_years) if cached_years else "0"
    need_refresh = (
        len(cached_records) < 3
        or int(latest_cached_year) < int(current_year) - 1
    )

    if need_refresh:
        # 全量拉取 THS 数据（只在缓存不充分时）
        try:
            t0 = time.time()
            df = ak.stock_financial_abstract_ths(symbol=code, indicator="按年度")
            if df is not None and not df.empty:
                new_records = []
                for _, row in df.iterrows():
                    rec = _parse_financial_row(row)
                    if len(rec["year"]) < 4:
                        continue
                    try:
                        y = int(rec["year"])
                        if y < 2015:
                            continue
                    except ValueError:
                        continue
                    new_records.append(rec)

                if new_records:
                    # 合并：新数据覆盖旧数据（按year去重）
                    merged = {r["year"]: r for r in cached_records}
                    for r in new_records:
                        merged[r["year"]] = r
                    cached_records = list(merged.values())

                    # 持久化到磁盘
                    _persist_write(persist_key, cached_records)

                elapsed = time.time() - t0
                print(f"[OK] financials {code}: {len(cached_records)} years ({elapsed:.1f}s, full refresh)")
        except Exception as e:
            print(f"[INFO] financials for {code}: {e}")
            # 拉取失败但有缓存，继续用缓存
    else:
        print(f"[OK] financials {code}: {len(cached_records)} years (from disk cache)")

    # 按年排序并限制条数
    cached_records.sort(key=lambda x: x["year"])
    display_records = cached_records[-years:] if len(cached_records) > years else cached_records

    out = {"data": display_records}
    cache_set(mem_key, out)

    # 如果前端请求增量
    if since_year:
        filtered = [r for r in display_records if r["year"] > since_year]
        return {"data": filtered, "incremental": True, "since": since_year}

    return out


# ── 股票筛选 ──────────────────────────────────────────────────

# 筛选股票池 — 涵盖各行业龙头，约40只
_SCREENER_POOL = [
    "600519", "000858", "000568", "002304",  # 白酒
    "600036", "601166", "601288",             # 银行
    "601318", "601628",                        # 保险
    "000333", "000651",                        # 家电
    "300750", "601012",                        # 新能源
    "002415", "603288", "600887",             # 安防/食品
    "600900", "600276", "300760", "000538",   # 电力/医药
    "002230", "002475", "601888",             # 科技/旅游
    "000002", "001979",                        # 地产
    "002594", "600104",                        # 汽车
    "600585", "600019",                        # 建材/钢铁
    "002714", "300059",                        # 牧业/科技
    "600809", "000661", "002032",             # 酒/电子/厨具
    "601899", "600309", "601225",             # 矿业/化工/钢铁
    "000963", "603259",                        # 华东医药/药明康德
    "601888", "300124",                        # 中国中免/汇川技术
]
# 去重
_SCREENER_POOL = list(dict.fromkeys(_SCREENER_POOL))


@app.get("/api/screener")
def screen_stocks(
    pe_min: Optional[float] = None,
    pe_max: Optional[float] = None,
    pb_min: Optional[float] = None,
    pb_max: Optional[float] = None,
    roe_min: Optional[float] = None,
    roe_max: Optional[float] = None,
    dividend_min: Optional[float] = None,
    debt_max: Optional[float] = None,
    profit_growth_min: Optional[float] = None,
    gross_margin_min: Optional[float] = None,
    net_margin_min: Optional[float] = None,
    current_ratio_min: Optional[float] = None,
    market_cap_min: Optional[float] = None,
    sort_by: Optional[str] = "roe",
    sort_dir: Optional[str] = "desc",
    limit: int = 50,
):
    """真正的股票筛选：批量获取股票池的行情+财务指标，支持多条件筛选和排序"""
    c = cached("screener_pool", 600)  # 缓存10分钟
    if c:
        pool_data = c
    else:
        pool_data = []
        for code in _SCREENER_POOL:
            try:
                quote = _get_stock_quote(code)
                # 使用完整的基本面获取（含THS回退 + PE/PB计算）
                fund = _get_complete_fundamentals(code)

                price = quote.get("price", 0)
                if price <= 0:
                    continue

                rec = {
                    "code": code,
                    "name": quote.get("name", code),
                    "market": "A",
                    "industry": "",
                    "price": price,
                    "change": quote.get("change", 0),
                    "changePercent": quote.get("changePercent", 0),
                    "marketCap": quote.get("marketCap", 0),
                    "pe": fund.get("pe", 0) or 0,
                    "pb": fund.get("pb", 0) or 0,
                    "roe": fund.get("roe", 0) or 0,
                    "eps": fund.get("eps", 0) or 0,
                    "dividendYield": fund.get("dividendYield", 0) or 0,
                    "debtRatio": fund.get("debtRatio", 0) or 0,
                    "revenueGrowth": fund.get("revenueGrowth", 0) or 0,
                    "profitGrowth": fund.get("profitGrowth", 0) or 0,
                    "grossMargin": fund.get("grossMargin", 0) or 0,
                    "netMargin": fund.get("netMargin", 0) or 0,
                    "currentRatio": fund.get("currentRatio", 0) or 0,
                    "freeCashFlow": fund.get("freeCashFlow", 0) or 0,
                }

                pool_data.append(rec)
            except Exception as e:
                print(f"[WARN] screener skip {code}: {e}")
                continue

        cache_set("screener_pool", pool_data)
        print(f"[OK] 筛选池加载完成: {len(pool_data)}/{len(_SCREENER_POOL)} 只股票")

    # 应用筛选条件
    results = pool_data[:]

    if pe_min is not None:
        results = [r for r in results if r["pe"] > 0 and r["pe"] >= pe_min]
    if pe_max is not None:
        results = [r for r in results if r["pe"] > 0 and r["pe"] <= pe_max]
    if pb_min is not None:
        results = [r for r in results if r["pb"] > 0 and r["pb"] >= pb_min]
    if pb_max is not None:
        results = [r for r in results if r["pb"] > 0 and r["pb"] <= pb_max]
    if roe_min is not None:
        results = [r for r in results if r["roe"] >= roe_min]
    if roe_max is not None:
        results = [r for r in results if r["roe"] <= roe_max]
    if dividend_min is not None:
        results = [r for r in results if r["dividendYield"] >= dividend_min]
    if debt_max is not None:
        results = [r for r in results if r["debtRatio"] > 0 and r["debtRatio"] <= debt_max]
    if profit_growth_min is not None:
        results = [r for r in results if r["profitGrowth"] >= profit_growth_min]
    if gross_margin_min is not None:
        results = [r for r in results if r["grossMargin"] >= gross_margin_min]
    if net_margin_min is not None:
        results = [r for r in results if r["netMargin"] >= net_margin_min]
    if current_ratio_min is not None:
        results = [r for r in results if r["currentRatio"] >= current_ratio_min]
    if market_cap_min is not None:
        results = [r for r in results if r["marketCap"] >= market_cap_min]

    # 排序
    valid_sort_fields = [
        "pe", "pb", "roe", "eps", "price", "marketCap",
        "dividendYield", "debtRatio", "profitGrowth", "revenueGrowth",
        "grossMargin", "netMargin", "currentRatio",
    ]
    if sort_by in valid_sort_fields:
        results.sort(
            key=lambda r: r.get(sort_by, 0) or 0,
            reverse=(sort_dir == "desc"),
        )

    total = len(results)
    results = results[:limit]

    return {"data": results, "total": total}


# ── AI 聊天 (阿里云百炼 Qwen + Function Calling) ──────────────
_DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
_DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1"
_CHAT_MODEL = "qwen3.5-plus"

from duckduckgo_search import DDGS

def _build_system_prompt():
    today = datetime.now().strftime("%Y年%m月%d日")
    return f"""你是 ValueLens 价值投资分析助手，专注于帮助用户进行股票分析和价值投资决策。
当前日期：{today}

⚠️ 时效性原则（最重要）：
• 回答任何股票分析问题时，你必须先调用工具获取最新实时数据，绝不凭记忆回答
• 推荐股票时，务必先用 get_stock_quote 获取最新价格，再用 get_stock_fundamentals 获取最新财务指标
• 涉及市场动态或新闻时，务必用 web_search 搜索最新信息，并注明数据时间
• 所有数据分析都要基于工具返回的实时数据，不要使用你训练数据中的历史价格或指标
• 如果用户问到推荐股票，你应该主动搜索多只相关股票的实时数据，做对比分析

你的能力：
• 解读财务指标（PE(TTM)、PB、ROE、毛利率、净利率、负债率等）
• 分析公司基本面和竞争优势（护城河）
• 应用价值投资大师的方法论（巴菲特、芒格、格雷厄姆、彼得·林奇、段永平）
• DCF 估值、格雷厄姆公式、PEG 估值等模型
• 行业分析和趋势判断

你拥有以下工具，可以在需要时自动调用：
• get_stock_quote — 获取股票实时行情（价格/涨跌/成交量/市值）
• get_stock_fundamentals — 获取最新财务指标（PE(TTM)/PB/ROE/EPS/负债率/毛利率/净利率/增长率等），PE已按TTM口径计算
• search_stock — 按名称或代码搜索股票
• web_search — 搜索最新财经新闻和资讯（推荐搜索时加上"{today[:4]}年"确保时效性）

回答风格：
• 用简洁的中文回答，重点突出
• 引用工具返回的真实数据，给出具体分析，标注数据获取时间
• 适当使用 emoji 增加可读性
• 推荐或评价股票时，同时给出关键指标（PE/PB/ROE/增长率）的具体数值
• 提醒用户数据仅供参考，不构成投资建议"""

_SYSTEM_PROMPT = _build_system_prompt()

# ── 工具定义 ──────────────────────────────────────────────────
_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_stock_quote",
            "description": "获取股票实时行情数据，包括最新价、涨跌幅、成交量、市值等。A股输入6位代码如600519，港股输入5位代码如00700。",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "股票代码，如600519(贵州茅台)、000858(五粮液)、00700(腾讯)"}
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_stock_fundamentals",
            "description": "获取股票核心财务指标，包括PE、PB、ROE、EPS、股息率、负债率、毛利率、净利率、营收增长率、利润增长率、流动比率等。仅支持A股。",
            "parameters": {
                "type": "object",
                "properties": {
                    "code": {"type": "string", "description": "A股6位代码，如600519、000858"}
                },
                "required": ["code"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_stock",
            "description": "根据名称关键词或代码搜索股票，返回匹配的股票列表（代码+名称+市场）。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词，如'茅台'、'腾讯'、'银行'"}
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网获取最新的财经新闻、市场分析、公司公告、行业动态等信息。当用户询问最新消息或你需要补充实时信息时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词，如'贵州茅台最新财报'、'A股市场走势'"}
                },
                "required": ["query"],
            },
        },
    },
]


def _execute_tool(name: str, arguments: dict) -> str:
    """执行工具调用，返回 JSON 字符串结果"""
    try:
        if name == "get_stock_quote":
            code = arguments.get("code", "")
            quote = _get_stock_quote(code)
            if quote:
                quote["query_time"] = datetime.now().strftime("%Y-%m-%d %H:%M")
                return json.dumps(quote, ensure_ascii=False)
            return json.dumps({"error": f"未找到 {code} 的行情数据"}, ensure_ascii=False)

        elif name == "get_stock_fundamentals":
            code = arguments.get("code", "")
            # 使用完整的基本面获取（含THS回退 + PE/PB计算），确保数据完整
            fund = _get_complete_fundamentals(code)
            if fund and any(v for k, v in fund.items() if k != "code"):
                result = {"code": code, "name": _stock_name_map.get(code, code)}
                result.update(fund)
                # 添加数据时间标注
                result["data_time"] = datetime.now().strftime("%Y-%m-%d %H:%M")
                return json.dumps(result, ensure_ascii=False)
            return json.dumps({"error": f"未找到 {code} 的财务数据"}, ensure_ascii=False)

        elif name == "search_stock":
            query = arguments.get("query", "").lower()
            matches = []
            for c, n in _stock_name_map.items():
                if query in c or query in n.lower():
                    matches.append({"code": c, "name": n, "market": "US" if _is_us_code(c) else ("HK" if _is_hk_code(c) else "A")})
                    if len(matches) >= 10:
                        break
            return json.dumps(matches, ensure_ascii=False)

        elif name == "web_search":
            query = arguments.get("query", "")
            results = []
            try:
                with DDGS() as ddgs:
                    for r in ddgs.text(query, region="cn-zh", max_results=5):
                        results.append({
                            "title": r.get("title", ""),
                            "body": r.get("body", ""),
                            "href": r.get("href", ""),
                        })
            except Exception as e:
                return json.dumps({"error": f"搜索失败: {str(e)}"}, ensure_ascii=False)
            return json.dumps(results, ensure_ascii=False)

        else:
            return json.dumps({"error": f"未知工具: {name}"}, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"工具执行异常: {str(e)}"}, ensure_ascii=False)


_TOOL_LABELS = {
    "get_stock_quote": "📊 查询实时行情",
    "get_stock_fundamentals": "📈 获取财务指标",
    "search_stock": "🔍 搜索股票",
    "web_search": "🌐 搜索最新资讯",
}


from pydantic import BaseModel, Field, field_validator
from typing import List


class ChatMessage(BaseModel):
    role: str
    content: str

    @field_validator('role')
    @classmethod
    def validate_role(cls, v: str) -> str:
        if v not in ('user', 'assistant', 'system', 'tool'):
            raise ValueError(f'Invalid role: {v}')
        return v

    @field_validator('content')
    @classmethod
    def validate_content(cls, v: str) -> str:
        if len(v) > 8000:
            raise ValueError('单条消息过长（最多8000字符）')
        return v


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., max_length=40)
    stock_context: Optional[str] = Field(None, max_length=500)


@app.post("/api/chat")
async def chat_stream(req: ChatRequest):
    """流式聊天接口 - 阿里云百炼 Qwen + Function Calling"""

    if not req.messages:
        raise HTTPException(400, "消息不能为空")

    if not _DASHSCOPE_API_KEY:
        async def err_gen():
            yield f"data: {json.dumps({'error': '未配置 API Key，请在 .env 文件中设置 DASHSCOPE_API_KEY'})}\n\n"
        return StreamingResponse(err_gen(), media_type="text/event-stream")

    # 每次请求重新生成系统提示词，确保日期始终为当天
    messages = [{"role": "system", "content": _build_system_prompt()}]

    if req.stock_context:
        messages.append({
            "role": "system",
            "content": f"用户当前正在查看的股票信息：\n{req.stock_context}\n请结合以上信息回答用户问题。",
        })

    for m in req.messages:
        messages.append({"role": m.role, "content": m.content})

    _headers = {
        "Authorization": f"Bearer {_DASHSCOPE_API_KEY}",
        "Content-Type": "application/json",
    }

    async def generate():
        nonlocal messages
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                _url = f"{_DASHSCOPE_BASE}/chat/completions"

                # ── 全流式架构：每一轮都用 streaming ──
                for _round in range(4):
                    payload = {
                        "model": _CHAT_MODEL,
                        "messages": messages,
                        "tools": _TOOLS,
                        "stream": True,
                        "temperature": 0.7,
                        "max_tokens": 2048,
                    }

                    async with client.stream(
                        "POST", _url, json=payload, headers=_headers,
                    ) as resp:
                        if resp.status_code != 200:
                            body = await resp.aread()
                            error_msg = f"API 错误: {resp.status_code}"
                            try:
                                err_json = json.loads(body)
                                error_msg = err_json.get("error", {}).get("message", error_msg)
                            except Exception:
                                pass
                            yield f"data: {json.dumps({'error': error_msg})}\n\n"
                            return

                        # 从流中累积 tool_calls 和 content
                        tool_calls_map: dict = {}  # index -> {id, name, arguments}
                        has_content = False

                        async for line in resp.aiter_lines():
                            if not line.startswith("data: "):
                                continue
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break

                            try:
                                chunk = json.loads(data_str)
                            except json.JSONDecodeError:
                                continue

                            choice = chunk.get("choices", [{}])[0]
                            delta = choice.get("delta", {})

                            # ── 流式输出内容（逐 chunk 推送给前端）──
                            if delta.get("content"):
                                has_content = True
                                yield f"data: {json.dumps({'content': delta['content']})}\n\n"

                            # ── 累积工具调用片段 ──
                            if "tool_calls" in delta:
                                for tc in delta["tool_calls"]:
                                    idx = tc.get("index", 0)
                                    if idx not in tool_calls_map:
                                        tool_calls_map[idx] = {
                                            "id": "",
                                            "name": "",
                                            "arguments": "",
                                        }
                                    if tc.get("id"):
                                        tool_calls_map[idx]["id"] = tc["id"]
                                    func = tc.get("function", {})
                                    if func.get("name"):
                                        tool_calls_map[idx]["name"] = func["name"]
                                    if func.get("arguments"):
                                        tool_calls_map[idx]["arguments"] += func["arguments"]

                    # ── 本轮流结束：判断是工具调用还是内容输出 ──

                    if not tool_calls_map:
                        # 无工具调用 → 内容已流式输出完毕
                        yield "data: [DONE]\n\n"
                        return

                    # 有工具调用 → 构造 assistant 消息，执行工具，继续下一轮
                    assistant_msg = {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": tc["id"],
                                "type": "function",
                                "function": {
                                    "name": tc["name"],
                                    "arguments": tc["arguments"],
                                },
                            }
                            for tc in tool_calls_map.values()
                        ],
                    }
                    messages.append(assistant_msg)

                    for tc in tool_calls_map.values():
                        func_name = tc["name"]
                        label = _TOOL_LABELS.get(func_name, func_name)

                        # 通知前端正在调用工具
                        yield f"data: {json.dumps({'tool_call': label})}\n\n"

                        # 执行工具
                        try:
                            func_args = json.loads(tc["arguments"])
                        except json.JSONDecodeError:
                            func_args = {}
                        tool_result = _execute_tool(func_name, func_args)

                        messages.append({
                            "role": "tool",
                            "tool_call_id": tc["id"],
                            "content": tool_result,
                        })

                # 循环结束仍无最终内容（极少发生）
                yield "data: [DONE]\n\n"

        except httpx.TimeoutException:
            yield f"data: {json.dumps({'error': '请求超时，请稍后重试'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': f'连接失败: {str(e)}'})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ── 健康检查 ──────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    hk_count = sum(1 for c in _stock_name_map if _is_hk_code(c))
    us_count = sum(1 for c in _stock_name_map if _is_us_code(c))
    a_count = len(_stock_name_map) - hk_count - us_count
    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "stocks_loaded": len(_stock_name_map),
        "a_stocks": a_count,
        "hk_stocks": hk_count,
        "us_stocks": us_count,
        "version": "4.1.0",
        "data_source": "sina/ths/tencent_qt",
    }


# ── 文件识别导入股票（图片/PDF/视频）──────────────────────────
import base64
import io

_IMPORT_SYSTEM_PROMPT = (
    "你是一个股票识别助手。请仔细分析内容中出现的所有股票信息，"
    "提取出股票代码和名称。\n\n"
    "输出格式要求：每行一只股票，格式为 `代码|名称`。\n"
    "例如:\n"
    "600519|贵州茅台\n"
    "AAPL|苹果\n"
    "00700|腾讯控股\n\n"
    "规则：\n"
    "- A股代码为6位数字（如600519、000858）\n"
    "- 港股代码为5位数字（如00700、09988）\n"
    "- 美股代码为1-5位英文字母（如AAPL、TSLA、NVDA）\n"
    "- 如果内容中没有股票信息，输出 NONE\n"
    "- 只输出代码和名称，不要其他内容"
)

# 使用 qwen3.5-plus 的 VL 多模态功能（图片/PDF/视频识别）
_VL_MODEL = "qwen3.5-plus"


def _pdf_to_images_base64(pdf_bytes: bytes, max_pages: int = 8) -> list[str]:
    """将 PDF 转为 base64 图片列表（每页一张）"""
    import fitz
    images = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for i in range(min(len(doc), max_pages)):
            page = doc[i]
            # 渲染为 2x 分辨率图片，提高 OCR 精度
            pix = page.get_pixmap(dpi=200)
            img_bytes = pix.tobytes("jpeg")
            b64 = base64.b64encode(img_bytes).decode("ascii")
            images.append(b64)
        doc.close()
    except Exception as e:
        print(f"[WARN] PDF 转图片失败: {e}")
    return images


def _parse_stock_response(content: str) -> list[dict]:
    """解析 AI 返回的股票列表文本，匹配名称映射表并去重"""
    if "NONE" in content.upper():
        return []

    recognized = []
    seen_codes: set[str] = set()

    for line in content.strip().split("\n"):
        line = line.strip().strip("-").strip("*").strip("`").strip()
        if "|" not in line:
            continue
        parts = line.split("|", 1)
        raw_code = parts[0].strip().upper().replace(" ", "")
        raw_name = parts[1].strip() if len(parts) > 1 else ""

        if raw_code in seen_codes:
            continue

        # 精确匹配代码
        matched_code = None
        matched_name = raw_name

        if raw_code in _stock_name_map:
            matched_code = raw_code
            matched_name = _stock_name_map[raw_code]
        else:
            # 尝试用名称模糊搜索
            for c, n in _stock_name_map.items():
                if raw_name and len(raw_name) >= 2 and raw_name in n:
                    matched_code = c
                    matched_name = n
                    break

        if matched_code and matched_code not in seen_codes:
            seen_codes.add(matched_code)
            market = "US" if _is_us_code(matched_code) else ("HK" if _is_hk_code(matched_code) else "A")
            recognized.append({
                "code": matched_code,
                "name": matched_name,
                "market": market,
            })

    return recognized


from fastapi import UploadFile, File, Form

@app.post("/api/stock/import-from-file")
async def import_stocks_from_file(file: UploadFile = File(...)):
    """使用 qwen3.5-plus VL 识别文件中的股票（支持图片/PDF/视频）"""
    if not _DASHSCOPE_API_KEY:
        raise HTTPException(500, "未配置 DASHSCOPE_API_KEY")

    filename = (file.filename or "").lower()
    content_type = (file.content_type or "").lower()
    file_bytes = await file.read()

    # 限制文件大小：图片/PDF 20MB，视频 50MB
    is_video = content_type.startswith("video/") or filename.endswith((".mp4", ".mov", ".avi", ".mkv", ".webm"))
    is_pdf = content_type == "application/pdf" or filename.endswith(".pdf")
    is_image = content_type.startswith("image/") or filename.endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"))

    max_size = 50 * 1024 * 1024 if is_video else 20 * 1024 * 1024
    if len(file_bytes) > max_size:
        raise HTTPException(400, f"文件太大，{'视频' if is_video else '文件'}请限制在{max_size // (1024*1024)}MB以内")

    if not (is_image or is_pdf or is_video):
        raise HTTPException(400, "不支持的文件格式，请上传图片、PDF 或视频文件")

    user_content: list[dict] = []

    if is_pdf:
        # PDF → 多页图片
        images_b64 = _pdf_to_images_base64(file_bytes, max_pages=8)
        if not images_b64:
            raise HTTPException(400, "PDF 解析失败，请确认文件未损坏")
        for img_b64 in images_b64:
            user_content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"},
            })
        user_content.append({"type": "text", "text": f"请识别这份PDF（共{len(images_b64)}页）中的所有股票代码和名称。"})

    elif is_video:
        # 视频直接作为 video 类型发送
        ext = filename.rsplit(".", 1)[-1] if "." in filename else "mp4"
        mime = f"video/{ext}" if ext in ("mp4", "webm") else "video/mp4"
        video_b64 = base64.b64encode(file_bytes).decode("ascii")
        user_content.append({
            "type": "video_url",
            "video_url": {"url": f"data:{mime};base64,{video_b64}"},
        })
        user_content.append({"type": "text", "text": "请识别这段视频中出现的所有股票代码和名称。"})

    else:
        # 图片
        ext = filename.rsplit(".", 1)[-1] if "." in filename else "jpeg"
        mime = f"image/{ext}" if ext in ("png", "gif", "webp", "bmp") else "image/jpeg"
        img_b64 = base64.b64encode(file_bytes).decode("ascii")
        user_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{img_b64}"},
        })
        user_content.append({"type": "text", "text": "请识别这张图片中的所有股票代码和名称。"})

    messages = [
        {"role": "system", "content": _IMPORT_SYSTEM_PROMPT},
        {"role": "user", "content": user_content},
    ]

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                f"{_DASHSCOPE_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {_DASHSCOPE_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": _VL_MODEL,
                    "messages": messages,
                    "max_tokens": 2000,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        ai_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        # 处理 qwen3.5 带思维链的情况：content 可能为 None，真正内容在 reasoning_content 或需要拼接
        if not ai_text:
            msg_obj = data.get("choices", [{}])[0].get("message", {})
            # 某些模型返回 content=null 但 reasoning_content 有内容
            ai_text = msg_obj.get("reasoning_content", "") or ""
            print(f"[DEBUG] VL primary content empty, reasoning_content: {ai_text[:200] if ai_text else 'also empty'}")
            print(f"[DEBUG] VL full message obj keys: {list(msg_obj.keys())}")
            print(f"[DEBUG] VL full response snippet: {json.dumps(data, ensure_ascii=False)[:800]}")

        file_type = "PDF" if is_pdf else ("视频" if is_video else "图片")
        print(f"[INFO] VL OCR ({file_type}) result:\n{ai_text}")

        recognized = _parse_stock_response(ai_text)
        print(f"[INFO] Recognized {len(recognized)} stocks from {file_type}")

        msg = f"从{file_type}中识别到 {len(recognized)} 只股票" if recognized else f"未在{file_type}中识别到股票信息"
        return {"data": recognized, "message": msg}

    except httpx.HTTPStatusError as e:
        print(f"[ERROR] VL API error: {e.response.text}")
        raise HTTPException(500, f"AI 识别服务错误: {e.response.status_code}")
    except Exception as e:
        print(f"[ERROR] File import error: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(500, f"文件识别失败: {str(e)}")


# 保留旧端点兼容性（base64 图片直接上传）
@app.post("/api/stock/import-from-image")
async def import_stocks_from_image_legacy(req: dict):
    """旧版接口兼容：接收 base64 图片"""
    if not _DASHSCOPE_API_KEY:
        raise HTTPException(500, "未配置 DASHSCOPE_API_KEY")

    image_data = req.get("image", "")
    if "," in image_data:
        image_data = image_data.split(",", 1)[1]
    if len(image_data) > 20 * 1024 * 1024 * 4 // 3:
        raise HTTPException(400, "图片太大")

    messages = [
        {"role": "system", "content": _IMPORT_SYSTEM_PROMPT},
        {"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data}"}},
            {"type": "text", "text": "请识别这张图片中的所有股票代码和名称。"},
        ]},
    ]

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{_DASHSCOPE_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {_DASHSCOPE_API_KEY}", "Content-Type": "application/json"},
                json={"model": _VL_MODEL, "messages": messages, "max_tokens": 2000},
            )
            resp.raise_for_status()
            data = resp.json()

        ai_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
        recognized = _parse_stock_response(ai_text)
        return {"data": recognized}
    except Exception as e:
        raise HTTPException(500, f"识别失败: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    print("🚀 ValueLens API v4.1 starting on http://localhost:8000")
    print("   数据源: 新浪(行情) + 同花顺(财务) + 腾讯QT(港美股)")
    print("   支持: A股 + 港股 + 美股")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
