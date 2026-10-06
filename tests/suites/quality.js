/* Качество данных: правила срабатывают на запущенной книге и молчат на
   опрятной. Второе важнее первого — инструмент, который находит проблемы
   везде, бесполезен так же, как тот, который не находит их нигде. */
const { браузер, открыть, страница, счёт } = require('../harness');

const ЖДЁМ = {                     // правило → сколько находок заложено в книгу
    'cell-errors': 2,              // #DIV/0! и #N/A (#REF! уходит в своё правило)
    'ref-broken': 1,               // формула со ссылкой на удалённый лист
    'names-broken': 1,             // видимое имя на #REF!
    'calc-manual': 1,
    'ext-local': 1,                // источник на локальном диске
    'hidden-sheets': 2,            // hidden + veryHidden
    'col-gap': 1,                  // колонка D: три константы среди формул
    'invisible-links': 1,          // ДВССЫЛ
    'volatile': 2,                 // TODAY
    'vba': 1,
    'privacy': 3,                  // автор, правивший, компания
};

module.exports = async function () {
    const t = счёт('Качество данных');
    const b = await браузер();

    t.раздел('Запущенная книга: находки совпадают с заложенным');
    const { pg, ошибки } = await открыть(b, 'messy.xlsm');
    const найдено = await pg.evaluate(() =>
        Object.fromEntries(APP.issues.map(i => [i.id, i.count])));
    Object.entries(ЖДЁМ).forEach(([id, n]) => {
        t.ok(найдено[id] === n, id.padEnd(16) + ' ожидали ' + n + ', нашли ' + (найдено[id] ?? '—'));
    });
    t.ok((найдено['names-hidden'] || 0) >= 30,
         'names-hidden    скрытых имён: ' + найдено['names-hidden']);

    t.раздел('Уровни важности и индекс здоровья');
    const h = await pg.evaluate(() => ({
        здоровье: APP.health.total,
        разделы: APP.health.scores,
        критичных: APP.issues.filter(i => i.severity === 'critical').length,
        уУсловия: APP.issues.every(i => i.title && i.desc && i.why),
    }));
    t.ok(h.здоровье > 0 && h.здоровье < 100, 'индекс здоровья посчитан: ' + h.здоровье);
    t.ok(Object.values(h.разделы).every(v => v >= 0 && v <= 100),
         'все пять разделов индекса в пределах 0…100');
    t.ok(h.критичных >= 1, 'есть хотя бы одна критичная находка: ' + h.критичных);
    t.ok(h.уУсловия, 'у каждого правила есть заголовок, описание и объяснение');

    t.раздел('Список находок отрисован');
    await страница(pg, 'quality');
    const вид = await pg.evaluate(() => ({
        карточек: document.querySelectorAll('.issue').length,
        сКнопкой: document.querySelectorAll('.issue-title .ib').length,
        фильтров: document.querySelectorAll('#sev-filter button').length,
    }));
    t.ok(вид.карточек === Object.keys(найдено).length,
         'карточек столько же, сколько правил: ' + вид.карточек);
    t.ok(вид.сКнопкой === вид.карточек, 'у каждой карточки своя кнопка (i)');
    t.ok(вид.фильтров >= 4, 'фильтр по важности на месте');
    await pg.close();

    t.раздел('Опрятная книга: лишнего не выдумано');
    const чисто = await открыть(b, 'clean.xlsx');
    const ч = await чисто.pg.evaluate(() => ({
        правила: APP.issues.map(i => i.id),
        здоровье: APP.health.total,
        скрытыхИмён: APP.books[0].names.filter(n => n.hidden).length,
    }));
    console.log('     сработало: ' + (ч.правила.join(', ') || '—'));
    const запрещённые = ['cell-errors', 'ref-broken', 'names-broken', 'calc-manual',
                         'hidden-sheets', 'names-hidden', 'vba', 'ext-local', 'col-gap'];
    const зря = ч.правила.filter(id => запрещённые.includes(id));
    t.ok(!зря.length, 'на чистой книге не сработало ни одно из «грязных» правил'
                      + (зря.length ? ': ' + зря.join(', ') : ''));
    t.ok(ч.скрытыхИмён === 0, 'скрытых имён в чистой книге нет');
    t.ok(ч.здоровье >= 90, 'индекс здоровья высокий: ' + ч.здоровье);
    ошибки.push(...чисто.ошибки);

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
