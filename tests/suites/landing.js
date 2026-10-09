/* Страница index.html для GitHub Pages.

   Проверка существует ради одной вещи, которая ломается молча: ссылки на
   сам инструмент зашиты в страницу именем файла, а имя меняется с каждой
   версией. Выпустили v2.4.7, забыли поправить страницу — кнопка «Открыть»
   ведёт в никуда, и узнаёт об этом первый, кто её нажмёт. */
const fs = require('fs');
const path = require('path');
const { браузер, счёт } = require('../harness');

const КОРЕНЬ = path.join(__dirname, '..', '..');

module.exports = async function () {
    const t = счёт('Страница проекта');
    const стр = path.join(КОРЕНЬ, 'index.html');
    if (!fs.existsSync(стр)) { console.log('  ✗ index.html не найден'); return 1; }

    const приложение = fs.readdirSync(КОРЕНЬ).filter(f => /^REX_v[\d.]+\.html$/.test(f)).sort();
    const текущее = приложение[приложение.length - 1];

    const b = await браузер();
    const pg = await b.newPage({ viewport: { width: 1450, height: 950 } });
    const ошибки = [];
    pg.on('pageerror', e => ошибки.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/ERR_|net::/.test(m.text())) ошибки.push(m.text()); });
    await pg.goto('file://' + стр);
    await pg.waitForTimeout(500);

    t.раздел('Ссылки ведут на тот файл, который в репозитории лежит');
    const ссылки = await pg.evaluate(() =>
        [...document.querySelectorAll('a[href]')].map(a => ({
            href: a.getAttribute('href'), текст: a.innerText.trim().slice(0, 30),
            скачивание: a.hasAttribute('download') })));
    const свои = ссылки.filter(a => !/^https?:/.test(a.href));
    console.log('     ' + свои.map(a => a.href + (a.скачивание ? ' [download]' : '')).join('  '));
    t.ok(приложение.length === 1,
         'в репозитории ровно одна версия инструмента: ' + приложение.join(', '));
    t.ok(свои.length >= 2, 'на странице есть ссылки на сам инструмент: ' + свои.length);
    const битые = свои.filter(a => !fs.existsSync(path.join(КОРЕНЬ, a.href)));
    t.ok(!битые.length, 'ни одна не ведёт в никуда'
         + (битые.length ? ' — ' + битые.map(a => a.href).join(', ') : ''));
    t.ok(свои.every(a => a.href === текущее), 'все указывают на текущую версию ' + текущее);
    t.ok(свои.some(a => a.скачивание),
         'у кнопки «скачать» есть атрибут download — иначе браузер покажет исходник текстом');

    t.раздел('Версия в тексте совпадает с версией файла');
    const вТексте = await pg.evaluate(() => (document.body.innerText.match(/v\d+\.\d+\.\d+/) || [])[0]);
    t.ok(вТексте === 'v' + текущее.replace(/^REX_v|\.html$/g, ''),
         'подпись версии: ' + вТексте + ' при файле ' + текущее);

    t.раздел('Разметка для ссылки и поиска');
    const мета = await pg.evaluate(() => ({
        титул: document.title,
        описание: (document.querySelector('meta[name="description"]') || {}).content || '',
        og: !!document.querySelector('meta[property="og:title"]'),
        значок: !!document.querySelector('link[rel="icon"]'),
        язык: document.documentElement.lang,
    }));
    t.ok(/REX/.test(мета.титул) && мета.титул.length > 10, 'заголовок страницы: ' + мета.титул);
    t.ok(мета.описание.length > 60, 'описание для поиска на месте');
    t.ok(мета.og && мета.значок && мета.язык === 'ru', 'og-разметка, значок и язык проставлены');

    t.раздел('Вёрстка держится от десктопа до телефона');
    for (const ш of [1450, 1024, 768, 400, 360]) {
        await pg.setViewportSize({ width: ш, height: 900 });
        await pg.waitForTimeout(350);
        const r = await pg.evaluate(() => ({
            лишнее: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            вылезли: [...document.querySelectorAll('*')]
                .filter(e => e.getBoundingClientRect().right > innerWidth + 1)
                .slice(0, 2).map(e => e.tagName + '.' + String(e.className).slice(0, 18)),
        }));
        t.ok(r.лишнее <= 0, ш + 'px: без горизонтальной прокрутки'
             + (r.лишнее > 0 ? ' — лишних ' + r.лишнее + 'px: ' + r.вылезли.join(', ') : ''));
    }

    t.раздел('Раздел про конвертер на месте и не врёт про возможности');
    const кв = await pg.evaluate(() => {
        const з = [...document.querySelectorAll('h2')].find(h => /конвертер/i.test(h.textContent));
        if (!з) return null;
        const раздел = з.closest('section');
        const файлы = [...раздел.querySelectorAll('.tr-file')];
        return {
            заголовок: з.textContent.trim(),
            метка: getComputedStyle(з, '::before').backgroundColor,
            строкФайлов: файлы.length,
            папок: раздел.querySelectorAll('.tr-row:not(.tr-file)').length,
            сКонвертацией: файлы.filter(r => /\.xls\b/.test(r.innerText) &&
                                             /\.xlsb/.test(r.innerText)).length,
            ограничения: (раздел.querySelector('.cv-limits') || {}).innerText || '',
            текст: раздел.innerText,
        };
    });
    t.ok(кв, 'раздел про конвертер есть');
    // У перечисления «показывает — разбирает — и говорит» метка синяя. Конвертер
    // в это перечисление не входит, и метка у него другая — иначе он читался бы
    // как четвёртый пункт списка, которым не является.
    const синие = await pg.evaluate(() =>
        [...document.querySelectorAll('h2.pair')].map(h => getComputedStyle(h, '::before').backgroundColor));
    t.ok(кв && синие.length === 3 && синие.every(c => c === синие[0]) && кв.метка !== синие[0],
         'метка у конвертера отличается от метки трёх разделов разбора');
    t.ok(кв && кв.строкФайлов >= 5 && кв.папок >= 4,
         'дерево папок нарисовано: файлов ' + (кв || {}).строкФайлов + ', папок ' + (кв || {}).папок);
    t.ok(кв && кв.сКонвертацией === кв.строкФайлов,
         'в каждой строке видно «было → стало»');
    t.ok(кв && /Power Query/.test(кв.текст), 'названа задача, ради которой это делается');
    // Конвертер теряет оформление и требует Chromium — умолчать об этом нельзя.
    t.ok(кв && /теряются/.test(кв.ограничения) && /формулы/i.test(кв.ограничения),
         'сказано, что теряется при конвертации');
    t.ok(кв && /Chrome|Edge/.test(кв.ограничения),
         'сказано, что нужен Chrome или Edge');

    t.раздел('Оговорка про сам разбор');
    /* Страница продаёт инструмент, а инструмент знает не всё. Человек,
       прочитавший «Ошибки 0» как «ошибок нет», уже один раз на это попался —
       и это было написано не на странице, а в самом REX. Теперь и здесь. */
    const огв = await pg.evaluate(() => {
        const el = document.querySelector('.an-limits');
        return el ? el.innerText.replace(/\s+/g, ' ') : '';
    });
    t.ok(/балл/i.test(огв) && /хуже некуда/i.test(огв),
         'сказано, что индекс здоровья — баллы, а не счётчик находок');
    t.ok(/больш/i.test(огв) && /по ячейкам/i.test(огв),
         'сказано, что очень большой лист по ячейкам не читается');
    t.ok(/VBA/.test(огв) && /DAX/.test(огв), 'сказано про VBA и DAX');

    t.раздел('Число правил на странице совпадает с тем, что в инструменте');
    /* Число правил зашито в страницу словами. Правило добавили — страница
       осталась со старым числом и тихо занижает инструмент: так «пятнадцать»
       прожило до двадцати одного правила. */
    const СЛОВА = { 'пятнадцать': 15, 'шестнадцать': 16, 'семнадцать': 17, 'восемнадцать': 18,
                    'девятнадцать': 19, 'двадцать': 20, 'двадцать одно': 21, 'двадцать два': 22,
                    'двадцать три': 23, 'двадцать четыре': 24, 'двадцать пять': 25 };
    const текстСтр = await pg.evaluate(() => document.body.innerText);
    const названо = Object.keys(СЛОВА).sort((a, b) => b.length - a.length)
        .find(w => new RegExp('(^|[^а-яё])' + w + ' правил', 'i').test(текстСтр));
    // Правило в REX — это вызов add({ id: '…', category: '…', severity: '…' }).
    // Считаем по этой тройке: id встречается в коде и у других вещей.
    const вПрограмме = new Set(
        (fs.readFileSync(path.join(КОРЕНЬ, текущее), 'utf8')
            .match(/add\(\{\s*id: '([a-z0-9-]+)', category:/g) || [])
            .map(x => /id: '([a-z0-9-]+)'/.exec(x)[1])).size;
    t.ok(названо, 'число правил на странице названо словом: ' + (названо || '—'));
    t.ok(названо && СЛОВА[названо] === вПрограмме,
         'на странице ' + СЛОВА[названо] + ', в инструменте ' + вПрограмме);

    t.раздел('Схема связей нарисована, а не подставлена картинкой');
    const схема = await pg.evaluate(() => {
        const svg = document.querySelector('svg.net');
        if (!svg) return null;
        return { узлов: svg.querySelectorAll('g > circle').length,
                 связей: svg.querySelectorAll('path[marker-end]').length,
                 подписей: svg.querySelectorAll('text').length,
                 описание: svg.getAttribute('aria-label') || '' };
    });
    t.ok(схема && схема.узлов >= 8 && схема.связей >= 7,
         'узлов ' + (схема || {}).узлов + ', связей ' + (схема || {}).связей);
    t.ok(схема && схема.подписей === схема.узлов, 'каждый узел подписан');
    t.ok(схема && схема.описание.length > 30, 'у схемы есть текстовое описание для читалок');

    await pg.close();
    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
