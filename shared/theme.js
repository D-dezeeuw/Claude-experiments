/**
 * Shared dark/light theme toggle for Claude Experiments.
 * Uses localStorage to persist preference. Defaults to dark.
 * Include this script and call initTheme() on DOMContentLoaded.
 */

function initTheme() {
  const stored = localStorage.getItem('claude-experiments-theme');
  if (stored === 'light') {
    document.documentElement.classList.remove('dark');
  } else {
    document.documentElement.classList.add('dark');
  }
  createToggleButton();
}

function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('claude-experiments-theme', isDark ? 'dark' : 'light');
  updateToggleIcon();
}

function createToggleButton() {
  const btn = document.createElement('button');
  btn.id = 'theme-toggle';
  btn.onclick = toggleTheme;
  btn.className = 'fixed top-4 right-4 z-50 p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-pointer';
  btn.setAttribute('aria-label', 'Toggle theme');
  document.body.appendChild(btn);
  updateToggleIcon();
}

function updateToggleIcon() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = document.documentElement.classList.contains('dark');
  // Sun icon for dark mode (click to go light), moon for light mode (click to go dark)
  btn.innerHTML = isDark
    ? '<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m8.66-13.66l-.71.71M4.05 19.95l-.71.71M21 12h-1M4 12H3m16.66 7.66l-.71-.71M4.05 4.05l-.71-.71M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>'
    : '<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/></svg>';
}

document.addEventListener('DOMContentLoaded', initTheme);
