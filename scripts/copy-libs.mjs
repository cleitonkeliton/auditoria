// Copia bibliotecas de terceiros de node_modules para www/lib (o app não usa bundler).
import { mkdirSync, copyFileSync, rmSync } from 'node:fs';

const arquivos = {
  'capacitor.js': 'node_modules/@capacitor/core/dist/capacitor.js',
  'capacitor-app.js': 'node_modules/@capacitor/app/dist/plugin.js',
  'barcode-scanning.js': 'node_modules/@capacitor-mlkit/barcode-scanning/dist/plugin.js',
};

rmSync('www/lib', { recursive: true, force: true });
mkdirSync('www/lib', { recursive: true });
for (const [destino, origem] of Object.entries(arquivos)) {
  copyFileSync(origem, 'www/lib/' + destino);
}
console.log('Bibliotecas copiadas para www/lib');
