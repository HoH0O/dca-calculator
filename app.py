"""
미국 주식 DCA(적립식 투자) 계산기
실행: streamlit run app.py
필요 패키지: streamlit yfinance pandas plotly
"""

from datetime import timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
import yfinance as yf
from plotly.subplots import make_subplots

st.set_page_config(
    page_title="US Stock DCA Calculator",
    page_icon="📈",
    layout="wide",
)

st.title("📈 미국 주식 DCA (적립식 투자) 계산기")
st.caption("yfinance 실시간 데이터를 활용해 과거 적립식 투자의 성과를 백테스트합니다.")


# ---------------------------------------------------------------------------
# Data layer
# ---------------------------------------------------------------------------
def _make_yf_session():
    """Yahoo Finance 봇 차단을 우회하기 위한 브라우저 위장 세션.

    Streamlit Cloud 같은 클라우드 환경에서 yfinance가 빈 결과를 반환하는
    문제(Yahoo의 IP/User-Agent 차단)를 피하려면 curl_cffi의 impersonate
    세션을 yf.Ticker에 주입하는 것이 가장 안정적이다.
    """
    try:
        from curl_cffi import requests as cffi_requests

        return cffi_requests.Session(impersonate="chrome")
    except Exception:
        return None


@st.cache_data(ttl=60 * 60, show_spinner=False)
def fetch_price_history(ticker: str) -> pd.DataFrame:
    """티커의 상장일부터 현재까지 일별 종가를 가져온다."""
    df = pd.DataFrame()
    last_error: Exception | None = None

    # 1차: curl_cffi 위장 세션 + Ticker.history (클라우드에서 가장 안정적)
    session = _make_yf_session()
    if session is not None:
        try:
            t = yf.Ticker(ticker, session=session)
            df = t.history(period="max", auto_adjust=True)
        except Exception as e:
            last_error = e
            df = pd.DataFrame()

    # 2차: 일반 Ticker.history
    if df is None or df.empty:
        try:
            t = yf.Ticker(ticker)
            df = t.history(period="max", auto_adjust=True)
        except Exception as e:
            last_error = e
            df = pd.DataFrame()

    # 3차: yf.download
    if df is None or df.empty:
        try:
            df = yf.download(
                ticker, period="max", progress=False, auto_adjust=True, threads=False
            )
        except Exception as e:
            last_error = e
            df = pd.DataFrame()

    if df is None or df.empty:
        if last_error is not None:
            raise RuntimeError(f"yfinance 호출 실패: {last_error}")
        return pd.DataFrame()

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df = df[["Close"]].dropna().copy()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    df.index.name = "Date"
    return df


# ---------------------------------------------------------------------------
# Calculation layer
# ---------------------------------------------------------------------------
def filter_buy_dates(price_df: pd.DataFrame, frequency: str) -> pd.DataFrame:
    """주기에 맞춰 매수일(거래일)만 추출한다."""
    if frequency == "Daily":
        return price_df.copy()
    if frequency == "Weekly":
        # 매주(월요일 기준) 첫 거래일
        return price_df.groupby(pd.Grouper(freq="W-MON")).head(1)
    if frequency == "Monthly":
        # 매월 첫 거래일
        return price_df.groupby(pd.Grouper(freq="MS")).head(1)
    return price_df.copy()


