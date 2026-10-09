/* Листы, которые REX по ячейкам не разбирает.

   Потолок в 40 МБ стоит по делу: на листе в 97 МБ полный разбор не
   укладывается и в десять минут. Беда не в потолке, а в молчании. На
   настоящей книге REX показывал «ошибок в ячейках: 3» при ста двадцати
   трёх тысячах — и ни одного слова о том, что самый большой лист даже
   не открывали.

   Поэтому набор проверяет не скорость, а честность: обрезанный лист
   обязан быть помечен, его счётчики — пустыми, а не нулевыми, и об
   этом должно быть сказано на каждом экране, где число видно. */
const { браузер, открыть, страница, счёт } = require('../harness');

module.exports = async function () {
    const t = счёт('Большие листы');
    const b = await браузер();
    const { pg, ошибки } = await открыть(b, 'huge.xlsx');

    t.раздел('Лист помечен, а счётчики пусты');
    const лист = await pg.evaluate(() => {
        const s = APP.books[0].sheets.find(x => x.name === 'Журнал');
        return s && { обрезан: !!s.truncated, байт: s.scanBytes, формул: s.formulaCount,
                      ячеек: s.cellCount, ошибок: s.errorCount, констант: s.constCount,
                      виды: s.errKinds };
    });
    t.ok(лист && лист.обрезан, 'лист «Журнал» помечен как необработанный');
    t.ok(лист.байт > 40 * 1024 * 1024, 'размер запомнен: ' + лист.байт + ' байт');
    t.ok(лист.формул > 0, 'формулы всё же посчитаны по разметке: ' + лист.формул);
    // Это главное. undefined и 0 на экране выглядят одинаково, null — нет.
    t.ok(лист.ошибок === null, 'errorCount — null, а не ноль: ' + JSON.stringify(лист.ошибок));
    t.ok(лист.ячеек === null, 'cellCount — null, а не ноль: ' + JSON.stringify(лист.ячеек));
    t.ok(лист.констант === null, 'constCount — null, а не ноль');
    t.ok(лист.виды === null, 'errKinds — null, а не пустая карта');

    const малый = await pg.evaluate(() => {
        const s = APP.books[0].sheets.find(x => x.name === 'Свод');
        return s && { обрезан: !!s.truncated, ошибок: s.errorCount };
    });
    t.ok(малый && !малый.обрезан && малый.ошибок === 0,
         'малый лист разобран как обычно: ошибок ' + малый.ошибок);

    t.раздел('Обзор не выдаёт неполное число за полное');
    await страница(pg, 'overview');
    const обзор = await pg.evaluate(() => {
        const карточки = [...document.querySelectorAll('#overview-kpi .kpi')].map(k => ({
            имя: k.querySelector('.kpi-label').textContent.trim(),
            от: !!k.querySelector('.kpi-ge'),
            под: k.querySelector('.kpi-sub').textContent.trim(),
        }));
        const i = document.querySelector('#health-why .ib');
        return { карточки, пояснение: i ? i.dataset.info : '' };
    });
    const ош = обзор.карточки.find(k => k.имя === 'Ошибок');
    t.ok(ош && ош.от, 'карточка «Ошибок» помечена как нижняя граница («от»)');
    t.ok(ош && /больш/i.test(ош.под), 'подпись говорит, чего в числе нет: ' + (ош || {}).под);
    const связей = обзор.карточки.find(k => k.имя === 'Связей в графе');
    t.ok(связей && !связей.от, 'полные числа не помечены: «Связей в графе» без «от»');
    t.ok(/не разбирал/i.test(обзор.пояснение),
         'в (i) индекса здоровья сказано про неразобранные листы');
    t.ok(/балл/i.test(обзор.пояснение) && /хуже некуда/i.test(обзор.пояснение),
         '(i) объясняет, что «Ошибки 0» — это оценка, а не счётчик');
    const баллы = await pg.evaluate(() =>
        [...document.querySelectorAll('.health-bars .hb-max')].length);
    t.ok(баллы === 5, 'у всех пяти строк индекса подписано «/100»: ' + баллы);

    t.раздел('Таблица листов: «н/д» вместо нуля');
    await страница(pg, 'sheets');
    const строка = await pg.evaluate(() => {
        const tr = [...document.querySelectorAll('#sheets-tbody tr')]
            .find(r => /Журнал/.test(r.textContent));
        return tr ? tr.textContent.replace(/\s+/g, ' ') : null;
    });
    t.ok(строка && /н\/д/.test(строка), 'в строке листа «Журнал» стоит «н/д»: ' + строка);

    t.раздел('Качество данных: список объявлен неполным');
    await страница(pg, 'quality');
    const баннер = await pg.evaluate(() => {
        const el = document.querySelector('#quality-cut');
        if (!el || el.hidden) return null;
        const i = el.querySelector('.ib');
        return { текст: el.textContent.replace(/\s+/g, ' ').trim(),
                 пояснение: i ? i.dataset.info : '' };
    });
    t.ok(баннер, 'предупреждение на «Качестве данных» показано');
    t.ok(баннер && /неполон/i.test(баннер.текст), 'сказано прямо: ' + (баннер || {}).текст);
    t.ok(баннер && /Журнал/.test(баннер.пояснение), 'в (i) назван сам лист');
    t.ok(баннер && /МБ/.test(баннер.пояснение), 'в (i) назван его размер');

    t.раздел('Оговорка о влиянии');
    const оговорки = await pg.evaluate(() => impactCaveats().map(c => c.id + '|' + c.title + '|' + c.text));
    const big = оговорки.find(x => x.startsWith('big|'));
    t.ok(big, 'оговорка «big» в списке есть');
    t.ok(big && /Журнал/.test(big), 'оговорка называет лист: ' + (big || '').slice(0, 120));

    t.раздел('Отчёт в markdown тоже оговаривается');
    const отчёт = await pg.evaluate(() => buildMarkdown());
    t.ok(/Отчёт неполон/.test(отчёт), 'в отчёте есть врезка «Отчёт неполон»');
    t.ok(/\| Журнал \|[^|]*\|[^|]*\|[^|]*\| н\/д \| н\/д \|/.test(отчёт),
         'в таблице листов у «Журнала» стоит «н/д», а не 0');

    t.раздел('Правило про ошибки не придумало находок');
    const ошибкиПравило = await pg.evaluate(() =>
        (APP.issues.find(i => i.id === 'cell-errors') || {}).count ?? null);
    t.ok(ошибкиПравило === null, 'правило cell-errors не сработало: по ячейкам ничего не читали');

    await pg.close();
    await b.close();
    return t.итог(ошибки);
};
