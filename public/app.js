(function () {
  var TITULOS = { geral: 'Visão geral', pedidos: 'Pedidos', receber: 'A receber', despesas: 'Despesas e sócios' };
  var FUSO = 'America/Sao_Paulo';
  var E = { vista: 'geral', periodo: (function () { try { return localStorage.getItem('fin-periodo') || 'mes'; } catch (e) { return 'mes'; } })(), de: '', ate: '', status: 'pago', metodo: '', busca: '', pagina: 1, pedidos: [], lanc: { pessoa: '', tipo: '', categoria: '', q: '' }, dados: null };

  var $ = function (id) { return document.getElementById(id); };
  var icone = function (nome, classe) { return '<svg class="icone ' + (classe || '') + '"><use href="#i-' + nome + '"/></svg>'; };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  var brl = function (v) { return fmtBRL.format(Number(v) || 0); };
  var inteiro = function (v) { return new Intl.NumberFormat('pt-BR').format(Number(v) || 0); };
  var pct = function (v) { return (Math.round((Number(v) || 0) * 1000) / 10).toLocaleString('pt-BR') + '%'; };
  function dataBR(iso, comHora) {
    if (!iso) return '';
    var o = { timeZone: FUSO, day: '2-digit', month: '2-digit' };
    if (comHora) { o.hour = '2-digit'; o.minute = '2-digit'; } else { o.year = 'numeric'; }
    return new Intl.DateTimeFormat('pt-BR', o).format(new Date(iso));
  }
  var diaCurto = function (ymd) { var p = ymd.split('-'); return p[2] + '/' + p[1]; };
  function nomeLimpo(nome) {
    return String(nome || '')
      .replace(/^\s*\(\s*pr[eé]-?venda\s*\)\s*/i, 'Pré-venda: ')
      .replace(/\s+-\s+(M[ií]dia Digital|Steam)\b.*$/i, '')
      .replace(/[™®©]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function hojeYMD(desloc) {
    var d = new Date(Date.now() + (desloc || 0) * 86400000);
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(d);
  }

  var timerAviso;
  function aviso(texto, erro) {
    var el = $('aviso');
    el.textContent = texto;
    el.classList.toggle('erro-aviso', !!erro);
    el.classList.add('on');
    clearTimeout(timerAviso);
    timerAviso = setTimeout(function () { el.classList.remove('on'); }, erro ? 3600 : 2200);
  }

  function api(metodo, rota, corpo) {
    return fetch(rota, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
      credentials: 'same-origin',
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && rota.indexOf('/api/') === 0) { mostrarLogin(); throw new Error('Entre de novo.'); }
        if (!r.ok || j.ok === false) throw new Error(j.erro || 'Erro ' + r.status);
        return j;
      });
    });
  }

  function aplicarLarguras(raiz) {
    (raiz || document).querySelectorAll('[data-w]').forEach(function (el) {
      var w = el.getAttribute('data-w');
      requestAnimationFrame(function () { el.style.width = w + '%'; });
    });
  }

  // ─── login e navegação ─────────────────────────────────────────────

  function mostrarLogin() {
    $('app').hidden = true;
    $('tela-login').hidden = false;
    setTimeout(function () { $('usuario').focus(); }, 50);
  }
  function mostrarApp() {
    $('tela-login').hidden = true;
    $('app').hidden = false;
    irPara(location.hash.replace('#', '') || 'geral', true);
  }
  $('form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var erro = $('erro-login');
    erro.hidden = true;
    api('POST', '/entrar', { usuario: $('usuario').value.trim(), senha: $('senha').value })
      .then(function () { $('senha').value = ''; mostrarApp(); })
      .catch(function (err) { erro.textContent = err.message; erro.hidden = false; });
  });
  $('btn-sair').addEventListener('click', function () { api('POST', '/sair').finally(mostrarLogin); });

  function abrirMenu(abrir) {
    $('menu').classList.toggle('aberto', abrir);
    $('veu').classList.toggle('on', abrir);
  }
  $('btn-menu').addEventListener('click', function () { abrirMenu(true); });
  $('veu').addEventListener('click', function () { abrirMenu(false); });

  function irPara(vista, sem) {
    if (!TITULOS[vista]) vista = 'geral';
    E.vista = vista;
    document.querySelectorAll('[data-vista]').forEach(function (s) {
      var ativa = s.getAttribute('data-vista') === vista;
      s.hidden = !ativa;
      if (ativa && !sem) { s.classList.remove('entrando'); void s.offsetWidth; s.classList.add('entrando'); }
    });
    document.querySelectorAll('[data-ir]').forEach(function (b) { b.classList.toggle('ativo', b.getAttribute('data-ir') === vista); });
    $('titulo-p').textContent = TITULOS[vista];
    $('periodo-barra').hidden = vista === 'receber';
    document.querySelectorAll('.so-geral').forEach(function (el) { el.hidden = vista !== 'geral'; });
    document.body.classList.toggle('na-geral', vista === 'geral');
    $('btn-novo').hidden = vista !== 'despesas';
    if (location.hash !== '#' + vista) history.replaceState(null, '', '#' + vista);
    abrirMenu(false);
    window.scrollTo(0, 0);
    carregar();
  }
  document.querySelectorAll('[data-ir]').forEach(function (b) {
    b.addEventListener('click', function () { irPara(b.getAttribute('data-ir')); });
  });
  window.addEventListener('scroll', function () { $('topo').classList.toggle('vidro', window.scrollY > 30); }, { passive: true });
  $('btn-atualizar').addEventListener('click', function () {
    api('POST', '/api/sincronizar').catch(function () {});
    aviso('Buscando pedidos novos na Nerix');
    setTimeout(carregar, 2500);
  });

  // ─── período ───────────────────────────────────────────────────────

  function calcularPeriodo() {
    var hoje = hojeYMD(0);
    var p = E.periodo;
    if (p === 'hoje') { E.de = hoje; E.ate = hoje; }
    else if (p === 'ontem') { E.de = hojeYMD(-1); E.ate = hojeYMD(-1); }
    else if (p === '7') { E.de = hojeYMD(-6); E.ate = hoje; }
    else if (p === '30') { E.de = hojeYMD(-29); E.ate = hoje; }
    else if (p === 'mes') { E.de = hoje.slice(0, 8) + '01'; E.ate = hoje; }
    else if (p === 'mes-passado') {
      var a = Number(hoje.slice(0, 4)); var m = Number(hoje.slice(5, 7)) - 1;
      if (m === 0) { m = 12; a--; }
      var mm = (m < 10 ? '0' : '') + m;
      var ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
      E.de = a + '-' + mm + '-01'; E.ate = a + '-' + mm + '-' + ultimo;
    } else {
      E.de = $('data-de').value || hoje; E.ate = $('data-ate').value || hoje;
      if (E.de > E.ate) { var t = E.de; E.de = E.ate; E.ate = t; }
    }
  }
  if (E.periodo === 'livre') {
    var salvas = ''; try { salvas = localStorage.getItem('fin-datas') || ''; } catch (e) {}
    if (/^\d{4}-\d{2}-\d{2}\|\d{4}-\d{2}-\d{2}$/.test(salvas)) { $('data-de').value = salvas.slice(0, 10); $('data-ate').value = salvas.slice(11); }
    else E.periodo = 'mes';
  }
  $('periodo').value = E.periodo;
  $('periodo').addEventListener('change', function () {
    E.periodo = this.value;
    try { localStorage.setItem('fin-periodo', E.periodo); } catch (e) {}
    $('datas').hidden = E.periodo !== 'livre';
    if (E.periodo === 'livre') {
      if (!$('data-de').value) $('data-de').value = E.de || hojeYMD(-6);
      if (!$('data-ate').value) $('data-ate').value = E.ate || hojeYMD(0);
    }
    E.pagina = 1;
    carregar();
  });
  ['data-de', 'data-ate'].forEach(function (id) { $(id).addEventListener('change', function () { E.pagina = 1; carregar(); }); });
  var qPeriodo = function () { return 'de=' + E.de + '&ate=' + E.ate; };

  function carregar() {
    calcularPeriodo();
    atualizarExportar();
    if (E.vista === 'geral') carregarGeral();
    else if (E.vista === 'pedidos') carregarPedidos(false);
    else if (E.vista === 'receber') carregarReceber();
    else carregarDespesas();
  }

  // ─── visão geral ───────────────────────────────────────────────────

  var graficos = [];
  E.serieMedida = 'bruto';
  E.fPlataforma = '';
  E.fMetodo = '';

  function cor(nome) { return getComputedStyle(document.documentElement).getPropertyValue('--' + nome).trim(); }
  function rgba(hex, a) {
    var h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }
  function paleta() { return [cor('azul'), cor('ciano'), cor('laranja'), '#8b5cf6', cor('vermelho'), '#ec4899', '#eab308', cor('fraco')]; }

  function prepararGraficos() {
    if (!window.Chart) return;
    Chart.defaults.color = cor('fraco');
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 11;
    Chart.defaults.borderColor = cor('linha');
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = cor('cartao');
    Chart.defaults.plugins.tooltip.borderColor = cor('linha-forte');
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.titleColor = cor('texto');
    Chart.defaults.plugins.tooltip.bodyColor = cor('texto');
    Chart.defaults.animation.duration = 500;
  }
  prepararGraficos();

  function limparGraficos() {
    graficos.forEach(function (g) { try { g.destroy(); } catch (e) {} });
    graficos = [];
  }
  function grafico(id, cfg) {
    var el = $(id);
    if (!el || !window.Chart) return null;
    var g = new Chart(el, cfg);
    graficos.push(g);
    return g;
  }

  function delta(atual, antes) {
    if (!antes && !atual) return '';
    if (!antes) return '<span class="delta sobe">novo</span>';
    var v = (atual - antes) / Math.abs(antes);
    if (Math.abs(v) < 0.005) return '<span class="delta igual">=</span>';
    return '<span class="delta ' + (v > 0 ? 'sobe' : 'desce') + '">' + (v > 0 ? '▲ ' : '▼ ') + pct(Math.abs(v)) + '</span>';
  }

  function kpi(ico, rotulo, valor, dlt, detalhe, negativo) {
    return '<div class="kpi"><div class="kpi-cab"><span class="rotulo">' + rotulo + '</span>' + icone(ico, 'kpi-icone') + '</div>' +
      '<div class="valor' + (negativo ? ' negativo' : '') + '">' + valor + '</div>' +
      '<div class="kpi-pe">' + (dlt || '') + (detalhe ? '<span class="detalhe">' + detalhe + '</span>' : '') + '</div></div>';
  }

  function agrupar(serie, dias) {
    if (dias <= 45) return serie.map(function (d) { return Object.assign({ rotulo: diaCurto(d.dia) }, d); });
    var porSemana = dias <= 200;
    var grupos = [];
    serie.forEach(function (d) {
      var chave, rotulo;
      if (porSemana) {
        var dt = new Date(d.dia + 'T12:00:00Z');
        var seg = new Date(dt.getTime() - ((dt.getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10);
        chave = seg; rotulo = 'sem ' + diaCurto(seg);
      } else {
        chave = d.dia.slice(0, 7); rotulo = d.dia.slice(5, 7) + '/' + d.dia.slice(2, 4);
      }
      var g = grupos.length && grupos[grupos.length - 1].chave === chave ? grupos[grupos.length - 1] : null;
      if (!g) { g = { chave: chave, rotulo: rotulo, dia: d.dia, bruto: 0, liquido: 0, pedidos: 0, criados: 0, despesas: 0 }; grupos.push(g); }
      ['bruto', 'liquido', 'pedidos', 'criados', 'despesas'].forEach(function (k) { g[k] += d[k] || 0; });
    });
    return grupos;
  }

  function desenharSerie(j) {
    var m = E.serieMedida;
    var atual = agrupar(j.serie, j.periodo.dias);
    var antes = agrupar(j.serieAnterior, j.periodo.dias);
    var valor = function (d) { return m === 'pedidos' ? d.pedidos : m === 'lucro' ? d.liquido - d.despesas : d[m]; };
    var dinheiro = m !== 'pedidos';
    var azul = cor('azul');
    grafico('g-serie', {
      type: 'line',
      data: {
        labels: atual.map(function (d) { return d.rotulo; }),
        datasets: [
          {
            label: 'Período atual', data: atual.map(valor), borderColor: azul, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: azul, pointHoverBorderColor: cor('cartao'), pointHoverBorderWidth: 2, tension: 0.35, fill: true,
            backgroundColor: function (c) {
              var a = c.chart.chartArea;
              if (!a) return rgba(azul, 0.12);
              var g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
              g.addColorStop(0, rgba(azul, 0.22));
              g.addColorStop(1, rgba(azul, 0));
              return g;
            },
          },
          { label: 'Período anterior', data: atual.map(function (_, i) { return antes[i] ? valor(antes[i]) : null; }), borderColor: cor('fraco'), borderDash: [4, 4], borderWidth: 1.4, pointRadius: 0, tension: 0.35, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: cor('linha') }, ticks: { maxTicksLimit: 5, callback: function (v) { return dinheiro ? (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR') + 'K' : v) : v; } } },
        },
        plugins: { tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + (dinheiro ? brl(c.raw) : inteiro(c.raw) + ' pedidos'); } } } },
      },
    });
  }

  function desenharMargem(j, filtrado) {
    var atual = agrupar(j.serie, j.periodo.dias);
    var antes = agrupar(j.serieAnterior, j.periodo.dias);
    var margem = function (d) { return d && d.bruto ? Math.round(((filtrado ? d.liquido : d.liquido - d.despesas) / d.bruto) * 1000) / 10 : null; };
    var verde = cor('azul');
    grafico('g-margem', {
      type: 'line',
      data: {
        labels: atual.map(function (d) { return d.rotulo; }),
        datasets: [
          {
            label: 'Margem', data: atual.map(margem), borderColor: verde, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, pointHoverBackgroundColor: verde, pointHoverBorderColor: cor('cartao'), pointHoverBorderWidth: 2, tension: 0.35, spanGaps: true, fill: true,
            backgroundColor: function (c) {
              var a = c.chart.chartArea;
              if (!a) return rgba(verde, 0.12);
              var g = c.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
              g.addColorStop(0, rgba(verde, 0.22));
              g.addColorStop(1, rgba(verde, 0));
              return g;
            },
          },
          { label: 'Período anterior', data: atual.map(function (_, i) { return margem(antes[i]); }), borderColor: cor('fraco'), borderDash: [4, 4], borderWidth: 1.4, pointRadius: 0, tension: 0.35, spanGaps: true, fill: false },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
          y: { border: { display: false }, grid: { color: cor('linha') }, suggestedMin: 0, suggestedMax: 100, ticks: { maxTicksLimit: 5, callback: function (v) { return v + '%'; } } },
        },
        plugins: { tooltip: { callbacks: { label: function (c) { return ' ' + c.dataset.label + ': ' + (c.raw == null ? 'sem venda' : c.raw.toLocaleString('pt-BR') + '%'); } } } },
      },
    });
  }

  function rosca(id, rotulos, valores) {
    grafico(id, {
      type: 'doughnut',
      data: { labels: rotulos, datasets: [{ data: valores, backgroundColor: paleta(), borderColor: cor('cartao'), borderWidth: 3, hoverOffset: 6, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '74%',
        plugins: { tooltip: { callbacks: { label: function (c) { var t = c.dataset.data.reduce(function (s, x) { return s + x; }, 0); return ' ' + c.label + ': ' + brl(c.raw) + ' (' + pct(t ? c.raw / t : 0) + ')'; } } } },
      },
    });
  }

  function legenda(rotulos, valores, extras) {
    var t = valores.reduce(function (s, x) { return s + x; }, 0);
    return '<div class="legenda-lista">' + rotulos.map(function (r, i) {
      return '<div><i class="ponto-cor c' + (i % 8) + '"></i><span>' + esc(r) + '</span><b>' + brl(valores[i]) + '</b><small>' + pct(t ? valores[i] / t : 0) + (extras && extras[i] ? ' · ' + extras[i] : '') + '</small></div>';
    }).join('') + '</div>';
  }

  var DIAS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

  function mapaCalor(calor) {
    var m = {};
    calor.forEach(function (c) { m[c.dia + '-' + c.hora] = c; });
    var max = Math.max.apply(null, calor.map(function (c) { return c.pedidos; }).concat([1]));
    var html = '<div class="calor"><span></span>';
    for (var h = 0; h < 24; h++) html += '<span class="calor-hora">' + (h % 3 === 0 ? h + 'h' : '') + '</span>';
    for (var d = 1; d <= 7; d++) {
      html += '<span class="calor-dia">' + DIAS[d - 1] + '</span>';
      for (var hh = 0; hh < 24; hh++) {
        var c = m[d + '-' + hh];
        var v = c ? c.pedidos : 0;
        html += '<i class="calor-cel" data-a="' + (v ? (0.15 + 0.85 * v / max).toFixed(2) : 0) + '" title="' + DIAS[d - 1] + ' ' + hh + 'h: ' + v + ' pedidos' + (c ? ', ' + brl(c.bruto) : '') + '"></i>';
      }
    }
    return html + '</div>';
  }

  function aplicarCalor(raiz) {
    var azul = cor('azul');
    var vazio = cor('cartao-2');
    raiz.querySelectorAll('.calor-cel').forEach(function (el) {
      var a = Number(el.getAttribute('data-a'));
      el.style.backgroundColor = a ? rgba(azul, a) : vazio;
    });
  }

  function barrasDias(calor) {
    var porDia = [0, 0, 0, 0, 0, 0, 0];
    calor.forEach(function (c) { porDia[c.dia - 1] += c.pedidos; });
    var max = Math.max.apply(null, porDia);
    var top = max ? porDia.indexOf(max) : -1;
    return '<div class="barras-dias">' + porDia.map(function (v, i) {
      return '<div class="barra-dia' + (i === top ? ' top' : '') + '" title="' + DIAS[i] + ': ' + inteiro(v) + ' pedidos">' +
        '<span class="topo-num">' + (i === top ? inteiro(v) : '') + '</span>' +
        '<span class="trilho-v"><span class="coluna" data-h="' + (max ? Math.max(6, Math.round(v / max * 100)) : 6) + '"></span></span>' +
        '<span class="dia">' + DIAS[i] + '</span></div>';
    }).join('') + '</div>';
  }

  function aplicarAlturas(raiz) {
    raiz.querySelectorAll('[data-h]').forEach(function (el) {
      var h = el.getAttribute('data-h');
      requestAnimationFrame(function () { el.style.height = h + '%'; });
    });
  }

  function medidor(fracao, texto) {
    var n = 44, cx = 120, cy = 118, r1 = 84, r2 = 104;
    var on = Math.round(Math.max(0, Math.min(1, fracao)) * n);
    var linhas = '';
    for (var i = 0; i < n; i++) {
      var a = Math.PI - (i / (n - 1)) * Math.PI;
      var x1 = cx + r1 * Math.cos(a), y1 = cy - r1 * Math.sin(a);
      var x2 = cx + r2 * Math.cos(a), y2 = cy - r2 * Math.sin(a);
      linhas += '<line class="tique' + (i < on ? ' on' : '') + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
    }
    return '<div class="medidor"><svg viewBox="0 0 240 128" aria-hidden="true">' + linhas + '</svg>' +
      '<div class="num">' + pct(fracao) + '</div><small>' + texto + '</small>' +
      '<button class="btn toque" id="ver-parados">Ver pedidos parados</button></div>';
  }

  function cartoesSocios(dv) {
    E.divisao = dv;
    var fonte = dv.fonte === 'carteira'
      ? 'Pela carteira da Nerix, conferida ' + dataBR(dv.carteira.atualizadoEm, true) + '. <button class="link toque" id="conferir-carteira">Atualizar</button>'
      : dv.mes ? 'Calculado pelos pedidos. <button class="link toque" id="conferir-carteira">Conferir com a carteira</button>' : 'Calculado pelos pedidos.';
    return '<p class="fonte">' + fonte + '</p><div class="divisao">' + dv.socios.map(function (s) {
      var negativo = s.agora < 0;
      return '<div class="conta-socio"><div class="cab"><b>Conta do ' + esc(s.nome) + '</b><small>' + s.pct + '% do lucro</small></div>' +
        '<div class="rotulo">' + (negativo ? 'Precisa devolver agora' : 'Precisa receber agora') + '</div>' +
        '<div class="agora' + (negativo ? ' negativo' : '') + '">' + brl(Math.abs(s.agora)) + '</div>' +
        '<div class="conta">' +
          '<div><span>Parte do lucro liberado</span><b>' + brl(s.parteLucro) + '</b></div>' +
          (s.reembolso ? '<div><span>+ Despesas que pagou</span><b>' + brl(s.reembolso) + '</b></div>' : '') +
          (s.aportes ? '<div><span>+ Aportes</span><b>' + brl(s.aportes) + '</b></div>' : '') +
          (s.retiradas ? '<div><span>− Já retirou</span><b>' + brl(s.retiradas) + '</b></div>' : '') +
        '</div>' +
        (s.depois ? '<div class="depois"><span>Quando o cartão liberar</span><b>+ ' + brl(s.depois) + '</b></div>' : '') +
      '</div>';
    }).join('') + '</div>';
  }

  var NOME_METODO = { pix: 'Pix', card: 'Cartão' };
  var ICONE_PLAT = { Nintendo: 'controle', PlayStation: 'controle', Steam: 'controle' };

  function faixa(classe, ico, valor, rotulo) {
    return '<div class="faixa ' + classe + '"><span class="ico">' + icone(ico) + '</span><b>' + valor + '</b><small>' + rotulo + '</small></div>';
  }

  function carregarGeral() {
    var alvo = $('geral');
    if (!alvo.innerHTML) alvo.innerHTML = '<div class="kpis">' + new Array(5).join('<div class="esqueleto"></div>') + '</div>';
    var q = qPeriodo() + '&plataforma=' + encodeURIComponent(E.fPlataforma) + '&metodo=' + encodeURIComponent(E.fMetodo);
    api('GET', '/api/resumo?' + q).then(function (j) {
      limparGraficos();
      E.resumo = j;
      var a = j.atual, b = j.anterior, dv = j.divisao;
      var filtrado = !!(E.fPlataforma || E.fMetodo);
      var antes = function (v, dinheiro) { return 'vs. ' + (dinheiro ? brl(v) : inteiro(v)) + ' antes'; };

      var html = '<div class="kpis">' +
        kpi('moeda', 'Faturamento', brl(a.bruto), delta(a.bruto, b.bruto), antes(b.bruto, true)) +
        kpi('carteira', 'Líquido', brl(a.liquido), delta(a.liquido, b.liquido), 'taxas ' + brl(a.taxas)) +
        kpi('sacola', 'Pedidos pagos', inteiro(a.pagos), delta(a.pagos, b.pagos), inteiro(a.clientes) + ' clientes') +
        kpi('etiqueta', 'Ticket médio', brl(a.ticket), delta(a.ticket, b.ticket), antes(b.ticket, true)) +
        '</div>';

      var principal = filtrado
        ? { rotulo: 'Líquido', valor: a.liquido, dlt: delta(a.liquido, b.liquido) }
        : { rotulo: 'Lucro previsto', valor: dv.lucroPrevisto, dlt: delta(a.lucro, b.lucro) };
      var faixas = filtrado
        ? faixa('azul', 'carteira', brl(a.liquido), 'Líquido') + faixa('verde', 'recibo', brl(a.taxas), 'Taxas') + faixa('laranja', 'etiqueta', brl(a.descontos), 'Descontos')
        : faixa('azul', 'cadeado', brl(dv.lucroLiberado), 'Lucro já liberado') + faixa('verde', 'relogio', brl(dv.aLiberar), 'A liberar do cartão') + faixa('laranja', 'recibo', brl(a.despesas), 'Despesas');

      html += '<div class="painel-grade">' +
        '<div class="cartao-g col-8 lucro">' +
          '<div class="lucro-topo">' +
            '<div class="lucro-num"><div class="rotulo">' + principal.rotulo + '</div>' +
              '<div class="grande' + (principal.valor < 0 ? ' negativo' : '') + '">' + brl(principal.valor) + '</div>' +
              '<div class="kpi-pe">' + (principal.dlt || '') + '<span class="detalhe">vs. período anterior</span></div></div>' +
            '<div><div class="cartao-cab"><small>' + (j.periodo.dias > 45 ? (j.periodo.dias > 200 ? 'Por mês' : 'Por semana') : 'Por dia') + '</small>' +
              '<div class="segmento" id="seg-serie">' + [['bruto', 'Faturamento'], ['liquido', 'Líquido'], ['lucro', 'Lucro'], ['pedidos', 'Pedidos']].map(function (o) {
                return '<button class="' + (E.serieMedida === o[0] ? 'ativo' : '') + '" data-m="' + o[0] + '">' + o[1] + '</button>';
              }).join('') + '</div></div><div class="area-grafico alta"><canvas id="g-serie"></canvas></div></div>' +
          '</div>' +
          '<div class="faixas"><div class="faixas-cab"><span>Para onde foi o dinheiro</span><span class="mais">···</span></div><div class="faixas-grade">' + faixas + '</div></div>' +
        '</div>' +
        '<div class="pilha col-4">' +
          '<div class="cartao-g"><div class="cartao-cab"><h3>Dias que mais vendem</h3><span class="mais">···</span></div>' + barrasDias(j.calor) + '</div>' +
          '<div class="cartao-g"><div class="cartao-cab"><h3>Conversão</h3><span class="mais">···</span></div>' +
            medidor(a.conversao, inteiro(a.pagos) + ' de ' + inteiro(a.criados) + ' pedidos foram pagos') + '</div>' +
        '</div>' +
      '</div>';

      var totalJogos = j.topJogos.reduce(function (s, t) { return s + t.receita; }, 0) || 1;
      html += '<div class="painel-grade">' +
        '<div class="cartao-g col-8"><div class="cartao-cab"><h3>Jogos que mais faturaram</h3><span class="mais">···</span></div>' +
        (j.topJogos.length ? '<div class="tabela-rolar"><table class="tabela"><thead><tr><th>#</th><th>Jogo</th><th class="num">Vendidos</th><th class="num">Receita</th><th class="num">Preço médio</th><th class="barra-col">Participação</th></tr></thead><tbody>' +
          j.topJogos.map(function (t, i) {
            var p = t.receita / totalJogos;
            return '<tr><td class="pos">#' + String(i + 1).padStart(2, '0') + '</td>' +
              '<td class="nome-jogo"><span class="nome-com-icone"><span class="mini-ico">' + icone(ICONE_PLAT[t.categoria] || 'controle') + '</span><span title="' + esc(t.categoria) + '">' + esc(nomeLimpo(t.nome)) + '</span></span></td>' +
              '<td class="num">' + inteiro(t.qtd) + ' vendidos</td>' +
              '<td class="num"><span class="receita"><i>↑</i>' + brl(t.receita) + '</span></td>' +
              '<td class="num">' + brl(t.qtd ? t.receita / t.qtd : 0) + '</td>' +
              '<td class="barra-col"><div class="trilho"><i data-w="' + Math.max(2, Math.round(p * 100)) + '"></i></div><small>' + pct(p) + '</small></td></tr>';
          }).join('') + '</tbody></table></div>' : '<p class="vazio">Nada vendido no período.</p>') +
        '</div>' +
        '<div class="cartao-g col-4"><div class="cartao-cab"><h3>Quanto vai para cada conta</h3><span class="mais">···</span></div>' + cartoesSocios(dv) + '</div>' +
      '</div>';

      var margemDe = function (x) { return x.bruto ? (filtrado ? x.liquido : x.lucro) / x.bruto : 0; };
      var mAtual = margemDe(a), mAntes = margemDe(b);
      var dpp = (mAtual - mAntes) * 100;
      var deltaM = !b.bruto ? '' : Math.abs(dpp) < 0.05 ? '<span class="delta igual">=</span>'
        : '<span class="delta ' + (dpp > 0 ? 'sobe' : 'desce') + '">' + (dpp > 0 ? '▲ ' : '▼ ') + Math.abs(dpp).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' p.p.</span>';
      html += '<div class="painel-grade">' +
        '<div class="cartao-g col-8 margem"><div class="margem-topo"><div><div class="rotulo-m">' + (filtrado ? 'Margem líquida' : 'Margem de lucro') + '</div>' +
          '<div class="grande-m' + (mAtual < 0 ? ' negativo' : '') + '">' + pct(mAtual) + '</div>' +
          '<div class="kpi-pe">' + deltaM + '<span class="detalhe">antes ' + pct(mAntes) + '</span></div></div>' +
          '<small class="explica-m">' + (filtrado ? 'Quanto do faturamento sobra depois das taxas.' : 'Quanto do faturamento sobra depois das taxas e das despesas.') + '</small></div>' +
          '<div class="area-grafico media"><canvas id="g-margem"></canvas></div></div>' +
        '<div class="cartao-g col-4"><div class="cartao-cab"><h3>Outros números</h3><span class="mais">···</span></div><div class="mini-kpis">' +
        '<div><span>Aguardando pagamento</span><b>' + brl(a.abertosValor) + '</b><small>' + inteiro(a.abertos) + ' pedidos parados</small></div>' +
        '<div><span>Clientes novos</span><b>' + inteiro(j.clientes.novos) + '</b><small>' + inteiro(j.clientes.voltaram) + ' voltaram a comprar</small></div>' +
        '<div><span>Descontos</span><b>' + brl(a.descontos) + '</b><small>em cupons</small></div>' +
        '<div><span>Taxas</span><b>' + brl(a.taxas) + '</b><small>' + pct(a.bruto ? a.taxas / a.bruto : 0) + ' do faturamento</small></div>' +
        '</div></div></div>';

      var met = j.porMetodo;
      var cat = j.porCategoria;
      var desp = j.despesasCat;
      html += '<div class="painel-grade">' +
        '<div class="cartao-g col-4"><div class="cartao-cab"><h3>Pix x cartão</h3><span class="mais">···</span></div><div class="area-grafico rosca"><canvas id="g-metodo"></canvas></div>' +
          legenda(met.map(function (m) { return NOME_METODO[m.metodo] || m.metodo; }), met.map(function (m) { return m.bruto; }), met.map(function (m) { return m.pedidos + ' pedidos · taxas ' + brl(m.taxas); })) + '</div>' +
        '<div class="cartao-g col-4"><div class="cartao-cab"><h3>Por plataforma</h3><span class="mais">···</span></div><div class="area-grafico rosca"><canvas id="g-plataforma"></canvas></div>' +
          legenda(cat.map(function (c) { return c.categoria; }), cat.map(function (c) { return c.receita; }), cat.map(function (c) { return c.qtd + ' itens'; })) + '</div>' +
        '<div class="cartao-g col-4"><div class="cartao-cab"><h3>Despesas</h3><span class="mais">···</span></div>' + (desp.length
          ? '<div class="area-grafico rosca"><canvas id="g-despesas"></canvas></div>' + legenda(desp.map(function (d) { return d.categoria; }), desp.map(function (d) { return d.total; }))
          : '<p class="vazio">Nenhuma despesa no período.</p>') + '</div>' +
        '</div>';

      html += '<div class="painel-grade"><div class="cartao-g col-12"><div class="cartao-cab"><h3>Quando vende</h3><small>pedidos pagos por dia da semana e hora</small></div>' + mapaCalor(j.calor) + '</div></div>';

      html += '<p class="legenda">Comparação com ' + j.periodo.dias + (j.periodo.dias === 1 ? ' dia anterior' : ' dias anteriores') + ' (' + diaCurto(j.periodo.antesDe) + ' a ' + diaCurto(j.periodo.antesAte) + ')' + (j.periodo.mesmoHorario ? ', até o mesmo horário de agora' : '') + '.' +
        (filtrado ? ' Com filtro de plataforma ou pagamento, lucro e despesas ficam de fora.' : '') + '</p>';

      alvo.innerHTML = html;
      aplicarLarguras(alvo);
      aplicarAlturas(alvo);
      aplicarCalor(alvo);
      desenharSerie(j);
      desenharMargem(j, filtrado);
      if (met.length) rosca('g-metodo', met.map(function (m) { return NOME_METODO[m.metodo] || m.metodo; }), met.map(function (m) { return m.bruto; }));
      if (cat.length) rosca('g-plataforma', cat.map(function (c) { return c.categoria; }), cat.map(function (c) { return c.receita; }));
      if (desp.length) rosca('g-despesas', desp.map(function (d) { return d.categoria; }), desp.map(function (d) { return d.total; }));
      mostrarSync(j.sync);
    }).catch(function (err) { alvo.innerHTML = '<p class="vazio">' + esc(err.message) + '</p>'; });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#ver-parados')) return;
    E.status = 'aberto';
    irPara('pedidos');
  });

  function trocarTema() {
    var escuro = document.documentElement.getAttribute('data-tema') !== 'escuro';
    if (escuro) document.documentElement.setAttribute('data-tema', 'escuro');
    else document.documentElement.removeAttribute('data-tema');
    try { localStorage.setItem('fin-tema', escuro ? 'escuro' : 'claro'); } catch (e) {}
    mostrarTema();
    prepararGraficos();
    if (E.vista === 'geral' && E.resumo) carregarGeral();
  }
  function mostrarTema() {
    var escuro = document.documentElement.getAttribute('data-tema') === 'escuro';
    $('icone-tema').setAttribute('href', escuro ? '#i-sol' : '#i-lua');
    $('cor-tema').setAttribute('content', escuro ? '#0b0c0e' : '#f3f4f6');
  }
  $('btn-tema').addEventListener('click', trocarTema);
  mostrarTema();

  $('busca-topo').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    E.busca = this.value.trim();
    $('busca-pedidos').value = E.busca;
    this.blur();
    irPara('pedidos');
  });

  function atualizarExportar() {
    var a = $('btn-exportar');
    if (E.vista === 'despesas') a.href = '/api/lancamentos/planilha?' + qPeriodo();
    else if (E.vista === 'pedidos') a.href = '/api/exportar?' + filtroQuery();
    else a.href = '/api/exportar?' + qPeriodo() + '&status=pago&metodo=' + encodeURIComponent(E.fMetodo) + '&q=';
  }

  $('geral').addEventListener('click', function (e) {
    var b = e.target.closest('#seg-serie button');
    if (!b || !E.resumo) return;
    E.serieMedida = b.getAttribute('data-m');
    document.querySelectorAll('#seg-serie button').forEach(function (x) { x.classList.toggle('ativo', x === b); });
    var g = graficos.filter(function (x) { return x.canvas && x.canvas.id === 'g-serie'; })[0];
    if (g) { graficos.splice(graficos.indexOf(g), 1); g.destroy(); }
    desenharSerie(E.resumo);
  });
  $('f-plataforma').value = '';
  $('f-metodo').value = '';
  $('f-plataforma').addEventListener('change', function () { E.fPlataforma = this.value; carregarGeral(); });
  $('f-metodo').addEventListener('change', function () { E.fMetodo = this.value; carregarGeral(); });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('#conferir-carteira') || !E.divisao) return;
    var dv = E.divisao;
    var c = dv.carteira || { saques: dv.saquesLancados || '', liberado: '', pendente: '' };
    var v = function (x) { return x === '' ? '' : String(Number(x).toFixed(2)).replace('.', ','); };
    var nomeMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(dv.mes + '-15T12:00:00Z'));
    abrirDialogo('<h3>Carteira da Nerix</h3><p>Copie da carteira da Nerix os valores de ' + esc(nomeMes) + '. A divisão entre os sócios passa a usar esse dinheiro real.</p>' +
      '<div class="form-lanc">' +
      '<label class="campo-rotulo">Saques do mês<input id="c-saques" class="campo-entrada" inputmode="decimal" value="' + v(c.saques) + '" placeholder="R$ 0,00"></label>' +
      '<label class="campo-rotulo">Liberado (disponível para saque)<input id="c-liberado" class="campo-entrada" inputmode="decimal" value="' + v(c.liberado) + '" placeholder="R$ 0,00"></label>' +
      '<label class="campo-rotulo">Pendente (a liberar)<input id="c-pendente" class="campo-entrada" inputmode="decimal" value="' + v(c.pendente) + '" placeholder="R$ 0,00"></label>' +
      '<p class="ajuda">Pelos pedidos: liberado ' + brl(dv.pelosPedidos.liberado) + ' e a liberar ' + brl(dv.pelosPedidos.aLiberar) + '.</p>' +
      '<button class="btn primario grande cheio toque" id="c-salvar">Salvar</button>' +
      (dv.carteira ? '<button class="btn cheio toque" id="c-remover">Voltar a calcular pelos pedidos</button>' : '<button class="btn cheio toque" data-fechar-dialogo>Cancelar</button>') +
      '</div>');
    $('c-salvar').addEventListener('click', function () {
      api('PUT', '/api/carteira/' + dv.mes, { saques: $('c-saques').value, liberado: $('c-liberado').value, pendente: $('c-pendente').value })
        .then(function () { fecharDialogo(); aviso('Carteira conferida'); carregarGeral(); })
        .catch(function (err) { aviso(err.message, true); });
    });
    if ($('c-remover')) $('c-remover').addEventListener('click', function () {
      api('DELETE', '/api/carteira/' + dv.mes).then(function () { fecharDialogo(); carregarGeral(); }).catch(function (err) { aviso(err.message, true); });
    });
  });

  function mostrarSync(s) {
    if (!s || !s.ultima) return;
    var min = Math.round((Date.now() - Date.parse(s.ultima)) / 60000);
    var txt = 'Pedidos atualizados ' + (min < 1 ? 'agora' : 'há ' + min + ' min') + (s.erro ? ' · erro: ' + s.erro : '');
    $('sync-info').textContent = txt;
    $('sync-topo').textContent = txt;
  }

  // ─── pedidos ───────────────────────────────────────────────────────

  function tagPedido(p) {
    if (p.pago) return '<span class="tag pago">Pago</span>';
    if (p.pagamento === 'pending') return '<span class="tag aberto">Aguardando</span>';
    return '<span class="tag cancelado">' + esc(p.pagamento || p.status) + '</span>';
  }

  function linhaPedido(p, i) {
    var jogos = (p.itens || []).map(function (x) { return (x.qtd > 1 ? x.qtd + 'x ' : '') + nomeLimpo(x.nome); }).join(' + ');
    return '<button class="linha pedido toque" data-i="' + i + '"><span><span class="nome">' + esc(p.cliente || 'Cliente') + '</span>' +
      '<span class="meta">' + tagPedido(p) + '<span class="tag">' + (NOME_METODO[p.metodo] || esc(p.metodo)) + (p.parcelas > 1 ? ' ' + p.parcelas + 'x' : '') + '</span>' + dataBR(p.criado_em, true) + '</span>' +
      '<span class="meta">' + esc(jogos) + '</span></span>' +
      '<span class="valor-lado"><b>' + brl(p.total) + '</b>' + (p.liquido != null ? '<small>líq. ' + brl(p.liquido) + '</small>' : '') + '</span></button>';
  }

  function filtroQuery() {
    return qPeriodo() + '&status=' + encodeURIComponent(E.status) + '&metodo=' + encodeURIComponent(E.metodo) + '&q=' + encodeURIComponent(E.busca);
  }

  function rotuloDe(g, obj) {
    var o = g.opcoes.filter(function (x) { return x[0] === obj[g.chave]; })[0];
    return o ? o[1] : '';
  }

  function desenharAtivos(alvo, botao, grupos, obj, texto, aoMudar) {
    var ativos = grupos.filter(function (g) { return obj[g.chave] !== g.padrao; });
    var b = $(botao);
    b.classList.toggle('ligado', ativos.length > 0);
    var bol = b.querySelector('.bolinha');
    bol.hidden = !ativos.length;
    bol.textContent = ativos.length;
    $(alvo).innerHTML = '<span class="total">' + texto + '</span>' + ativos.map(function (g) {
      return '<button class="pilula toque" data-limpar="' + g.chave + '">' + esc(rotuloDe(g, obj)) + icone('fechar', 'p') + '</button>';
    }).join('');
    $(alvo).onclick = function (e) {
      var p = e.target.closest('[data-limpar]');
      if (!p) return;
      var g = grupos.filter(function (x) { return x.chave === p.getAttribute('data-limpar'); })[0];
      obj[g.chave] = g.padrao;
      aoMudar();
    };
  }

  function abrirFiltros(grupos, obj, aoMudar, extra) {
    function desenhar() {
      var ativos = grupos.filter(function (g) { return obj[g.chave] !== g.padrao; }).length;
      var html = '<div class="filtros-cab"><h3>Filtros</h3><button class="link toque" data-zerar' + (ativos ? '' : ' disabled') + '>Limpar</button></div>' +
        grupos.map(function (g) {
          return '<div class="grupo-filtro"><div class="grupo-titulo">' + g.titulo + '</div><div class="opcoes">' + g.opcoes.map(function (o) {
            return '<button class="opcao toque' + (obj[g.chave] === o[0] ? ' ativo' : '') + '" data-chave="' + g.chave + '" data-valor="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
          }).join('') + '</div></div>';
        }).join('') + (extra ? extra() : '') +
        '<button class="btn primario grande cheio toque" data-fechar-dialogo>Ver resultado</button>';
      if ($('dialogo-veu').hidden) abrirDialogo(html);
      else $('dialogo').innerHTML = html;
    }
    desenhar();
    $('dialogo').onclick = function (e) {
      var o = e.target.closest('.opcao[data-chave]');
      if (o) { obj[o.getAttribute('data-chave')] = o.getAttribute('data-valor'); aoMudar(); desenhar(); return; }
      if (e.target.closest('[data-zerar]')) { grupos.forEach(function (g) { obj[g.chave] = g.padrao; }); aoMudar(); desenhar(); }
    };
  }

  var FILTROS_PEDIDOS = [
    { chave: 'status', titulo: 'Situação', padrao: 'pago', opcoes: [['pago', 'Pagos'], ['aberto', 'Aguardando pagamento'], ['cancelado', 'Cancelados'], ['', 'Todos']] },
    { chave: 'metodo', titulo: 'Forma de pagamento', padrao: '', opcoes: [['', 'Pix e cartão'], ['pix', 'Pix'], ['card', 'Cartão']] },
  ];

  function carregarPedidos(mais) {
    if (!mais) { E.pagina = 1; E.pedidos = []; $('lista-pedidos').innerHTML = '<div class="grupo">' + new Array(6).join('<div class="esqueleto"></div>') + '</div>'; }
    api('GET', '/api/pedidos?' + filtroQuery() + '&pagina=' + E.pagina).then(function (j) {
      E.pedidos = E.pedidos.concat(j.pedidos);
      desenharAtivos('ativos-pedidos', 'filtros-pedidos', FILTROS_PEDIDOS, E,
        inteiro(j.total) + (j.total === 1 ? ' pedido' : ' pedidos') + (j.bruto ? ' · ' + brl(j.bruto) : ''),
        function () { carregarPedidos(false); });
      if (!E.pedidos.length) { $('lista-pedidos').innerHTML = '<p class="vazio">Nenhum pedido neste filtro.</p>'; return; }
      $('lista-pedidos').innerHTML = '<div class="grupo">' + E.pedidos.map(linhaPedido).join('') + '</div>' +
        (E.pedidos.length < j.total ? '<button class="btn cheio toque mais-pedidos" id="btn-mais-pedidos">Carregar mais</button>' : '');
    }).catch(function (err) { $('lista-pedidos').innerHTML = '<p class="vazio">' + esc(err.message) + '</p>'; });
  }

  $('lista-pedidos').addEventListener('click', function (e) {
    if (e.target.closest('#btn-mais-pedidos')) { E.pagina++; carregarPedidos(true); return; }
    var b = e.target.closest('[data-i]');
    if (b) abrirPedido(E.pedidos[Number(b.getAttribute('data-i'))]);
  });
  var timerBusca;
  $('busca-pedidos').addEventListener('input', function () {
    E.busca = this.value.trim();
    clearTimeout(timerBusca);
    timerBusca = setTimeout(function () { carregarPedidos(false); }, 350);
  });
  $('filtros-pedidos').addEventListener('click', function () {
    abrirFiltros(FILTROS_PEDIDOS, E, function () { carregarPedidos(false); }, function () {
      return '<a class="btn cheio toque" href="/api/exportar?' + filtroQuery() + '" download>' + icone('baixar', 'p') + 'Baixar planilha deste filtro</a>';
    });
  });

  function abrirFolha() {
    var f = $('folha'), v = $('folha-veu');
    f.hidden = false; v.hidden = false;
    document.body.style.overflow = 'hidden';
    void f.offsetHeight;
    f.classList.add('on'); v.classList.add('on');
  }
  function fecharFolha() {
    var f = $('folha'), v = $('folha-veu');
    f.classList.remove('on'); v.classList.remove('on');
    document.body.style.overflow = '';
    setTimeout(function () { if (!f.classList.contains('on')) { f.hidden = true; v.hidden = true; } }, 450);
  }
  $('folha-veu').addEventListener('click', fecharFolha);
  $('folha').addEventListener('click', function (e) { if (e.target.closest('[data-fechar-folha]')) fecharFolha(); });

  function abrirPedido(resumo) {
    $('folha-titulo').textContent = resumo.cliente || 'Pedido';
    $('folha-sub').textContent = 'Pedido #' + resumo.nerix_id + ' · ' + dataBR(resumo.criado_em, true);
    $('folha-corpo').innerHTML = '<div class="grupo">' + new Array(4).join('<div class="esqueleto"></div>') + '</div>';
    abrirFolha();
    api('GET', '/api/pedidos/' + encodeURIComponent(resumo.numero)).then(function (j) {
      var p = j.pedido;
      var linha = function (r, v) { return v === '' || v == null ? '' : '<div><span>' + r + '</span><b>' + v + '</b></div>'; };
      var html = '<div class="detalhe-lista">' +
        linha('Situação', tagPedido(p)) +
        linha('Pagamento', (NOME_METODO[p.metodo] || esc(p.metodo)) + (p.parcelas > 1 ? ' em ' + p.parcelas + 'x' : '')) +
        linha('Subtotal', brl(p.subtotal)) +
        (Number(p.desconto) ? linha('Desconto', '- ' + brl(p.desconto)) : '') +
        linha('Total pago', brl(p.total)) +
        (p.taxa_gateway != null ? linha('Taxa do pagamento', brl(p.taxa_gateway)) : '') +
        (p.taxa_plataforma != null ? linha('Taxa da Nerix', brl(p.taxa_plataforma)) : '') +
        (p.liquido != null ? linha('Líquido', '<span class="tag pago">' + brl(p.liquido) + '</span>') : '') +
        (p.disponivel_em ? linha('Libera', brl(p.disponivel_valor) + ' em ' + dataBR(p.disponivel_em)) : '') +
        (p.reserva_em ? linha('Reserva', brl(p.reserva_valor) + ' em ' + dataBR(p.reserva_em)) : '') +
        '</div><div class="detalhe-lista">' +
        (p.itens || []).map(function (i) { return linha(esc((i.qtd > 1 ? i.qtd + 'x ' : '') + nomeLimpo(i.nome)), brl(i.total)); }).join('') +
        '</div><div class="detalhe-lista">' +
        linha('Cliente', esc(p.cliente)) + linha('E-mail', esc(p.email)) + linha('Telefone', esc(p.telefone)) +
        linha('Compras desse cliente', j.cliente.pedidos + ' · ' + brl(j.cliente.total)) +
        linha('Aparelho', esc(p.dispositivo)) +
        linha('Código', '<span class="mono">' + esc(p.numero) + '</span>') +
        '</div>';
      $('folha-corpo').innerHTML = html;
    }).catch(function (err) { $('folha-corpo').innerHTML = '<p class="vazio">' + esc(err.message) + '</p>'; });
  }

  // ─── a receber ─────────────────────────────────────────────────────

  function carregarReceber() {
    var alvo = $('receber');
    alvo.innerHTML = '<div class="grupo">' + new Array(4).join('<div class="esqueleto"></div>') + '</div>';
    api('GET', '/api/receber').then(function (j) {
      var html = '<div class="kpis">' +
        kpi('calendario', 'Próximos 7 dias', brl(j.semana), '', 'cartão liberando na carteira') +
        kpi('cadeado', 'Reserva de 30 dias', brl(j.reserva), '', '10% de cada venda no cartão') +
        '</div>';
      if (!j.dias.length) html += '<p class="vazio">Nada para liberar. Pix cai na hora.</p>';
      else {
        html += '<div class="grupo">' + j.dias.map(function (d) {
          var tipos = d.tipos.split(',').map(function (t) { return t === 'reserva' ? 'reserva' : 'cartão'; }).join(' + ');
          return '<div class="linha"><span><span class="nome">' + dataBR(d.dia + 'T12:00:00Z') + '</span><span class="meta">' + tipos + '</span></span><span class="valor-lado"><b>' + brl(d.valor) + '</b></span></div>';
        }).join('') + '</div>';
      }
      alvo.innerHTML = html;
    }).catch(function (err) { alvo.innerHTML = '<p class="vazio">' + esc(err.message) + '</p>'; });
  }

  // ─── despesas e sócios ─────────────────────────────────────────────

  var NOME_TIPO = { despesa: 'Custo', retirada: 'Retirada', aporte: 'Aporte', saque: 'Saque' };
  var QUEM_PAGOU = { Loja: 'pago com dinheiro da loja', Pedro: 'pago pelo Pedro', Arthur: 'pago pelo Arthur' };

  function filtrosLanc() {
    var op = (E.dados && E.dados.opcoes) || { pagadores: ['Pedro', 'Arthur', 'Loja'], categorias: [] };
    return [
      { chave: 'pessoa', titulo: 'Quem', padrao: '', opcoes: [['', 'Todos']].concat(op.pagadores.map(function (p) { return [p, p]; })) },
      { chave: 'tipo', titulo: 'Tipo', padrao: '', opcoes: [['', 'Tudo'], ['despesa', 'Custos'], ['saque', 'Saques'], ['retirada', 'Retiradas'], ['aporte', 'Aportes']] },
      { chave: 'categoria', titulo: 'Categoria', padrao: '', opcoes: [['', 'Todas']].concat(op.categorias.map(function (c) { return [c, c]; })) },
    ];
  }

  function carregarDespesas() {
    if (!E.dados) $('lista-lanc').innerHTML = '<div class="grupo">' + new Array(4).join('<div class="esqueleto"></div>') + '</div>';
    var q = qPeriodo() + '&pessoa=' + encodeURIComponent(E.lanc.pessoa) + '&tipo=' + encodeURIComponent(E.lanc.tipo) + '&q=' + encodeURIComponent(E.lanc.q);
    api('GET', '/api/lancamentos?' + q).then(function (j) {
      E.dados = j;
      desenharSocios();
      desenharLancamentos();
      desenharFixos();
    }).catch(function (err) { $('lista-lanc').innerHTML = '<p class="vazio">' + esc(err.message) + '</p>'; });
  }

  function desenharSocios() {
    var j = E.dados;
    $('socios').innerHTML = j.opcoes.pagadores.map(function (p) {
      var x = j.porPessoa[p] || { despesas: 0, retiradas: 0, aportes: 0, saques: 0 };
      var partes = [];
      if (p === 'Loja') partes.push('custos pagos com dinheiro da loja');
      else {
        if (x.saques) partes.push('sacou ' + brl(x.saques));
        if (x.retiradas) partes.push('tirou ' + brl(x.retiradas));
        if (x.aportes) partes.push('colocou ' + brl(x.aportes));
        if (!partes.length) partes.push('custos que pagou do bolso');
      }
      return '<button class="socio toque' + (E.lanc.pessoa === p ? ' ativo' : '') + '" data-socio="' + esc(p) + '"><b>' + esc(p === 'Loja' ? 'Loja' : p) + '</b>' +
        '<span class="gasto">' + brl(x.despesas) + '</span><small>' + esc(partes.join(' · ')) + '</small></button>';
    }).join('');
  }

  function textoLanc(l) {
    if (l.tipo === 'saque') return { titulo: 'Saque para o ' + l.pessoa, meta: 'saiu da carteira da Nerix', sinal: '' };
    if (l.tipo === 'retirada') return { titulo: l.pessoa + ' tirou pra ele', meta: 'retirada de sócio', sinal: '− ' };
    if (l.tipo === 'aporte') return { titulo: l.pessoa + ' colocou na loja', meta: 'aporte de sócio', sinal: '+ ' };
    return { titulo: l.descricao || l.categoria, meta: [l.descricao ? l.categoria : '', QUEM_PAGOU[l.pessoa] || l.pessoa].filter(Boolean).join(' · '), sinal: '− ' };
  }

  function desenharLancamentos() {
    var j = E.dados;
    var lista = j.lancamentos.filter(function (l) { return !E.lanc.categoria || l.categoria === E.lanc.categoria; });
    var totalDesp = lista.filter(function (l) { return l.tipo === 'despesa'; }).reduce(function (s, l) { return s + l.valor; }, 0);
    desenharAtivos('ativos-lanc', 'filtros-lanc', filtrosLanc(), E.lanc,
      lista.length + (lista.length === 1 ? ' lançamento' : ' lançamentos') + (totalDesp ? ' · ' + brl(totalDesp) + ' em custos' : ''),
      carregarDespesas);
    if (!lista.length) {
      $('lista-lanc').innerHTML = '<p class="vazio">Nada lançado neste período. Toque no + para começar.</p>';
      return;
    }
    $('lista-lanc').innerHTML = '<div class="grupo">' + lista.map(function (l) {
      var t = textoLanc(l);
      return '<button class="linha lanc toque" data-lanc="' + l.id + '"><span><span class="nome">' + esc(t.titulo) + (l.recorrente_id ? ' <span class="tag">todo mês</span>' : '') + '</span>' +
        '<span class="meta">' + esc(dataBR(l.data + 'T12:00:00Z') + ' · ' + t.meta) + '</span></span>' +
        '<span class="valor-lado ' + l.tipo + '">' + t.sinal + brl(l.valor) + '</span></button>';
    }).join('') + '</div>';
  }
  function desenharFixos() {
    var r = E.dados.recorrentes;
    $('lista-fixos').innerHTML = r.length ? r.map(function (c) {
      return '<div class="linha"><span><span class="nome">' + esc(c.descricao || c.categoria) + '</span>' +
        '<span class="meta">' + esc(c.pessoa) + ' · todo dia ' + c.dia + ' · ' + brl(c.valor) + (c.ativo ? '' : ' · pausado') + '</span></span>' +
        '<input type="checkbox" class="chave" data-fixo="' + c.id + '"' + (c.ativo ? ' checked' : '') + ' aria-label="Ativo">' +
        '<button class="icone-btn apagar toque" data-apagar-fixo="' + c.id + '" aria-label="Apagar">' + icone('lixo', 'p') + '</button></div>';
    }).join('') : '<p class="vazio">Nenhum custo fixo. Ao lançar, marque "Repetir todo mês".</p>';
  }

  $('socios').addEventListener('click', function (e) {
    var b = e.target.closest('[data-socio]');
    if (!b) return;
    var p = b.getAttribute('data-socio');
    E.lanc.pessoa = E.lanc.pessoa === p ? '' : p;
    carregarDespesas();
  });
  var timerLanc;
  $('busca-lanc').addEventListener('input', function () {
    E.lanc.q = this.value.trim();
    clearTimeout(timerLanc);
    timerLanc = setTimeout(carregarDespesas, 350);
  });
  $('filtros-lanc').addEventListener('click', function () {
    abrirFiltros(filtrosLanc(), E.lanc, function () { if (E.dados) { desenharSocios(); desenharLancamentos(); } carregarDespesas(); }, function () {
      var d = (E.dados && E.dados.divisao) || { Pedro: 50, Arthur: 50 };
      return '<div class="troca"><span>Divisão do lucro<small>Pedro ' + d.Pedro + '% · Arthur ' + d.Arthur + '%</small></span><button class="link toque" id="mudar-divisao">Mudar</button></div>' +
        '<a class="btn cheio toque" href="/api/lancamentos/planilha?' + qPeriodo() + '" download>' + icone('baixar', 'p') + 'Baixar planilha dos lançamentos</a>';
    });
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#mudar-divisao')) return;
    var d = (E.dados && E.dados.divisao) || { Pedro: 50, Arthur: 50 };
    abrirDialogo('<h3>Divisão do lucro</h3><p>Quanto do lucro é do Pedro. O resto é do Arthur.</p>' +
      '<input id="pct-pedro" class="campo-entrada" inputmode="numeric" value="' + d.Pedro + '" placeholder="% do Pedro">' +
      '<button class="btn primario grande cheio toque" id="salvar-divisao">Salvar</button><button class="btn cheio toque" data-fechar-dialogo>Cancelar</button>');
    $('salvar-divisao').addEventListener('click', function () {
      api('PUT', '/api/divisao', { Pedro: Number(String($('pct-pedro').value).replace(',', '.')) })
        .then(function () { fecharDialogo(); aviso('Divisão salva'); E.dados = null; carregar(); })
        .catch(function (err) { aviso(err.message, true); });
    });
  });

  $('lista-fixos').addEventListener('change', function (e) {
    var c = e.target.closest('[data-fixo]');
    if (!c) return;
    api('PUT', '/api/recorrentes/' + c.getAttribute('data-fixo'), { ativo: c.checked })
      .then(function () { aviso(c.checked ? 'Custo fixo retomado' : 'Custo fixo pausado'); carregarDespesas(); })
      .catch(function (err) { c.checked = !c.checked; aviso(err.message, true); });
  });
  $('lista-fixos').addEventListener('click', function (e) {
    var b = e.target.closest('[data-apagar-fixo]');
    if (!b) return;
    abrirDialogo('<h3>Parar este custo fixo?</h3><p>Ele não entra mais nos próximos meses. Os lançamentos que já entraram continuam.</p>' +
      '<button class="btn grande cheio toque perigo" id="sim-apagar-fixo">Parar</button><button class="btn cheio toque" data-fechar-dialogo>Cancelar</button>');
    $('sim-apagar-fixo').addEventListener('click', function () {
      api('DELETE', '/api/recorrentes/' + b.getAttribute('data-apagar-fixo'))
        .then(function () { fecharDialogo(); aviso('Custo fixo parado'); carregarDespesas(); })
        .catch(function (err) { fecharDialogo(); aviso(err.message, true); });
    });
  });

  var ACOES = [
    { tipo: 'despesa', titulo: 'Paguei um custo da loja', sub: 'Anúncios, contas, ferramentas, qualquer gasto' },
    { tipo: 'saque', titulo: 'Saquei da carteira da Nerix', sub: 'Dinheiro da loja que foi para a conta de alguém' },
    { tipo: 'retirada', titulo: 'Tirei dinheiro pra mim', sub: 'Retirada de sócio, para uso pessoal' },
    { tipo: 'aporte', titulo: 'Coloquei dinheiro na loja', sub: 'Aporte de sócio' },
  ];

  function escolherAcao() {
    abrirDialogo('<h3>O que aconteceu?</h3><div class="acoes-lanc">' + ACOES.map(function (a) {
      return '<button class="acao-lanc toque" data-acao="' + a.tipo + '"><b>' + a.titulo + '</b><small>' + a.sub + '</small></button>';
    }).join('') + '</div><button class="btn cheio toque" data-fechar-dialogo>Cancelar</button>');
    $('dialogo').onclick = function (e) {
      var b = e.target.closest('[data-acao]');
      if (b) formulario({ tipo: b.getAttribute('data-acao') });
    };
  }

  function formulario(base) {
    var op = E.dados.opcoes;
    var F = Object.assign({ tipo: 'despesa', pessoa: '', data: hojeYMD(0), valor: '', categoria: '', descricao: '', repetir: false }, base || {});
    var editando = !!F.id;
    if (!editando && !F.pessoa && E.lanc.pessoa && (F.tipo === 'despesa' || E.lanc.pessoa !== 'Loja')) F.pessoa = E.lanc.pessoa;
    function guardarCampos() {
      ['valor', 'data', 'descricao'].forEach(function (k) { var el = $('f-' + k); if (el) F[k] = el.value; });
      var r = $('f-repetir'); if (r) F.repetir = r.checked;
    }
    function opcoes(chave, lista) {
      return '<div class="opcoes">' + lista.map(function (o) {
        return '<button class="opcao toque' + (F[chave] === o[0] ? ' ativo' : '') + '" data-f="' + chave + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>';
      }).join('') + '</div>';
    }
    var TITULOS_F = { despesa: 'Custo da loja', saque: 'Saque da carteira', retirada: 'Retirada de sócio', aporte: 'Aporte de sócio' };
    var PERGUNTA = { despesa: 'Com que dinheiro?', saque: 'Para a conta de quem?', retirada: 'Quem tirou?', aporte: 'Quem colocou?' };
    function desenhar() {
      var quem = F.tipo === 'despesa'
        ? [['Loja', 'Dinheiro da loja'], ['Pedro', 'Bolso do Pedro'], ['Arthur', 'Bolso do Arthur']]
        : op.socios.map(function (p) { return [p, p]; });
      var ajuda = F.tipo === 'despesa'
        ? (F.pessoa === 'Loja' ? 'Saiu da carteira da Nerix ou de um saque. Sai do lucro e é dividido entre os sócios.' : F.pessoa ? 'Saiu do dinheiro pessoal dele. Ele recebe esse valor de volta no acerto.' : '')
        : F.tipo === 'saque' ? 'Só registra que o dinheiro saiu da carteira. Não mexe no lucro. Lance os custos pagos com ele como "Dinheiro da loja".'
        : F.tipo === 'retirada' ? 'Sai da parte dele no acerto do mês.' : 'Ele recebe esse valor de volta no acerto do mês.';
      var html = '<h3>' + (editando ? 'Editar · ' : '') + TITULOS_F[F.tipo] + '</h3><div class="form-lanc">' +
        '<div class="duas"><input id="f-valor" class="campo-entrada" inputmode="decimal" placeholder="Valor (R$)" value="' + esc(F.valor) + '" autocomplete="off">' +
        '<input id="f-data" type="date" class="campo-entrada" value="' + esc(F.data) + '"></div>' +
        (F.tipo === 'despesa' ? '<div class="grupo-titulo">Pra quê?</div>' + opcoes('categoria', op.categorias.map(function (c) { return [c, c]; })) : '') +
        '<div class="grupo-titulo">' + PERGUNTA[F.tipo] + '</div>' + opcoes('pessoa', quem) +
        (ajuda ? '<p class="ajuda">' + ajuda + '</p>' : '') +
        '<input id="f-descricao" class="campo-entrada" placeholder="' + (F.tipo === 'despesa' ? 'Descrição, ex.: Facebook Ads' : 'Observação (opcional)') + '" value="' + esc(F.descricao) + '" autocomplete="off">' +
        (!editando && F.tipo === 'despesa' ? '<label class="troca"><span>Repetir todo mês<small>Entra sozinho no mesmo dia, todo mês</small></span><input type="checkbox" class="chave" id="f-repetir"' + (F.repetir ? ' checked' : '') + '></label>' : '') +
        '<button class="btn primario grande cheio toque" id="f-salvar">' + (editando ? 'Salvar' : 'Lançar') + '</button>' +
        (editando ? '<button class="btn cheio toque perigo" id="f-apagar">Apagar</button>' : '<button class="btn cheio toque" data-fechar-dialogo>Cancelar</button>') +
        '</div>';
      if ($('dialogo-veu').hidden) abrirDialogo(html);
      else $('dialogo').innerHTML = html;
    }
    desenhar();
    $('dialogo').onclick = function (e) {
      var o = e.target.closest('.opcao[data-f]');
      if (o) { guardarCampos(); F[o.getAttribute('data-f')] = o.getAttribute('data-v'); desenhar(); return; }
      if (e.target.closest('#f-salvar')) {
        guardarCampos();
        if (!F.pessoa) { aviso(PERGUNTA[F.tipo], true); return; }
        if (F.tipo === 'despesa' && !F.categoria) { aviso('Escolha pra quê foi o custo', true); return; }
        var b = $('f-salvar');
        b.disabled = true;
        var corpo = { tipo: F.tipo, pessoa: F.pessoa, data: F.data, valor: F.valor, categoria: F.categoria, descricao: F.descricao, repetir: F.repetir };
        api(editando ? 'PUT' : 'POST', '/api/lancamentos' + (editando ? '/' + F.id : ''), corpo)
          .then(function () { fecharDialogo(); aviso(editando ? 'Salvo' : 'Lançado'); carregarDespesas(); })
          .catch(function (err) { b.disabled = false; aviso(err.message, true); });
        return;
      }
      if (e.target.closest('#f-apagar')) {
        api('DELETE', '/api/lancamentos/' + F.id)
          .then(function () { fecharDialogo(); aviso('Apagado'); carregarDespesas(); })
          .catch(function (err) { aviso(err.message, true); });
      }
    };
  }

  $('btn-novo').addEventListener('click', function () {
    if (!E.dados) return;
    escolherAcao();
  });
  $('lista-lanc').addEventListener('click', function (e) {
    var b = e.target.closest('[data-lanc]');
    if (!b || !E.dados) return;
    var l = E.dados.lancamentos.filter(function (x) { return String(x.id) === b.getAttribute('data-lanc'); })[0];
    if (l) formulario({ id: l.id, tipo: l.tipo, pessoa: l.pessoa, data: l.data, valor: String(l.valor.toFixed(2)).replace('.', ','), categoria: l.categoria, descricao: l.descricao });
  });

  // ─── diálogo e app instalado ───────────────────────────────────────

  function abrirDialogo(html) {
    var v = $('dialogo-veu');
    $('dialogo').onclick = null;
    $('dialogo').innerHTML = html;
    v.hidden = false;
    void v.offsetHeight;
    v.classList.add('on');
  }
  function fecharDialogo() {
    var v = $('dialogo-veu');
    v.classList.remove('on');
    setTimeout(function () { if (!v.classList.contains('on')) v.hidden = true; }, 400);
  }
  $('dialogo-veu').addEventListener('click', function (e) {
    if (e.target === $('dialogo-veu') || e.target.closest('[data-fechar-dialogo]')) fecharDialogo();
  });

  var pedidoInstalar = null;
  var ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var instalado = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  if (instalado) $('btn-instalar').hidden = true;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(function () {});
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); pedidoInstalar = e; });
  window.addEventListener('appinstalled', function () { $('btn-instalar').hidden = true; aviso('App instalado na tela inicial'); });
  $('btn-instalar').addEventListener('click', function () {
    abrirMenu(false);
    if (pedidoInstalar) {
      pedidoInstalar.prompt();
      pedidoInstalar.userChoice.finally(function () { pedidoInstalar = null; });
      return;
    }
    abrirDialogo('<h3>Instalar o app</h3>' + (ehIOS
      ? '<ol class="passos"><li>Abra este painel no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b> (o quadrado com a seta para cima).</li><li>Escolha <b>Adicionar à Tela de Início</b> e confirme.</li></ol>'
      : '<p>No Chrome, toque nos três pontinhos e em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</p>') +
      '<button class="btn cheio toque" data-fechar-dialogo>Fechar</button>');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('dialogo-veu').hidden) fecharDialogo();
    else if (!$('folha').hidden) fecharFolha();
    else abrirMenu(false);
  });
  window.addEventListener('hashchange', function () {
    var v = location.hash.replace('#', '');
    if (v && v !== E.vista && TITULOS[v]) irPara(v);
  });

  api('GET', '/api/receber').then(mostrarApp).catch(mostrarLogin);
})();
