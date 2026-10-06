/* Раскладывает библиотеки из node_modules в tests/vendor под теми именами,
   которых ждёт build.py. Версии закреплены в package.json — те же, что
   стоят в разметке приложения, иначе build.py не сойдётся по integrity. */
const fs = require('fs');
const path = require('path');

const ЗДЕСЬ = __dirname;
const ЦЕЛЬ = path.join(ЗДЕСЬ, 'vendor');
const ФАЙЛЫ = [
    ['fflate/umd/index.js',              'fflate.js'],
    ['dagre/dist/dagre.min.js',          'dagre.min.js'],
    ['cytoscape/dist/cytoscape.min.js',  'cytoscape.min.js'],
    ['cytoscape-dagre/cytoscape-dagre.js', 'cytoscape-dagre.js'],
    ['xlsx/dist/xlsx.full.min.js',       'xlsx.full.min.js'],
];

fs.mkdirSync(ЦЕЛЬ, { recursive: true });
let нет = [];
for (const [откуда, куда] of ФАЙЛЫ) {
    const src = path.join(ЗДЕСЬ, 'node_modules', откуда);
    if (!fs.existsSync(src)) { нет.push(откуда); continue; }
    fs.copyFileSync(src, path.join(ЦЕЛЬ, куда));
    console.log('  ' + куда.padEnd(22) + fs.statSync(src).size + ' байт');
}
if (нет.length) {
    console.error('\nНе найдено в node_modules: ' + нет.join(', ') + '\nСначала: npm install');
    process.exit(1);
}
