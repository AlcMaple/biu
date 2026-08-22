/*
 * 这是静态 HTML 版本的状态容器。每个 render* 函数都按注释中的 React 组件边界拆分，
 * 审查通过后可直接转为同名组件的 props / Zustand 状态，而不是重新做视觉设计。
 */
const data = {
  music: [
    { id: "m1", title: "等风来", author: "林野", plays: "8,712", duration: "03:46", art: "amber", word: "WIND" },
    {
      id: "m2",
      title: "把云写成一封信",
      author: "知夏",
      plays: "5,491",
      duration: "04:12",
      art: "teal",
      word: "CLOUD",
    },
    {
      id: "m3",
      title: "凌晨三点半的海",
      author: "潮汐乐队",
      plays: "2.31 万",
      duration: "03:58",
      art: "pink",
      word: "TIDE",
    },
    {
      id: "m4",
      title: "白日焰火",
      author: "北岛邮差",
      plays: "9,205",
      duration: "03:33",
      art: "slate",
      word: "SPARK",
    },
    {
      id: "m5",
      title: "慢一点也没关系",
      author: "春野",
      plays: "7,702",
      duration: "03:10",
      art: "sand",
      word: "SLOW",
    },
    {
      id: "m6",
      title: "回声落在雨里",
      author: "夏末电台",
      plays: "6,394",
      duration: "04:04",
      art: "violet",
      word: "ECHO",
    },
    {
      id: "m7",
      title: "日落之前",
      author: "南方树",
      plays: "1.48 万",
      duration: "02:56",
      art: "moss",
      word: "DUSK",
    },
    {
      id: "m8",
      title: "飞向没有名字的星",
      author: "阿遥",
      plays: "4,841",
      duration: "03:28",
      art: "blue",
      word: "ORBIT",
    },
  ],
  guichu: [
    {
      id: "g1",
      title: "复读机的反击",
      author: "拟声研究所",
      plays: "1.26 万",
      duration: "02:18",
      art: "violet",
      word: "LOOP",
    },
    {
      id: "g2",
      title: "今天的闹钟很会唱",
      author: "快乐音箱",
      plays: "8,112",
      duration: "02:42",
      art: "pink",
      word: "ALARM",
    },
    {
      id: "g3",
      title: "像素雨落下的节拍",
      author: "八比特小队",
      plays: "3,755",
      duration: "03:12",
      art: "blue",
      word: "PIXEL",
    },
    {
      id: "g4",
      title: "热水壶也想上舞台",
      author: "日常乐园",
      plays: "6,098",
      duration: "02:26",
      art: "amber",
      word: "BOIL",
    },
    {
      id: "g5",
      title: "开会五分钟，摸鱼两小时",
      author: "办公桌乐队",
      plays: "9,411",
      duration: "03:01",
      art: "teal",
      word: "BREAK",
    },
  ],
  pop: [
    {
      id: "p1",
      title: "夏天的最后一班车",
      author: "未眠城市",
      plays: "2.64 万",
      duration: "03:39",
      art: "moss",
      word: "SUMMER",
    },
    {
      id: "p2",
      title: "银河便利店",
      author: "白昼梦",
      plays: "1.75 万",
      duration: "03:18",
      art: "blue",
      word: "GALAXY",
    },
    {
      id: "p3",
      title: "晚安以后",
      author: "朔风",
      plays: "8,680",
      duration: "04:06",
      art: "amber",
      word: "NIGHT",
    },
    {
      id: "p4",
      title: "薄荷色的周末",
      author: "一页晴天",
      plays: "1.02 万",
      duration: "03:24",
      art: "teal",
      word: "MINT",
    },
    {
      id: "p5",
      title: "再见的练习题",
      author: "镜子乐队",
      plays: "7,320",
      duration: "03:55",
      art: "slate",
      word: "MIRROR",
    },
  ],
};

const downloads = [
  {
    id: "d1",
    title: "等风来 · 现场版",
    art: "amber",
    word: "WIND",
    type: "audio",
    quality: "320 kbps",
    progress: 72,
    size: "8.4 MB",
    time: "今天 10:24",
    state: "下载中",
  },
  {
    id: "d2",
    title: "凌晨三点半的海",
    art: "pink",
    word: "TIDE",
    type: "video",
    quality: "1080P60",
    progress: 100,
    size: "146 MB",
    time: "昨天 21:08",
    state: "已完成",
  },
  {
    id: "d3",
    title: "白日焰火",
    art: "slate",
    word: "SPARK",
    type: "audio",
    quality: "flac",
    progress: 100,
    size: "34.6 MB",
    time: "昨天 18:35",
    state: "已完成",
  },
];

