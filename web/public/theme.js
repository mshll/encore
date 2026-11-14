(function () {
  var pref = null;
  try { pref = localStorage.getItem("encore-theme"); } catch (e) { pref = null; }
  var dark = pref === "dark" || (pref !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  if (pref === "light" || pref === "dark") {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].content = dark ? "#111111" : "#ffffff";
  }
})();
