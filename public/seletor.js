(function () {
  var FUSO = 'America/Sao_Paulo';
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MESES_C = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  var SEMANA = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  var $ = function (id) { return document.getElementById(id); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var ymd = function (a, m, d) { return a + '-' + pad(m + 1) + '-' + pad(d); };
  function hoje(desloc) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO }).format(new Date(Date.now() + (desloc || 0) * 86400000));
  }
  function curta(s) { var p = s.split('-'); return Number(p[2]) + ' ' + MESES_C[Number(p[1]) - 1]; }
  function ultimoDia(a, m) { return new Date(Date.UTC(a, m + 1, 0)).getUTCDate(); }
  function chevron() { return '<svg class="sel-seta" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'; }
  function check() { return '<svg class="sel-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>'; }
  var seta = function (lado) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="' + (lado < 0 ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6') + '"/></svg>'; };

  var aberto = null;
  var veu = document.createElement('div');
  veu.className = 'sel-veu';
  document.body.appendChild(veu);
  veu.addEventListener('click', function () { fechar(); });

  function fechar() {
    if (!aberto) return;
    aberto.caixa.classList.remove('on');
    aberto.menu.hidden = true;
    veu.classList.remove('on');
    aberto = null;
  }
  document.addEventListener('click', function (e) { if (aberto && !aberto.caixa.contains(e.target)) fechar(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') fechar(); });
  window.addEventListener('resize', fechar);

  function abrir(s) {
    if (aberto === s) { fechar(); return; }
    fechar();
    if (s.antesDeAbrir) s.antesDeAbrir();
    s.desenhar();
    s.menu.hidden = false;
    s.caixa.classList.add('on');
    if (window.innerWidth < 640) veu.classList.add('on');
    s.menu.classList.remove('a-direita');
    var r = s.menu.getBoundingClientRect();
    if (window.innerWidth >= 640 && r.right > window.innerWidth - 12) s.menu.classList.add('a-direita');
    aberto = s;
  }

  function trocar(select, valor) {
    select.value = valor;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function montar(select, opcoes) {
    var label = select.closest('label');
    var caixa = document.createElement('div');
    caixa.className = label.className + ' sel';
    if (label.hidden) caixa.hidden = true;
    var icone = label.querySelector('svg.icone');
    caixa.innerHTML = '<button type="button" class="sel-botao" aria-haspopup="true">' + (icone ? icone.outerHTML : '') + '<span class="sel-texto"></span>' + chevron() + '</button><div class="sel-menu" hidden></div>';
    label.parentNode.replaceChild(caixa, label);
    select.hidden = true;
    caixa.appendChild(select);
    var s = { select: select, caixa: caixa, botao: caixa.querySelector('.sel-botao'), texto: caixa.querySelector('.sel-texto'), menu: caixa.querySelector('.sel-menu') };
    s.botao.addEventListener('click', function () { abrir(s); });
    s.menu.addEventListener('click', function (e) { e.stopPropagation(); });
    s.lista = function () {
      return [].map.call(select.options, function (o) {
        if (opcoes && opcoes.pular && opcoes.pular.indexOf(o.value) >= 0) return '';
        return '<button type="button" class="sel-opcao' + (o.value === select.value ? ' ativo' : '') + '" data-v="' + o.value + '"><span>' + o.textContent + '</span>' + check() + '</button>';
      }).join('');
    };
    s.ligarLista = function () {
      s.menu.querySelectorAll('.sel-opcao').forEach(function (b) {
        b.addEventListener('click', function () { fechar(); trocar(select, b.getAttribute('data-v')); s.rotular(); });
      });
    };
    s.rotular = function () { var o = select.options[select.selectedIndex]; s.texto.textContent = o ? o.textContent : ''; };
    s.desenhar = function () { s.menu.innerHTML = '<div class="sel-opcoes">' + s.lista() + '</div>'; s.ligarLista(); };
    s.rotular();
    return s;
  }

  ['f-plataforma', 'f-metodo'].forEach(function (id) { if ($(id)) montar($(id)); });

  var per = $('periodo');
  if (!per) return;
  var s = montar(per, { pular: ['livre'] });
  var cal = { a: 0, m: 0, inicio: null, modo: 'dias' };

  function faixaAtual() {
    var h = hoje(0), v = per.value;
    if (v === 'hoje') return [h, h];
    if (v === 'ontem') return [hoje(-1), hoje(-1)];
    if (v === '7') return [hoje(-6), h];
    if (v === '30') return [hoje(-29), h];
    if (v === 'mes') return [h.slice(0, 8) + '01', h];
    if (v === 'mes-passado') {
      var a = Number(h.slice(0, 4)), m = Number(h.slice(5, 7)) - 2;
      if (m < 0) { m = 11; a--; }
      return [ymd(a, m, 1), ymd(a, m, ultimoDia(a, m))];
    }
    var de = $('data-de').value || h, ate = $('data-ate').value || h;
    return de > ate ? [ate, de] : [de, ate];
  }

  s.rotular = function () {
    if (per.value !== 'livre') { var o = per.options[per.selectedIndex]; s.texto.textContent = o ? o.textContent : ''; return; }
    var f = faixaAtual();
    if (f[0] === f[1]) { s.texto.textContent = curta(f[0]) + (f[0].slice(0, 4) !== hoje(0).slice(0, 4) ? ' ' + f[0].slice(0, 4) : ''); return; }
    var mesmoMes = f[0].slice(0, 7) === f[1].slice(0, 7);
    var inteiro = mesmoMes && f[0].slice(8) === '01' && Number(f[1].slice(8)) === ultimoDia(Number(f[1].slice(0, 4)), Number(f[1].slice(5, 7)) - 1);
    if (inteiro) { var mm = Number(f[0].slice(5, 7)) - 1; s.texto.textContent = MESES[mm].charAt(0).toUpperCase() + MESES[mm].slice(1) + ' ' + f[0].slice(0, 4); return; }
    s.texto.textContent = mesmoMes ? Number(f[0].slice(8)) + ' a ' + curta(f[1]) : curta(f[0]) + ' a ' + curta(f[1]);
  };

  s.antesDeAbrir = function () {
    var f = faixaAtual();
    cal.a = Number(f[1].slice(0, 4)); cal.m = Number(f[1].slice(5, 7)) - 1;
    cal.inicio = null; cal.modo = 'dias';
  };

  function aplicar(de, ate) {
    if (de > ate) { var t = de; de = ate; ate = t; }
    $('data-de').value = de;
    $('data-ate').value = ate;
    try { localStorage.setItem('fin-datas', de + '|' + ate); } catch (e) {}
    fechar();
    trocar(per, 'livre');
    s.rotular();
  }

  function calendario() {
    var h = hoje(0);
    var topo = '<div class="cal-topo"><button type="button" class="cal-nav" data-nav="-1" aria-label="Anterior">' + seta(-1) + '</button>' +
      '<button type="button" class="cal-titulo" data-modo>' + (cal.modo === 'dias' ? MESES[cal.m] + ' ' + cal.a : cal.a) + chevron() + '</button>' +
      '<button type="button" class="cal-nav" data-nav="1" aria-label="Próximo">' + seta(1) + '</button></div>';
    if (cal.modo === 'meses') {
      var ms = MESES_C.map(function (n, i) {
        var futuro = ymd(cal.a, i, 1) > h;
        return '<button type="button" class="cal-mes' + (cal.a === Number(h.slice(0, 4)) && i === Number(h.slice(5, 7)) - 1 ? ' hoje' : '') + '" data-mes="' + i + '"' + (futuro ? ' disabled' : '') + '>' + n + '</button>';
      }).join('');
      return topo + '<div class="cal-meses">' + ms + '</div>';
    }
    var f = cal.inicio ? [cal.inicio, cal.inicio] : faixaAtual();
    var primeiro = new Date(Date.UTC(cal.a, cal.m, 1)).getUTCDay();
    var total = ultimoDia(cal.a, cal.m);
    var cel = SEMANA.map(function (d) { return '<span class="cal-sem">' + d + '</span>'; }).join('');
    for (var i = 0; i < primeiro; i++) cel += '<span></span>';
    for (var d = 1; d <= total; d++) {
      var dia = ymd(cal.a, cal.m, d);
      var cls = 'cal-dia';
      if (dia === h) cls += ' hoje';
      if (dia >= f[0] && dia <= f[1]) cls += ' dentro';
      if (dia === f[0]) cls += ' ini';
      if (dia === f[1]) cls += ' fim';
      cel += '<button type="button" class="' + cls + '" data-dia="' + dia + '"' + (dia > h ? ' disabled' : '') + '>' + d + '</button>';
    }
    var ultimoMes = ymd(cal.a, cal.m, 1) === h.slice(0, 8) + '01';
    return topo + '<div class="cal-grade">' + cel + '</div>' +
      '<p class="cal-dica">' + (cal.inicio ? 'Agora toque no último dia. Para ver só ' + curta(cal.inicio) + ', toque nele de novo.' : 'Toque no primeiro e no último dia. Para um dia só, toque nele duas vezes.') + '</p>' +
      '<button type="button" class="cal-inteiro" data-inteiro>Ver ' + MESES[cal.m] + ' inteiro' + (ultimoMes ? ' até hoje' : '') + '</button>';
  }

  s.desenhar = function () {
    s.menu.classList.add('sel-periodo-menu');
    s.menu.innerHTML = '<div class="sel-opcoes">' + s.lista() + '</div><div class="sel-cal">' + calendario() + '</div>';
    s.ligarLista();
    var c = s.menu.querySelector('.sel-cal');
    c.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.hasAttribute('data-nav')) {
        var n = Number(b.getAttribute('data-nav'));
        if (cal.modo === 'meses') cal.a += n;
        else { cal.m += n; if (cal.m < 0) { cal.m = 11; cal.a--; } if (cal.m > 11) { cal.m = 0; cal.a++; } }
      } else if (b.hasAttribute('data-modo')) {
        cal.modo = cal.modo === 'dias' ? 'meses' : 'dias';
      } else if (b.hasAttribute('data-mes')) {
        cal.m = Number(b.getAttribute('data-mes')); cal.modo = 'dias';
      } else if (b.hasAttribute('data-inteiro')) {
        var h = hoje(0), fim = ymd(cal.a, cal.m, ultimoDia(cal.a, cal.m));
        aplicar(ymd(cal.a, cal.m, 1), fim > h ? h : fim);
        return;
      } else if (b.hasAttribute('data-dia')) {
        var dia = b.getAttribute('data-dia');
        if (!cal.inicio) { cal.inicio = dia; }
        else { aplicar(cal.inicio, dia); return; }
      }
      c.innerHTML = calendario();
    });
  };

  per.addEventListener('change', function () { s.rotular(); });
  s.rotular();
})();
