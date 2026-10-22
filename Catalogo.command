#!/bin/zsh
cd "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print 'No se encontro Node.js. Instalar la version LTS desde https://nodejs.org'
  read -r '?Presiona Enter para cerrar.'
  exit 1
fi
print 'Catalogo IPTV Argentina'
print '1. Auditar candidatos, sin consultar streams (recomendado primero)'
print '2. Generar catalogo local de canales con procedencia revisada'
read -r 'choice?Elegir 1 o 2: '
npm install --no-audit --no-fund || exit 1
if [[ "$choice" == "1" ]]; then
  npm run catalog:audit
elif [[ "$choice" == "2" ]]; then
  npm run catalog:generate
else
  print 'Opcion invalida. No se ejecuto el generador.'
fi
print 'Este script no publica ni sube cambios a Internet.'
read -r '?Presiona Enter para cerrar.'