def run_dca_simulation(
    price_df: pd.DataFrame, frequency: str, amount: float
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """일별 타임라인과 매수내역을 반환한다."""
    buys = filter_buy_dates(price_df, frequency).copy()
    buys["Investment"] = amount
    buys["Shares Bought"] = amount / buys["Close"]
    buys["Cumulative Investment"] = buys["Investment"].cumsum()
    buys["Cumulative Shares"] = buys["Shares Bought"].cumsum()

    timeline = price_df.copy()
    timeline = timeline.join(
        buys[["Cumulative Investment", "Cumulative Shares"]], how="left"
    )
    timeline[["Cumulative Investment", "Cumulative Shares"]] = (
        timeline[["Cumulative Investment", "Cumulative Shares"]].ffill().fillna(0.0)
    )
    timeline["Portfolio Value"] = timeline["Cumulative Shares"] * timeline["Close"]
    invested = timeline["Cumulative Investment"].replace(0, pd.NA)
    timeline["ROI %"] = (
        (timeline["Portfolio Value"] - timeline["Cumulative Investment"]) / invested * 100
    )
    timeline["ROI %"] = timeline["ROI %"].astype(float)
    return timeline, buys


# ---------------------------------------------------------------------------
# Sidebar — Step 1: 티커 입력
# ---------------------------------------------------------------------------
with st.sidebar:
    st.header("⚙️ 투자 설정")
    ticker_input = (
        st.text_input(
            "투자 종목 (티커)",
            value="AAPL",
            placeholder="예: AAPL, NVDA, SPY, NVDL",
            help="Yahoo Finance에서 사용하는 티커 심볼을 입력하세요.",
        )
        .strip()
        .upper()
    )

if not ticker_input:
    st.info("👈 사이드바에서 티커를 입력해 주세요.")
    st.stop()

# ---------------------------------------------------------------------------
# 데이터 호출
# ---------------------------------------------------------------------------
try:
    with st.spinner(f"'{ticker_input}' 가격 데이터를 불러오는 중..."):
        price_df = fetch_price_history(ticker_input)
except Exception as e:
    st.error(
        f"yfinance에서 데이터를 가져오는 중 오류가 발생했습니다.\n\n```\n{e}\n```\n\n"
        "잠시 후 다시 시도하거나, 티커가 정확한지 확인해 주세요."
    )
    st.stop()

if price_df.empty:
    st.error(
        f"❌ '{ticker_input}'에 대한 가격 데이터를 찾을 수 없습니다. "
        "티커가 정확한지 다시 확인해 주세요."
    )
    st.stop()

min_date = price_df.index.min().date()
max_date = price_df.index.max().date()

# ---------------------------------------------------------------------------
# Sidebar — Step 2: 기간/주기/금액
# ---------------------------------------------------------------------------
with st.sidebar:
    st.success(f"✅ 데이터 로드 완료\n\n📅 {min_date} ~ {max_date}")
    st.divider()

    default_start = max(min_date, max_date - timedelta(days=365 * 5))

    start_date = st.date_input(
        "시작일",
        value=default_start,
        min_value=min_date,
        max_value=max_date,
        help="해당 종목의 상장일 이전으로는 설정할 수 없습니다.",
    )
    end_date = st.date_input(
        "종료일",
        value=max_date,
        min_value=min_date,
        max_value=max_date,
    )
    frequency = st.selectbox(
        "투자 주기",
        options=["Daily", "Weekly", "Monthly"],
        index=2,
    )
    amount = st.number_input(
        "1회 투자 금액 (USD)",
        min_value=1.0,
        value=100.0,
        step=10.0,
        format="%.2f",
    )

    st.divider()
    analyze_clicked = st.button(
        "📊 분석하기", type="primary", use_container_width=True
    )

# ---------------------------------------------------------------------------
# 분석 트리거
# ---------------------------------------------------------------------------
if start_date >= end_date:
    st.warning("⚠️ 시작일은 종료일보다 빨라야 합니다.")
    st.stop()

if "analyzed" not in st.session_state:
    st.session_state.analyzed = False
if analyze_clicked:
    st.session_state.analyzed = True

if not st.session_state.analyzed:
    st.info("사이드바에서 조건을 설정한 뒤 **'📊 분석하기'** 버튼을 눌러 주세요.")
    st.stop()

# ---------------------------------------------------------------------------
# 시뮬레이션 실행
# ---------------------------------------------------------------------------
period_df = price_df.loc[
    (price_df.index >= pd.Timestamp(start_date))
    & (price_df.index <= pd.Timestamp(end_date))
].copy()

if period_df.empty:
    st.error("선택한 기간에 거래 데이터가 없습니다. 기간을 다시 설정해 주세요.")
    st.stop()

timeline, buys = run_dca_simulation(period_df, frequency, amount)

if buys.empty:
    st.error("선택한 기간과 주기로는 매수 시점이 발생하지 않습니다.")
    st.stop()

total_invested = float(buys["Investment"].sum())
final_value = float(timeline["Portfolio Value"].iloc[-1])
profit = final_value - total_invested
total_roi = (profit / total_invested * 100) if total_invested else 0.0

# ---------------------------------------------------------------------------
# 결과 — 메트릭
# ---------------------------------------------------------------------------
st.subheader(f"📊 {ticker_input} DCA 시뮬레이션 결과")
st.caption(
    f"기간: **{start_date} ~ {end_date}** · 주기: **{frequency}** · "
    f"1회 매수: **${amount:,.2f}** · 총 매수횟수: **{len(buys):,}회**"
)

c1, c2, c3 = st.columns(3)
c1.metric("💰 총 누적 투자 금액", f"${total_invested:,.2f}")
c2.metric(
    "📈 최종 평가액",
    f"${final_value:,.2f}",
    delta=f"${profit:,.2f}",
)
c3.metric("🎯 최종 수익률", f"{total_roi:,.2f}%")

# ---------------------------------------------------------------------------
# 결과 — Plotly 듀얼 Y축 차트
# ---------------------------------------------------------------------------
fig = make_subplots(specs=[[{"secondary_y": True}]])

fig.add_trace(
    go.Scatter(
        x=timeline.index,
        y=timeline["Cumulative Investment"],
        name="누적 투자금",
        mode="lines",
        line=dict(color="#94a3b8", width=1),
        fill="tozeroy",
        fillcolor="rgba(148, 163, 184, 0.25)",
        hovertemplate="%{x|%Y-%m-%d}<br>누적 투자금: $%{y:,.2f}<extra></extra>",
    ),
    secondary_y=False,
)
fig.add_trace(
    go.Scatter(
        x=timeline.index,
        y=timeline["Portfolio Value"],
        name="평가액",
        mode="lines",
        line=dict(color="#2563eb", width=2),
        fill="tonexty",
        fillcolor="rgba(37, 99, 235, 0.15)",
        hovertemplate="%{x|%Y-%m-%d}<br>평가액: $%{y:,.2f}<extra></extra>",
    ),
    secondary_y=False,
)
fig.add_trace(
    go.Scatter(
        x=timeline.index,
        y=timeline["ROI %"],
        name="누적 수익률 (%)",
        mode="lines",
        line=dict(color="#dc2626", width=1.5, dash="dot"),
        hovertemplate="%{x|%Y-%m-%d}<br>수익률: %{y:,.2f}%<extra></extra>",
    ),
    secondary_y=True,
)

fig.update_layout(
    title=f"{ticker_input} DCA 시뮬레이션",
    hovermode="x unified",
    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    height=540,
    margin=dict(l=10, r=10, t=80, b=10),
    template="plotly_white",
)
fig.update_xaxes(title_text="날짜")
fig.update_yaxes(
    title_text="금액 (USD)",
    secondary_y=False,
    tickprefix="$",
    separatethousands=True,
)
fig.update_yaxes(title_text="누적 수익률 (%)", secondary_y=True, ticksuffix="%")

st.plotly_chart(fig, use_container_width=True)

# ---------------------------------------------------------------------------
# 결과 — 매수 내역 테이블
# ---------------------------------------------------------------------------
with st.expander("📋 매수 내역 상세 보기"):
    display_buys = buys.copy()
    display_buys.index = display_buys.index.date
    display_buys.index.name = "매수일"
    display_buys = display_buys[
        [
            "Close",
            "Investment",
            "Shares Bought",
            "Cumulative Shares",
            "Cumulative Investment",
        ]
    ]
    display_buys.columns = ["매수가", "투자금", "매수수량", "누적수량", "누적투자금"]
    st.dataframe(
        display_buys.style.format(
            {
                "매수가": "${:,.2f}",
                "투자금": "${:,.2f}",
                "매수수량": "{:,.6f}",
                "누적수량": "{:,.6f}",
                "누적투자금": "${:,.2f}",
            }
        ),
        use_container_width=True,
    )
