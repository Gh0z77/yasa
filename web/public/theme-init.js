// Runs before first paint: applies the stored theme and locale so there is no flash.
// Keep in sync with components/common/ThemeProvider.tsx and i18n/index.tsx.
(function () {
  try {
    var root = document.documentElement;
    var theme = localStorage.getItem('yasa:theme');
    // Light is the default; 'system' follows the OS.
    var dark =
      theme === 'system'
        ? !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches)
        : theme === 'dark';
    root.classList.toggle('dark', dark);
    root.style.colorScheme = dark ? 'dark' : 'light';
    var locale = localStorage.getItem('yasa:locale');
    if (locale === 'en' || locale === 'uz' || locale === 'ru') root.lang = locale;
  } catch (e) {
    /* storage unavailable: defaults apply */
  }
})();
