// Owns ranking rows, scroll positions, loading and preview input.
// Data providers, quote formatting and chart rendering stay in their shared modules.
import { icon, escapeHtml as esc } from "./components.js";
import { price, percentage, amount } from "./data.js";
import { watchButton } from "./watch-button.js";
import { requestChannel, reconcile, setText, setHTML } from "./market-client.js";
import { retainRanking } from "./market-preferences.js";
function mountHomeRanking(root, { state, preview, getMonthlyFlow, meta, stateBox, onUpdate = () => {
}, navigate, scrollPreview = () => {
}, request = requestChannel }) {
  const $ = (selector) => root.querySelector(selector);
  const polarity = (n) => n > 0 ? "up" : n < 0 ? "negative" : "neutral-text";
  let rankRows = new Map(), rankViews = new Map(), restoreRankScroll = null, disposed = false;
  const life = new AbortController();
  const listen = (type, handler) => root.querySelector("#rank-body").addEventListener(type, handler, { signal: life.signal });
  function rankRowCreate() {
    const tr = root.ownerDocument.createElement("tr");
    tr.innerHTML = '<td class="rank-cell"></td><td class="name-cell"><div class="rank-stock"><span class="rank-watch-slot"></span><a class="stock-identity" data-nav><span class="stock-avatar"></span><span><strong></strong><small></small></span></a><button class="rank-preview-button" data-rank-preview aria-label="차트 미리보기">' + icon("chart") + '</button></div></td><td class="numeric price-cell"></td><td class="numeric change-cell"></td><td class="numeric amount-cell"></td>';
    return tr;
  }
  function rankRowUpdate(tr, row) {
    if (row.group) {
      tr.className = "market-group";
      setHTML(tr, '<th colspan="5" scope="rowgroup">' + row.label + "<span>" + esc(row.note) + "</span></th>");
      return;
    }
    tr.tabIndex = 0;
    tr.dataset.stockKey = row.market + ":" + row.id;
    tr.classList.toggle("preview-selected", preview?.getSelected() === tr.dataset.stockKey);
    tr.setAttribute("aria-label", row.name + " " + row.ticker + " · 포커스·Space로 차트 미리보기 · Enter로 상세 보기");
    tr.querySelector("[data-rank-preview]").setAttribute("aria-label", row.name + " 차트 미리보기");
    setText(tr.children[0], row.rank);
    setHTML(tr.querySelector(".rank-watch-slot"), watchButton(row, "rank-watch-button"));
    const a = tr.querySelector("a");
    a.tabIndex = -1;
    a.href = "/stock/" + row.market + "/" + encodeURIComponent(row.id) + (row.mode === "monthly_close" ? "?chartDate=" + row.baseDate : "");
    setText(a.querySelector(".stock-avatar"), row.ticker.slice(0, 2));
    setText(a.querySelector("strong"), row.name);
    setText(a.querySelector("small"), row.ticker + " · " + row.market);
    setText(tr.querySelector(".price-cell"), price(row));
    const ch = tr.querySelector(".change-cell");
    ch.className = "numeric change-cell " + polarity(row.changePct);
    setText(ch, percentage(row.changePct));
    const amountCell = tr.querySelector(".amount-cell");
    const estimated = row.turnoverBasis === "price_times_volume";
    amountCell.dataset.label = state.rankKind === "volume" ? "거래량" : estimated ? "추정 거래대금" : "거래대금";
    amountCell.title = state.rankKind === "turnover" && estimated ? "현재가 × 거래량 · 실제 체결대금 합계와 다를 수 있음" : "";
    setText(amountCell, state.rankKind === "volume" ? Number.isFinite(row.volume) ? row.volume.toLocaleString("en-US") + "주" : "—" : (estimated ? "≈ " : "") + amount(row.turnover, row.currency));
  }
  function renderRanking(data) {
    if (disposed) return;
    if (getMonthlyFlow()?.isActive()) return;
    let rows = [], statuses = [];
    const estimated = state.rankKind === "turnover" && (data.groups || [data]).some((g) => g.turnoverEstimated || g.items?.some((s) => s.turnoverBasis === "price_times_volume"));
    const measure = state.rankKind === "volume" ? "거래량" : estimated ? state.rankMarket === "all" ? "거래대금 (미국 추정)" : "추정 거래대금" : "거래대금";
    setText($(".ranking-table thead .amount-cell"), measure + " ↓");
    setText($(".ranking-table caption"), "종목 순위, 종목명과 티커, 현재가, 등락률, " + measure);
    const groups = data.groups || [{ ...data, market: state.rankMarket }];
    groups.forEach((g) => {
      const items = g.items || [];
      statuses.push(g);
      if (state.rankMarket === "all") rows.push({ id: "group-" + g.market, group: true, label: g.market === "KR" ? "국내 · KRW" : "미국 · USD", note: meta(g) + " · " + items.length + "개" });
      items.forEach((s, i) => rows.push({ ...s, mode: s.mode || g.mode, asOf: s.asOf || g.asOf, asOfKind: s.asOfKind || g.asOfKind, rank: i + 1 }));
    });
    setText($("#rank-description"), state.rankMarket === "all" ? "국내·미국 각각 1–100위 · 시장별 " + measure + " 내림차순" : (state.rankMarket === "KR" ? "국내" : "미국 상장 종목") + " · " + measure + " 기준 · 최대 100개 종목" + (state.rankKind === "volume" ? " · 단위: 주" : "") + (state.rankMarket === "KR" && groups[0]?.baseDate ? " · 전일 기준 " + groups[0].baseDate : "") + (estimated ? " · 미국 추정: 현재가 × 거래량" : ""));
    const scrollTop = $("#rank-scroll").scrollTop, count = rows.filter((x) => !x.group).length;
    reconcile($("#rank-body"), rows, (x) => x.group ? x.id : x.market + ":" + x.id, (row) => row.group ? root.ownerDocument.createElement("tr") : rankRowCreate(), rankRowUpdate);
    $("#rank-scroll").scrollTop = scrollTop;
    rankRows = new Map(rows.filter((r) => !r.group).map((r) => [r.market + ":" + r.id, r]));
    preview?.setRows([...rankRows.values()], state.rankMarket + ":" + state.rankKind);
    if (restoreRankScroll !== null) {
      $("#rank-scroll").scrollTop = restoreRankScroll;
      restoreRankScroll = null;
    }
    const failed = statuses.filter((g) => !g.items?.length && g.status !== "ready");
    setHTML($("#rank-state"), failed.length ? failed.map((g) => '<div class="group-state">' + (state.rankMarket === "all" && g.market ? '<span class="group-state-name">' + (g.market === "KR" ? "국내" : "미국") + "</span>" : "") + stateBox(g.status, g.message || measure + " 순위를 제공할 데이터 연결이 필요합니다.", "refresh-ranking") + "</div>").join("") : "");
    setText($("#rank-count"), state.rankKind === "turnover" && state.rankMarket === "all" ? statuses.map((g) => (g.market === "KR" ? "국내" : "미국") + " " + (g.items?.length || 0) + "개").join(" · ") : count + "개 종목");
    if (state.rankKind === "turnover") {
      setText($(".top100"), state.rankMarket === "all" ? "시장별 최대 100" : count ? "TOP " + count : "최대 100");
      $("#rank-description").textContent += " · ETF 제외";
      const unknown = statuses.reduce((n, g) => n + (g.classification?.displayedUnknownCount || 0), 0);
      if (unknown) $("#rank-description").textContent += " · 유형 미확인 " + unknown + "개 포함";
      $("#rank-description").title = "확인된 ETF만 제외 · ETN 등 다른 상품은 이 필터로 제외하지 않음" + statuses.filter((g) => g.classification?.receivedAt).map((g) => "\n" + (g.market === "KR" ? "국내" : "미국") + " 분류: " + g.classification.source + " · " + g.classification.receivedAt + (g.classification.stale ? " · 마지막 저장 분류" : "")).join("");
      if (statuses.some((g) => g.classification?.stale)) $("#rank-description").textContent += " · 마지막 저장 분류 사용";
    } else {
      setText($(".top100"), "TOP 100");
      $("#rank-description").title = "";
    }
    setText($("#rank-meta"), (data.stale ? "갱신 오류 · 마지막 " : "") + statuses.map((g) => (g.stale ? "갱신 오류 · 마지막 " : "") + (state.rankMarket === "all" && g.market ? g.market === "KR" ? "국내 " : "미국 " : "") + meta(g)).join(" / "));
    $("#rank-meta").classList.toggle("stale", Boolean(data.stale || statuses.some((g) => g.stale)));
    root.setAttribute("aria-busy", "false");
    onUpdate();
  }
  function renderMonthlyRanking(data) {
    if (disposed) return;
    const stocks = data.stocks || [], rows = stocks.slice(0, 100).map((s, i) => ({ ...s, rank: i + 1 })), scroll = $("#rank-scroll").scrollTop;
    setText($("#ranking-title"), "월 누적 등락률 순위");
    setText($(".top100"), rows.length ? "TOP " + rows.length : "집계 없음");
    setText($(".ranking-table caption"), "월 누적 종목 수익률 순위");
    setText($(".ranking-table thead th:nth-child(3)"), "기준일 종가");
    setText($(".ranking-table thead th:nth-child(4)"), "월 누적");
    setText($(".ranking-table thead .amount-cell"), "지수 대비");
    reconcile($("#rank-body"), rows, (s) => s.market + ":" + s.id, rankRowCreate, (tr, row) => {
      rankRowUpdate(tr, row);
      const cell = tr.querySelector(".amount-cell");
      cell.dataset.label = "지수 대비";
      cell.title = "같은 기간 수익률 차이 · 퍼센트포인트";
      setText(cell, Number.isFinite(row.excessPct) ? (row.excessPct > 0 ? "+" : "") + row.excessPct.toFixed(2) + "%p" : "—");
    });
    $("#rank-scroll").scrollTop = scroll;
    rankRows = new Map(rows.map((r) => [r.market + ":" + r.id, r]));
    preview?.setRows(rows, "monthly:" + data.indexId + ":" + data.month + ":" + data.filter);
    setText($("#rank-description"), (data.universe || data.indexId || "") + " · " + (data.startDate || "—") + " → " + (data.baseDate || "—") + " · 월 누적 내림차순 · ETF 제외");
    setText($("#rank-count"), "조건 " + stocks.length + "개 · " + rows.length + "개 표시");
    setText($("#rank-meta"), (data.stale ? "마지막 저장 집계 · " : "") + (data.source || "") + " · " + (data.baseDate || "기준일 없음"));
    setHTML($("#rank-state"), rows.length ? "" : stateBox(data.status === "loading" ? "loading" : data.status === "error" ? "error" : "empty", data.message || "선택한 조건의 종목이 없습니다."));
    root.setAttribute("aria-busy", String(data.status === "loading"));
  }
  function loadRanking(clear = false) {
    if (disposed) return;
    if (getMonthlyFlow()?.isActive()) {
      getMonthlyFlow().refresh();
      return;
    }
    const scroll = $("#rank-scroll"), context = state.rankMarket + ":" + state.rankKind;
    if (clear) {
      if (scroll.dataset.context) rankViews.set(scroll.dataset.context, scroll.scrollTop);
      restoreRankScroll = rankViews.get(context) || 0;
      state.ranking = null;
      rankRows.clear();
      $("#rank-body").replaceChildren();
      preview?.loading();
    }
    scroll.dataset.context = context;
    request("ranking", "/api/ranking?market=" + state.rankMarket + "&kind=" + state.rankKind, () => {
      if (!state.ranking) setHTML($("#rank-state"), stateBox("loading", "순위를 확인하고 있어요"));
      root.setAttribute("aria-busy", "true");
    }, (data) => {
      if (disposed) return;
      state.ranking = retainRanking(state.ranking, data);
      renderRanking(state.ranking);
    });
  }
  const selectRow = (e) => {
    if (e.target.closest('[data-action="watch-stock"]')) return;
    const row = e.target.closest("[data-stock-key]");
    if (row) preview.select(rankRows.get(row.dataset.stockKey));
  };
  let hoverTimer, hoverPausedUntil = 0;
  listen("pointerover", (e) => {
    clearTimeout(hoverTimer);
    if (e.pointerType === "mouse" && Date.now() > hoverPausedUntil && !e.target.closest(".rank-watch-slot")) hoverTimer = setTimeout(() => selectRow(e), 100);
  });
  listen("pointerout", () => clearTimeout(hoverTimer));
  listen("pointerdown", () => clearTimeout(hoverTimer));
  listen("focusin", selectRow);
  const openRankRow = (row) => {
    const href = row?.querySelector("a[data-nav]")?.getAttribute("href");
    if (href) {
      clearTimeout(hoverTimer);
      navigate(href);
    }
  };
  listen("click", (e) => {
    if (e.target.closest("[data-rank-preview]")) {
      e.preventDefault();
      clearTimeout(hoverTimer);
      hoverPausedUntil = Date.now() + 1e3;
      selectRow(e);
      scrollPreview();
      return;
    }
    if (e.target.closest("a,button") || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    const row = e.target.closest("[data-stock-key]");
    if (row) {
      e.preventDefault();
      openRankRow(row);
    }
  });
  listen("keydown", (e) => {
    if (e.target.matches("[data-stock-key]") && ["Enter", " "].includes(e.key)) {
      e.preventDefault();
      if (e.key === " ") selectRow(e);
      else openRankRow(e.target);
    }
  });
  function showDaily() {
    if (disposed) return;
    setText($("#ranking-title"), "종목 순위");
    setText($(".ranking-table thead th:nth-child(3)"), "현재가");
    setText($(".ranking-table thead th:nth-child(4)"), "등락률");
    loadRanking();
  }
  return { load: loadRanking, renderMonthly: renderMonthlyRanking, showDaily, destroy() {
    if (disposed) return;
    disposed = true;
    clearTimeout(hoverTimer);
    life.abort();
    rankRows.clear();
    rankViews.clear();
  } };
}
export {
  mountHomeRanking
};