const coverGradients = {
  amber: "linear-gradient(138deg,#7c503d 0%,#d39a70 48%,#e8cfad 100%)",
  teal: "linear-gradient(138deg,#07383f 0%,#168d8c 51%,#d8db9a 100%)",
  pink: "linear-gradient(138deg,#322f58 0%,#b45177 52%,#edbd8b 100%)",
  slate: "linear-gradient(138deg,#162b3d 0%,#456d8d 50%,#d6dce3 100%)",
  sand: "linear-gradient(138deg,#4d3b38 0%,#b77b55 53%,#f0d2ad 100%)",
  violet: "linear-gradient(138deg,#2b234b 0%,#7651ae 49%,#efb3bb 100%)",
  moss: "linear-gradient(138deg,#22352a 0%,#729953 51%,#f1df9d 100%)",
  blue: "linear-gradient(138deg,#1e3e68 0%,#45a0ca 51%,#d9f1ee 100%)",
};

const state = {
  page: "recommend",
  tab: "music",
  current: data.music[0],
  playing: false,
  liked: false,
  searchOpen: false,
  searchValue: "",
  filter: "all",
  menuTrack: null,
  mobileDrawer: false,
  queueOpen: false,
  fullOpen: false,
  fullSettings: false,
};
const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const allTracks = () => Object.values(data).flat();
const currentTracks = () => data[state.tab];
const icon = (name, extra = "") => `<svg class="icon ${extra}" aria-hidden="true"><use href="#i-${name}" /></svg>`;
const esc = value =>
  String(value).replace(/[&<>"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
const cover = (item, className = "track-cover") =>
  `<span class="${className}" style="--cover:${coverGradients[item.art]}"><span class="cover-word">${esc(item.word)}</span></span>`;

function renderMenus() {
  const items = [
    ["recommend", "推荐音乐", "disc"],
    ["fm", "私人FM", "heart-pulse"],
    ["downloads", "下载记录", "download"],
  ];
  const markup = items
    .map(
      ([page, label, graphic]) =>
        `<button class="menu-item ${state.page === page ? "is-active" : ""}" type="button" data-page="${page}">${icon(graphic)}<span>${label}</span></button>`,
    )
    .join("");
  $("#desktop-menu").innerHTML = markup;
  $("#mobile-menu").innerHTML = markup;
}

function renderTrackRows(items) {
  return items
    .map(
      (item, index) => `
    <article class="music-row ${item.id === state.current.id ? "is-playing" : ""} ${state.menuTrack === item.id ? "is-menu-open" : ""}" data-track-row="${item.id}">
      <span class="music-row-index">${index + 1}</span>
      <button class="track-primary" type="button" data-action="play-track" data-track-id="${item.id}" aria-label="播放 ${esc(item.title)}">
        ${cover(item)}
        <span class="track-copy"><span class="track-title">${esc(item.title)}</span><span class="track-author">${esc(item.author)}</span></span>
      </button>
      <span class="music-row-stat">${item.plays}</span>
      <span class="music-row-duration">${item.duration}</span>
      <button class="track-more" type="button" aria-label="${esc(item.title)} 更多操作" data-action="toggle-operation" data-track-id="${item.id}">${icon("more")}</button>
      <div class="operation-menu" aria-label="${esc(item.title)} 操作"><button type="button" data-action="play-next" data-track-id="${item.id}">下一首播放</button><button type="button" data-action="add-queue" data-track-id="${item.id}">加入播放列表</button><button type="button" data-action="toast" data-message="原型中：已打开收藏夹选择">收藏</button><button type="button" data-action="toast" data-message="原型中：已打开下载选项">下载</button></div>
    </article>`,
    )
    .join("");
}

function renderRecommend() {
  const tabs = [
    ["music", "音乐"],
    ["guichu", "鬼畜"],
    ["pop", "流行"],
  ];
  return `<section data-component="MusicRecommend"><div class="recommend-toolbar"><div class="tabs" role="tablist" aria-label="推荐分类">${tabs.map(([key, label]) => `<button class="tab ${state.tab === key ? "is-active" : ""}" type="button" role="tab" aria-selected="${state.tab === key}" data-tab="${key}">${label}</button>`).join("")}</div><button class="primary-button" type="button" data-action="play-all">${icon("play", "fill-icon")}<span>全部播放</span></button></div><div class="music-list" data-component="MusicRecommendList"><div class="music-head" data-component="MusicListHeader"><span>#</span><span>标题</span><span class="align-right hide-compact hide-mobile">播放量</span><span class="align-right hide-mobile">时长</span><span></span></div>${renderTrackRows(currentTracks())}</div></section>`;
}

function renderFm() {
  const item = state.current;
  return `<section class="fm-page" data-component="Heartbeat">${cover(item, "fm-cover")}<div class="fm-copy"><h1>${esc(item.title)}</h1><p>${esc(item.author)}</p></div><button class="fm-like ${state.liked ? "is-liked" : ""}" type="button" data-action="toggle-like">${icon("heart")}<span>加入我喜欢的音乐</span></button><p class="fm-note">私人FM · 根据「我喜欢的音乐」为你不断推荐相似单曲，边听边用 ♥ 收藏你喜欢的。</p></section>`;
}

function filteredDownloads() {
  return state.filter === "all" ? downloads : downloads.filter(item => item.type === state.filter);
}

function renderDownloadItem(item) {
  return `<tr><td><div class="download-file">${cover(item)}<div class="download-file-copy"><div class="download-file-title">${esc(item.title)}</div><span class="quality-chip">${item.quality}</span></div></div></td><td><div class="download-progress"><div class="download-progress-label"><span>${item.state}</span><span>${item.progress}%</span></div><div class="progress-track"><span class="progress-value" style="--progress:${item.progress}%"></span></div></div></td><td>${item.size}</td><td>${item.time}</td><td><button class="icon-button" type="button" aria-label="${esc(item.title)} 更多操作" data-action="toast" data-message="原型中：打开下载任务操作">${icon("more")}</button></td></tr>`;
}

function renderDownloadMobileItem(item) {
  return `<div class="download-mobile-item">${cover(item)}<div class="download-mobile-copy"><div class="download-file-title">${esc(item.title)}</div><span class="quality-chip">${item.quality}</span><div class="download-progress"><div class="progress-track"><span class="progress-value" style="--progress:${item.progress}%"></span></div></div></div><span class="download-mobile-state">${item.state}<br>${item.progress}%</span></div>`;
}

function renderDownloads() {
  const list = filteredDownloads();
  const filters = [
    ["all", "全部"],
    ["audio", "音频"],
    ["video", "视频"],
  ];
  return `<section class="download-page" data-component="DownloadList"><div class="page-heading-row"><h1>下载记录</h1><button class="download-path" type="button" data-action="toast" data-message="原型中：打开下载目录">${icon("folder")}<span>D:\\Biu Downloads</span></button></div><div class="download-card"><div class="download-tools"><div class="radio-tabs" role="radiogroup" aria-label="文件类型">${filters.map(([key, label]) => `<button class="radio-tab ${state.filter === key ? "is-active" : ""}" type="button" role="radio" aria-checked="${state.filter === key}" data-filter="${key}"><span class="radio-dot"></span>${label}</button>`).join("")}</div><button class="icon-button" type="button" aria-label="清空记录" data-action="toast" data-message="原型中：清空记录需要二次确认">${icon("close")}</button></div><table class="download-table" aria-label="下载列表"><thead><tr><th>文件</th><th>状态</th><th>大小</th><th>下载时间</th><th>操作</th></tr></thead><tbody>${list.map(renderDownloadItem).join("")}</tbody></table><div class="download-mobile-list">${list.map(renderDownloadMobileItem).join("")}</div></div></section>`;
}

function renderSearchPage() {
  const query = state.searchValue.trim();
  const rows = allTracks().filter(item => `${item.title}${item.author}`.includes(query));
  return `<section data-component="Search"><h1 class="search-page-heading">搜索【${esc(query)}】的结果</h1><div class="search-page-toolbar"><div class="tabs" role="tablist" aria-label="搜索类型"><button class="tab is-active" type="button">视频</button><button class="tab" type="button" data-action="toast" data-message="原型中：用户搜索结果">用户</button></div></div><div class="music-list"><div class="music-head"><span>#</span><span>标题</span><span class="align-right hide-compact hide-mobile">播放量</span><span class="align-right hide-mobile">时长</span><span></span></div>${rows.length ? renderTrackRows(rows) : '<div class="fm-note" style="margin:56px auto">暂无模拟搜索结果</div>'}</div></section>`;
}

function renderPage() {
  const view =
    state.page === "recommend"
      ? renderRecommend()
      : state.page === "fm"
        ? renderFm()
        : state.page === "downloads"
          ? renderDownloads()
          : renderSearchPage();
  $("#page-content").innerHTML = view;
  renderMenus();
}

function renderSearchPopover() {
  const query = state.searchValue.trim();
  const history = ["晚风", "治愈歌单", "夏天", "白噪音"];
  const matches = query
    ? allTracks()
        .filter(item => `${item.title}${item.author}`.includes(query))
        .slice(0, 6)
    : [];
  let content = "";
  if (!query) {
    content = `<div class="search-history-head"><span>搜索历史</span><button type="button" data-action="clear-history">清除全部</button></div><div class="search-chips">${history.map(term => `<button class="search-chip" type="button" data-action="select-search" data-search-term="${term}">${term}</button>`).join("")}</div><div class="suggestion-row" style="color:var(--foreground-400);justify-content:center">输入关键词查看模拟建议</div>`;
  } else if (matches.length) {
    content = matches
      .map(
        item =>
          `<button class="suggestion-row" type="button" data-action="select-search" data-search-term="${esc(item.title)}">${icon("search")}<span>${esc(item.title)} · ${esc(item.author)}</span></button>`,
      )
      .join("");
  } else {
    content = `<div class="suggestion-row" style="color:var(--foreground-400);justify-content:center">暂无搜索建议</div>`;
  }
  $("#search-popover").innerHTML = content;
  $("#search-shell").classList.toggle("is-open", state.searchOpen);
  $("#search-shell").classList.toggle("has-value", Boolean(state.searchValue));
}

function renderPlayer() {
  const item = state.current;
  [
    ["desktop-player-cover", "player-cover"],
    ["mobile-player-cover", "player-cover"],
    ["full-player-cover", "full-cover"],
  ].forEach(([id, className]) => {
    $("#" + id).outerHTML = cover(item, `${className}" id="${id}`);
  });
  [
    ["desktop-player-title", item.title],
    ["desktop-player-author", item.author],
    ["mobile-player-title", item.title],
    ["mobile-player-author", item.author],
    ["full-player-title", item.title],
    ["full-player-author", item.author],
    ["desktop-total-time", item.duration],
    ["full-total-time", item.duration],
  ].forEach(([id, value]) => {
    $("#" + id).textContent = value;
  });
  $$("[data-play-toggle]").forEach(button => {
    button.setAttribute("aria-label", state.playing ? "暂停" : "播放");
    button.innerHTML = icon(state.playing ? "pause-circle" : "play-circle");
  });
}

function renderQueue() {
  const items = currentTracks();
  $("#queue-count").textContent = `${items.length} 首`;
  $("#queue-list").innerHTML = items
    .map(
      (item, index) =>
        `<button class="queue-item ${item.id === state.current.id ? "is-playing" : ""}" type="button" data-action="play-track" data-track-id="${item.id}"><span class="queue-number">${index + 1}</span>${cover(item)}<span class="queue-name">${esc(item.title)}</span><span class="queue-duration">${item.duration}</span></button>`,
    )
    .join("");
}

function syncLayers() {
  $("#mobile-side-drawer").classList.toggle("is-open", state.mobileDrawer);
  $("#mobile-side-drawer").setAttribute("aria-hidden", String(!state.mobileDrawer));
  $("#queue-drawer").classList.toggle("is-open", state.queueOpen);
  $("#queue-drawer").setAttribute("aria-hidden", String(!state.queueOpen));
  $("#drawer-backdrop").classList.toggle("is-open", state.mobileDrawer || state.queueOpen);
  $("#full-player").classList.toggle("is-open", state.fullOpen);
  $("#full-player").setAttribute("aria-hidden", String(!state.fullOpen));
  $("#full-settings").classList.toggle("is-open", state.fullSettings && state.fullOpen);
  document.body.classList.toggle("modal-open", state.fullOpen);
}

function renderAll() {
  renderPage();
  renderSearchPopover();
  renderPlayer();
  renderQueue();
  syncLayers();
}

function findTrack(id) {
  return allTracks().find(item => item.id === id);
}
function changeTrack(id, message = true) {
  const item = findTrack(id);
  if (!item) return;
  state.current = item;
  state.playing = true;
  state.menuTrack = null;
  renderAll();
  if (message) showToast(`正在播放：${item.title}`);
}
function stepTrack(delta) {
  const items = currentTracks();
  let index = items.findIndex(item => item.id === state.current.id);
  if (index < 0) index = 0;
  changeTrack(items[(index + delta + items.length) % items.length].id);
}
function closeDrawers() {
  state.mobileDrawer = false;
  state.queueOpen = false;
  syncLayers();
}
function openFull() {
  closeDrawers();
  state.fullOpen = true;
  state.fullSettings = false;
  syncLayers();
}
function closeFull() {
  state.fullOpen = false;
  state.fullSettings = false;
  syncLayers();
}
function submitSearch(value) {
  const query = value.trim();
  if (!query) return;
  state.searchValue = query;
  state.searchOpen = false;
  state.page = "search";
  renderAll();
  $("#search-input").blur();
  $("#page-scroll").scrollTop = 0;
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

document.addEventListener("click", event => {
  const target = event.target.closest("[data-action], [data-page], [data-tab], [data-filter]");
  if (!target) {
    if (!$("#search-shell").contains(event.target)) {
      state.searchOpen = false;
      renderSearchPopover();
    }
    return;
  }
  if (target.dataset.page) {
    state.page = target.dataset.page;
    state.menuTrack = null;
    closeDrawers();
    renderAll();
    return;
  }
  if (target.dataset.tab) {
    state.tab = target.dataset.tab;
    state.menuTrack = null;
    if (!currentTracks().some(item => item.id === state.current.id)) state.current = currentTracks()[0];
    renderAll();
    return;
  }
  if (target.dataset.filter) {
    state.filter = target.dataset.filter;
    renderPage();
    return;
  }
  const { action, trackId, message, searchTerm } = target.dataset;
  if (action === "open-mobile-menu") {
    state.mobileDrawer = true;
    syncLayers();
  }
  if (action === "close-drawers") closeDrawers();
  if (action === "open-queue") {
    state.queueOpen = true;
    state.mobileDrawer = false;
    state.fullOpen = false;
    state.fullSettings = false;
    syncLayers();
  }
  if (action === "play-track") {
    closeDrawers();
    changeTrack(trackId);
  }
  if (action === "previous") stepTrack(-1);
  if (action === "next") stepTrack(1);
  if (action === "toggle-play") {
    state.playing = !state.playing;
    renderPlayer();
    showToast(state.playing ? "继续播放" : "已暂停");
  }
  if (action === "play-all") {
    changeTrack(currentTracks()[0].id, false);
    showToast(`已添加 ${currentTracks().length} 首到播放列表`);
  }
  if (action === "toggle-operation") {
    state.menuTrack = state.menuTrack === trackId ? null : trackId;
    renderPage();
  }
  if (action === "play-next") {
    state.menuTrack = null;
    renderPage();
    showToast("已加入下一首播放");
  }
  if (action === "add-queue") {
    state.menuTrack = null;
    renderPage();
    showToast("已加入播放列表");
  }
  if (action === "open-full-player") openFull();
  if (action === "close-full-player") closeFull();
  if (action === "toggle-full-settings") {
    state.fullSettings = !state.fullSettings;
    syncLayers();
  }
  if (action === "toggle-like") {
    state.liked = !state.liked;
    renderPage();
    showToast(state.liked ? "已加入我喜欢的音乐" : "已移出我喜欢的音乐");
  }
  if (action === "clear-search") {
    state.searchValue = "";
    $("#search-input").value = "";
    state.searchOpen = true;
    renderSearchPopover();
    $("#search-input").focus();
  }
  if (action === "clear-history") showToast("原型中：搜索历史已清除");
  if (action === "select-search") {
    $("#search-input").value = searchTerm;
    state.searchValue = searchTerm;
    submitSearch(searchTerm);
  }
  if (action === "toast") showToast(message || "原型交互已触发");
});

$("#search-input").addEventListener("focus", () => {
  state.searchOpen = true;
  renderSearchPopover();
});
$("#search-input").addEventListener("input", event => {
  state.searchValue = event.target.value;
  state.searchOpen = true;
  renderSearchPopover();
});
$("#search-input").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.isComposing) {
    event.preventDefault();
    submitSearch(event.currentTarget.value);
  }
  if (event.key === "Escape") {
    state.searchOpen = false;
    renderSearchPopover();
    event.currentTarget.blur();
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    state.searchOpen = false;
    closeDrawers();
    closeFull();
    renderSearchPopover();
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    state.searchOpen = true;
    renderSearchPopover();
    $("#search-input").focus();
  }
});

renderAll();
