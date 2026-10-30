// Opens and closes the menu on small screens.
document.querySelectorAll('.menu-toggle').forEach(function (button) {
  button.addEventListener('click', function () {
    var menu = document.getElementById(button.getAttribute('aria-controls'));
    var open = menu.classList.toggle('open');
    button.setAttribute('aria-expanded', open);
  });
});

// Keeps the year in the footer current.
var year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

// Fades sections in when they scroll into view.
var observer = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) entry.target.classList.add('visible');
  });
}, { threshold: 0.1 });
document.querySelectorAll('.reveal').forEach(function (el) { observer.observe(el); });

// Builds tab buttons from the panels' data-title.
document.querySelectorAll('[data-tabs]').forEach(function (tabs) {
  var buttons = tabs.querySelector('.tab-buttons');
  var panels = tabs.querySelectorAll('.tab-panel');
  panels.forEach(function (panel, i) {
    var button = document.createElement('button');
    button.textContent = panel.getAttribute('data-title');
    button.addEventListener('click', function () {
      panels.forEach(function (p) { p.classList.remove('active'); });
      buttons.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
      panel.classList.add('active');
      button.classList.add('active');
    });
    buttons.appendChild(button);
    if (i === 0) button.click();
  });
});
