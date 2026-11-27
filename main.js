/* GeoPortal — main.js
   index.html: mapa (Leaflet + markercluster), filtros, tabela e CSV.
   galeria.html: filtro e busca dos mapas.
   Cada parte só roda se os elementos da página existirem. */
(function () {
  'use strict';

  /* ---------------- MAPA ---------------- */
  function iniciarMapa() {
    if (!document.getElementById('map') || typeof L === 'undefined') {
      return;
    }

    /* cores das camadas: uma única fonte (variáveis CSS em main.css), usadas no mapa, na legenda e na exportação */
    var cv = function (n, d) { return (getComputedStyle(document.documentElement).getPropertyValue(n) || '').trim() || d; };
    var COR = { pocos: cv('--cor-pocos', COR.pocos), acudes: cv('--cor-acudes', COR.acudes), acudesBorda: cv('--cor-acudes-borda', COR.acudesBorda), drenagem: cv('--cor-drenagem', COR.acudes),
      postos: cv('--cor-postos', COR.postos), adutExist: cv('--cor-adut-existente', COR.adutExist), adutObras: cv('--cor-adut-obras', COR.adutObras), adutPlan: cv('--cor-adut-planejada', COR.adutPlan) };
    var $ = function (id) { return document.getElementById(id); };
    var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
    var nf = function (v, d) { return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d === undefined ? 2 : d }); };
    var norm = function (s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); };
    var status = function (t) { var e = $('statusMapa'); if (e) e.textContent = t; };

    function popup(titulo, p, campos) {
      var rows = campos.map(function (c) {
        var v = p[c[1]];
        if (v === null || v === undefined || v === '') return '';
        return '<tr><th scope="row">' + esc(c[0]) + '</th><td>' + esc(typeof v === 'number' && c[2] !== undefined ? nf(v) + c[2] : v) + '</td></tr>';
      }).join('');
      return '<strong>' + esc(titulo) + '</strong><table class="popup-attr">' + rows + '</table>';
    }

    var map = L.map('map', { preferCanvas: true }).setView([-7.2, -36.8], 8);
    var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: true, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
    var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, crossOrigin: true, attribution: 'Imagens &copy; Esri' });
    L.control.layers({ 'OpenStreetMap': osm, 'Imagem de satélite (Esri)': sat }, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    window.mapaGeoPortal = map;

    /* ---------- Camadas vetoriais ---------- */
    var camadas = {}, importadas = [];
    var PAL = ['#d8b45a', '#9db87a', '#c98a6b', '#8fb3c4', '#b9a3c9', '#c4c18f'];

    function criarBacias() {
      return L.geoJSON(bacias_hidro, {
        style: function (f) { return { color: '#6b5a2e', weight: 1.5, dashArray: '5 3', fillColor: PAL[(f.properties.Cod || 0) % PAL.length], fillOpacity: 0.3 }; },
        onEachFeature: function (f, l) {
          var p = f.properties;
          l.bindTooltip(esc(p.Nome || 'Bacia'), { sticky: true });
          l.bindPopup(function () { return popup('Bacia ' + (p.Nome || ''), p, [['Código', 'Cod'], ['Comitê', 'Comite'], ['Área', 'Area_Km2', ' km²'], ['Perímetro', 'Perimetro', ' km'], ['Volume', 'Volume(%)', ' %']]); });
        }
      });
    }
    function criarAcudes() {
      return L.geoJSON(acudes, {
        style: { color: COR.acudesBorda, weight: 2, fillColor: COR.acudes, fillOpacity: 0.95 },
        onEachFeature: function (f, l) {
          var p = f.properties, nome = p.Nome || 'Açude ' + p.OBJECTID;
          l.bindTooltip(esc(nome), { sticky: true });
          l.bindPopup(function () {
            var d = Object.assign({}, p, { cap: (p.Capacidade || 0) / 1e6 || null, morto: (p.Vol_Morto || 0) / 1e6 || null, esp: (p.A_Espelho || 0) / 1e4 || null });
            return popup(nome, d, [['Município', 'Municipio'], ['Microrregião', 'Microrreg'], ['Mesorregião', 'Mesorreg'], ['Proprietário', 'Propriet'], ['Órgão responsável', 'Org_Resp'], ['Finalidade', 'Finalidade'], ['Capacidade', 'cap', ' hm³'], ['Volume morto', 'morto', ' hm³'], ['Área do espelho', 'esp', ' ha'], ['Altura da barragem', 'Alt_Barrag', ' m'], ['Comprimento', 'Comp_', ' m'], ['Curso barrado', 'Curso_Bar'], ['Início da construção', 'Inic_Const'], ['Conclusão', 'Conclusao']]);
          });
        }
      });
    }
    function criarDrenagem() {
      return L.geoJSON(drenagem_principal, {
        style: function (f) {
          var n = parseInt(String(f.properties.Ordem || '').replace(/\D/g, ''), 10) || 3;
          return { color: COR.drenagem, weight: Math.max(0.8, (n - 2) * 0.7 + 0.6), opacity: 0.9 };
        },
        onEachFeature: function (f, l) {
          var p = f.properties;
          l.bindPopup(function () { return popup(p.Nome || 'Trecho de drenagem', p, [['Ordem', 'Ordem'], ['Zona', 'Zona'], ['Domínio', 'Dominio'], ['Código Otto', 'CodigoOtto']]); });
        }
      });
    }

    /* Postos pluviométricos e adutoras */
    var SIT = { 'Sistema Existente': { c: COR.adutExist, d: null }, 'Sistema em Obras': { c: COR.adutObras, d: '8 5' }, 'Sistema Planejado': { c: COR.adutPlan, d: '2 6' } };
    function kmGeom(g) {
      var km = 0;
      (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach(function (ln) { for (var i = 1; i < ln.length; i++) km += L.latLng(ln[i - 1][1], ln[i - 1][0]).distanceTo(L.latLng(ln[i][1], ln[i][0])) / 1000; });
      return km;
    }
    function distLinha(ll, g) {                         /* menor distância (m) do ponto à linha */
      var kx = 111320 * Math.cos(ll.lat * Math.PI / 180), ky = 110540, best = Infinity;
      (g.type === 'LineString' ? [g.coordinates] : g.coordinates).forEach(function (ln) {
        for (var i = 1; i < ln.length; i++) {
          var ax = (ln[i - 1][0] - ll.lng) * kx, ay = (ln[i - 1][1] - ll.lat) * ky, bx = (ln[i][0] - ll.lng) * kx, by = (ln[i][1] - ll.lat) * ky, dx = bx - ax, dy = by - ay;
          var t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0, px = ax + t * dx, py = ay + t * dy;
          best = Math.min(best, Math.sqrt(px * px + py * py));
        }
      });
      return best;
    }
    function criarPostos() {
      return L.geoJSON(postos_pluviometricos, {
        pointToLayer: function (f, ll) { return L.circleMarker(ll, { radius: 5, color: '#fff', weight: 1.2, fillColor: COR.postos, fillOpacity: 0.95 }); },
        onEachFeature: function (f, l) {
          var p = f.properties;
          l.bindTooltip(esc(p.municipio), { direction: 'top' });
          l.bindPopup(function () { return popup('Posto pluviométrico', p, [['Município', 'municipio'], ['Região', 'regiao']]); });
        }
      });
    }
    function criarAdutoras() {
      return L.geoJSON(adutoras, {
        style: function (f) { var s = SIT[f.properties.situacao] || SIT['Sistema Existente']; return { color: s.c, weight: 3.5, opacity: 0.95, dashArray: s.d }; },
        onEachFeature: function (f, l) {
          var p = f.properties;
          l.bindTooltip(esc(p.adutora) + ' · ' + esc(p.situacao), { sticky: true });
          l.bindPopup(function () { return popup(p.adutora, Object.assign({}, p, { km: kmGeom(f.geometry) }), [['Situação', 'situacao'], ['Estado', 'estado'], ['Extensão do trecho', 'km', ' km']]); });
        }
      });
    }

    /* Alterna camada; a drenagem (7,7 MB) só é baixada na primeira ativação */
    function alternar(chave, ligar, fabrica, varNome, arquivo) {
      if (!ligar) { if (camadas[chave]) map.removeLayer(camadas[chave]); desenharLegenda(); return; }
      if (camadas[chave]) { camadas[chave].addTo(map); desenharLegenda(); return; }
      var montar = function () { camadas[chave] = fabrica().addTo(map); if (chave === 'bacias') camadas[chave].bringToBack(); status('Camada carregada'); desenharLegenda(); };
      if (window[varNome]) return montar();
      status('Carregando ' + chave + '…');
      var s = document.createElement('script'); s.src = arquivo;
      s.onload = montar;
      s.onerror = function () { status('Falha ao carregar ' + arquivo); var c = $('toggle' + chave[0].toUpperCase() + chave.slice(1)); if (c) c.checked = false; };
      document.head.appendChild(s);
    }
    var ligacoes = { Bacias: ['bacias', criarBacias, 'bacias_hidro', 'data/bacias_hidro.js'], Acudes: ['acudes', criarAcudes, 'acudes', 'data/acudes.js'], Drenagem: ['drenagem', criarDrenagem, 'drenagem_principal', 'data/drenagem_principal.js'], Postos: ['postos', criarPostos, 'postos_pluviometricos', 'data/postos_pluviometricos.js'], Adutoras: ['adutoras', criarAdutoras, 'adutoras', 'data/adutoras.js'] };
    Object.keys(ligacoes).forEach(function (k) {
      var el = $('toggle' + k), a = ligacoes[k];
      if (!el) return;
      el.addEventListener('change', function () { alternar(a[0], el.checked, a[1], a[2], a[3]); });
      if (el.checked) alternar(a[0], true, a[1], a[2], a[3]);
    });

    /* ---------- Poços ---------- */
    var linhas = [], visiveis = [], marcadores = {}, cluster = L.markerClusterGroup({ chunkedLoading: true, showCoverageOnHover: false, maxClusterRadius: 55 });
    var opac = 0.9, pagina = 1, POR_PAG = 15;

    if (typeof pocos === 'undefined' || !pocos.features) { status('Dados dos poços não carregados'); return; }
    pocos.features.forEach(function (f) {
      var c = f.geometry && f.geometry.coordinates;
      if (!c || !isFinite(c[0]) || !isFinite(c[1])) return;
      var p = f.properties || {};
      linhas.push({ id: p.fid, p: p, lat: c[1], lng: c[0], busca: norm([p.municipio, p.orgao, p.proprietario, p.equipamento, p.microregiao].join(' ')) });
    });

    function marcador(r) {
      var m = L.circleMarker([r.lat, r.lng], { radius: 6, color: '#fff', weight: 1.5, fillColor: COR.pocos, fillOpacity: opac });
      m.bindTooltip('Poço ' + r.id, { direction: 'top' });
      m.bindPopup(function () { return popup('Poço ' + r.id, r.p, [['Proprietário', 'proprietario'], ['Órgão responsável', 'orgao'], ['Data de perfuração', 'data_perfuracao'], ['Município', 'municipio'], ['Microrregião', 'microregiao'], ['Mesorregião', 'mesoregiao'], ['Profundidade', 'profundidade', ' m'], ['Vazão', 'q_m3h', ' m³/h'], ['Equipamento', 'equipamento']]); });
      return m;
    }
    linhas.forEach(function (r) { marcadores[r.id] = marcador(r); });

    function preencher(sel, campo) {
      var vals = Array.from(new Set(linhas.map(function (r) { return r.p[campo]; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, 'pt-BR'); });
      vals.forEach(function (v) { var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
      return vals.length;
    }
    var nMun = agruparMunicipios(), nOrg = preencher($('filtroOrgao'), 'orgao');
    var vaz = linhas.map(function (r) { return r.p.q_m3h; }).filter(function (v) { return typeof v === 'number' && v > 0; });
    $('statTotal').textContent = nf(linhas.length, 0);
    $('statMunicipios').textContent = nf(nMun, 0);
    $('statOrgaos').textContent = nf(nOrg, 0);
    $('statVazao').textContent = vaz.length ? nf(vaz.reduce(function (a, b) { return a + b; }, 0) / vaz.length, 1) : '—';

    function filtrar() {
      var q = norm($('buscaMapa').value.trim()), o = $('filtroOrgao').value, m = $('filtroMunicipio').value;
      lerFaixas();
      visiveis = linhas.filter(function (r) { return (!q || r.busca.indexOf(q) > -1) && (!o || r.p.orgao === o) && (!m || r.p.municipio === m) && faixaOk(r); });
      cluster.clearLayers();
      cluster.addLayers(visiveis.map(function (r) { return marcadores[r.id]; }));
      $('totalFiltrado').textContent = nf(visiveis.length, 0);
      pagina = 1; tabela();
      status(nf(visiveis.length, 0) + ' poços exibidos');
      desenharLegenda();
    }

    function tabela() {
      var tot = visiveis.length, pags = Math.max(1, Math.ceil(tot / POR_PAG));
      pagina = Math.min(pagina, pags);
      var ini = (pagina - 1) * POR_PAG, fatia = ordenados().slice(ini, ini + POR_PAG);
      $('corpoTabela').innerHTML = fatia.length ? fatia.map(function (r) {
        var p = r.p;
        return '<tr><th scope="row">' + esc(r.id) + '</th><td>' + esc(p.municipio || '—') + '</td><td>' + esc(p.proprietario || '—') + '</td><td>' + esc(p.orgao || '—') + '</td><td>' + (p.profundidade != null ? nf(p.profundidade) + ' m' : '—') + '</td><td>' + (p.q_m3h != null ? nf(p.q_m3h) : '—') + '</td><td>' + esc(p.equipamento || '—') + '</td><td><button class="btn btn-sm btn-outline-primary" data-loc="' + esc(r.id) + '"><i class="bi bi-crosshair me-1"></i>Localizar</button></td></tr>';
      }).join('') : '<tr><td colspan="8" class="text-center py-5 text-secondary">Nenhum registro encontrado.</td></tr>';
      $('contagemTabela').textContent = nf(tot, 0) + ' registros';
      $('infoPagina').textContent = tot ? 'Mostrando ' + (ini + 1) + '–' + (ini + fatia.length) + ' de ' + nf(tot, 0) : 'Sem registros';
      var ini2 = Math.max(1, Math.min(pagina - 2, pags - 4)), fim = Math.min(pags, ini2 + 4), h = '';
      var item = function (n, rot, dis, act) { return '<li class="page-item' + (dis ? ' disabled' : '') + (act ? ' active' : '') + '"><button class="page-link" data-pg="' + n + '">' + rot + '</button></li>'; };
      h += item(pagina - 1, '&laquo;', pagina === 1);
      for (var i = ini2; i <= fim; i++) h += item(i, i, false, i === pagina);
      h += item(pagina + 1, '&raquo;', pagina === pags);
      $('paginacao').innerHTML = h;
      rodapeTabela();
    }
    $('paginacao').addEventListener('click', function (e) { var b = e.target.closest('[data-pg]'); if (b) { pagina = +b.dataset.pg; tabela(); } });
    $('corpoTabela').addEventListener('click', function (e) {
      var b = e.target.closest('[data-loc]'); if (!b) return;
      var m = marcadores[b.dataset.loc]; if (!m) return;
      $('map').scrollIntoView({ behavior: 'smooth', block: 'center' });
      cluster.zoomToShowLayer(m, function () { m.openPopup(); });
    });

    /* Filtros */
    var tmr; $('buscaMapa').addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(filtrar, 250); });
    $('filtroOrgao').addEventListener('change', filtrar);
    $('filtroMunicipio').addEventListener('change', filtrar);
    $('btnAplicar').addEventListener('click', filtrar);
    $('btnLimpar').addEventListener('click', function () { $('buscaMapa').value = ''; $('filtroOrgao').value = ''; $('filtroMunicipio').value = ''; filtrar(); });
    $('opacidade').addEventListener('input', function (e) {
      opac = e.target.value / 100; $('valorOpacidade').textContent = e.target.value + '%';
      visiveis.forEach(function (r) { marcadores[r.id].setStyle({ fillOpacity: opac }); });
    });
    $('togglePocos').addEventListener('change', function (e) { e.target.checked ? cluster.addTo(map) : map.removeLayer(cluster); desenharLegenda(); });
    cluster.addTo(map);

    /* ---------- CSV (separador ; e BOM para Excel pt-BR) ---------- */
    function csv() {
      var cab = ['fid', 'municipio', 'microregiao', 'mesoregiao', 'proprietario', 'orgao', 'data_perfuracao', 'profundidade', 'q_m3h', 'equipamento', 'latitude', 'longitude'];
      var cel = function (v) { v = v == null ? '' : String(v); return '"' + v.replace(/"/g, '""') + '"'; };
      var corpo = visiveis.map(function (r) { return [r.id, r.p.municipio, r.p.microregiao, r.p.mesoregiao, r.p.proprietario, r.p.orgao, r.p.data_perfuracao, r.p.profundidade, r.p.q_m3h, r.p.equipamento, r.lat, r.lng].map(cel).join(';'); });
      var url = URL.createObjectURL(new Blob(['\ufeff' + cab.join(';') + '\n' + corpo.join('\n')], { type: 'text/csv;charset=utf-8' }));
      var a = document.createElement('a'); a.href = url; a.download = 'pocos_pb_filtrados.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    }
    $('btnBaixarCsv').addEventListener('click', csv); $('btnTabelaCsv').addEventListener('click', csv);

    /* ---------- Importar GeoJSON ---------- */
    var msg = function (t, ok) { var e = $('mensagemGeo'); e.textContent = t; e.className = 'small mt-3 ' + (ok ? 'text-success' : 'text-danger'); };
    $('arquivoGeo').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var r = new FileReader(); r.onload = function () { $('textoGeo').value = r.result; if (!$('nomeCamada').value) $('nomeCamada').value = f.name.replace(/\.(geo)?json$/i, ''); }; r.readAsText(f);
    });
    $('btnImportarGeo').addEventListener('click', function () {
      try {
        var g = JSON.parse($('textoGeo').value);
        var lyr = L.geoJSON(g, {
          onEachFeature: function (f, l) {
            var p = f.properties || {}, k = Object.keys(p);
            if (k.length) l.bindPopup(popup($('nomeCamada').value || 'Feição', p, k.map(function (x) { return [x, x]; })));
          }
        });
        var b = lyr.getBounds(); if (!b.isValid()) throw new Error('Nenhuma geometria válida encontrada.');
        var lat = Math.abs(b.getSouth()) <= 90 && Math.abs(b.getNorth()) <= 90 && Math.abs(b.getWest()) <= 180;
        if (!lat) throw new Error('Coordenadas fora do intervalo geográfico. Reprojete para WGS 84 (lon/lat).');
        lyr.addTo(map); map.fitBounds(b);
        importadas.push({ nome: $('nomeCamada').value.trim() || 'Camada importada', lyr: lyr }); desenharLegenda();
        var nome = $('nomeCamada').value.trim() || 'Camada importada';
        var div = document.createElement('div'); div.className = 'form-check mt-2';
        var id = 'imp' + Date.now();
        div.innerHTML = '<input class="form-check-input" type="checkbox" id="' + id + '" checked><label class="form-check-label" for="' + id + '">' + esc(nome) + '</label>';
        div.firstChild.addEventListener('change', function (e) { e.target.checked ? lyr.addTo(map) : map.removeLayer(lyr); desenharLegenda(); });
        $('listaImportadas').appendChild(div);
        msg('Camada adicionada.', true);
        bootstrap.Modal.getInstance($('modalGeoJSON')).hide();
        $('textoGeo').value = ''; $('arquivoGeo').value = ''; $('nomeCamada').value = '';
      } catch (err) { msg('Não foi possível importar: ' + err.message, false); }
    });


    /* ---------- Avançado: consulta por clique e medição ---------- */
    function caixa(f) {
      if (f._bx) return f._bx;
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      (function rec(a) { if (typeof a[0] === 'number') { b = [Math.min(b[0], a[0]), Math.min(b[1], a[1]), Math.max(b[2], a[0]), Math.max(b[3], a[1])]; } else a.forEach(rec); })(f.geometry.coordinates);
      return (f._bx = b);
    }
    function anel(x, y, r) { var d = false; for (var i = 0, k = r.length - 1; i < r.length; k = i++) { if (((r[i][1] > y) !== (r[k][1] > y)) && (x < (r[k][0] - r[i][0]) * (y - r[i][1]) / (r[k][1] - r[i][1]) + r[i][0])) d = !d; } return d; }
    function achar(x, y, fc) {                          /* feição de polígono que contém o ponto */
      for (var i = 0; i < fc.features.length; i++) {
        var f = fc.features[i], b = caixa(f); if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
        var g = f.geometry, ps = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
        if (ps.some(function (p) { return anel(x, y, p[0]) && !p.slice(1).some(function (h) { return anel(x, y, h); }); })) return f;
      }
      return null;
    }
    var temBac = typeof bacias_hidro !== 'undefined';

    /* ferramentas de clique: consultar ponto e medir */
    var ferr = '', medPts = [], medGrp = L.layerGroup().addTo(map), raioKm = 5;
    function setFerr(f) {
      ferr = ferr === f ? '' : f;
      $('btnIdentificar').setAttribute('aria-pressed', ferr === 'id'); $('btnMedir').setAttribute('aria-pressed', ferr === 'med');
      map.getContainer().style.cursor = ferr ? 'crosshair' : '';
      if (ferr !== 'med') limparMed();
    }
    $('btnIdentificar').addEventListener('click', function () { setFerr('id'); });
    $('btnMedir').addEventListener('click', function () { setFerr('med'); });
    $('btnLimparMedida').addEventListener('click', function () { limparMed(); });
    function limparMed() { medGrp.clearLayers(); medPts = []; $('medInfo').textContent = ''; }
    function medir(ll) {
      medPts.push(ll); medGrp.clearLayers();
      L.polyline(medPts, { color: '#d9480f', weight: 3, dashArray: '6 4' }).addTo(medGrp);
      medPts.forEach(function (p) { L.circleMarker(p, { radius: 4, color: '#d9480f', fillColor: '#fff', fillOpacity: 1 }).addTo(medGrp); });
      var d = 0, i; for (i = 1; i < medPts.length; i++) d += medPts[i - 1].distanceTo(medPts[i]);
      var t = 'Distância: ' + nf(d / 1000, 2) + ' km';
      if (medPts.length > 2) { var s = 0, R = 6378137; for (i = 0; i < medPts.length; i++) { var a = medPts[i], b = medPts[(i + 1) % medPts.length]; s += (b.lng - a.lng) * Math.PI / 180 * (2 + Math.sin(a.lat * Math.PI / 180) + Math.sin(b.lat * Math.PI / 180)); } t += ' · Área: ' + nf(Math.abs(s) * R * R / 2 / 1e6, 2) + ' km²'; }
      $('medInfo').textContent = t;
    }
    function identificar(ll) {
      var x = ll.lng, y = ll.lat, d = { coord: nf(y, 5) + ', ' + nf(x, 5) };
      var b = temBac ? achar(x, y, bacias_hidro) : null;
      d.bac = b ? b.properties.Nome + (b.properties.Comite ? ' (comitê ' + b.properties.Comite + ')' : '') : 'nenhuma';
      var ac = typeof acudes !== 'undefined' ? achar(x, y, acudes) : null; if (ac) d.dentro = ac.properties.Nome || 'Açude';
      var near = null, dm = Infinity;
      if (typeof acudes !== 'undefined') acudes.features.forEach(function (f) { var bx = caixa(f), dd = ll.distanceTo(L.latLng((bx[1] + bx[3]) / 2, (bx[0] + bx[2]) / 2)); if (dd < dm) { dm = dd; near = f; } });
      if (near) d.acu = (near.properties.Nome || 'Açude') + ' · ' + nf(dm / 1000, 1) + ' km';
      var pc = linhas.filter(function (r) { return ll.distanceTo(L.latLng(r.lat, r.lng)) <= raioKm * 1000; });
      d.poc = pc.length;
      var vz = pc.map(function (r) { return r.p.q_m3h; }).filter(function (v) { return typeof v === 'number' && v > 0; });
      if (vz.length) d.vaz = vz.reduce(function (s, v) { return s + v; }, 0) / vz.length;
      if (typeof postos_pluviometricos !== 'undefined') {
        var np = null, dp = Infinity;
        postos_pluviometricos.features.forEach(function (f) { var c = f.geometry.coordinates, dd = ll.distanceTo(L.latLng(c[1], c[0])); if (dd < dp) { dp = dd; np = f; } });
        if (np) d.pos = np.properties.municipio + ' (' + np.properties.regiao + ') · ' + nf(dp / 1000, 1) + ' km';
      }
      if (typeof adutoras !== 'undefined') {
        var na = null, da = Infinity;
        adutoras.features.forEach(function (f) { var dd = distLinha(ll, f.geometry); if (dd < da) { da = dd; na = f; } });
        if (na) d.adu = na.properties.adutora + ' (' + na.properties.situacao.replace('Sistema ', '').toLowerCase() + ') · ' + nf(da / 1000, 1) + ' km';
      }
      var raio = L.circle(ll, { radius: raioKm * 1000, color: '#0b8fb0', weight: 1.5, fillOpacity: 0.08, interactive: false }).addTo(map);
      L.popup({ maxWidth: 320 }).setLatLng(ll).setContent(popup('Consulta no ponto', d, [['Coordenadas', 'coord'], ['Bacia hidrográfica', 'bac'], ['Dentro do açude', 'dentro'], ['Açude mais próximo', 'acu'], ['Poços em ' + raioKm + ' km', 'poc'], ['Vazão média desses poços', 'vaz', ' m³/h'], ['Posto pluviométrico mais próximo', 'pos'], ['Adutora mais próxima', 'adu']])).on('remove', function () { map.removeLayer(raio); }).openOn(map);
    }
    map.on('click', function (e) { if (ferr === 'id') identificar(e.latlng); else if (ferr === 'med') medir(e.latlng); });

    /* ---------- Acessibilidade e documentação: filtros, tabela ordenável, legenda, metadados e escala ---------- */
    var fx = { pmin: null, pmax: null, vmin: null, vmax: null }, ordem = { k: '', dir: 1 };
    var porNome = function (a, b) { return a.localeCompare(b, 'pt-BR'); };
    function lerNum(id) { var v = $(id).value; return v === '' || isNaN(+v) ? null : +v; }
    function lerFaixas() {
      fx = { pmin: lerNum('fProfMin'), pmax: lerNum('fProfMax'), vmin: lerNum('fVazMin'), vmax: lerNum('fVazMax') };
      var ip = fx.pmin != null && fx.pmax != null && fx.pmin > fx.pmax, iv = fx.vmin != null && fx.vmax != null && fx.vmin > fx.vmax;
      if (ip) { fx.pmin = fx.pmax = null; } if (iv) { fx.vmin = fx.vmax = null; }
      $('msgFaixa').textContent = ip || iv ? 'O valor mínimo não pode ser maior que o máximo; essa faixa foi ignorada.' : '';
    }
    function faixaOk(r) {
      var d = r.p.profundidade, v = r.p.q_m3h;
      if ((fx.pmin != null || fx.pmax != null) && (typeof d !== 'number' || (fx.pmin != null && d < fx.pmin) || (fx.pmax != null && d > fx.pmax))) return false;
      if ((fx.vmin != null || fx.vmax != null) && (typeof v !== 'number' || (fx.vmin != null && v < fx.vmin) || (fx.vmax != null && v > fx.vmax))) return false;
      return true;
    }
    function agruparMunicipios() {                      /* <optgroup> por mesorregião */
      var g = {}, vistos = {}, sel = $('filtroMunicipio');
      linhas.forEach(function (r) { var m = r.p.municipio; if (!m) return; var me = r.p.mesoregiao || 'Sem mesorregião'; (g[me] = g[me] || {})[m] = 1; vistos[m] = 1; });
      Object.keys(g).sort(porNome).forEach(function (me) {
        var og = document.createElement('optgroup'); og.label = me;
        Object.keys(g[me]).sort(porNome).forEach(function (m) { var o = document.createElement('option'); o.value = m; o.textContent = m; og.appendChild(o); });
        sel.appendChild(og);
      });
      return Object.keys(vistos).length;
    }
    function ordenados() {
      if (!ordem.k) return visiveis;
      var k = ordem.k, d = ordem.dir;
      return visiveis.slice().sort(function (a, b) {
        var x = k === 'id' ? a.id : a.p[k], y = k === 'id' ? b.id : b.p[k], nx = x == null || x === '', ny = y == null || y === '';
        if (nx || ny) return nx && ny ? 0 : nx ? 1 : -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR', { numeric: true })) * d;
      });
    }
    function rodapeTabela() {
      var ps = [], vs = [], soma = function (a) { return a.reduce(function (s, v) { return s + v; }, 0); };
      visiveis.forEach(function (r) { if (typeof r.p.profundidade === 'number') ps.push(r.p.profundidade); if (typeof r.p.q_m3h === 'number') vs.push(r.p.q_m3h); });
      $('tfProf').textContent = ps.length ? 'média ' + nf(soma(ps) / ps.length, 1) + ' m' : '—';
      $('tfVaz').textContent = vs.length ? 'soma ' + nf(soma(vs), 1) + ' · média ' + nf(soma(vs) / vs.length, 2) : '—';
      $('tfTotal').textContent = nf(visiveis.length, 0) + ' registros';
    }
    Array.prototype.forEach.call(document.querySelectorAll('.th-sort'), function (b) {
      b.addEventListener('click', function () {
        ordem = { k: b.dataset.k, dir: ordem.k === b.dataset.k ? -ordem.dir : 1 };
        Array.prototype.forEach.call(document.querySelectorAll('.th-sort'), function (x) { x.parentNode.setAttribute('aria-sort', x === b ? (ordem.dir === 1 ? 'ascending' : 'descending') : 'none'); });
        pagina = 1; tabela();
      });
    });
    $('formFiltros').addEventListener('submit', function (e) { e.preventDefault(); filtrar(); });
    $('formFiltros').addEventListener('reset', function () { setTimeout(function () { $('opacidade').dispatchEvent(new Event('input')); filtrar(); }, 0); });
    ['fProfMin', 'fProfMax', 'fVazMin', 'fVazMax'].forEach(function (id) { $(id).addEventListener('input', function () { clearTimeout(tmr); tmr = setTimeout(filtrar, 300); }); });

    function desenharLegenda() {                        /* legenda na tela: só as camadas ligadas */
      var it = itensLegenda(), h = '', aberto = false;
      if (!it.length) { $('listaLegenda').innerHTML = '<li class="text-secondary">Ligue uma camada para ver a legenda.</li>'; return; }
      it.forEach(function (i) {
        if (i.t === 'titulo') { if (aberto) h += '</ul></li>'; h += '<li class="lg-grupo"><span class="lg-titulo">' + esc(i.rot) + '</span><ul class="lg-sub">'; aberto = true; return; }
        h += '<li class="lg-item"><span class="lg-sw lg-' + i.t + '" style="--c:' + i.cor + ';--b:' + (i.borda || i.cor) + ';--a:' + (i.a == null ? 1 : i.a) + '" aria-hidden="true"></span>' + esc(i.rot) + '</li>';
      });
      if (aberto) h += '</ul></li>';
      $('listaLegenda').innerHTML = h;
    }
    function desenharMetadados() {                      /* ficha técnica gerada dos próprios dados */
      var AESA = '<abbr title="Agência Executiva de Gestão das Águas do Estado da Paraíba">AESA</abbr>';
      var SRC = '<abbr title="Sistema de Referência Geocêntrico para as Américas">SIRGAS</abbr> 2000 / <abbr title="World Geodetic System 1984">WGS 84</abbr> (graus)';
      var defs = [
        { t: 'Poços', g: 'Pontos', d: typeof pocos !== 'undefined' ? pocos : null, n: linhas.length, f: AESA },
        { t: 'Açudes', g: 'Polígonos', d: typeof acudes !== 'undefined' ? acudes : null, f: AESA },
        { t: 'Bacias hidrográficas', g: 'Polígonos', d: typeof bacias_hidro !== 'undefined' ? bacias_hidro : null, f: AESA },
        { t: 'Drenagem principal', g: 'Linhas', d: window.drenagem_principal || null, n: 2265, campos: ['Nome', 'Ordem', 'Zona', 'Dominio', 'CodigoOtto'], f: AESA, nota: 'Carregada ao ligar a camada (cerca de 7,7 MB).' },
        { t: 'Postos pluviométricos', g: 'Pontos', d: typeof postos_pluviometricos !== 'undefined' ? postos_pluviometricos : null },
        { t: 'Adutoras', g: 'Linhas', d: typeof adutoras !== 'undefined' ? adutoras : null }
      ];
      $('listaMeta').innerHTML = defs.map(function (x) {
        var n = x.n || (x.d ? x.d.features.length : null), campos = x.campos || (x.d && x.d.features.length ? Object.keys(x.d.features[0].properties) : []);
        return '<div class="col-md-6 col-xl-4"><article class="chart-card meta-card"><h3>' + esc(x.t) + '</h3><dl class="ficha">' +
          '<dt>Geometria</dt><dd>' + x.g + '</dd><dt>Feições</dt><dd>' + (n != null ? nf(n, 0) : '—') + '</dd>' +
          '<dt>Atributos</dt><dd>' + (campos.length ? campos.slice(0, 14).map(function (c) { return '<code>' + esc(c) + '</code>'; }).join(' ') : '—') + '</dd>' +
          '<dt>Referência espacial</dt><dd>' + SRC + '</dd><dt>Fonte</dt><dd>' + (x.f || 'Não informada nos dados') + '</dd></dl>' + (x.nota ? '<p class="small text-secondary mb-0">' + x.nota + '</p>' : '') + '</article></div>';
      }).join('');
    }
    function atualizarEscala() {                        /* escala aproximada (96 dpi) para o zoom atual */
      var c = map.getCenter(), mpp = 156543.03392 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
      var txt = '1:' + (Math.round(mpp * 3779.5275 / 1000) * 1000).toLocaleString('pt-BR');
      Array.prototype.forEach.call(document.querySelectorAll('.escala-atual'), function (e) { e.textContent = txt; });
    }
    map.on('zoomend moveend', atualizarEscala);
    desenharMetadados(); atualizarEscala();

    /* ---------- Baixar camadas do geoportal (GeoJSON ou ZIP) ---------- */
    function carregarVar(nome, arq) {
      return new Promise(function (ok, no) {
        if (window[nome]) return ok(window[nome]);
        var s = document.createElement('script'); s.src = arq;
        s.onload = function () { window[nome] ? ok(window[nome]) : no(new Error('o arquivo ' + arq + ' não define ' + nome)); };
        s.onerror = function () { no(new Error('não foi possível carregar ' + arq)); };
        document.head.appendChild(s);
      });
    }
    function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'camada'; }
    function defsDownload() {
      var d = [
        { rot: 'Poços', arq: 'pocos_pb', info: nf(linhas.length, 0) + ' pontos', obter: function () {
          var so = $('dlFiltrados').checked;
          return Promise.resolve({ type: 'FeatureCollection', features: (so ? visiveis : linhas).map(function (r) { return { type: 'Feature', properties: r.p, geometry: { type: 'Point', coordinates: [r.lng, r.lat] } }; }) }); } },
        { rot: 'Açudes', arq: 'acudes', info: 'polígonos', obter: function () { return carregarVar('acudes', 'data/acudes.js'); } },
        { rot: 'Bacias hidrográficas', arq: 'bacias_hidro', info: 'polígonos', obter: function () { return carregarVar('bacias_hidro', 'data/bacias_hidro.js'); } },
        { rot: 'Drenagem principal', arq: 'drenagem_principal', info: 'linhas · cerca de 7,7 MB', obter: function () { return carregarVar('drenagem_principal', 'data/drenagem_principal.js'); } }
      ];
      d.push({ rot: 'Postos pluviométricos', arq: 'postos_pluviometricos', info: '269 pontos', obter: function () { return carregarVar('postos_pluviometricos', 'data/postos_pluviometricos.js'); } });
      d.push({ rot: 'Adutoras', arq: 'adutoras', info: 'linhas', obter: function () { return carregarVar('adutoras', 'data/adutoras.js'); } });
      importadas.forEach(function (x) { d.push({ rot: x.nome, arq: slug(x.nome), info: 'importada nesta sessão', obter: function () { return Promise.resolve(x.lyr.toGeoJSON()); } }); });
      return d;
    }
    var defs = [];
    $('modalCamadas').addEventListener('show.bs.modal', function () {
      defs = defsDownload();
      $('listaDownloads').innerHTML = defs.map(function (d, i) {
        return '<div class="form-check mb-2"><input class="form-check-input" type="checkbox" id="dl' + i + '" checked><label class="form-check-label" for="dl' + i + '">' + esc(d.rot) + ' <span class="text-secondary small">· ' + esc(d.info) + '</span></label></div>';
      }).join('');
      $('msgCamadas').textContent = '';
    });
    function salvar(blob, nome) {
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    }
    $('btnBaixarCamadas').addEventListener('click', function () {
      var aviso = $('msgCamadas'), btn = $('btnBaixarCamadas');
      var sel = defs.filter(function (d, i) { return $('dl' + i).checked; });
      var erro = function (t) { aviso.textContent = t; aviso.className = 'small mt-3 text-danger'; };
      if (!sel.length) return erro('Selecione ao menos uma camada.');
      btn.disabled = true; aviso.textContent = 'Preparando arquivos…'; aviso.className = 'small mt-3 text-secondary';
      Promise.all(sel.map(function (d) { return d.obter().then(function (g) { return { nome: d.arq + '.geojson', txt: JSON.stringify(g) }; }); }))
        .then(function (arqs) {
          if (arqs.length === 1) return salvar(new Blob([arqs[0].txt], { type: 'application/geo+json' }), arqs[0].nome);
          if (typeof JSZip === 'undefined') throw new Error('biblioteca JSZip não carregada; baixe uma camada por vez.');
          var z = new JSZip();
          arqs.forEach(function (a) { z.file(a.nome, a.txt); });
          z.file('LEIAME.txt', 'GeoPortal PB — camadas em GeoJSON\r\nSistema de coordenadas: WGS 84 (EPSG:4326), longitude/latitude.\r\nGerado em ' + new Date().toLocaleString('pt-BR') + '.\r\nPara usar no QGIS: Camada > Adicionar Camada > Vetorial.\r\n');
          return z.generateAsync({ type: 'blob', compression: 'DEFLATE' }).then(function (b) { salvar(b, 'camadas_geoportal.zip'); });
        })
        .then(function () { aviso.textContent = 'Download iniciado.'; aviso.className = 'small mt-3 text-success'; })
        .catch(function (e) { erro('Falha ao gerar o arquivo: ' + e.message); })
        .then(function () { btn.disabled = false; });
    });

    /* ---------- Baixar mapa: folha com título, mapa, legenda, escala e norte ---------- */
    function itensLegenda() {
      var it = [];
      if (map.hasLayer(cluster)) it.push({ t: 'ponto', cor: COR.pocos, rot: 'Poços (' + nf(visiveis.length, 0) + ')' });
      if (camadas.acudes && map.hasLayer(camadas.acudes)) it.push({ t: 'area', cor: COR.acudes, borda: COR.acudesBorda, rot: 'Açudes', a: 1 });
      if (camadas.drenagem && map.hasLayer(camadas.drenagem)) it.push({ t: 'linha', cor: COR.drenagem, rot: 'Drenagem principal' });
      if (camadas.postos && map.hasLayer(camadas.postos)) it.push({ t: 'ponto', cor: COR.postos, rot: 'Postos pluviométricos' });
      if (camadas.adutoras && map.hasLayer(camadas.adutoras)) Object.keys(SIT).forEach(function (k) { it.push({ t: 'linha', cor: SIT[k].c, rot: 'Adutora · ' + k.replace('Sistema ', '').toLowerCase() }); });
      importadas.forEach(function (x) { if (map.hasLayer(x.lyr)) it.push({ t: 'area', cor: '#3388ff', borda: '#3388ff', rot: x.nome, a: 0.3 }); });
      if (camadas.bacias && map.hasLayer(camadas.bacias)) {
        it.push({ t: 'titulo', rot: 'Bacias hidrográficas' });
        var vistos = {}, lista = [];
        bacias_hidro.features.forEach(function (f) { var p = f.properties; if (!vistos[p.Nome]) { vistos[p.Nome] = 1; lista.push(p); } });
        lista.sort(function (a, b) { return String(a.Nome).localeCompare(b.Nome, 'pt-BR'); }).forEach(function (p) {
          it.push({ t: 'area', cor: PAL[(p.Cod || 0) % PAL.length], borda: '#6b5a2e', rot: p.Nome, a: 0.5, rec: true });
        });
      }
      return it;
    }

    function barraEscala() {
      var c = map.getCenter(), mpp = 156543.03392 * Math.cos(c.lat * Math.PI / 180) / Math.pow(2, map.getZoom());
      var alvo = mpp * 120, passos = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 200000], d = passos[0];
      passos.forEach(function (p) { if (p <= alvo) d = p; });
      return { px: d / mpp, rot: d >= 1000 ? (d / 1000) + ' km' : d + ' m' };
    }

    function compor(mc, o) {
      var s = o.s, m = 24 * s, hd = 84 * s, ft = 54 * s, lw = o.legenda ? 270 * s : 0, gap = o.legenda ? 16 * s : 0;
      var W = m * 2 + mc.width + gap + lw, H = hd + mc.height + ft + m;
      var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      var x = cv.getContext('2d'), mx = m, my = hd;
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      x.fillStyle = '#0f3d4a'; x.fillRect(0, 0, W, hd);
      x.fillStyle = '#fff'; x.textBaseline = 'alphabetic';
      x.font = '800 ' + 26 * s + 'px Manrope, "Segoe UI", sans-serif'; x.fillText(o.titulo, m, 40 * s);
      x.font = '500 ' + 14 * s + 'px "DM Sans", "Segoe UI", sans-serif'; x.globalAlpha = 0.85; x.fillText(o.subtitulo, m, 64 * s); x.globalAlpha = 1;
      x.drawImage(mc, mx, my);
      x.strokeStyle = '#0f3d4a'; x.lineWidth = 1.5 * s; x.strokeRect(mx, my, mc.width, mc.height);

      if (o.norte) {                                   /* seta de norte */
        var nx = mx + mc.width - 38 * s, ny = my + 12 * s;
        x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(nx - 4 * s, ny - 4 * s, 34 * s, 52 * s);
        x.fillStyle = '#0f3d4a'; x.beginPath(); x.moveTo(nx + 13 * s, ny); x.lineTo(nx + 24 * s, ny + 30 * s); x.lineTo(nx + 13 * s, ny + 24 * s); x.lineTo(nx + 2 * s, ny + 30 * s); x.closePath(); x.fill();
        x.font = '800 ' + 14 * s + 'px sans-serif'; x.textAlign = 'center'; x.fillText('N', nx + 13 * s, ny + 44 * s); x.textAlign = 'left';
      }
      if (o.escala) {                                  /* barra de escala */
        var e = barraEscala(), bw = e.px * s, bx = mx + 14 * s, by = my + mc.height - 16 * s;
        x.fillStyle = 'rgba(255,255,255,.9)'; x.fillRect(bx - 8 * s, by - 28 * s, bw + 16 * s, 40 * s);
        x.fillStyle = '#0f3d4a'; x.fillRect(bx, by - 4 * s, bw, 4 * s);
        x.fillRect(bx, by - 12 * s, 2 * s, 12 * s); x.fillRect(bx + bw - 2 * s, by - 12 * s, 2 * s, 12 * s);
        x.font = '600 ' + 12 * s + 'px sans-serif'; x.fillText('0', bx, by - 16 * s); x.textAlign = 'right'; x.fillText(e.rot, bx + bw, by - 16 * s); x.textAlign = 'left';
      }
      if (o.legenda) {                                 /* legenda */
        var lx = mx + mc.width + gap, it = itensLegenda(), pad = 14 * s;
        x.strokeStyle = '#d3dcda'; x.lineWidth = s; x.strokeRect(lx, my, lw, mc.height);
        x.fillStyle = '#0f3d4a'; x.font = '800 ' + 16 * s + 'px Manrope, sans-serif'; x.fillText('Legenda', lx + pad, my + 28 * s);
        var step = Math.min(24 * s, (mc.height - 56 * s) / Math.max(it.length, 1)), y = my + 56 * s;
        it.forEach(function (i) {
          var ix = lx + pad + (i.rec ? 10 * s : 0), cy = y - 5 * s;
          if (i.t === 'titulo') { x.fillStyle = '#15262b'; x.font = '700 ' + 13 * s + 'px "DM Sans", sans-serif'; x.fillText(i.rot, lx + pad, y); y += step; return; }
          if (i.t === 'ponto') { x.fillStyle = '#fff'; x.beginPath(); x.arc(ix + 9 * s, cy, 8 * s, 0, 7); x.fill(); x.fillStyle = i.cor; x.beginPath(); x.arc(ix + 9 * s, cy, 6 * s, 0, 7); x.fill(); }
          else if (i.t === 'linha') { x.strokeStyle = i.cor; x.lineWidth = 2.5 * s; x.beginPath(); x.moveTo(ix, cy); x.lineTo(ix + 18 * s, cy); x.stroke(); }
          else { x.globalAlpha = i.a; x.fillStyle = i.cor; x.fillRect(ix, cy - 6 * s, 18 * s, 12 * s); x.globalAlpha = 1; x.strokeStyle = i.borda; x.lineWidth = 1.2 * s; x.strokeRect(ix, cy - 6 * s, 18 * s, 12 * s); }
          x.fillStyle = '#15262b'; x.font = '500 ' + 13 * s + 'px "DM Sans", sans-serif';
          var r = String(i.rot); while (x.measureText(r).width > lw - (ix - lx) - 30 * s - pad && r.length > 4) r = r.slice(0, -2);
          x.fillText(r === String(i.rot) ? r : r + '…', ix + 26 * s, y); y += step;
        });
      }
      var base = map.hasLayer(sat) ? 'Imagens © Esri' : '© contribuidores do OpenStreetMap';
      x.fillStyle = '#52666b'; x.font = '500 ' + 12 * s + 'px "DM Sans", sans-serif';
      x.fillText('Fonte: AESA · Base cartográfica: ' + base, m, my + mc.height + 24 * s);
      x.fillText('Sistema de coordenadas: WGS 84 (EPSG:4326) · Gerado em ' + new Date().toLocaleDateString('pt-BR'), m, my + mc.height + 42 * s);
      return cv;
    }

    function gerarMapa(formato) {
      var aviso = $('msgExportar'), botoes = [$('btnExportarPng'), $('btnExportarPdf')];
      var erro = function (t) { aviso.textContent = t; aviso.className = 'small mt-3 text-danger'; };
      if (typeof html2canvas === 'undefined') return erro('Biblioteca html2canvas não carregada. Verifique a conexão.');
      var o = { s: Number($('expRes').value), titulo: $('expTitulo').value.trim() || 'Mapa da Paraíba', subtitulo: $('expSubtitulo').value.trim(), legenda: $('expLegenda').checked, escala: $('expEscala').checked, norte: $('expNorte').checked };
      botoes.forEach(function (b) { b.disabled = true; });
      aviso.textContent = 'Gerando layout…'; aviso.className = 'small mt-3 text-secondary';
      html2canvas($('map'), { useCORS: true, scale: o.s, logging: false, ignoreElements: function (el) { return el.classList && el.classList.contains('leaflet-control-container'); } })
        .then(function (mc) {
          var cv = compor(mc, o), nome = 'mapa_geoportal_pb';
          if (formato === 'pdf') {
            var J = window.jspdf && window.jspdf.jsPDF; if (!J) throw new Error('Biblioteca jsPDF não carregada.');
            var pdf = new J({ orientation: cv.width >= cv.height ? 'l' : 'p', unit: 'mm', format: 'a4' });
            var pw = pdf.internal.pageSize.getWidth() - 10, ph = pdf.internal.pageSize.getHeight() - 10, k = Math.min(pw / cv.width, ph / cv.height);
            pdf.addImage(cv.toDataURL('image/jpeg', 0.92), 'JPEG', 5 + (pw - cv.width * k) / 2, 5, cv.width * k, cv.height * k);
            pdf.save(nome + '.pdf');
          } else {
            cv.toBlob(function (b) {
              if (!b) return erro('Não foi possível gerar a imagem (restrição de CORS no mapa-base).');
              var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nome + '.png'; document.body.appendChild(a); a.click(); a.remove();
            }, 'image/png');
          }
          aviso.textContent = 'Arquivo gerado.'; aviso.className = 'small mt-3 text-success';
        })
        .catch(function (e) { erro('Falha ao gerar o mapa: ' + e.message); })
        .then(function () { botoes.forEach(function (b) { b.disabled = false; }); });
    }
    $('btnExportarPng').addEventListener('click', function () { gerarMapa('png'); });
    $('btnExportarPdf').addEventListener('click', function () { gerarMapa('pdf'); });

    filtrar();
    map.fitBounds([[-8.35, -38.8], [-6.0, -34.75]]);
  }

  /* ---------------- GALERIA ---------------- */
  function iniciarGaleria() {
    var grid = document.getElementById('galleryGrid');

    if (!grid) {
      return;
    }

    var itens = Array.prototype.slice.call(
      grid.querySelectorAll('.gallery-item')
    );

    var busca = document.getElementById('gallerySearch');
    var vazio = document.getElementById('emptyGallery');

    var botoes = Array.prototype.slice.call(
      document.querySelectorAll('.filter-btn')
    );

    var filtro = 'todos';

    var norm = function (s) {
      return String(s)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
    };

    function aplicar() {
      var q = norm(busca ? busca.value.trim() : '');
      var n = 0;

      itens.forEach(function (it) {
        var ok =
          (filtro === 'todos' ||
            it.dataset.category === filtro) &&
          (!q ||
            norm(it.dataset.title).indexOf(q) > -1);

        it.classList.toggle('d-none', !ok);

        if (ok) {
          n++;
        }
      });

      if (vazio) {
        vazio.classList.toggle('d-none', n > 0);
      }
    }

    botoes.forEach(function (b) {
      b.setAttribute(
        'aria-pressed',
        b.classList.contains('active') ? 'true' : 'false'
      );

      b.addEventListener('click', function () {
        filtro = b.dataset.filter;

        botoes.forEach(function (x) {
          var on = x === b;

          x.classList.toggle('active', on);

          x.setAttribute(
            'aria-pressed',
            on ? 'true' : 'false'
          );
        });

        aplicar();
      });
    });

    if (busca) {
      busca.addEventListener('input', aplicar);
    }
  }

  iniciarMapa();
  iniciarGaleria();
})();
