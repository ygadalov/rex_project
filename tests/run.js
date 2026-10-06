#!/usr/bin/env node
/* Прогон всех наборов. Каждый набор — отдельный файл в suites/, который
   экспортирует функцию и возвращает число провалов.

       node run.js                # все наборы
       node run.js graph quality  # только названные

   Наборы идут по очереди, а не разом: каждый поднимает свой Chromium, и
   на пяти сразу браузеры начинают падать от нехватки памяти — проверки
   тогда «валятся» не по делу. */
const fs = require('fs');
const path = require('path');

const ПАПКА = path.join(__dirname, 'suites');

(async () => {
    const спрошены = process.argv.slice(2);
    const наборы = fs.readdirSync(ПАПКА).filter(f => f.endsWith('.js')).sort()
        .filter(f => !спрошены.length || спрошены.some(s => f === s || f === s + '.js'));

    if (!наборы.length) {
        console.error('Нечего запускать. Есть: ' +
            fs.readdirSync(ПАПКА).filter(f => f.endsWith('.js')).join(', '));
        process.exit(2);
    }
    if (!fs.existsSync(path.join(__dirname, 'build', 'app.html'))) {
        console.error('Нет сборки. Сначала: python3 tests/build.py');
        process.exit(2);
    }

    const начало = Date.now();
    const итоги = [];
    for (const файл of наборы) {
        console.log('\n═══════════ ' + файл);
        const t0 = Date.now();
        let провалов;
        try {
            провалов = await require(path.join(ПАПКА, файл))();
        } catch (e) {
            console.log('  ✗ набор упал: ' + (e && e.message ? e.message.split('\n')[0] : e));
            провалов = 1;
        }
        итоги.push({ файл, провалов, сек: ((Date.now() - t0) / 1000).toFixed(1) });
    }

    console.log('\n═══════════ ИТОГ');
    итоги.forEach(и => console.log('  ' + (и.провалов ? '✗' : '✓') + ' ' +
        и.файл.replace('.js', '').padEnd(12) + и.сек + ' с' +
        (и.провалов ? '   провалов: ' + и.провалов : '')));
    const всего = итоги.reduce((a, и) => a + и.провалов, 0);
    console.log('\n  наборов: ' + итоги.length + ', время: ' +
        ((Date.now() - начало) / 1000).toFixed(0) + ' с');
    console.log(всего ? '\n❌ ПРОВАЛОВ: ' + всего : '\n✅ ВСЁ ЗЕЛЁНОЕ');
    process.exit(всего ? 1 : 0);
})();
