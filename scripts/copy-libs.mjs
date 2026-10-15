// Copia bibliotecas de terceiros de node_modules para www/lib
import { mkdirSync, copyFileSync } from 'node:fs';

mkdirSync('www/lib', { recursive: true });
copyFileSync('node_modules/@zxing/library/umd/index.min.js', 'www/lib/zxing.min.js');
console.log('Bibliotecas copiadas para www/lib');
