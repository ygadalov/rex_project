/* Общая обвязка для наборов проверок.

   Каждый набор — отдельный файл в suites/, который получает готовую
   страницу с уже разобранной книгой и говорит, что должно быть правдой.
   Обвязка держит на себе три вещи, в которых легко ошибиться поодиночке:
   ожидание конца разбора (а не «подождём три секунды»), сбор ошибок
   консоли и единый счёт провалов. */
const path = require('path');

const КОРЕНЬ = __dirname;
const СТРАНИЦА = 'file://' + path.join(КОРЕНЬ, 'build', 'app.html');
const КНИГИ = path.join(КОРЕНЬ, 'fixtures');

function браузер() {
    const { chromium } = require('playwright-core');
    // В контейнерах Playwright кладёт Chromium сюда; на машине разработчика
    // путь берётся из его собственной установки.
    const свой = process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium';
    const fs = require('fs');
    const опции = {
        // Chromium по дороге ходит за своими списками на google.com. В закрытой
        // сети эти запросы падают и попадают в консоль как ошибки страницы —
        // проверки начинают валиться не из-за приложения.
        args: ['--disable-component-update', '--disable-background-networking',
               '--disable-sync', '--no-first-run', '--no-default-browser-check'],
    };
    if (fs.existsSync(свой)) опции.executablePath = свой;
    return chromium.launch(опции);
}

/* Сообщения, которые пишет не приложение, а сам браузер: сетевые запросы
   Chromium наружу и отказ по сертификату прокси. К REX отношения не имеют. */
const ЧУЖИЕ = [/ERR_CERT_/, /ERR_(INTERNET|NAME|NETWORK|CONNECTION|PROXY|BLOCKED|TUNNEL)/,
               /Failed to load resource.*(google|gstatic|googleapis)/i];

/** Открыть приложение и разобрать книги. Возвращает страницу и журнал ошибок. */
async function открыть(браузерЭкз, книги, { ширина = 1450, высота = 950 } = {}) {
    const список = Array.isArray(книги) ? книги : [книги];
    const pg = await браузерЭкз.newPage({ viewport: { width: ширина, height: высота } });
    const ошибки = [];
    pg.on('pageerror', e => ошибки.push('PAGEERROR ' + e.message));
    pg.on('console', m => {
        if (m.type() !== 'error') return;
        const txt = m.text();
        if (ЧУЖИЕ.some(re => re.test(txt))) return;
        ошибки.push(txt.slice(0, 200));
    });
    await pg.goto(СТРАНИЦА);
    // APP объявлен через const на верхнем уровне обычного скрипта: такое
    // имя доступно как глобальное, но в window не попадает — проверяем его
    // самого, а не window.APP.
    await pg.waitForFunction(() => typeof APP !== 'undefined' && typeof fflate !== 'undefined',
                             null, { timeout: 30000 });

    for (let i = 0; i < список.length; i++) {
        const до = await pg.evaluate(() => APP.books.length);
        await pg.setInputFiles(i === 0 ? '#file-input' : '#file-add', path.join(КНИГИ, список[i]));
        // Разбор окончен, когда книга появилась в APP.books и страницы открылись
        await pg.waitForFunction(n => APP.books.length > n, до, { timeout: 120000 });
        await pg.waitForFunction(() => !document.querySelector('.nav-item[data-page="overview"]').disabled,
                                 null, { timeout: 30000 });
    }
    // граф строится в простое — дождёмся, иначе проверки графа гоняют пустоту
    await pg.waitForFunction(() => !document.querySelector('.nav-item[data-page="graph"]').disabled,
                             null, { timeout: 30000 });
    await pg.waitForTimeout(400);
    return { pg, ошибки };
}

/** Перейти на страницу и дождаться, пока она действительно активна. */
async function страница(pg, имя) {
    await pg.evaluate(p => goPage(p), имя);
    await pg.waitForFunction(p => document.querySelector('#page-' + p).classList.contains('active'),
                             имя, { timeout: 15000 });
    await pg.waitForTimeout(250);
}

/** Счётчик проверок одного набора. */
function счёт(название) {
    let провалов = 0;
    return {
        ok(условие, сообщение) {
            console.log((условие ? '  ✓ ' : '  ✗ ') + сообщение);
            if (!условие) провалов++;
        },
        раздел(текст) { console.log('\n── ' + текст); },
        итог(ошибки) {
            if (ошибки && ошибки.length) {
                провалов++;
                console.log('  ✗ ошибки консоли: ' + ошибки.length);
                ошибки.slice(0, 3).forEach(e => console.log('      ' + e));
            } else {
                console.log('\n  ✓ ошибок консоли нет');
            }
            console.log(провалов ? '\n❌ ' + название + ': провалов ' + провалов
                                 : '\n✅ ' + название);
            return провалов;
        },
    };
}

module.exports = { браузер, открыть, страница, счёт, КНИГИ, СТРАНИЦА };
