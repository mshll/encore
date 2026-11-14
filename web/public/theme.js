(function () {
  var pref = null;
  try { pref = localStorage.getItem("encore-theme"); } catch (e) { pref = null; }
  var dark = pref === "dark" || (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();
