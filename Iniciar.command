#!/bin/zsh
cd "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  print 'No se encontro Node.js. Instalar la version LTS desde https://nodejs.org'
  read -r '?Presiona Enter para cerrar.'
  exit 1
fi
npm install --no-audit --no-fund || exit 1
npm run build || exit 1
npm start