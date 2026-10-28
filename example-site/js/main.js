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
