/* Книга доезжает до разбора: страницы открылись, объекты найдены,
   консоль чистая. Если падает этот набор — остальные можно не смотреть. */
const { браузер, открыть, страница, счёт } = require('../harness');

module.exports = async function () {
    const t = счёт('Разбор книги доходит до конца');
    const b = await браузер();
    const { pg, ошибки } = await открыть(b, 'messy.xlsm');

    t.раздел('Книга разобрана');
    const к = await pg.evaluate(() => {
        const b = APP.books[0];
        return { файл: b.fileName, формат: b.format, листов: b.sheets.length,
                 имён: b.names.length, таблиц: (b.tables || []).length,
                 vba: !!b.vba, пересчёт: (b.calc || {}).mode,
                 автор: (b.props || {}).creator,
                 внешних: (b.externalLinks || []).length,
                 типыУзлов: [...new Set(APP.graph.nodes.map(n => n.type))].sort(),
                 типыСвязей: [...new Set(APP.graph.edges.map(e => e.type))].sort(),
                 узлов: APP.graph.nodes.length, правил: APP.issues.length };
    });
    console.log('     ' + JSON.stringify(к));
    t.ok(к.формат === 'xlsm', 'формат определён: ' + к.формат);
    t.ok(к.листов === 5, 'найдены все пять листов, включая скрытые: ' + к.листов);
    t.ok(к.имён >= 50, 'именованные диапазоны собраны: ' + к.имён);
    t.ok(к.таблиц === 1, 'умная таблица найдена');
    t.ok(к.vba === true, 'макросы VBA замечены');
    t.ok(к.пересчёт === 'manual', 'ручной режим пересчёта прочитан');
    t.ok(к.автор === 'Иванова А. П.', 'автор из свойств файла: ' + к.автор);
    t.ok(к.внешних === 1, 'внешняя книга-источник найдена');
    // Книга собрана так, чтобы в графе оказались объекты всех четырёх видов
    // и связи трёх видов: пустой граф или граф из одних листов — это поломка.
    t.ok(JSON.stringify(к.типыУзлов) === JSON.stringify(['extbook', 'name', 'sheet', 'table']),
         'в графе объекты всех заложенных видов: ' + к.типыУзлов.join(', '));
    t.ok(JSON.stringify(к.типыСвязей) === JSON.stringify(['contains', 'ext', 'ref']),
         'связи всех заложенных видов: ' + к.типыСвязей.join(', '));
    t.ok(к.правил >= 12, 'правила качества сработали: ' + к.правил);

    t.раздел('Все разделы открываются');
    for (const p of ['overview', 'graph', 'sheets', 'formulas', 'pq', 'model', 'quality', 'cleanup', 'report']) {
        await страница(pg, p);
    }
    const пусто = await pg.evaluate(() =>
        [...document.querySelectorAll('.page-content')].filter(s => !s.innerText.trim()).map(s => s.id));
    t.ok(!пусто.length, 'ни один раздел не остался пустым' + (пусто.length ? ': ' + пусто : ''));

    const провалов = t.итог(ошибки);
    await b.close();
    return провалов;
};
