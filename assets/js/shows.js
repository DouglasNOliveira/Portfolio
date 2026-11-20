/* ==========================================================================
   SHOWS — dashboard dos shows que assisti (dados do setlist.fm)

   Fluxo dos dados:
     setlist.fm API → Apps Script (vinculado à planilha) → Google Sheets
     publicado como CSV → este arquivo.

   A aba de gid 0 ("indice") diz o gid de cada tabela, então novas abas ou
   abas recriadas não exigem mudança aqui.
   ========================================================================== */
(function () {
  "use strict";

  const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQnutQitZ9TMrVsDBzm9k7bCcQ2JKOeGBj2xHIsmmede9EI-pxki_R9yYYKjbxhuOz3WIsRrdFT3Kum/pub?single=true&output=csv&gid=";
  const INDEX_GID = "0";
  const TABLES = ["fact_shows", "fact_songs", "dim_artists", "dim_venues", "dim_cities"];
  // Geradas pelo Apps Script da planilha (busca no MusicBrainz); sem elas o dashboard funciona, só sem álbuns
  const OPTIONAL_TABLES = ["dim_songs", "dim_albums"];
  const RANKING_SIZE = 10;
  const ALBUM_WALL_SIZE = 12;
  const ALBUM_COLORS = ["#52e3ff", "#a075ff", "#6cf6c5", "#ffbe5c", "#ff718d", "#4f8cff", "#ec6bdf", "#81d56c", "#ff9f5a", "#7de0ff"];
  const NO_ALBUM = { cover: "__cover", missing: "__none" };

  const number = new Intl.NumberFormat("pt-BR");
  const shortDate = new Intl.DateTimeFormat("pt-BR");
  const longDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });
  const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

  const state = {
    shows: [],
    filters: { year: "all", artist: "all", city: "all", venue: "all" },
    placeMode: "venue",
    albumArtist: null,
    hasAlbums: false,
    search: "",
    sort: { key: "date", direction: "desc" },
    updatedAt: null,
    sourceUrl: "https://www.setlist.fm",
  };

  const $ = (selector, root = document) => root.querySelector(selector);

  /* ---------- Utilitários ---------- */

  function parseCsv(text) {
    const rows = []; let row = []; let value = ""; let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]; const next = text[index + 1];
      if (char === '"' && quoted && next === '"') { value += char; index += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { row.push(value); value = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && next === "\n") index += 1;
        row.push(value); if (row.some((cell) => cell.trim())) rows.push(row);
        row = []; value = "";
      }
      else value += char;
    }
    if (value || row.length) { row.push(value); if (row.some((cell) => cell.trim())) rows.push(row); }
    const [headers = [], ...records] = rows;
    return records.map((record) => Object.fromEntries(headers.map((header, index) => [header.trim().toLowerCase(), (record[index] || "").trim()])));
  }

  function escape(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  }

  /** "yyyy-mm-dd" → Date local (sem deslocamento de fuso). */
  function toDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
  }

  function groupBy(items, keyOf) {
    const groups = new Map();
    items.forEach((item) => {
      const key = keyOf(item);
      if (key === undefined || key === null || key === "") return;
      if (groups.has(key)) groups.get(key).push(item); else groups.set(key, [item]);
    });
    return groups;
  }

  const distinct = (items, keyOf) => new Set(items.map(keyOf).filter(Boolean)).size;
  const plural = (count, one, many) => `${number.format(count)} ${count === 1 ? one : many}`;
  const sumSongs = (shows) => shows.reduce((sum, show) => sum + show.songCount, 0);

  /** Item mais frequente de uma lista de chaves: [chave, contagem]. */
  function mostFrequent(keys) {
    const counts = new Map();
    keys.forEach((key) => { if (key) counts.set(key, (counts.get(key) || 0) + 1); });
    return [...counts].sort((a, b) => b[1] - a[1])[0] || null;
  }

  /* ---------- Carregamento ---------- */

  async function fetchCsv(gid) {
    const response = await fetch(SHEET_URL + encodeURIComponent(gid));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseCsv(await response.text());
  }

  async function loadData() {
    setStatus("loading");
    try {
      const index = await fetchCsv(INDEX_GID);
      const gids = Object.fromEntries(index.map((row) => [row.table_name, row.gid]));
      if (TABLES.some((table) => !gids[table])) throw new Error("empty");

      const optional = OPTIONAL_TABLES.filter((table) => gids[table]);
      const [results, optionalResults] = await Promise.all([
        Promise.all(TABLES.map((table) => fetchCsv(gids[table]))),
        Promise.allSettled(optional.map((table) => fetchCsv(gids[table]))),
      ]);
      const data = Object.fromEntries(TABLES.map((table, position) => [table, results[position]]));
      OPTIONAL_TABLES.forEach((table) => { data[table] = []; });
      optional.forEach((table, position) => { if (optionalResults[position].status === "fulfilled") data[table] = optionalResults[position].value; });

      const showsEntry = index.find((row) => row.table_name === "fact_shows") || index[0];
      state.updatedAt = showsEntry?.updated_at ? new Date(showsEntry.updated_at) : null;
      if (showsEntry?.source_url) state.sourceUrl = showsEntry.source_url;
      state.hasAlbums = data.dim_albums.length > 0;
      state.shows = buildShows(data);
      if (!state.shows.length) throw new Error("empty");

      setStatus("ok");
      render();
    } catch (error) {
      setStatus(error.message === "empty" ? "empty" : "error");
    }
  }

  /** Junta fatos e dimensões em uma lista de shows já resolvidos. */
  function buildShows(data) {
    const artists = new Map(data.dim_artists.map((row) => [row.artist_mbid, { id: row.artist_mbid, name: row.artist_name || "Artista desconhecido", url: row.artist_url }]));
    const cities = new Map(data.dim_cities.map((row) => [row.city_id, { id: row.city_id, name: row.city_name || "Cidade desconhecida", state: row.state, country: row.country_name, countryCode: row.country_code }]));
    const venues = new Map(data.dim_venues.map((row) => [row.venue_id, { id: row.venue_id, name: row.venue_name || "Local desconhecido", cityId: row.city_id, url: row.venue_url }]));
    const albums = new Map(data.dim_albums.map((row) => [row.release_group_mbid, {
      id: row.release_group_mbid,
      title: row.album_title || "Álbum sem título",
      type: row.album_type,
      year: row.release_year,
      artistId: row.artist_mbid,
      artistName: artists.get(row.artist_mbid)?.name || "",
      cover: row.cover_url_manual || row.cover_url,
      url: row.musicbrainz_url,
    }]));
    // Música (artista + nome) → álbum de origem, vindo de dim_songs
    const songAlbums = new Map(data.dim_songs.map((row) => [row.song_key, { status: row.match_status, album: albums.get(row.release_group_mbid) || null }]));

    const songsBySetlist = groupBy(
      data.fact_songs
        .filter((row) => row.is_tape !== "true" && row.song_name)
        .map((row) => {
          const match = songAlbums.get(`${row.artist_mbid}|${row.song_name.toLowerCase()}`);
          return {
            setlistId: row.setlist_id,
            position: Number(row.song_position) || 0,
            name: row.song_name,
            encore: row.is_encore === "true",
            isCover: row.is_cover === "true",
            original: row.original_artist_name,
            guest: row.with_artist_name,
            info: row.song_info,
            album: match?.album || null,
            albumStatus: match?.status || "pending",
          };
        }),
      (song) => song.setlistId,
    );

    return data.fact_shows
      .map((row) => {
        const date = toDate(row.event_date);
        if (!date) return null;
        const venue = venues.get(row.venue_id) || { id: row.venue_id, name: "Local desconhecido" };
        const city = cities.get(row.city_id || venue.cityId) || { id: row.city_id, name: "Cidade desconhecida" };
        const songs = (songsBySetlist.get(row.setlist_id) || []).sort((a, b) => a.position - b.position);
        return {
          id: row.setlist_id,
          eventId: row.event_id || `${row.event_date}_${row.venue_id}`,
          date,
          year: date.getFullYear(),
          artist: artists.get(row.artist_mbid) || { id: row.artist_mbid, name: "Artista desconhecido" },
          venue,
          city,
          tour: row.tour_name,
          songCount: Number(row.song_count) || songs.length,
          coverCount: Number(row.cover_count) || 0,
          info: row.info,
          url: row.setlist_url,
          songs,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.date - b.date);
  }

  /* Filtros do topo. value = chave do filtro; name = texto da opção. */
  const FILTERS = {
    year: { all: "Todos os anos", value: (show) => String(show.year), name: (show) => String(show.year), order: (a, b) => b.value.localeCompare(a.value) },
    artist: { all: "Todos os artistas", value: (show) => show.artist.id, name: (show) => show.artist.name },
    city: { all: "Todas as cidades", value: (show) => show.city.id, name: (show) => show.city.name },
    venue: { all: "Todos os locais", value: (show) => show.venue.id, name: (show) => show.venue.name },
  };

  /** Shows que passam em todos os filtros (menos o indicado em `except`). */
  function filteredShows(except) {
    const active = Object.keys(FILTERS).filter((key) => key !== except && state.filters[key] !== "all");
    return active.length ? state.shows.filter((show) => active.every((key) => FILTERS[key].value(show) === state.filters[key])) : state.shows;
  }

  const hasActiveFilters = () => Object.values(state.filters).some((value) => value !== "all");

  /* ---------- Status e filtro de ano ---------- */

  function setStatus(kind) {
    const host = $("[data-dashboard-status]");
    const messages = {
      loading: '<i class="bx bx-loader-alt bx-spin"></i> Carregando shows…',
      ok: `<i class="bx bx-check-circle"></i> ${state.updatedAt && !Number.isNaN(state.updatedAt.getTime()) ? `Atualizado em ${escape(dateTime.format(state.updatedAt))}` : "Dados atualizados"}`,
      empty: '<i class="bx bx-info-circle"></i> Planilha ainda sem dados do setlist.fm',
      error: '<i class="bx bx-error-circle"></i> Não foi possível carregar os dados agora',
    };
    host.innerHTML = messages[kind];
    if (kind === "empty" || kind === "error") {
      const message = kind === "empty" ? "Os dados aparecerão aqui depois da primeira atualização da planilha." : "Tente novamente em instantes.";
      ["[data-shows-kpis]", "[data-years-chart]", "[data-artists-ranking]", "[data-places-ranking]", "[data-songs-ranking]", "[data-album-wall]", "[data-album-donut]"].forEach((selector) => { $(selector).innerHTML = `<p class="muted">${message}</p>`; });
      $("[data-history-table]").innerHTML = `<tr><td colspan="7">${message}</td></tr>`;
    }
  }

  /** Opções de cada filtro em cascata: só o que existe com os demais filtros aplicados. */
  function renderFilters() {
    Object.entries(FILTERS).forEach(([key, filter]) => {
      const select = $(`[data-filter="${key}"]`);
      const options = [...groupBy(filteredShows(key), filter.value)]
        .map(([value, items]) => ({ value, name: filter.name(items[0]), count: items.length }))
        .sort(filter.order || ((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      if (state.filters[key] !== "all" && !options.some((option) => option.value === state.filters[key])) state.filters[key] = "all";
      select.innerHTML = `<option value="all">${filter.all}</option>${options.map((option) => `<option value="${escape(option.value)}">${escape(option.name)} (${option.count})</option>`).join("")}`;
      select.value = state.filters[key];
      select.closest("label").classList.toggle("is-active", state.filters[key] !== "all");
    });
    $("[data-filters-clear]").hidden = !hasActiveFilters();
  }

  function setFilter(key, value) {
    state.filters[key] = String(value);
    render();
  }

  /* ---------- Render ---------- */

  function render() {
    if (!state.shows.length) return;
    renderFilters();
    const shows = filteredShows();
    renderKpis(shows);
    renderYears();
    renderArtists(shows);
    renderPlaces(shows);
    renderSongs(shows);
    renderAlbumWall(shows);
    renderAlbumDonut(shows);
    renderHistory(shows);
  }

  function renderKpis(shows) {
    const cards = [
      ["shows", "Apresentações", shows.length, "bx-microphone"],
      ["events", "Eventos", distinct(shows, (show) => show.eventId), "bx-calendar-event"],
      ["artists", "Artistas", distinct(shows, (show) => show.artist.id), "bx-user-voice"],
      ["venues", "Locais", distinct(shows, (show) => show.venue.id), "bx-map-pin"],
      ["cities", "Cidades", distinct(shows, (show) => show.city.id), "bx-buildings"],
      ["songs", "Músicas ouvidas", sumSongs(shows), "bx-music"],
    ];
    $("[data-shows-kpis]").innerHTML = cards.map(([key, label, value, icon]) => `<article class="dashboard-kpi" data-tip="kpi:${key}" tabindex="0"><i class="bx ${icon}"></i><span>${label}</span><strong>${number.format(value)}</strong></article>`).join("");
  }

  /**
   * Colunas por ano: só os anos com shows (respeitando os outros filtros);
   * o ano filtrado fica em destaque e os demais esmaecidos.
   */
  function renderYears() {
    const host = $("[data-years-chart]");
    const byYear = groupBy(filteredShows("year"), (show) => show.year);
    const years = [...byYear.keys()].sort((a, b) => a - b);
    if (!years.length) { host.innerHTML = '<p class="muted">Nenhum show com os filtros atuais.</p>'; return; }

    const width = Math.max(host.clientWidth, 260);
    const height = Math.max(host.clientHeight, 220);
    const left = 8; const right = 8; const top = 26; const bottom = 28;
    const chartHeight = height - top - bottom;
    const step = (width - left - right) / years.length;
    const bar = Math.min(56, Math.max(6, step * 0.62));
    const max = Math.max(...years.map((year) => (byYear.get(year) || []).length), 1);
    const labelEvery = step < 30 ? 2 : 1;
    const selected = state.filters.year === "all" ? null : Number(state.filters.year);

    const grid = [0, 0.5, 1].map((ratio) => `<line class="shows-grid-line" x1="${left}" x2="${width - right}" y1="${top + chartHeight * ratio}" y2="${top + chartHeight * ratio}"></line>`).join("");
    const columns = years.map((year, index) => {
      const count = (byYear.get(year) || []).length;
      const x = left + index * step + step / 2;
      const barHeight = count / max * chartHeight;
      const y = top + chartHeight - barHeight;
      const status = selected === null ? "" : year === selected ? " is-selected" : " is-dimmed";
      const label = (years.length - 1 - index) % labelEvery === 0 ? `<text class="shows-axis-label" x="${x}" y="${height - 8}">${year}</text>` : "";
      return `<g class="shows-year${status}">
        <rect class="shows-year-bar" x="${x - bar / 2}" y="${y}" width="${bar}" height="${barHeight}"></rect>
        ${count ? `<text class="shows-year-value" x="${x}" y="${y - 7}">${count}</text>` : ""}
        ${label}
        <rect class="shows-year-hit" x="${x - step / 2}" y="${top - 20}" width="${step}" height="${chartHeight + 20 + bottom}" data-tip="year:${year}" data-year="${year}" tabindex="0" role="button" aria-label="${year}: ${plural(count, "apresentação", "apresentações")}${year === selected ? " (filtrado)" : ""}"></rect>
      </g>`;
    }).join("");

    host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Apresentações por ano">${grid}${columns}</svg>`;
    host.dataset.renderedWidth = String(width);
    host.dataset.renderedHeight = String(height);
  }

  /** Lista em barras horizontais usada pelos três rankings. */
  function rankingHtml(rows, tipKind, emptyMessage) {
    if (!rows.length) return `<p class="muted">${emptyMessage}</p>`;
    const max = Math.max(...rows.map((row) => row.count), 1);
    return `<ol class="shows-ranking">${rows.map((row, index) => `<li class="shows-rank" data-tip="${tipKind}:${escape(row.key)}" tabindex="0">
      <span class="shows-rank-position">${index + 1}</span>
      <span class="shows-rank-body">
        <span class="shows-rank-name"><b>${escape(row.name)}</b>${row.detail ? `<small>${escape(row.detail)}</small>` : ""}</span>
        <span class="shows-rank-bar"><i style="width:${(row.count / max * 100).toFixed(1)}%"></i></span>
      </span>
      <strong class="shows-rank-value">${number.format(row.count)}</strong>
    </li>`).join("")}</ol>`;
  }

  const byCountThenName = (a, b) => b.count - a.count || a.name.localeCompare(b.name, "pt-BR");

  function renderArtists(shows) {
    const rows = [...groupBy(shows, (show) => show.artist.id)].map(([key, items]) => ({ key, name: items[0].artist.name, count: items.length })).sort(byCountThenName).slice(0, RANKING_SIZE);
    $("[data-artists-ranking]").innerHTML = rankingHtml(rows, "artist", "Nenhum artista no período.");
  }

  const PLACE_MODES = {
    venue: { title: "Por Casa de Show", key: (show) => show.venue.id, name: (show) => show.venue.name, detail: (show) => show.city.name },
    city: { title: "Por Cidade", key: (show) => show.city.id, name: (show) => show.city.name, detail: (show) => [show.city.state, show.city.country].filter(Boolean).join(" · ") },
    country: { title: "Por País", key: (show) => show.city.countryCode || show.city.country, name: (show) => show.city.country || "País desconhecido", detail: () => "" },
  };

  function renderPlaces(shows) {
    const mode = PLACE_MODES[state.placeMode];
    const rows = [...groupBy(shows, mode.key)].map(([key, items]) => ({ key, name: mode.name(items[0]), detail: mode.detail(items[0]), count: items.length })).sort(byCountThenName).slice(0, RANKING_SIZE);
    $("[data-places-title]").textContent = mode.title;
    document.querySelectorAll("[data-place-mode]").forEach((button) => {
      const active = button.dataset.placeMode === state.placeMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("[data-places-ranking]").innerHTML = rankingHtml(rows, "place", "Nenhum local no período.");
  }

  /** Chave de música: artista + nome (a mesma música de bandas diferentes não se soma). */
  const songKey = (show, song) => `${show.artist.id}|${song.name.toLowerCase()}`;

  function songPlays(shows) {
    const plays = new Map();
    shows.forEach((show) => show.songs.forEach((song) => {
      const key = songKey(show, song);
      if (!plays.has(key)) plays.set(key, { key, name: song.name, artist: show.artist.name, original: song.original, isCover: song.isCover, shows: [] });
      // Conta shows distintos: uma reprise no mesmo show não soma de novo
      const entry = plays.get(key);
      if (entry.shows.at(-1) !== show) entry.shows.push(show);
    }));
    return plays;
  }

  function renderSongs(shows) {
    const rows = [...songPlays(shows).values()].map((song) => ({ key: song.key, name: song.name, detail: song.artist, count: song.shows.length })).sort(byCountThenName).slice(0, RANKING_SIZE);
    $("[data-songs-ranking]").innerHTML = rankingHtml(rows, "song", "Nenhuma música registrada no período.");
  }

  /* ---------- Álbuns ---------- */

  /** Só aceita imagens https (a coluna manual da planilha é digitada à mão). */
  const coverUrl = (album) => (album && /^https:\/\//i.test(album.cover || "") ? album.cover : "");

  function coverHtml(album, size) {
    const url = coverUrl(album);
    return url
      ? `<img class="album-cover album-cover-${size}" src="${escape(url)}" alt="" loading="lazy" decoding="async">`
      : `<span class="album-cover album-cover-${size} is-empty" aria-hidden="true"><i class="bx bx-album"></i></span>`;
  }

  const SPECIAL_SLICES = {
    [NO_ALBUM.cover]: { title: "Covers", detail: "Músicas de outros artistas", color: "#7f93a8" },
    [NO_ALBUM.missing]: { title: "Fora de álbuns", detail: "Sem álbum de estúdio identificado", color: "#33495e" },
  };

  /**
   * Execuções de músicas agrupadas pelo álbum de origem.
   * Cada item: { key, album, plays, songs: Map(nome → execuções), shows: Set }.
   */
  function albumPlays(shows) {
    const groups = new Map();
    shows.forEach((show) => show.songs.forEach((song) => {
      const key = song.album ? song.album.id : (song.isCover || song.albumStatus === "cover" ? NO_ALBUM.cover : NO_ALBUM.missing);
      if (!groups.has(key)) groups.set(key, { key, album: song.album, artistName: show.artist.name, plays: 0, songs: new Map(), shows: new Set() });
      const group = groups.get(key);
      group.plays += 1;
      group.songs.set(song.name, (group.songs.get(song.name) || 0) + 1);
      group.shows.add(show);
    }));
    return groups;
  }

  function renderAlbumWall(shows) {
    const host = $("[data-album-wall]");
    if (!state.hasAlbums) { host.innerHTML = '<p class="muted">Os álbuns aparecem depois da busca no MusicBrainz.</p>'; return; }
    const top = [...albumPlays(shows).values()]
      .filter((group) => group.album)
      .sort((a, b) => b.plays - a.plays || a.album.title.localeCompare(b.album.title, "pt-BR"))
      .slice(0, ALBUM_WALL_SIZE);
    host.innerHTML = top.length ? `<ol class="album-wall">${top.map((group, index) => `<li class="album-card" data-tip="album:${escape(group.key)}" tabindex="0">
      <span class="album-card-art">${coverHtml(group.album, "lg")}<b class="album-card-rank">${index + 1}</b><strong class="album-card-plays">${number.format(group.plays)}</strong></span>
      <span class="album-card-title">${escape(group.album.title)}</span>
      <small>${escape(group.album.artistName)}${group.album.year ? ` · ${escape(group.album.year)}` : ""}</small>
    </li>`).join("")}</ol>` : '<p class="muted">Nenhum álbum identificado no período.</p>';
  }

  /** Artistas com músicas no período, do mais ouvido para o menos ouvido. */
  function albumArtists(shows) {
    return [...groupBy(shows, (show) => show.artist.id)]
      .map(([id, items]) => ({ id, name: items[0].artist.name, plays: items.reduce((sum, show) => sum + show.songs.length, 0) }))
      .filter((artist) => artist.plays > 0)
      .sort((a, b) => b.plays - a.plays || a.name.localeCompare(b.name, "pt-BR"));
  }

  function renderAlbumDonut(shows) {
    const host = $("[data-album-donut]");
    const select = $("[data-album-artist]");
    if (!state.hasAlbums) { select.hidden = true; host.innerHTML = '<p class="muted">Sem dados de álbuns ainda.</p>'; return; }

    const artists = albumArtists(shows);
    select.hidden = !artists.length;
    if (!artists.length) { host.innerHTML = '<p class="muted">Nenhuma música registrada no período.</p>'; return; }
    if (!artists.some((artist) => artist.id === state.albumArtist)) state.albumArtist = artists[0].id;
    select.innerHTML = artists.map((artist) => `<option value="${escape(artist.id)}">${escape(artist.name)} (${number.format(artist.plays)})</option>`).join("");
    select.value = state.albumArtist;

    const slices = albumSlices(shows, state.albumArtist);
    const total = slices.reduce((sum, slice) => sum + slice.plays, 0);
    const size = 220; const radius = 84; const stroke = 30;
    const circumference = 2 * Math.PI * radius;
    const gap = slices.length > 1 ? 2 : 0;
    let offset = 0;
    const arcs = slices.map((slice) => {
      const length = slice.plays / total * circumference;
      const arc = `<circle class="album-slice" cx="${size / 2}" cy="${size / 2}" r="${radius}" stroke="${slice.color}" stroke-width="${stroke}" stroke-dasharray="${Math.max(length - gap, 0.5)} ${circumference}" stroke-dashoffset="${-offset}" data-tip="slice:${escape(state.albumArtist)}|${escape(slice.key)}" tabindex="0"><title>${escape(slice.title)}</title></circle>`;
      offset += length;
      return arc;
    }).join("");
    const artistName = artists.find((artist) => artist.id === state.albumArtist).name;

    host.innerHTML = `<div class="album-donut">
        <div class="album-donut-ring">
          <svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Músicas de ${escape(artistName)} por álbum"><g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g></svg>
          <span class="album-donut-center"><b>${number.format(total)}</b><small>${total === 1 ? "música ouvida" : "músicas ouvidas"}</small></span>
        </div>
        <ol class="album-legend">${slices.map((slice) => `<li class="album-legend-item" style="--slice-color:${slice.color}" data-tip="slice:${escape(state.albumArtist)}|${escape(slice.key)}" tabindex="0">
          ${slice.album ? coverHtml(slice.album, "sm") : `<span class="album-cover album-cover-sm is-empty is-special" aria-hidden="true"><i class="bx ${slice.key === NO_ALBUM.cover ? "bx-transfer-alt" : "bx-question-mark"}"></i></span>`}
          <span class="album-legend-name"><b>${escape(slice.title)}</b><small>${escape(slice.detail)}</small></span>
          <strong>${number.format(slice.plays)}<small>${(slice.plays / total * 100).toFixed(0)}%</small></strong>
        </li>`).join("")}</ol>
      </div>`;
  }

  /** Fatias do artista: álbuns por execuções (cores fixas na ordem), especiais no fim. */
  function albumSlices(shows, artistId) {
    const groups = [...albumPlays(shows.filter((show) => show.artist.id === artistId)).values()];
    const albumsFirst = groups.filter((group) => group.album).sort((a, b) => b.plays - a.plays || String(a.album.year).localeCompare(String(b.album.year)));
    const specials = groups.filter((group) => !group.album).sort((a, b) => (a.key === NO_ALBUM.cover ? -1 : 1) - (b.key === NO_ALBUM.cover ? -1 : 1));
    return [
      ...albumsFirst.map((group, index) => ({ ...group, title: group.album.title, detail: group.album.year || "", color: ALBUM_COLORS[index % ALBUM_COLORS.length] })),
      ...specials.map((group) => ({ ...group, ...SPECIAL_SLICES[group.key] })),
    ];
  }

  function albumTipHtml(group, heading) {
    const songs = [...group.songs].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
    const list = songs.slice(0, 8).map(([name, count]) => `<li><b>${count}×</b> ${escape(name)}</li>`).join("");
    const more = songs.length > 8 ? `<li class="muted">+ ${songs.length - 8} músicas</li>` : "";
    return `<div class="shows-tip-album">${heading}</div>
      <div class="shows-tip-grid">
        ${tipItem(number.format(group.plays), "Execuções ao vivo")}
        ${tipItem(number.format(group.songs.size), "Músicas diferentes", "accent")}
        ${tipItem(number.format(group.shows.size), group.shows.size === 1 ? "Show" : "Shows", "success")}
      </div>
      <ul class="shows-tip-list">${list}${more}</ul>`;
  }

  /* ---------- Histórico (tabela) ---------- */

  const SORTERS = {
    date: (show) => show.date.getTime(),
    artist: (show) => show.artist.name,
    venue: (show) => show.venue.name,
    city: (show) => show.city.name,
    tour: (show) => show.tour || "",
    songs: (show) => show.songCount,
  };

  function renderHistory(shows) {
    const term = state.search.trim().toLocaleLowerCase("pt-BR");
    const visible = term ? shows.filter((show) => [show.artist.name, show.venue.name, show.city.name, show.city.country, show.tour].join(" ").toLocaleLowerCase("pt-BR").includes(term)) : shows;
    const valueOf = SORTERS[state.sort.key];
    const direction = state.sort.direction === "asc" ? 1 : -1;
    const sorted = [...visible].sort((a, b) => {
      const left = valueOf(a); const right = valueOf(b);
      const result = typeof left === "string" ? left.localeCompare(right, "pt-BR") : left - right;
      return direction * result || b.date - a.date;
    });

    $("[data-history-count]").textContent = plural(visible.length, "apresentação", "apresentações");
    $("[data-history-table]").innerHTML = sorted.map((show) => `<tr data-tip="setlist:${escape(show.id)}">
      <td>${shortDate.format(show.date)}</td>
      <td><b>${escape(show.artist.name)}</b></td>
      <td>${escape(show.venue.name)}</td>
      <td>${escape(show.city.name)}${show.city.countryCode && show.city.countryCode !== "BR" ? ` <small>${escape(show.city.countryCode)}</small>` : ""}</td>
      <td>${show.tour ? escape(show.tour) : '<span class="muted">—</span>'}</td>
      <td>${show.songCount || '<span class="muted">—</span>'}</td>
      <td>${show.url ? `<a class="shows-setlist-link" href="${escape(show.url)}" target="_blank" rel="noopener" aria-label="Ver setlist de ${escape(show.artist.name)} em ${shortDate.format(show.date)} no setlist.fm">setlist.fm <i class="bx bx-link-external" aria-hidden="true"></i></a>` : ""}</td>
    </tr>`).join("") || '<tr><td colspan="7">Nenhum show encontrado.</td></tr>';

    document.querySelectorAll("[data-history-sort]").forEach((button) => {
      button.setAttribute("aria-sort", button.dataset.historySort === state.sort.key ? (state.sort.direction === "asc" ? "ascending" : "descending") : "none");
    });
  }

  /* ---------- Tooltips ---------- */

  const tipItem = (value, label, tone = "") => `<div class="shows-tip-item ${tone}"><strong>${value}</strong><span>${label}</span></div>`;
  const sameDay = (shows) => shows[0].date.getTime() === shows.at(-1).date.getTime();
  const firstLast = (shows) => sameDay(shows) ? longDate.format(shows[0].date) : `${shortDate.format(shows[0].date)} → ${shortDate.format(shows.at(-1).date)}`;

  const TIPS = {
    kpi(key) {
      const help = {
        shows: ["Apresentações", "Cada setlist assistido. Em um festival, cada banda conta uma vez."],
        events: ["Eventos", "Datas e locais distintos. Um festival com várias bandas conta como um evento."],
        artists: ["Artistas", "Artistas diferentes vistos ao vivo."],
        venues: ["Locais", "Casas de show, estádios e espaços diferentes."],
        cities: ["Cidades", "Cidades diferentes onde assisti a shows."],
        songs: ["Músicas ouvidas", "Total de músicas tocadas nos setlists (sem intros gravadas)."],
      }[key];
      return help && `<h4>${help[0]}</h4><p>${help[1]}</p>`;
    },

    year(key) {
      const year = Number(key);
      const shows = filteredShows("year").filter((show) => show.year === year);
      if (!shows.length) return `<h4>${year}</h4><p>Nenhum show neste ano.</p>`;
      const top = mostFrequent(shows.map((show) => show.artist.name));
      const action = String(year) === state.filters.year ? "Clique para ver todos os anos" : "Clique para filtrar este ano";
      return `<h4>Shows em ${year}</h4>
        <div class="shows-tip-grid">
          ${tipItem(number.format(shows.length), "Apresentações")}
          ${tipItem(number.format(distinct(shows, (show) => show.eventId)), "Eventos", "accent")}
          ${tipItem(number.format(distinct(shows, (show) => show.artist.id)), "Artistas", "success")}
          ${tipItem(number.format(sumSongs(shows)), "Músicas", "warm")}
        </div>
        ${top && top[1] > 1 ? `<p>Mais visto: <b>${escape(top[0])}</b> (${top[1]}×)</p>` : ""}
        <p class="shows-tip-hint">${action}</p>`;
    },

    artist(key) {
      const shows = filteredShows().filter((show) => show.artist.id === key);
      if (!shows.length) return "";
      const songs = songPlays(shows);
      const favorite = [...songs.values()].sort((a, b) => b.shows.length - a.shows.length)[0];
      return `<h4>${escape(shows[0].artist.name)}</h4>
        <div class="shows-tip-grid">
          ${tipItem(number.format(shows.length), shows.length === 1 ? "Apresentação" : "Apresentações")}
          ${tipItem(number.format(distinct(shows, (show) => show.venue.id)), "Locais", "success")}
          ${tipItem(number.format(sumSongs(shows)), "Músicas ouvidas", "warm")}
          ${tipItem(number.format(songs.size), "Músicas diferentes", "accent")}
        </div>
        <p>${sameDay(shows) ? "Visto em" : "Período"}: <b>${firstLast(shows)}</b></p>
        ${favorite && favorite.shows.length > 1 ? `<p>Mais ouvida: <b>${escape(favorite.name)}</b> (${favorite.shows.length}×)</p>` : ""}
        ${state.hasAlbums && songs.size ? '<p class="shows-tip-hint">Clique para ver as músicas por álbum</p>' : ""}`;
    },

    album(key) {
      const group = albumPlays(filteredShows()).get(key);
      if (!group || !group.album) return "";
      const { album } = group;
      return albumTipHtml(group, `${coverHtml(album, "tip")}<div><h4>${escape(album.title)}</h4><p class="shows-tip-sub">${escape(album.artistName)}${album.year ? ` · ${escape(album.year)}` : ""}${album.type && album.type !== "Album" ? ` · ${escape(album.type)}` : ""}</p></div>`);
    },

    slice(key) {
      const [artistId, albumKey] = key.split("|");
      const slice = albumSlices(filteredShows(), artistId).find((item) => item.key === albumKey);
      if (!slice) return "";
      const heading = slice.album
        ? `${coverHtml(slice.album, "tip")}<div><h4>${escape(slice.title)}</h4><p class="shows-tip-sub">${escape(slice.artistName)}${slice.album.year ? ` · ${escape(slice.album.year)}` : ""}</p></div>`
        : `<div><h4>${escape(slice.title)}</h4><p class="shows-tip-sub">${escape(slice.detail)} · ${escape(slice.artistName)}</p></div>`;
      return albumTipHtml(slice, heading);
    },

    place(key) {
      const mode = PLACE_MODES[state.placeMode];
      const shows = filteredShows().filter((show) => mode.key(show) === key);
      if (!shows.length) return "";
      const detail = mode.detail(shows[0]);
      const top = mostFrequent(shows.map((show) => show.artist.name));
      return `<h4>${escape(mode.name(shows[0]))}</h4>
        ${detail ? `<p class="shows-tip-sub">${escape(detail)}</p>` : ""}
        <div class="shows-tip-grid">
          ${tipItem(number.format(shows.length), shows.length === 1 ? "Apresentação" : "Apresentações")}
          ${tipItem(number.format(distinct(shows, (show) => show.eventId)), "Eventos", "accent")}
          ${tipItem(number.format(distinct(shows, (show) => show.artist.id)), "Artistas", "success")}
          ${tipItem(number.format(sumSongs(shows)), "Músicas", "warm")}
        </div>
        <p>${sameDay(shows) ? "Data" : "Período"}: <b>${firstLast(shows)}</b></p>
        ${top && top[1] > 1 ? `<p>Mais visto aqui: <b>${escape(top[0])}</b> (${top[1]}×)</p>` : ""}`;
    },

    song(key) {
      const song = songPlays(filteredShows()).get(key);
      if (!song) return "";
      const dates = song.shows.slice(-6).reverse().map((show) => `<li><b>${shortDate.format(show.date)}</b> · ${escape(show.venue.name)}</li>`).join("");
      const more = song.shows.length > 6 ? `<li class="muted">+ ${song.shows.length - 6} anteriores</li>` : "";
      return `<h4>${escape(song.name)}</h4>
        <p class="shows-tip-sub">${escape(song.artist)}${song.isCover && song.original ? ` · cover de ${escape(song.original)}` : ""}</p>
        <p>Ouvida ao vivo <b>${plural(song.shows.length, "vez", "vezes")}</b>:</p>
        <ul class="shows-tip-list">${dates}${more}</ul>`;
    },

    setlist(key) {
      const show = state.shows.find((item) => item.id === key);
      if (!show) return "";
      const head = `<h4>${escape(show.artist.name)}</h4><p class="shows-tip-sub">${longDate.format(show.date)} · ${escape(show.venue.name)}, ${escape(show.city.name)}</p>`;
      if (!show.songs.length) return `${head}<p>${escape(show.info || "Setlist ainda não registrado no setlist.fm.")}</p>`;
      const limit = 22;
      let encoreShown = false;
      const items = show.songs.slice(0, limit).map((song, index) => {
        const marker = song.encore && !encoreShown ? '<li class="shows-tip-encore">Bis</li>' : "";
        if (song.encore) encoreShown = true;
        const notes = [song.isCover && song.original ? `cover de ${song.original}` : "", song.guest ? `com ${song.guest}` : ""].filter(Boolean).join(" · ");
        return `${marker}<li><span>${index + 1}</span>${escape(song.name)}${notes ? ` <small>${escape(notes)}</small>` : ""}</li>`;
      }).join("");
      const more = show.songs.length > limit ? `<li class="shows-tip-more">+ ${show.songs.length - limit} músicas</li>` : "";
      return `${head}${show.tour ? `<p>Turnê: <b>${escape(show.tour)}</b></p>` : ""}<ul class="shows-tip-setlist">${items}${more}</ul>`;
    },
  };

  const tooltip = document.createElement("div");
  tooltip.className = "shows-tooltip";
  tooltip.setAttribute("role", "tooltip");
  document.body.append(tooltip);
  let tipTarget = null;

  function showTip(target, x, y) {
    if (target !== tipTarget) {
      const [kind, ...rest] = target.dataset.tip.split(":");
      const html = TIPS[kind]?.(rest.join(":"));
      tipTarget = target;
      if (!html) { tooltip.classList.remove("is-visible"); return; }
      tooltip.innerHTML = html;
      tooltip.classList.add("is-visible");
    }
    if (!tooltip.classList.contains("is-visible")) return;
    const gap = 16;
    const { offsetWidth: width, offsetHeight: height } = tooltip;
    let left = x + gap;
    if (left + width > window.innerWidth - 12) left = x - gap - width;
    const top = Math.min(window.innerHeight - height - 12, Math.max(12, y - height / 2));
    tooltip.style.left = `${Math.max(12, left)}px`;
    tooltip.style.top = `${top}px`;
  }

  function hideTip() {
    tipTarget = null;
    tooltip.classList.remove("is-visible");
  }

  document.addEventListener("pointermove", (event) => {
    const target = event.target.closest?.("[data-tip]");
    if (target) showTip(target, event.clientX, event.clientY); else if (tipTarget) hideTip();
  });
  document.addEventListener("focusin", (event) => {
    const target = event.target.closest?.("[data-tip]");
    if (!target) return;
    const box = target.getBoundingClientRect();
    showTip(target, box.right - Math.min(box.width / 2, 40), box.top + box.height / 2);
  });
  document.addEventListener("focusout", hideTip);
  window.addEventListener("scroll", hideTip, { passive: true });
  document.addEventListener("pointerleave", hideTip);

  /* ---------- Eventos ---------- */

  document.querySelectorAll("[data-filter]").forEach((select) => select.addEventListener("change", () => setFilter(select.dataset.filter, select.value)));
  $("[data-filters-clear]").addEventListener("click", () => {
    Object.keys(state.filters).forEach((key) => { state.filters[key] = "all"; });
    render();
  });

  function toggleYearFrom(target) {
    const year = target.dataset.year;
    hideTip();
    setFilter("year", state.filters.year === year ? "all" : year);
  }

  $("[data-years-chart]").addEventListener("click", (event) => {
    const target = event.target.closest("[data-year]");
    if (target) toggleYearFrom(target);
  });
  $("[data-years-chart]").addEventListener("keydown", (event) => {
    const target = event.target.closest("[data-year]");
    if (target && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggleYearFrom(target); }
  });

  $("[data-album-artist]").addEventListener("change", (event) => {
    state.albumArtist = event.target.value;
    renderAlbumDonut(filteredShows());
  });

  // Clique em um artista do ranking: mostra os álbuns dele na rosca
  $("[data-artists-ranking]").addEventListener("click", (event) => {
    const item = event.target.closest("[data-tip^='artist:']");
    if (!item || !state.hasAlbums) return;
    state.albumArtist = item.dataset.tip.slice("artist:".length);
    hideTip();
    renderAlbumDonut(filteredShows());
    $(".shows-panel-album-donut").scrollIntoView({ behavior: "smooth", block: "nearest" });
  });

  // Capa que não carrega (álbum sem imagem no Cover Art Archive) → ícone no lugar
  document.addEventListener("error", (event) => {
    const image = event.target;
    if (!(image instanceof HTMLImageElement) || !image.classList.contains("album-cover")) return;
    const placeholder = document.createElement("span");
    placeholder.className = `${image.className} is-empty`;
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.innerHTML = '<i class="bx bx-album"></i>';
    image.replaceWith(placeholder);
  }, true);

  document.querySelectorAll("[data-place-mode]").forEach((button) => button.addEventListener("click", () => {
    state.placeMode = button.dataset.placeMode;
    renderPlaces(filteredShows());
  }));

  document.querySelectorAll("[data-history-sort]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.historySort;
    const defaultDirection = key === "date" || key === "songs" ? "desc" : "asc";
    state.sort = { key, direction: state.sort.key === key ? (state.sort.direction === "asc" ? "desc" : "asc") : defaultDirection };
    renderHistory(filteredShows());
  }));

  $("[data-history-search]").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderHistory(filteredShows());
  });

  // O gráfico de anos é desenhado no tamanho real do painel: redesenha ao redimensionar
  const yearsHost = $("[data-years-chart]");
  new ResizeObserver(() => {
    if (!state.shows.length) return;
    const changed = String(Math.max(yearsHost.clientWidth, 260)) !== yearsHost.dataset.renderedWidth
      || String(Math.max(yearsHost.clientHeight, 220)) !== yearsHost.dataset.renderedHeight;
    if (changed) renderYears();
  }).observe(yearsHost);

  const backToTop = $("[data-back-to-top]");
  const updateBackToTop = () => backToTop.classList.toggle("is-visible", window.scrollY > 420);
  window.addEventListener("scroll", updateBackToTop, { passive: true });
  updateBackToTop();
  backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  $("[data-dashboard-reload]").addEventListener("click", loadData);
  loadData();
}());
