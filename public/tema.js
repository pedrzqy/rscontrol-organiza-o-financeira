(function () {
  var salvo = null;
  try { salvo = localStorage.getItem('fin-tema'); } catch (e) {}
  var escuro = salvo ? salvo === 'escuro' : !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (escuro) document.documentElement.setAttribute('data-tema', 'escuro');
})();
