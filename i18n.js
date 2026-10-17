(function () {
  var S = {
    en: {
      newTab: 'New tab', back: 'Back', forward: 'Forward', reload: 'Reload', downloads: 'Downloads', settings: 'Settings',
      addressPlaceholder: 'Search or enter an address', closeTab: 'Close tab', mute: 'Mute tab', unmute: 'Unmute',
      customize: 'Customize', newShortcut: 'New shortcut', namePlaceholder: 'Name (optional)',
      urlPlaceholder: 'Address, for example wikipedia.org', cancel: 'Cancel', add: 'Add',
      theme: 'Theme', shortcuts: 'Shortcuts', showShortcuts: 'Show shortcuts', showNames: 'Show names',
      theme_actual: 'Fox', theme_grafito: 'Helio', theme_oceano: 'Ocean', theme_bosque: 'Forest',
      theme_violeta: 'Violet', theme_ambar: 'Amber', theme_rosa: 'Rose',
      loadFail: 'Could not load the shortcuts.', removeShortcut: 'Remove shortcut', addShortcut: 'Add shortcut',
      searchingIcon: 'Looking for the icon...', invalidAddress: 'That address is not valid.',
      historyTitle: 'History', searchHistory: 'Search history', clearAll: 'Clear all',
      today: 'Today', yesterday: 'Yesterday', noResults: 'No results', noHistory: 'No history yet',
      removeHistory: 'Remove from history', clearHistoryConfirm: 'Clear all history?',
      searchDownloads: 'Search downloads', clearList: 'Clear list', completed: 'Completed', cancelled: 'Cancelled',
      interrupted: 'Interrupted', paused: 'Paused', of: 'of', noDownloads: 'No downloads yet',
      open: 'Open', showInFolder: 'Show in folder', removeFromList: 'Remove from list',
      openFail: 'Could not open the file. It may have been moved or deleted.',
      clearConfirm: 'Remove finished downloads from the list? The files will not be deleted.'
    },
    es: {
      newTab: 'Nueva pesta\u00f1a', back: 'Atr\u00e1s', forward: 'Adelante', reload: 'Recargar', downloads: 'Descargas', settings: 'Configuraci\u00f3n',
      addressPlaceholder: 'Busca o escribe una direcci\u00f3n', closeTab: 'Cerrar pesta\u00f1a', mute: 'Silenciar pesta\u00f1a', unmute: 'Activar sonido',
      customize: 'Personalizar', newShortcut: 'Nuevo acceso directo', namePlaceholder: 'Nombre (opcional)',
      urlPlaceholder: 'Direcci\u00f3n, por ejemplo wikipedia.org', cancel: 'Cancelar', add: 'A\u00f1adir',
      theme: 'Tema', shortcuts: 'Accesos directos', showShortcuts: 'Mostrar accesos directos', showNames: 'Mostrar nombres',
      theme_actual: 'Fox', theme_grafito: 'Helio', theme_oceano: 'Oc\u00e9ano', theme_bosque: 'Bosque',
      theme_violeta: 'Violeta', theme_ambar: '\u00c1mbar', theme_rosa: 'Rosa',
      loadFail: 'No se pudieron cargar los accesos directos.', removeShortcut: 'Quitar acceso directo', addShortcut: 'A\u00f1adir acceso directo',
      searchingIcon: 'Buscando el icono...', invalidAddress: 'Esa direcci\u00f3n no es v\u00e1lida.',
      historyTitle: 'Historial', searchHistory: 'Buscar en el historial', clearAll: 'Borrar todo',
      today: 'Hoy', yesterday: 'Ayer', noResults: 'Sin resultados', noHistory: 'A\u00fan no hay historial',
      removeHistory: 'Quitar del historial', clearHistoryConfirm: '\u00bfBorrar todo el historial?',
      searchDownloads: 'Buscar en las descargas', clearList: 'Borrar lista', completed: 'Completada', cancelled: 'Cancelada',
      interrupted: 'Interrumpida', paused: 'En pausa', of: 'de', noDownloads: 'A\u00fan no hay descargas',
      open: 'Abrir', showInFolder: 'Mostrar en carpeta', removeFromList: 'Quitar de la lista',
      openFail: 'No se pudo abrir el archivo. Puede que lo hayas movido o borrado.',
      clearConfirm: 'Quitar de la lista las descargas terminadas? Los archivos no se borran.'
    }
  };
  var lang = 'en';
  window.setLang = function (l) {
    lang = (l === 'es') ? 'es' : 'en';
    document.documentElement.lang = lang;
  };
  window.L = function (key) {
    var d = S[lang];
    if (d && d[key] !== undefined) return d[key];
    return (S.en[key] !== undefined) ? S.en[key] : key;
  };
  window.getLocale = function () { return lang === 'es' ? 'es-ES' : 'en-GB'; };
})();
